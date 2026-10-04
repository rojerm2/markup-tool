import { expect, it } from "vitest";
import {
  emptySession,
  type AnnotationSession,
} from "../src/services/annotationSession";
import { defaultExportSelection } from "../src/services/exportSelection";
import {
  buildMarkupReport,
  markupReportCsv,
  reportCsvCell,
} from "../src/services/markupReport";
import { TEXT_DEFAULTS } from "../src/services/notes";

const session: AnnotationSession = {
  ...emptySession,
  legends: [
    { id: "walls", name: "Walls", color: "#facc15" },
    { id: "real", name: "Unassigned", color: "#ff0000" },
  ],
  notes: [
    {
      ...TEXT_DEFAULTS,
      id: "note",
      type: "text",
      page: 3,
      x: 20,
      y: 200,
      rotation: 0,
      width: 200,
      height: 60,
      text: '=HYPERLINK("example")\nReview, "Door"',
    },
  ],
  measurements: [
    {
      id: "l",
      type: "length",
      page: 1,
      points: [
        { x: 0, y: 0 },
        { x: 3, y: 4 },
      ],
      color: "#0284c7",
      width: 2,
      fontSize: 12,
    },
    {
      id: "a",
      type: "area",
      page: 3,
      points: [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 4, y: 3 },
        { x: 0, y: 3 },
      ],
      color: "#0284c7",
      width: 2,
      fontSize: 12,
    },
    {
      id: "u",
      type: "length",
      page: 2,
      points: [
        { x: 0, y: 0 },
        { x: 3, y: 4 },
      ],
      color: "#0284c7",
      width: 2,
      fontSize: 12,
    },
  ],
  calibrations: [
    { page: 1, a: { x: 0, y: 0 }, b: { x: 1, y: 0 }, distance: 2, unit: "m" },
    { page: 3, a: { x: 0, y: 0 }, b: { x: 1, y: 0 }, distance: 10, unit: "cm" },
  ],
  objectCategories: { l: "walls", a: "real" },
};

it("maps original/export page numbers, notes and calibrated values, separates totals by unit/kind/calibration and leaves source unchanged", () => {
  const before = structuredClone(session),
    report = buildMarkupReport(session, defaultExportSelection(3), 3);
  expect(report.rows).toHaveLength(4);
  expect(report.rows.find((r) => r.id === "l")).toMatchObject({
    length: 10,
    unit: "m",
    calibrated: true,
    category: "Walls",
    sourcePage: 1,
    exportPage: 1,
  });
  expect(report.rows.find((r) => r.id === "a")).toMatchObject({
    area: 1200,
    perimeter: 140,
    unit: "cm",
    calibrated: true,
  });
  expect(report.totals).toEqual(
    expect.arrayContaining([
      { kind: "length", unit: "m", calibrated: true, value: 10, count: 1 },
      {
        kind: "length",
        unit: "PDF units",
        calibrated: false,
        value: 5,
        count: 1,
      },
      { kind: "area", unit: "cm²", calibrated: true, value: 1200, count: 1 },
      { kind: "perimeter", unit: "cm", calibrated: true, value: 140, count: 1 },
    ]),
  );
  expect(report.counts.reduce((n, c) => n + c.count, 0)).toBe(4);
  expect(report.rows.find((r) => r.id === "note")?.notes).toBe(
    session.notes![0].type === "text" ? session.notes![0].text : "",
  );
  const selected = buildMarkupReport(
    session,
    { ...defaultExportSelection(3), pages: [3] },
    3,
  );
  expect(
    selected.rows.every((r) => r.sourcePage === 3 && r.exportPage === 1),
  ).toBe(true);
  expect(selected.totals.some((t) => t.unit === "m")).toBe(false);
  expect(session).toEqual(before);
});

it("neutralizes formula prefixes and control-led cells while quoting embedded commas, quotes, newlines and Unicode", () => {
  for (const text of [
    "=SUM(1)",
    "+1",
    "-1",
    "@SUM(1)",
    "  =1",
    "\t=1",
    "\r=1",
    "\n=1",
    "\uFEFF=1",
  ]) {
    expect(reportCsvCell(text)).toBe("\"'" + text.replace(/"/g, '""') + '"');
  }
  expect(reportCsvCell('Δ, "door"\nWalls')).toBe('"Δ, ""door""\nWalls"');
  expect(reportCsvCell(-2)).toBe('"-2"');
  expect(reportCsvCell(null)).toBe('""');
  const csv = markupReportCsv(
    buildMarkupReport(session, defaultExportSelection(3), 3),
  );
  expect(csv.startsWith('\uFEFF"Record type","Source page"')).toBe(true);
  expect(csv).toContain('"\'=HYPERLINK(""example"")');
  const records = csvRecords(csv);
  expect(records.every((r) => r.length === records[0].length)).toBe(true);
  const header = records[0],
    totals = records.filter((r) => r[0] === "Total");
  expect(
    totals.find((r) => r[header.indexOf("Measurement type")] === "area")![
      header.indexOf("Area")
    ],
  ).toBe("1200");
  expect(
    totals.find((r) => r[header.indexOf("Measurement type")] === "area")![
      header.indexOf("Area unit")
    ],
  ).toBe("cm²");
});

it("does not merge a category named Unassigned with truly unassigned counts and handles an empty report", () => {
  const categories = {
    ...session,
    objectCategories: { ...session.objectCategories, note: "real" },
    annotations: [
      {
        id: "named",
        type: "freehand" as const,
        page: 3,
        legendId: "real",
        color: "#ff0000",
        width: 10,
        opacity: 0.4,
        points: [
          { x: 10, y: 10 },
          { x: 30, y: 10 },
        ],
      },
      {
        id: "none",
        type: "freehand" as const,
        page: 3,
        legendId: null,
        color: "#ff0000",
        width: 10,
        opacity: 0.4,
        points: [
          { x: 10, y: 10 },
          { x: 30, y: 10 },
        ],
      },
    ],
  };
  const report = buildMarkupReport(categories, defaultExportSelection(3), 3);
  expect(report.counts.reduce((n, c) => n + c.count, 0)).toBe(
    report.rows.length,
  );
  const highlights = report.counts.filter((c) => c.type === "highlight");
  expect(highlights).toHaveLength(2);
  expect(highlights.map((c) => c.categoryId)).toEqual(["real", null]);
  const empty = buildMarkupReport(emptySession, defaultExportSelection(1), 1);
  expect(empty).toEqual({ pages: [1], rows: [], counts: [], totals: [] });
  expect(csvRecords(markupReportCsv(empty))).toHaveLength(1);
});

// Independent reader checks actual CSV records, including embedded quoted newlines.
function csvRecords(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    field = "",
    quoted = false;
  for (let i = text.startsWith("\uFEFF") ? 1 : 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = !quoted;
    } else if (!quoted && c === ",") {
      row.push(field);
      field = "";
    } else if (!quoted && c === "\r" && text[i + 1] === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
    } else field += c;
  }
  expect(quoted).toBe(false);
  return rows;
}
