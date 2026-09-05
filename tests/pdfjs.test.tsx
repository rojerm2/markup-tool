// @vitest-environment node
import { expect, it } from "vitest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { clientToPdf, pdfToClient, pdfToViewport, viewportToPdf, fitScale, pdfWidthToViewport } from "../src/services/coordinates";

// A tiny two-page vector PDF built without an additional PDF-writing dependency.
function fixture(rotation = 90, cropped = false, userUnit = 1) {
  const stream = "0 0 0 RG 2 w 10 10 m 90 90 l S\n";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << >> /Contents 5 0 R >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${cropped ? "300 200" : "200 100"}] ${cropped ? "/CropBox [20 30 220 130]" : ""} /UserUnit ${userUnit} /Rotate ${rotation} /Resources << >> /Contents 5 0 R >>`,
    `<< /Length ${stream.length} >>\nstream\n${stream}endstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 6\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}

it("real PDF.js parses two local pages, including rotation, without changing source bytes", async () => {
  const original = fixture();
  const before = original.slice();
  const task = getDocument({ data: original.slice() });
  try {
    const pdf = await task.promise;
    expect(pdf.numPages).toBe(2);
    const first = await pdf.getPage(1);
    const second = await pdf.getPage(2);
    expect(first.getViewport({ scale: 1 }).width).toBe(100);
    const rotated = second.getViewport({ scale: 1 });
    expect([rotated.width, rotated.height]).toEqual([100, 200]);
    expect((await first.getOperatorList()).fnArray.length).toBeGreaterThan(0);
    expect(original).toEqual(before);
  } finally { await task.destroy(); }
});

it("real PDF.js rejects corrupt input", async () => {
  const task = getDocument({ data: new TextEncoder().encode("Not a PDF") });
  try { await expect(task.promise).rejects.toThrow(); }
  finally { await task.destroy(); }
});

it.each([
  [0, 20, 80], [90, 20, 20], [180, 180, 20], [270, 80, 180],
])("preserves cropped PDF coordinates at rotation %i across zoom and client offsets", async (rotation, x, y) => {
  const task = getDocument({ data: fixture(rotation, true) });
  try {
    const page = await (await task.promise).getPage(2);
    expect(page.view).toEqual([20, 30, 220, 130]);
    for (const scale of [0.1, 1, 2, 8]) {
      const viewport = page.getViewport({ scale });
      const stored = { x: 40, y: 50 };
      expect(pdfToViewport(stored, viewport)).toEqual({ x: x * scale, y: y * scale });
      for (const point of [stored, { x: 20, y: 30 }, { x: 220, y: 130 }, { x: -15.5, y: 140.25 }]) {
        const converted = viewportToPdf(pdfToViewport(point, viewport), viewport);
        expect(converted.x).toBeCloseTo(point.x, 8);
        expect(converted.y).toBeCloseTo(point.y, 8);
        // Client rectangles include scrolling/pan and possible CSS scaling;
        // none of these affect the persisted PDF point.
        const rect = { left: -350, top: 71, width: viewport.width * 0.75, height: viewport.height * 0.75 };
        const client = pdfToClient(point, rect, viewport);
        const result = clientToPdf(client, rect, viewport);
        expect(result.x).toBeCloseTo(point.x, 8);
        expect(result.y).toBeCloseTo(point.y, 8);
      }
    }
  } finally { await task.destroy(); }
});

it("uses PDF UserUnit and rotated crop dimensions when fitting a sheet", async () => {
  const task = getDocument({ data: fixture(90, true, 2) });
  try {
    const page = await (await task.promise).getPage(2);
    const viewport = page.getViewport({ scale: 1 });
    expect([viewport.width, viewport.height]).toEqual([200, 400]);
    for (const scale of [.1, 1, 2, 8]) {
      expect(pdfWidthToViewport(20, page.getViewport({ scale }))).toBeCloseTo(40 * scale);
    }
    expect(pdfToViewport({ x: 40, y: 50 }, viewport)).toEqual({ x: 40, y: 40 });
    expect(fitScale(viewport, { width: 600, height: 400 }, "page")).toBe(1);
    expect(fitScale(viewport, { width: 600, height: 400 }, "width")).toBe(3);
    expect(fitScale({ width: 100000, height: 100000 }, { width: 600, height: 400 }, "page")).toBe(0.004);
  } finally { await task.destroy(); }
});
