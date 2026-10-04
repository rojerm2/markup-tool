import { buildMarkupReport, markupReportCsv } from "./markupReport";
import { generateReportPdf } from "./reportPdf";
import type { AnnotationSession } from "./annotationSession";
import type { ExportSelection } from "./exportSelection";

self.onmessage = async ({
  data,
}: MessageEvent<{
  session: AnnotationSession;
  selection: ExportSelection;
  pageCount: number;
  filename: string;
  format: "csv" | "pdf";
}>) => {
  try {
    const report = buildMarkupReport(
      data.session,
      data.selection,
      data.pageCount,
    );
    const bytes =
      data.format === "csv"
        ? new TextEncoder().encode(markupReportCsv(report))
        : await generateReportPdf(report, data.filename);
    self.postMessage({ bytes }, { transfer: [bytes.buffer] });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
