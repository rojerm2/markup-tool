// @vitest-environment node
import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { generateReportPdf } from "../src/services/reportPdf";
import type { MarkupReport } from "../src/services/markupReport";

it("paginates report details, preserves count/unit/calibration semantics, escapes unsupported text and keeps contents within margins", async () => {
  const report: MarkupReport = {
      pages: [3],
      rows: Array.from({ length: 30 }, (_, i) => ({
        id: `markup-${i}`,
        sourcePage: 3,
        exportPage: 1,
        type: "text",
        detail: "Review",
        category: "Walls",
        categoryId: "walls",
        color: "#facc15",
        notes:
          `Door ${i}: Δ wall review. ` + "W".repeat(180) + "\nSecond line 🧱",
        measurement: "",
        calibrated: null,
        unit: "",
        areaUnit: "",
        length: null,
        area: null,
        perimeter: null,
      })),
      counts: [
        {
          page: 3,
          type: "text",
          category: "Walls",
          categoryId: "walls",
          count: 30,
        },
      ],
      totals: [
        {
          kind: "length",
          unit: "m",
          calibrated: true,
          value: 1000000000,
          count: 1,
        },
        { kind: "area", unit: "cm²", calibrated: true, value: 1200, count: 1 },
        {
          kind: "length",
          unit: "PDF units",
          calibrated: false,
          value: 5,
          count: 1,
        },
      ],
    },
    snapshot = structuredClone(report),
    fontBytes = new Uint8Array(
      readFileSync(new URL("../src/assets/LegendSans.ttf", import.meta.url)),
    ),
    bytes = await generateReportPdf(report, "Original 🧱.pdf", fontBytes),
    parsed = await PDFDocument.load(bytes);
  expect(parsed.getPageCount()).toBeGreaterThan(1);
  expect(report).toEqual(snapshot);
  const task = getDocument({ data: bytes.slice() }),
    document = await task.promise;
  const text: string[] = [];
  try {
    for (let number = 1; number <= document.numPages; number++) {
      const page = await document.getPage(number),
        content = await page.getTextContent();
      const items = content.items.filter((i) => "str" in i);
      text.push(items.map((i) => i.str).join(" "));
      expect(
        items.some((i) => i.str === `${number} of ${document.numPages}`),
      ).toBe(true);
      for (const item of items) {
        expect(item.transform[4]).toBeGreaterThanOrEqual(35.9);
        expect(item.transform[4] + item.width).toBeLessThanOrEqual(560);
        expect(item.transform[5]).toBeGreaterThanOrEqual(19.9);
        expect(item.transform[5]).toBeLessThan(806);
      }
    }
    const all = text.join(" ");
    expect(all).toContain("1,000,000,000 m");
    expect(all).toContain("1,200 cm²");
    expect(all).toContain("5 PDF units | Uncalibrated");
    expect(all).toContain("[U+1F9F1]");
    expect(all).toContain("Source page 3 -> Export page 1");
    expect(all).toContain("markup-29");
  } finally {
    await task.destroy();
  }
});
