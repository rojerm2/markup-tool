import { expect, it } from "vitest";
import { SessionHistory, HISTORY_LIMIT } from "../src/services/sessionHistory";
import {
  emptySession,
  type AnnotationSession,
  type SessionAction,
} from "../src/services/annotationSession";
import { SHAPE_DEFAULTS, type Shape } from "../src/services/shapes";
import type { Highlight } from "../src/types/annotation";

const stroke: Highlight = {
  id: "a",
  page: 1,
  type: "freehand",
  color: "#facc15",
  width: 10,
  opacity: 0.4,
  legendId: "l",
  points: [
    { x: 0.123456789, y: -22.75 },
    { x: 90.125, y: 300.875 },
  ],
};
const initial: AnnotationSession = {
  ...emptySession,
  legends: [{ id: "l", name: "Walls", color: "#facc15" }],
  activeLegendId: "l",
  annotations: [
    stroke,
    { ...stroke, id: "b", page: 2, legendId: null },
    { ...stroke, id: "c" },
  ],
};
const move = (h: SessionHistory, id = "a", dx = 2.125, dy = -4.5) => {
  const before = h.present.annotations.find((s) => s.id === id)!;
  return h.apply({
    type: "move-stroke",
    before,
    legends: h.present.legends,
    points: before.points.map((p) => ({ x: p.x + dx, y: p.y + dy })),
  });
};

it("undoes and redoes highlight creation, deletion and movement with exact geometry/order", () => {
  const h = new SessionHistory(initial);
  h.apply({ type: "remove-stroke", id: "a" });
  expect(h.undoLabel).toBe("Delete highlight");
  expect(h.traverse("undo")).toBe(true);
  expect(h.present).toEqual(initial);
  expect(h.present.annotations[0].points).toBe(stroke.points);
  h.traverse("redo");
  expect(h.present.annotations.map((s) => s.id)).toEqual(["b", "c"]);
  h.traverse("undo");
  move(h);
  const moved = h.present.annotations[0];
  expect(h.undoLabel).toBe("Move highlight");
  h.traverse("undo");
  expect(h.present.annotations[0]).toEqual(stroke);
  h.traverse("redo");
  expect(h.present.annotations[0]).toEqual(moved);
  h.apply({ type: "commit", stroke: { ...stroke, id: "new" } });
  expect(h.undoLabel).toBe("Draw highlight");
  h.traverse("undo");
  expect(h.present.annotations.map((s) => s.id)).toEqual(["a", "b", "c"]);
  h.traverse("redo");
  expect(h.present.annotations.at(-1)?.id).toBe("new");
});

it.each<SessionAction>([
  { type: "edit-stroke", id: "a", edit: { width: 20 } },
  { type: "edit-stroke", id: "a", edit: { color: "#38bdf8" } },
  { type: "edit-stroke", id: "a", edit: { rounding: 0 } },
  { type: "edit-stroke", id: "a", edit: { legendId: null } },
  { type: "create", legend: { id: "door", name: "Doors", color: "#38bdf8" } },
  { type: "rename", id: "l", name: "Renamed" },
  { type: "delete", id: "l" },
  { type: "select", id: null },
  { type: "category-settings", id: "l", hidden: true, locked: false },
  {
    type: "drawing",
    drawing: { ...emptySession.drawing, width: 20 },
    manual: true,
  },
])("persists $type without adding an undo step", (action) => {
  const h = new SessionHistory(initial);
  expect(h.apply(action)).toBe(true);
  const changed = h.present;
  expect(h.undoLabel).toBeUndefined();
  expect(h.traverse("undo")).toBe(false);
  expect(h.present).toBe(changed);
});

it("preserves updated properties and other objects when undoing highlight movement", () => {
  const h = new SessionHistory(initial);
  move(h);
  h.apply({ type: "edit-stroke", id: "a", edit: { color: "#38bdf8" } });
  h.apply({ type: "edit-stroke", id: "a", edit: { width: 0.25 } });
  h.apply({ type: "edit-stroke", id: "a", edit: { rounding: 0 } });
  h.apply({
    type: "drawing",
    drawing: { ...emptySession.drawing, width: 100 },
    manual: true,
  });
  const shape: Shape = {
    ...SHAPE_DEFAULTS,
    id: "shape",
    type: "rectangle",
    page: 1,
    a: { x: 0, y: 0 },
    b: { x: 10, y: 10 },
  };
  h.apply({ type: "put-shape", shape });
  const latest = h.present;
  h.traverse("undo");
  expect(h.present.annotations[0]).toMatchObject({
    color: "#38bdf8",
    width: 0.25,
    rounding: 0,
    legendId: null,
    points: stroke.points,
  });
  expect(h.present.shapes).toBe(latest.shapes);
  expect(h.present.drawing).toBe(latest.drawing);
  h.traverse("redo");
  expect(h.present).toEqual(latest);
});

it("keeps redo after style/category changes and restores the latest stroke appearance without deleted categories", () => {
  const h = new SessionHistory({ ...initial, annotations: [] });
  h.apply({ type: "commit", stroke });
  h.apply({ type: "edit-stroke", id: "a", edit: { width: 30 } });
  h.traverse("undo");
  h.apply({ type: "delete", id: "l" });
  h.apply({
    type: "drawing",
    drawing: { ...emptySession.drawing, width: 100, color: "#ff0000" },
    manual: true,
  });
  expect(h.redoLabel).toBe("Draw highlight");
  h.traverse("redo");
  expect(h.present.annotations[0]).toEqual({
    ...stroke,
    width: 30,
    legendId: null,
  });
  expect(h.present.legends).toEqual([]);
  expect(h.present.drawing.width).toBe(100);
  h.apply({ type: "remove-stroke", id: "a" });
  h.traverse("undo");
  expect(h.present.annotations[0].width).toBe(30);
});

it("undoes only the highlights in a mixed bulk action, leaving shapes and category mappings applied", () => {
  const shape: Shape = {
    ...SHAPE_DEFAULTS,
    id: "shape",
    type: "rectangle",
    page: 1,
    a: { x: 0, y: 0 },
    b: { x: 10, y: 10 },
  };
  const h = new SessionHistory({
    ...initial,
    shapes: [shape],
    objectCategories: { shape: "l" },
  });
  const before = h.present;
  h.apply({
    type: "bulk",
    before,
    label: "Delete selection",
    actions: [
      { type: "remove-stroke", id: "a" },
      { type: "remove-stroke", id: "c" },
      { type: "remove-shape", id: "shape" },
    ],
  });
  expect(h.undoLabel).toBe("Delete highlights");
  h.traverse("undo");
  expect(h.present.annotations).toEqual(before.annotations);
  expect(h.present.shapes).toBeUndefined();
  expect(h.present.objectCategories).toBeUndefined();
  h.traverse("redo");
  expect(h.present.annotations.map((s) => s.id)).toEqual(["b"]);
});

it("keeps category locks effective during history and does not consume blocked steps", () => {
  const h = new SessionHistory(initial);
  move(h);
  h.apply({ type: "category-settings", id: "l", hidden: false, locked: true });
  const locked = h.present;
  expect(h.undoLabel).toBeUndefined();
  expect(h.traverse("undo")).toBe(false);
  expect(h.present).toBe(locked);
  h.apply({ type: "category-settings", id: "l", hidden: false, locked: false });
  expect(h.undoLabel).toBe("Move highlight");
  h.traverse("undo");
  expect(h.present.annotations[0].points).toEqual(stroke.points);
});

it("does not restore a highlight over a reused category ID", () => {
  const h = new SessionHistory({
    ...emptySession,
    annotations: [{ ...stroke, legendId: null }],
  });
  h.apply({ type: "remove-stroke", id: "a" });
  h.apply({
    type: "create",
    legend: { id: "a", name: "Reused", color: "#facc15" },
  });
  expect(h.traverse("undo")).toBe(false);
  expect(h.present.annotations).toEqual([]);
  h.apply({ type: "delete", id: "a" });
  expect(h.traverse("undo")).toBe(true);
  expect(h.present.annotations[0].id).toBe("a");
});

it("bounds history to 100 highlight changes and clears redo only for new highlight geometry", () => {
  const h = new SessionHistory(emptySession);
  for (let i = 0; i < 105; i++)
    h.apply({
      type: "commit",
      stroke: { ...stroke, id: String(i), legendId: null },
    });
  for (let i = 0; i < HISTORY_LIMIT; i++) expect(h.traverse("undo")).toBe(true);
  expect(h.present.annotations.map((s) => s.id)).toEqual([
    "0",
    "1",
    "2",
    "3",
    "4",
  ]);
  expect(h.traverse("undo")).toBe(false);
  for (let i = 0; i < HISTORY_LIMIT; i++) expect(h.traverse("redo")).toBe(true);
  expect(h.present.annotations).toHaveLength(105);
  h.traverse("undo");
  h.apply({
    type: "drawing",
    drawing: { ...emptySession.drawing, width: 50 },
    manual: true,
  });
  expect(h.redoLabel).toBe("Draw highlight");
  h.apply({
    type: "commit",
    stroke: { ...stroke, id: "branch", legendId: null },
  });
  expect(h.redoLabel).toBeUndefined();
});

it("rejects stale gestures and invalid/no-op edits without erasing redo, even on empty undo attempts", () => {
  const h = new SessionHistory(initial),
    token = h.generation;
  h.apply({ type: "remove-stroke", id: "a" });
  h.traverse("undo");
  expect(
    h.apply({ type: "commit", stroke: { ...stroke, id: "new" } }, token),
  ).toBe(false);
  expect(h.apply({ type: "edit-stroke", id: "a", edit: { width: NaN } })).toBe(
    false,
  );
  expect(h.apply({ type: "remove-stroke", id: "missing" })).toBe(false);
  expect(h.redoLabel).toBe("Delete highlight");
  let cancelled = 0;
  const unsubscribe = h.subscribeCancellation(() => cancelled++);
  const emptyToken = h.generation;
  expect(h.traverse("undo")).toBe(false);
  expect(cancelled).toBe(1);
  expect(
    h.apply({ type: "commit", stroke: { ...stroke, id: "new" } }, emptyToken),
  ).toBe(false);
  unsubscribe();
  h.invalidate();
  expect(cancelled).toBe(1);
});
