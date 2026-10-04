import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import type { AnnotationSession } from "./annotationSession";
import { serializeProject, type SourceIdentity } from "./projectFormat";
import {
  validateExportSelection,
  type ExportSelection,
} from "./exportSelection";

export type ExportProgress =
  | "Reading PDF…"
  | "Preparing pages…"
  | "Adding markup…"
  | "Building PDF…"
  | "Building report…"
  | "Saving report…"
  | "Opening print preview…"
  | "Saving PDF…";

export function generateInWorker(
  bytes: Uint8Array,
  session: AnnotationSession,
  signal: AbortSignal,
  onProgress?: (stage: ExportProgress) => void,
  selection?: ExportSelection,
): Promise<Uint8Array> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    let finished = false;
    const worker = new Worker(
      new URL("./pdfExport.worker.ts", import.meta.url),
      { type: "module" },
    );
    const finish = () => {
      finished = true;
      worker.terminate();
      signal.removeEventListener("abort", abort);
    };
    const abort = () => {
      finish();
      reject(new DOMException("Export cancelled", "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
    worker.onerror = (event) => {
      if (finished) return;
      finish();
      reject(new Error(event.message));
    };
    worker.onmessage = ({ data }) => {
      if (finished) return;
      if (data.progress) {
        onProgress?.(data.progress);
        return;
      }
      finish();
      if (data.error) reject(new Error(data.error));
      else resolve(data.bytes);
    };
    worker.postMessage(
      { bytes, session, ...(selection ? { selection } : {}) },
      [bytes.buffer],
    );
  });
}

export async function exportPdf(
  sourcePath: string,
  projectPath: string | null,
  source: SourceIdentity,
  session: AnnotationSession,
  signal: AbortSignal,
  onProgress?: (stage: ExportProgress) => void,
  options?: ExportSelection,
): Promise<string | null> {
  // Reuse schema/resource validation; this does not change the saved baseline.
  serializeProject(source, session);
  const selection = options
    ? validateExportSelection(options, source.pages, session)
    : undefined;
  signal.throwIfAborted();
  const path = await save({
    title: "Export Annotated PDF",
    defaultPath: source.filename.replace(/\.pdf$/i, "") + "_Marked.pdf",
    filters: [{ name: "Annotated PDF", extensions: ["pdf"] }],
  });
  signal.throwIfAborted();
  if (!path) return null;
  const identity = { sourcePath, size: source.size, sha256: source.sha256 };
  onProgress?.("Reading PDF…");
  const bytes = new Uint8Array(
    await invoke<ArrayBuffer>("read_export_source", identity),
  );
  signal.throwIfAborted();
  const output = await generateInWorker(
    bytes,
    session,
    signal,
    onProgress,
    selection,
  );
  signal.throwIfAborted();
  onProgress?.("Saving PDF…");
  // Only small metadata is JSON. Keep PDF bytes binary across the native bridge.
  // Escape non-ASCII filenames for HTTP header compatibility, including Unicode.
  const metadata = JSON.stringify({ ...identity, path, projectPath }).replace(
    /[^\x20-\x7e]/g,
    (character) =>
      `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
  await invoke("write_export", output, {
    headers: { "x-export-metadata": metadata },
  });
  return path;
}

export async function printPdf(
  sourcePath: string,
  source: SourceIdentity,
  session: AnnotationSession,
  signal: AbortSignal,
  onProgress?: (stage: ExportProgress) => void,
  options?: ExportSelection,
): Promise<void> {
  serializeProject(source, session);
  const selection = options
    ? validateExportSelection(options, source.pages, session)
    : undefined;
  signal.throwIfAborted();
  const identity = { sourcePath, size: source.size, sha256: source.sha256 };
  onProgress?.("Reading PDF…");
  const bytes = new Uint8Array(
    await invoke<ArrayBuffer>("read_export_source", identity),
  );
  signal.throwIfAborted();
  const output = await generateInWorker(
    bytes,
    session,
    signal,
    onProgress,
    selection,
  );
  signal.throwIfAborted();
  const metadata = JSON.stringify({
    ...identity,
    filename: source.filename,
  }).replace(
    /[^\x20-\x7e]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
  onProgress?.("Opening print preview…");
  await invoke("print_annotated_pdf", output, {
    headers: { "x-print-metadata": metadata },
  });
}
