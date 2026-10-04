import type { AnnotationSession } from "./annotationSession";
import { objectCategory, objectVisible } from "./categoryPolicy";

export type ExportSelection = {
  /** Original one-based page numbers, in document order. */
  pages: number[];
  /** null includes every category; an empty array includes no assigned marks. */
  categoryIds: string[] | null;
  includeUnassigned: boolean;
  includeHidden: boolean;
};

function pageCount(count: number) {
  if (!Number.isInteger(count) || count < 1 || count > 10000)
    throw new Error("Invalid export page count.");
}

export function defaultExportSelection(count: number): ExportSelection {
  pageCount(count);
  return {
    pages: Array.from({ length: count }, (_, i) => i + 1),
    categoryIds: null,
    includeUnassigned: true,
    includeHidden: true,
  };
}

export function parsePageSelection(text: string, count: number): number[] {
  pageCount(count);
  if (text.length > 5000) throw new Error("Page selection is too long.");
  if (!text.trim()) throw new Error("Choose at least one page.");
  const result = new Set<number>();
  for (const part of text.split(",")) {
    const match = /^(\d{1,5})(?:\s*-\s*(\d{1,5}))?$/.exec(part.trim());
    if (!match) throw new Error("Use page numbers and ranges, such as 1, 3-5.");
    const start = Number(match[1]),
      end = Number(match[2] ?? match[1]);
    if (start < 1 || end < start || end > count)
      throw new Error(
        `Choose pages between 1 and ${count}, with ascending ranges.`,
      );
    for (let page = start; page <= end; page++) result.add(page);
  }
  return [...result].sort((a, b) => a - b);
}

export function validateExportSelection(
  value: unknown,
  count: number,
  session: AnnotationSession,
): ExportSelection {
  pageCount(count);
  const v = value as ExportSelection;
  if (
    !v ||
    !Array.isArray(v.pages) ||
    !v.pages.length ||
    v.pages.length > count ||
    v.pages.some((p) => !Number.isInteger(p) || p < 1 || p > count) ||
    new Set(v.pages).size !== v.pages.length ||
    typeof v.includeUnassigned !== "boolean" ||
    typeof v.includeHidden !== "boolean"
  )
    throw new Error("Invalid export selection.");
  const ids = new Set(session.legends.map((l) => l.id));
  if (
    v.categoryIds !== null &&
    (!Array.isArray(v.categoryIds) ||
      v.categoryIds.length > 1000 ||
      v.categoryIds.some((id) => typeof id !== "string" || !ids.has(id)) ||
      new Set(v.categoryIds).size !== v.categoryIds.length)
  )
    throw new Error("Invalid export categories.");
  return {
    pages: [...v.pages].sort((a, b) => a - b),
    categoryIds: v.categoryIds === null ? null : [...v.categoryIds],
    includeUnassigned: v.includeUnassigned,
    includeHidden: v.includeHidden,
  };
}

/** Retains original page numbers until the PDF writer has added their vector marks. */
export function selectExportSession(
  session: AnnotationSession,
  selection: ExportSelection,
  count: number,
): AnnotationSession {
  const valid = validateExportSelection(selection, count, session),
    pages = new Set(valid.pages),
    categories = valid.categoryIds === null ? null : new Set(valid.categoryIds),
    definitions = new Map(session.legends.map((l) => [l.id, l])),
    categoryIncluded = (id: string | null) =>
      id === null
        ? valid.includeUnassigned
        : definitions.has(id) &&
          (categories === null || categories.has(id)) &&
          (valid.includeHidden || !definitions.get(id)?.hidden),
    included = (object: { id: string; page: number }) =>
      pages.has(object.page) &&
      categoryIncluded(objectCategory(session, object.id)) &&
      (valid.includeHidden || objectVisible(session, object.id)),
    annotations = session.annotations.filter(included),
    shapes = (session.shapes ?? []).filter(included),
    notes = (session.notes ?? []).filter(included),
    measurements = (session.measurements ?? []).filter(included),
    pageLegends = (session.pageLegends ?? [])
      .filter(included)
      .map((k) => ({
        ...k,
        categoryIds: k.categoryIds.filter((id) => categoryIncluded(id)),
      }))
      .filter((k) => k.categoryIds.length > 0),
    kept = new Set(
      [
        ...annotations,
        ...shapes,
        ...notes,
        ...measurements,
        ...pageLegends,
      ].map((o) => o.id),
    );
  return {
    ...session,
    annotations,
    shapes,
    notes,
    measurements,
    pageLegends,
    calibrations: (session.calibrations ?? []).filter((c) => pages.has(c.page)),
    ...(session.objectCategories
      ? {
          objectCategories: Object.fromEntries(
            Object.entries(session.objectCategories).filter(([id]) =>
              kept.has(id),
            ),
          ),
        }
      : {}),
  };
}
