import { readFile } from "@tauri-apps/plugin-fs";
import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";

GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url,
).toString();

// Preserve the native picker's path, including spaces and UNC shares.
// The caller owns this document until it aborts the supplied signal.
export async function loadDocument(filePath: string, signal: AbortSignal) {
  const bytes = await readFile(filePath);
  signal.throwIfAborted();
  const assets = new URL(`${import.meta.env.BASE_URL}pdfjs/`, window.location.href);
  const task = getDocument({
    data: bytes,
    cMapUrl: new URL("cmaps/", assets).href,
    cMapPacked: true,
    standardFontDataUrl: new URL("standard_fonts/", assets).href,
    wasmUrl: new URL("wasm/", assets).href,
  });
  const destroy = () => {
    void task.destroy().catch((error: unknown) => console.error("PDF cleanup failed", error));
  };
  signal.addEventListener("abort", destroy, { once: true });
  try {
    return await task.promise;
  } catch (error) {
    signal.removeEventListener("abort", destroy);
    destroy();
    throw error;
  }
}
