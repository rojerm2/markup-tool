import { generateAnnotatedPdf } from "./pdfExport";
import type { AnnotationSession } from "./annotationSession";
import type { ExportSelection } from "./exportSelection";
self.onmessage = async ({
  data,
}: MessageEvent<{
  bytes: Uint8Array;
  session: AnnotationSession;
  selection?: ExportSelection;
}>) => {
  try {
    const bytes = await generateAnnotatedPdf(
      data.bytes,
      data.session,
      undefined,
      (progress) => self.postMessage({ progress }),
      data.selection,
    );
    self.postMessage({ bytes }, { transfer: [bytes.buffer] });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
