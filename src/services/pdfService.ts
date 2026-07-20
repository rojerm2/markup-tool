import * as pdfjsLib from "pdfjs-dist";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.mjs",
  import.meta.url,
).toString();

export default pdfjsLib;

export async function loadPdf(file: Uint8Array) {
  const loadingTask = pdfjsLib.getDocument({
    data: file,
  });

  return await loadingTask.promise;
}
