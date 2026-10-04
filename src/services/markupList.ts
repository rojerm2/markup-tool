import type { AnnotationSession } from "./annotationSession";
import { keyPoint, layoutLegend } from "./pageLegend";
import { notePoint } from "./notes";
import type { Point } from "./coordinates";
import { objectCategory } from "./categoryPolicy";
import { measurementLabel, measurementAnchor } from "./measurements";

export type MarkupType =
  "highlight" | "shape" | "text" | "arrow" | "legend" | "measurement";
export type MarkupRow = {
  id: string;
  page: number;
  type: MarkupType;
  label: string;
  categoryId: string | null;
  category: string;
  color: string;
  center: Point;
};

export function markupRows(session: AnnotationSession): MarkupRow[] {
  const categories = new Map(session.legends.map((l) => [l.id, l.name]));
  const rows: MarkupRow[] = session.annotations.map((s) => {
    let left = Infinity,
      right = -Infinity,
      top = Infinity,
      bottom = -Infinity;
    for (const p of s.points) {
      left = Math.min(left, p.x);
      right = Math.max(right, p.x);
      top = Math.min(top, p.y);
      bottom = Math.max(bottom, p.y);
    }
    return {
      id: s.id,
      page: s.page,
      type: "highlight",
      label: "Highlight",
      categoryId: s.legendId,
      category: categories.get(s.legendId ?? "") ?? "Unassigned",
      color: s.color,
      center: { x: (left + right) / 2, y: (top + bottom) / 2 },
    };
  });
  for (const s of session.shapes ?? [])
    rows.push({
      id: s.id,
      page: s.page,
      type: "shape",
      label: s.type[0].toUpperCase() + s.type.slice(1),
      categoryId: null,
      category: "Unassigned",
      color: s.color,
      center: { x: (s.a.x + s.b.x) / 2, y: (s.a.y + s.b.y) / 2 },
    });
  for (const n of session.notes ?? [])
    rows.push({
      id: n.id,
      page: n.page,
      type: n.type,
      label: n.type === "text" ? n.text : "Arrow",
      categoryId: null,
      category: "Unassigned",
      color: n.color,
      center:
        n.type === "text"
          ? notePoint(n, n.width / 2, n.height / 2)
          : { x: (n.a.x + n.b.x) / 2, y: (n.a.y + n.b.y) / 2 },
    });
  for (const k of session.pageLegends ?? [])
    rows.push({
      id: k.id,
      page: k.page,
      type: "legend",
      label: k.title,
      categoryId: null,
      category: "Unassigned",
      color: "#64748b",
      center: keyPoint(
        k,
        k.width / 2,
        layoutLegend(k, session.legends).height / 2,
      ),
    });
  for (const m of session.measurements ?? [])
    rows.push({
      id: m.id,
      page: m.page,
      type: "measurement",
      label: `${m.type[0].toUpperCase() + m.type.slice(1)} · ${measurementLabel(
        m,
        session.calibrations?.find((c) => c.page === m.page),
      )}`,
      categoryId: null,
      category: "Unassigned",
      color: m.color,
      center: measurementAnchor(m),
    });
  for (const row of rows) {
    const id = objectCategory(session, row.id);
    row.categoryId = id;
    row.category = categories.get(id ?? "") ?? "Unassigned";
  }
  return rows.sort((a, b) => a.page - b.page);
}

export function filterMarkups(
  rows: MarkupRow[],
  query: string,
  page: number | null,
  category: string | null,
  type: string,
) {
  const search = query.trim().toLocaleLowerCase();
  return rows.filter(
    (r) =>
      (!page || r.page === page) &&
      (category === "" ||
        (category === null
          ? r.categoryId === null
          : r.categoryId === category)) &&
      (!type || r.type === type) &&
      (!search ||
        `${r.label} ${r.category} ${r.type} page ${r.page}`
          .toLocaleLowerCase()
          .includes(search)),
  );
}
