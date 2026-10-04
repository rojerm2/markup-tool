import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import type { AnnotationSession } from "./annotationSession";
import { serializeProject, type SourceIdentity } from "./projectFormat";
import {
  validateExportSelection,
  type ExportSelection,
} from "./exportSelection";
import type { ExportProgress } from "./exportService";

export function generateReportInWorker(
  source: SourceIdentity,
  session: AnnotationSession,
  selection: ExportSelection,
  format: "csv" | "pdf",
  signal: AbortSignal,
): Promise<Uint8Array> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./report.worker.ts", import.meta.url), {
      type: "module",
    });
    let finished = false;
    const finish = () => {
      finished = true;
      worker.terminate();
      signal.removeEventListener("abort", abort);
    };
    const abort = () => {
      finish();
      reject(new DOMException("Report cancelled", "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
    worker.onerror = (event) => {
      if (finished) return;
      finish();
      reject(new Error(event.message));
    };
    worker.onmessage = ({ data }) => {
      if (finished) return;
      finish();
      if (data.error) reject(new Error(data.error));
      else resolve(data.bytes);
    };
    // Filename is for the report heading. No source paths or PDF bytes enter this worker.
    worker.postMessage({
      session,
      selection,
      format,
      pageCount: source.pages,
      filename: source.filename,
    });
  });
}

export async function exportReport(
  sourcePath: string,
  projectPath: string | null,
  source: SourceIdentity,
  session: AnnotationSession,
  options: ExportSelection,
  format: "csv" | "pdf",
  signal: AbortSignal,
  onProgress?: (stage: ExportProgress) => void,
): Promise<string | null> {
  serializeProject(source, session);
  const selection = validateExportSelection(options, source.pages, session);
  signal.throwIfAborted();
  const path = await save({
    title: `Export ${format.toUpperCase()} Markup Report`,
    defaultPath: source.filename.replace(/\.pdf$/i, "") + `_Report.${format}`,
    filters: [{ name: `${format.toUpperCase()} Report`, extensions: [format] }],
  });
  signal.throwIfAborted();
  if (!path) return null;
  onProgress?.("Building report…");
  const output = await generateReportInWorker(
    source,
    session,
    selection,
    format,
    signal,
  );
  signal.throwIfAborted();
  onProgress?.("Saving report…");
  const metadata = JSON.stringify({
    sourcePath,
    projectPath,
    path,
    size: source.size,
    sha256: source.sha256,
  }).replace(
    /[^\x20-\x7e]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
  await invoke(format === "csv" ? "write_report_csv" : "write_export", output, {
    headers: { "x-export-metadata": metadata },
  });
  // An atomic publish has completed. A late abort must not misreport a saved report as cancelled.
  return path;
}
