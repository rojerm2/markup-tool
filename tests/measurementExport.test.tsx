// @vitest-environment node
import { expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import {
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  decodePDFRawStream,
  degrees,
} from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { generateAnnotatedPdf } from "../src/services/pdfExport";
import { emptySession } from "../src/services/annotationSession";
import {
  measurementLabel,
  measurementTextLayout,
  type Measurement,
} from "../src/services/measurements";

it("exports vector measurement geometry and matching labels on cropped, rotated UserUnit pages", async () => {
  const original = await PDFDocument.create();
  for (const rotation of [0, 90, 180, 270]) {
    const p = original.addPage([600, 800]);
    p.setRotation(degrees(rotation));
    p.setMediaBox(-30, 0, 600, 800);
    p.setCropBox(-10, 10, 560, 760);
    p.node.set(PDFName.of("UserUnit"), PDFNumber.of(2));
  }
  const source = await original.save(),
    before = source.slice(),
    fontBytes = new Uint8Array(
      await readFile(new URL("../src/assets/LegendSans.ttf", import.meta.url)),
    );
  const measurements: Measurement[] = [0, 1, 2, 3].flatMap((i) => [
      {
        id: `length-${i}`,
        page: i + 1,
        type: "length" as const,
        points: [
          { x: 100, y: 200 },
          { x: 200, y: 200 },
        ],
        color: "#0284c7",
        width: 2,
        fontSize: 12,
      },
      {
        id: `area-${i}`,
        page: i + 1,
        type: "area" as const,
        points: [
          { x: 100, y: 300 },
          { x: 200, y: 300 },
          { x: 200, y: 350 },
          { x: 100, y: 350 },
        ],
        color: "#0284c7",
        width: 2,
        fontSize: 12,
      },
    ]),
    calibrations = [1, 2, 3].map((page) => ({
      page,
      a: { x: 100, y: 200 },
      b: { x: 200, y: 200 },
      distance: 10,
      unit: "m" as const,
    }));
  const exported = await generateAnnotatedPdf(
      source,
      { ...emptySession, measurements, calibrations },
      fontBytes,
    ),
    parsed = await PDFDocument.load(exported),
    task = getDocument({ data: new Uint8Array(exported) }),
    rendered = await task.promise;
  expect(source).toEqual(before);
  expect(parsed.getPageCount()).toBe(4);
  for (let i = 0; i < 4; i++) {
    const page = parsed.getPage(i);
    expect(page.getCropBox()).toEqual(original.getPage(i).getCropBox());
    expect(page.getRotation().angle).toBe(i * 90);
    expect(page.node.get(PDFName.of("UserUnit"))!.toString()).toBe("2");
    const contents = page.node.Contents()!;
    const streams = Array.from({ length: contents.size() }, (_, i) =>
      parsed.context.lookup(contents.get(i), PDFRawStream),
    );
    const commands = streams
      .map((s) => new TextDecoder().decode(decodePDFRawStream(s).decode()))
      .join("\n");
    expect(commands).toContain("100 200 m");
    expect(commands).toContain("200 200 l");
    expect(commands).toContain("100 350 l");
    const text = (await (await rendered.getPage(i + 1)).getTextContent()).items
      .map((item) => ("str" in item ? item.str : ""))
      .join("");
    const length = measurements[i * 2],
      area = measurements[i * 2 + 1],
      calibration = calibrations.find((c) => c.page === i + 1);
    expect(text).toContain(measurementLabel(length, calibration));
    expect(text).toContain(measurementLabel(area, calibration));
    expect(commands).toContain(
      `1 0 0 -1 ${measurementTextLayout(length, calibration).x}`,
    );
  }
  await task.destroy();
});

it("rejects invalid or duplicate calibration and invalid measurement data before writing export output", async () => {
  const pdf = await PDFDocument.create();
  pdf.addPage();
  const source = await pdf.save();
  const calibration = {
    page: 1,
    a: { x: 0, y: 0 },
    b: { x: 100, y: 0 },
    distance: 10,
    unit: "m" as const,
  };
  for (const calibrations of [
    [calibration, calibration],
    [{ ...calibration, distance: 0 }],
    [{ ...calibration, page: 2 }],
  ])
    await expect(
      generateAnnotatedPdf(source, { ...emptySession, calibrations }),
    ).rejects.toThrow("Invalid measurement");
  await expect(
    generateAnnotatedPdf(source, {
      ...emptySession,
      measurements: [
        {
          id: "bad",
          page: 1,
          type: "length",
          points: [
            { x: 0, y: 0 },
            { x: 0, y: 0 },
          ],
          color: "#0284c7",
          width: 2,
          fontSize: 12,
        },
      ],
    }),
  ).rejects.toThrow("Invalid measurement");
});
