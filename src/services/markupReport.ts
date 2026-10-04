import type { AnnotationSession } from "./annotationSession";
import {
  selectExportSession,
  validateExportSelection,
  type ExportSelection,
} from "./exportSelection";
import { markupRows, type MarkupType } from "./markupList";
import { measurementValues } from "./measurements";

export type ReportRow = {
  id: string;
  sourcePage: number;
  exportPage: number;
  type: MarkupType;
  detail: string;
  category: string;
  categoryId: string | null;
  color: string;
  notes: string;
  measurement: "length" | "area" | "perimeter" | "";
  calibrated: boolean | null;
  unit: string;
  areaUnit: string;
  length: number | null;
  area: number | null;
  perimeter: number | null;
};
export type ReportTotal = {
  kind: "length" | "area" | "perimeter";
  unit: string;
  calibrated: boolean;
  value: number;
  count: number;
};
export type MarkupReport = {
  pages: number[];
  rows: ReportRow[];
  counts: {
    page: number;
    type: MarkupType;
    category: string;
    categoryId: string | null;
    count: number;
  }[];
  totals: ReportTotal[];
};
export const MAX_REPORT_CSV_BYTES = 64 * 1024 * 1024;

export function buildMarkupReport(
  session: AnnotationSession,
  selection: ExportSelection,
  pageCount: number,
): MarkupReport {
  const valid = validateExportSelection(selection, pageCount, session),
    selected = selectExportSession(session, valid, pageCount),
    pageMap = new Map(valid.pages.map((p, i) => [p, i + 1])),
    measures = new Map(selected.measurements?.map((m) => [m.id, m])),
    calibrations = new Map(selected.calibrations?.map((c) => [c.page, c])),
    notes = new Map(
      selected.notes
        ?.filter((n) => n.type === "text")
        .map((n) => [n.id, n.text]),
    ),
    counts = new Map<string, MarkupReport["counts"][number]>(),
    totals = new Map<string, ReportTotal>();
  const rows = markupRows(selected).map((row) => {
    const result: ReportRow = {
      id: row.id,
      sourcePage: row.page,
      exportPage: pageMap.get(row.page)!,
      type: row.type,
      detail: row.label,
      category: row.category,
      categoryId: row.categoryId,
      color: row.color,
      notes: notes.get(row.id) ?? "",
      measurement: "",
      calibrated: null,
      unit: "",
      areaUnit: "",
      length: null,
      area: null,
      perimeter: null,
    };
    const measure = measures.get(row.id);
    if (measure) {
      const values = measurementValues(measure, calibrations.get(row.page));
      Object.assign(result, {
        measurement: measure.type,
        calibrated: values.calibrated,
        unit: values.unit,
        areaUnit: values.area === undefined ? "" : `${values.unit}²`,
        length: values.length ?? null,
        area: values.area ?? null,
        perimeter: values.perimeter ?? null,
      });
      for (const kind of ["length", "area", "perimeter"] as const) {
        const value = result[kind];
        if (value === null) continue;
        const key = JSON.stringify([kind, result.unit, result.calibrated]);
        const current = totals.get(key) ?? {
          kind,
          unit: kind === "area" ? result.areaUnit : result.unit,
          calibrated: values.calibrated,
          value: 0,
          count: 0,
        };
        current.value += value;
        current.count++;
        if (!Number.isFinite(current.value))
          throw new Error("Measurement total exceeds the report range.");
        totals.set(key, current);
      }
    }
    // Category IDs distinguish a real category named Unassigned from truly unassigned marks.
    const countKey = JSON.stringify([row.page, row.type, row.categoryId]);
    const count = counts.get(countKey) ?? {
      page: row.page,
      type: row.type,
      category: row.category,
      categoryId: row.categoryId,
      count: 0,
    };
    count.count++;
    counts.set(countKey, count);
    return result;
  });
  return {
    pages: valid.pages,
    rows,
    counts: [...counts.values()],
    totals: [...totals.values()],
  };
}

/** Quote every cell and neutralize spreadsheet formulas even after leading whitespace. */
export function reportCsvCell(value: string | number | null): string {
  let text = value === null ? "" : String(value);
  if (
    typeof value === "string" &&
    (/^[\s\uFEFF]*[=+\-@]/u.test(text) || /^[\t\r\n]/u.test(text))
  )
    text = "'" + text;
  return `"${text.replace(/"/g, '""')}"`;
}

export function markupReportCsv(report: MarkupReport): string {
  const headers = [
    "Record type",
    "Source page",
    "Export page",
    "Type",
    "Detail",
    "Category",
    "Category ID",
    "Color",
    "Notes",
    "Measurement type",
    "Calibrated",
    "Length / perimeter unit",
    "Area unit",
    "Length",
    "Area",
    "Perimeter",
    "Markup ID",
    "Count",
  ];
  const records: (string | number | null)[][] = [headers];
  const pageMap = new Map(report.pages.map((page, index) => [page, index + 1]));
  for (const r of report.rows)
    records.push([
      "Markup",
      r.sourcePage,
      r.exportPage,
      r.type,
      r.detail,
      r.category,
      r.categoryId,
      r.color,
      r.notes,
      r.measurement,
      r.calibrated === null ? "" : r.calibrated ? "Yes" : "No",
      r.unit,
      r.areaUnit,
      r.length,
      r.area,
      r.perimeter,
      r.id,
      null,
    ]);
  for (const c of report.counts)
    records.push([
      "Count",
      c.page,
      pageMap.get(c.page) ?? null,
      c.type,
      "",
      c.category,
      c.categoryId,
      "",
      "",
      "",
      "",
      "",
      "",
      null,
      null,
      null,
      "",
      c.count,
    ]);
  for (const t of report.totals)
    records.push([
      "Total",
      null,
      null,
      "measurement",
      "",
      "",
      null,
      "",
      "",
      t.kind,
      t.calibrated ? "Yes" : "No",
      t.kind === "area" ? "" : t.unit,
      t.kind === "area" ? t.unit : "",
      t.kind === "length" ? t.value : null,
      t.kind === "area" ? t.value : null,
      t.kind === "perimeter" ? t.value : null,
      "",
      t.count,
    ]);
  // One rectangular table, with explicit record types, works in spreadsheets and CSV readers.
  const text =
    "\uFEFF" +
    records.map((record) => record.map(reportCsvCell).join(",")).join("\r\n") +
    "\r\n";
  if (new TextEncoder().encode(text).length > MAX_REPORT_CSV_BYTES)
    throw new Error(
      "CSV report exceeds 64 MiB. Select fewer pages or categories.",
    );
  return text;
}
