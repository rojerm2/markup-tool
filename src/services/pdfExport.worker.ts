import { generateAnnotatedPdf } from './pdfExport';
import type { AnnotationSession } from './annotationSession';
self.onmessage = async ({ data }: MessageEvent<{ bytes: Uint8Array; session: AnnotationSession }>) => {
  try {
    const bytes = await generateAnnotatedPdf(data.bytes, data.session);
    self.postMessage({ bytes }, { transfer: [bytes.buffer] });
  } catch (error) { self.postMessage({ error: error instanceof Error ? error.message : String(error) }); }
};
