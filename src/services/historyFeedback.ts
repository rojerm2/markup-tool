import type { AnnotationSession } from "./annotationSession";
import { sameSession } from "./sessionHistory";
import { keyPoint, layoutLegend } from "./pageLegend";
import { notePoint } from "./notes";
import type { Point } from "./coordinates";

export type ChangeRegion = {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
};
type Located = { id: string; page: number };

export function historyChangeRegions(
  before: AnnotationSession,
  after: AnnotationSession,
): ChangeRegion[] {
  const regions: ChangeRegion[] = [];

  function add(page: number, points: Point[], padding = 4) {
    const xs = points.map((p) => p.x),
      ys = points.map((p) => p.y);
    if (!xs.length || regions.length >= 100) return;
    const x = Math.min(...xs) - padding,
      y = Math.min(...ys) - padding;
    regions.push({
      page,
      x,
      y,
      width: Math.max(...xs) + padding - x,
      height: Math.max(...ys) + padding - y,
    });
  }

  function compare<T extends Located>(
    left: T[],
    right: T[],
    locate: (value: T, session: AnnotationSession) => void,
    force = false,
  ) {
    const old = new Map(left.map((value) => [value.id, value])),
      next = new Map(right.map((value) => [value.id, value]));
    for (const id of new Set([...old.keys(), ...next.keys()])) {
      const a = old.get(id),
        b = next.get(id);
      if (!force && sameSession(a, b)) continue;
      if (a) locate(a, before);
      if (b) locate(b, after);
    }
  }
  compare(before.annotations, after.annotations, (stroke) => {
    // Large freehand paths are scanned without spreading every vertex into Math.min.
    const bounds = stroke.points.reduce<{
      x: number;
      y: number;
      right: number;
      bottom: number;
    }>(
      (b, p) => ({
        x: Math.min(b.x, p.x),
        y: Math.min(b.y, p.y),
        right: Math.max(b.right, p.x),
        bottom: Math.max(b.bottom, p.y),
      }),
      { x: Infinity, y: Infinity, right: -Infinity, bottom: -Infinity },
    );
    add(
      stroke.page,
      [
        { x: bounds.x, y: bounds.y },
        { x: bounds.right, y: bounds.bottom },
      ],
      stroke.width / 2 + 4,
    );
  });
  compare(before.shapes ?? [], after.shapes ?? [], (shape) =>
    add(shape.page, [shape.a, shape.b], shape.width / 2 + 4),
  );
  compare(before.notes ?? [], after.notes ?? [], (note) => {
    if (note.type === "arrow") add(note.page, [note.a, note.b], note.head + 4);
    else
      add(note.page, [
        notePoint(note, 0, 0),
        notePoint(note, note.width, 0),
        notePoint(note, 0, note.height),
        notePoint(note, note.width, note.height),
        ...note.pointers.map((p) => p.target),
      ]);
  });
  compare(
    before.pageLegends ?? [],
    after.pageLegends ?? [],
    (key, session) => {
      const height = layoutLegend(key, session.legends).height;
      add(key.page, [
        keyPoint(key, 0, 0),
        keyPoint(key, key.width, 0),
        keyPoint(key, 0, height),
        keyPoint(key, key.width, height),
      ]);
    },
    !sameSession(before.legends, after.legends),
  );
  return regions;
}
