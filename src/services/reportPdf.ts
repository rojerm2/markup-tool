import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb } from "pdf-lib";
import fontUrl from "../assets/LegendSans.ttf?url";
import type { MarkupReport } from "./markupReport";

/** Text-only report; original drawing geometry remains in the annotated PDF export. */
export async function generateReportPdf(
  report: MarkupReport,
  filename: string,
  fontBytes?: Uint8Array,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(
    fontBytes ?? new Uint8Array(await (await fetch(fontUrl)).arrayBuffer()),
    { subset: true },
  );
  const supported = new Set(font.getCharacterSet()),
    safe = (text: string) =>
      [...text]
        .map((c) =>
          c === "\n" || supported.has(c.codePointAt(0)!)
            ? c
            : `[U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}]`,
        )
        .join(""),
    width = 595.28,
    height = 841.89,
    margin = 36,
    contentWidth = width - margin * 2;
  let page = pdf.addPage([width, height]),
    y = height - margin;

  function nextPage() {
    if (pdf.getPageCount() >= 10000)
      throw new Error(
        "Report exceeds 10,000 pages. Select fewer pages or categories.",
      );
    page = pdf.addPage([width, height]);
    y = height - margin;
  }

  function line(text: string, size = 10, muted = false) {
    if (y - size * 1.5 < margin + 15) nextPage();
    y -= size;
    page.drawText(text, {
      x: margin,
      y,
      font,
      size,
      color: muted ? rgb(0.35, 0.4, 0.45) : rgb(0.12, 0.16, 0.2),
    });
    y -= size * 0.5;
  }

  function text(value: string, size = 10, muted = false) {
    for (const paragraph of safe(value).split("\n")) {
      let current = "",
        advance = 0;
      for (const c of paragraph) {
        const step = font.widthOfTextAtSize(c, size);
        if (current && advance + step > contentWidth) {
          line(current, size, muted);
          current = "";
          advance = 0;
        }
        current += c;
        advance += step;
      }
      line(current, size, muted);
    }
  }

  function heading(value: string) {
    y -= 8;
    text(value, 13);
    y -= 4;
  }

  text("PDF Markup - Markup report", 18);
  text(filename, 11);
  text(
    `${report.pages.length} source ${report.pages.length === 1 ? "page" : "pages"} selected | ${report.rows.length} ${report.rows.length === 1 ? "markup" : "markups"}`,
    10,
    true,
  );
  text(
    "Source page numbers refer to the original document; export page numbers refer to the selected-page PDF.",
    9,
    true,
  );
  text(
    "Measurements are drawing review aids, not certified engineering results. Units and calibration status are shown separately.",
    9,
    true,
  );
  text(
    "Unsupported font characters appear as [U+XXXX]. CSV retains the original text.",
    9,
    true,
  );
  heading("Summary");
  const counts = new Map<
    string,
    { type: string; category: string; count: number }
  >();
  for (const c of report.counts) {
    const key = JSON.stringify([c.type, c.categoryId]),
      current = counts.get(key) ?? {
        type: c.type,
        category:
          c.categoryId === null ? `${c.category} (no category)` : c.category,
        count: 0,
      };
    current.count += c.count;
    counts.set(key, current);
  }
  for (const c of counts.values())
    text(`${c.type} | ${c.category} | ${c.count}`);
  if (!counts.size) text("No markups match this selection.");
  heading("Measurement totals");
  for (const total of report.totals)
    text(
      `${total.kind}: ${new Intl.NumberFormat("en-US", { maximumSignificantDigits: 10 }).format(total.value)} ${total.unit} | ${total.calibrated ? "Calibrated" : "Uncalibrated"} | ${total.count} ${total.count === 1 ? "value" : "values"}`,
    );
  if (!report.totals.length) text("No measurements match this selection.");
  heading("Markup details");
  for (const row of report.rows) {
    y -= 5;
    text(
      `Source page ${row.sourcePage} -> Export page ${row.exportPage} | ${row.type} | ${row.categoryId === null ? `${row.category} (no category)` : row.category}`,
      10,
    );
    text(`ID: ${row.id} | Color: ${row.color}`, 8, true);
    if (row.type !== "text") text(row.detail);
    if (row.notes) text(row.notes);
    if (row.calibrated !== null) {
      text(
        `${row.calibrated ? "Calibrated" : "Uncalibrated"}: ${[
          row.length === null ? null : `Length ${row.length} ${row.unit}`,
          row.area === null ? null : `Area ${row.area} ${row.areaUnit}`,
          row.perimeter === null
            ? null
            : `Perimeter ${row.perimeter} ${row.unit}`,
        ]
          .filter(Boolean)
          .join(" | ")}`,
        9,
        true,
      );
    }
  }
  for (const [i, p] of pdf.getPages().entries())
    p.drawText(`${i + 1} of ${pdf.getPageCount()}`, {
      x: margin,
      y: 20,
      font,
      size: 8,
      color: rgb(0.35, 0.4, 0.45),
    });
  return pdf.save({ objectsPerTick: Infinity });
}
