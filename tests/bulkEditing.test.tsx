import { expect, it } from "vitest";
import {
  emptySession,
  sessionReducer,
  type AnnotationSession,
  type SingleSessionAction,
} from "../src/services/annotationSession";
import { SessionHistory } from "../src/services/sessionHistory";
import { TEXT_DEFAULTS } from "../src/services/notes";
import { objectLocked, objectVisible } from "../src/services/categoryPolicy";
import { parseProject, serializeProject } from "../src/services/projectFormat";
import {
  copyMarkups,
  pasteMarkups,
  selectedObjects,
  moveMarkups,
  movementLimits,
  selectionBounds,
  duplicateMarkups,
  deleteMarkups,
} from "../src/services/bulkEditing";
import type { PageViewport } from "../src/services/coordinates";

function viewport(rotation = 0, unit = 1): PageViewport {
  return {
    width: (rotation % 180 ? 800 : 600) * unit,
    height: (rotation % 180 ? 600 : 800) * unit,
    convertToViewportPoint: (x: number, y: number) =>
      rotation === 90
        ? [y * unit, x * unit]
        : rotation === 180
          ? [(600 - x) * unit, y * unit]
          : rotation === 270
            ? [(800 - y) * unit, (600 - x) * unit]
            : [x * unit, (800 - y) * unit],
    convertToPdfPoint: (x: number, y: number) =>
      rotation === 90
        ? [y / unit, x / unit]
        : rotation === 180
          ? [600 - x / unit, y / unit]
          : rotation === 270
            ? [600 - y / unit, 800 - x / unit]
            : [x / unit, 800 - y / unit],
  } as unknown as PageViewport;
}

it("moves a mixed group in visual page coordinates, including pointer targets, and clamps the whole group", () => {
  const before = fixture(),
    history = new SessionHistory(before),
    ids = ["stroke", "shape", "note"];
  const view = viewport(90, 2),
    objects = selectedObjects(before, ids);
  const limits = movementLimits(objects, before.legends, () => view);
  expect(history.apply(moveMarkups(before, ids, 12, 8, () => view))).toBe(true);
  expect(history.present.annotations[0].points[0]).toEqual({
    x: before.annotations[0].points[0].x + 4,
    y: before.annotations[0].points[0].y + 6,
  });
  const note = history.present.notes![0];
  if (note.type !== "text") throw new Error("Expected text");
  expect(note.pointers[0].target).toEqual({ x: 14, y: 26 });
  expect(history.undoLabel).toBe("Move highlight");
  history.traverse("undo");
  expect(history.present.annotations).toEqual(before.annotations);
  expect(history.present.notes![0]).toBe(note);
  const bounded = new SessionHistory(before);
  bounded.apply(moveMarkups(before, ids, 1e6, 1e6, () => view));
  const box = selectionBounds(
    selectedObjects(bounded.present, ids),
    before.legends,
    view,
  );
  expect(box.right).toBeLessThanOrEqual(view.width + 1e-8);
  expect(box.bottom).toBeLessThanOrEqual(view.height + 1e-8);
  const start = selectionBounds(objects, before.legends, view);
  expect(box.left - start.left).toBeCloseTo(limits.maxX);
  expect(box.top - start.top).toBeCloseTo(limits.maxY);
  expect(() => moveMarkups(before, ids, NaN, 0, () => view)).toThrow(
    "Invalid movement",
  );
});

it("duplicates objects across pages with unique IDs as one transaction and deletes the copies atomically", () => {
  const original = fixture();
  const before = {
    ...original,
    shapes: [{ ...original.shapes![0], page: 2 }],
    legends: [{ id: "walls", name: "Walls", color: "#facc15" }],
    objectCategories: { shape: "walls", note: "walls" },
  };
  let counter = 0;
  const result = duplicateMarkups(
    before,
    ["stroke", "shape", "note"],
    (p) => viewport(p === 2 ? 90 : 0),
    () => `dup-${++counter}`,
  );
  const history = new SessionHistory(before);
  expect(history.apply(result.action)).toBe(true);
  expect(history.present.annotations).toHaveLength(2);
  expect(history.present.shapes!.map((s) => s.page)).toEqual([2, 2]);
  expect(history.present.notes).toHaveLength(2);
  expect(history.present.objectCategories?.[history.present.notes![1].id]).toBe(
    "walls",
  );
  expect(history.undoLabel).toBe("Draw highlight");
  history.traverse("undo");
  expect(history.present.annotations).toEqual(before.annotations);
  expect(history.present.shapes).toHaveLength(2);
  expect(history.present.notes).toHaveLength(2);
  expect(history.traverse("undo")).toBe(false);
  history.traverse("redo");
  const copied = history.present;
  expect(history.apply(deleteMarkups(copied, result.ids))).toBe(true);
  expect(history.present.annotations).toHaveLength(1);
  expect(history.present.shapes).toHaveLength(1);
  expect(history.present.notes).toHaveLength(1);
  history.traverse("undo");
  expect(history.present.annotations).toEqual(copied.annotations);
  expect(history.present.shapes).toHaveLength(1);
  expect(history.present.notes).toHaveLength(1);
  const protectedState = {
    ...before,
    legends: [{ ...before.legends[0], locked: true }],
  };
  expect(() =>
    duplicateMarkups(protectedState, ["stroke", "shape"], () => viewport()),
  ).toThrow("Unlock and show");
  expect(() => deleteMarkups(protectedState, ["stroke", "shape"])).toThrow(
    "Unlock and show",
  );
});

it("copies mixed geometry to a rotated page with fresh IDs and one Undo step, preserving nested pointer targets", () => {
  const before = {
    ...fixture(),
    legends: [{ id: "wall", name: "Walls", color: "#facc15" }],
    objectCategories: { note: "wall", shape: "wall" },
  };
  const copy = copyMarkups(before, ["stroke", "shape", "note"], viewport(90));
  let counter = 0;
  const result = pasteMarkups(
    before,
    copy,
    2,
    viewport(270),
    { x: 300, y: 400 },
    () => `copy-${++counter}`,
  );
  expect(result.ids).toEqual(["copy-1", "copy-2", "copy-3"]);
  const history = new SessionHistory(before);
  expect(history.apply(result.action)).toBe(true);
  const pasted = history.present.notes!.find((n) => n.id === "copy-3")!;
  expect(pasted.type).toBe("text");
  if (pasted.type !== "text") throw new Error("Expected text");
  expect(pasted.page).toBe(2);
  expect(pasted.rotation).toBe(180);
  expect(pasted.pointers[0].id).toBe("copy-4");
  const original = before.notes![0];
  if (original.type !== "text") throw new Error("Expected text");
  const sourceAnchor = copy.viewport.convertToViewportPoint(
      original.x,
      original.y,
    ),
    sourceTarget = copy.viewport.convertToViewportPoint(
      original.pointers[0].target.x,
      original.pointers[0].target.y,
    );
  const dest = viewport(270),
    destAnchor = dest.convertToViewportPoint(pasted.x, pasted.y),
    destTarget = dest.convertToViewportPoint(
      pasted.pointers[0].target.x,
      pasted.pointers[0].target.y,
    );
  expect(destTarget[0] - destAnchor[0]).toBeCloseTo(
    sourceTarget[0] - sourceAnchor[0],
  );
  expect(destTarget[1] - destAnchor[1]).toBeCloseTo(
    sourceTarget[1] - sourceAnchor[1],
  );
  expect(history.present.objectCategories?.[pasted.id]).toBe("wall");
  expect(history.undoLabel).toBe("Draw highlight");
  expect(history.traverse("undo")).toBe(true);
  expect(history.present.annotations).toEqual(before.annotations);
  expect(history.present.notes).toHaveLength(2);
  expect(history.present.shapes).toHaveLength(2);
  expect(history.traverse("redo")).toBe(true);
  expect(history.present.annotations).toHaveLength(2);
  expect(before.notes).toHaveLength(1);
  expect(original.pointers[0].id).toBe("pointer");
});

it("clamps placement to target bounds, scales UserUnit and rejects oversize or ID-colliding paste without changing the session", () => {
  const before = fixture();
  let counter = 0;
  const copy = copyMarkups(before, ["stroke"], viewport(0, 2));
  const pasted = sessionReducer(
    before,
    pasteMarkups(
      before,
      copy,
      2,
      viewport(),
      { x: -1000, y: 1000 },
      () => `new-${++counter}`,
    ).action,
  ).annotations[1];
  expect(pasted.width).toBe(20);
  for (const p of pasted.points) {
    const [x, y] = viewport().convertToViewportPoint(p.x, p.y);
    expect(x).toBeGreaterThanOrEqual(10);
    expect(y).toBeGreaterThanOrEqual(10);
    expect(x).toBeLessThanOrEqual(590);
    expect(y).toBeLessThanOrEqual(790);
  }
  expect(() =>
    pasteMarkups(
      before,
      copy,
      2,
      { ...viewport(), width: 1, height: 1 },
      { x: 0, y: 0 },
    ),
  ).toThrow("larger than this page");
  expect(() =>
    pasteMarkups(
      before,
      copy,
      2,
      viewport(),
      { x: 300, y: 400 },
      () => "pointer",
    ),
  ).toThrow("unique markup ID");
  expect(before.annotations).toHaveLength(1);
});

it("rejects missing, repeated, hidden, locked and mixed-page copy selections", () => {
  const before = fixture();
  expect(() => selectedObjects(before, ["missing"])).toThrow(
    "no longer exists",
  );
  expect(() => selectedObjects(before, ["stroke", "stroke"])).toThrow(
    "Select between",
  );
  expect(() =>
    copyMarkups(
      { ...before, shapes: [{ ...before.shapes![0], page: 2 }] },
      ["stroke", "shape"],
      viewport(),
    ),
  ).toThrow("one page");
  const protectedSession = {
    ...before,
    legends: [{ id: "wall", name: "Walls", color: "#facc15", locked: true }],
    objectCategories: { note: "wall" },
  };
  expect(() => copyMarkups(protectedSession, ["note"], viewport())).toThrow(
    "Unlock and show",
  );
});

it("locks mixed categories centrally and rejects every mutation, including an atomic batch", () => {
  let state = fixture();
  state = {
    ...state,
    legends: [{ id: "wall", name: "Walls", color: "#facc15" }],
  };
  state = sessionReducer(state, {
    type: "assign-category",
    ids: ["stroke", "shape", "note"],
    categoryId: "wall",
  });
  state = sessionReducer(state, {
    type: "category-settings",
    id: "wall",
    hidden: true,
    locked: true,
  });
  for (const id of ["stroke", "shape", "note"]) {
    expect(objectLocked(state, id)).toBe(true);
    expect(objectVisible(state, id)).toBe(false);
  }
  const actions: SingleSessionAction[] = [
    { type: "remove-stroke", id: "stroke" },
    { type: "remove-shape", id: "shape" },
    { type: "remove-note", id: "note" },
    { type: "edit-stroke", id: "stroke", edit: { width: 20 } },
    {
      type: "put-note",
      before: state.notes![0],
      note: { ...state.notes![0], page: 1 },
    },
    {
      type: "put-shape",
      before: state.shapes![0],
      shape: { ...state.shapes![0], width: 4 },
    },
    {
      type: "move-stroke",
      before: state.annotations[0],
      legends: state.legends,
      points: [
        { x: 11, y: 20 },
        { x: 31, y: 20 },
      ],
    },
    {
      type: "assign-category",
      ids: ["stroke", "shape", "note"],
      categoryId: null,
    },
    { type: "delete", id: "wall" },
    { type: "select", id: "wall" },
    { type: "commit", stroke: { ...state.annotations[0], id: "fresh" } },
  ];
  for (const action of actions)
    expect(sessionReducer(state, action)).toBe(state);
  expect(
    sessionReducer(state, {
      type: "bulk",
      before: state,
      label: "Delete selection",
      actions: [
        { type: "remove-shape", id: "shape" },
        { type: "remove-note", id: "note" },
      ],
    }),
  ).toBe(state);
  state = sessionReducer(state, {
    type: "category-settings",
    id: "wall",
    hidden: false,
    locked: false,
  });
  expect(objectLocked(state, "note")).toBe(false);
  expect(objectVisible(state, "stroke")).toBe(true);
  expect(
    sessionReducer(state, { type: "remove-note", id: "note" }).objectCategories,
  ).toEqual({ shape: "wall" });
});

it("persists category protection with version 3, retains old defaults and rejects malformed relationships", () => {
  const source = {
    reference: "floor.pdf",
    filename: "floor.pdf",
    sha256: "a".repeat(64),
    size: 100,
    pages: 2,
  };
  const state = {
    ...fixture(),
    legends: [
      {
        id: "wall",
        name: "Walls",
        color: "#facc15",
        hidden: true,
        locked: true,
      },
    ],
    objectCategories: { note: "wall", shape: "wall" },
  };
  const text = serializeProject(source, state),
    parsed = parseProject(text);
  expect(parsed.version).toBe(3);
  expect(parsed.session).toEqual(state);
  expect(parseProject(serializeProject(source, fixture())).version).toBe(2);
  expect(objectLocked(fixture(), "stroke")).toBe(false);
  const raw = JSON.parse(text);
  raw.version = 2;
  expect(() => parseProject(JSON.stringify(raw))).toThrow("version 3");
  raw.version = 3;
  for (const categories of [
    { note: "missing" },
    { missing: "wall" },
    { stroke: "wall" },
    { pointer: "wall" },
  ]) {
    expect(() =>
      parseProject(
        JSON.stringify({
          ...raw,
          session: { ...raw.session, objectCategories: categories },
        }),
      ),
    ).toThrow("relationship");
  }
  raw.session.legends[0].locked = "yes";
  expect(() => parseProject(JSON.stringify(raw))).toThrow("visibility/locking");
});

function fixture(): AnnotationSession {
  return {
    ...emptySession,
    annotations: [
      {
        id: "stroke",
        type: "freehand",
        page: 1,
        legendId: null,
        color: "#facc15",
        width: 10,
        opacity: 0.4,
        points: [
          { x: 10, y: 20 },
          { x: 30, y: 20 },
        ],
      },
    ],
    shapes: [
      {
        id: "shape",
        type: "line",
        page: 1,
        a: { x: 10, y: 20 },
        b: { x: 40, y: 20 },
        color: "#facc15",
        width: 2,
        fill: null,
      },
    ],
    notes: [
      {
        ...TEXT_DEFAULTS,
        id: "note",
        type: "text",
        page: 1,
        x: 100,
        y: 200,
        rotation: 0,
        text: "Check wall",
        pointers: [
          {
            id: "pointer",
            target: { x: 10, y: 20 },
            color: "#facc15",
            width: 2,
            head: 10,
          },
        ],
      },
    ],
  };
}
it("deletes mixed objects atomically and restores only highlights through undo", () => {
  const before = fixture(),
    history = new SessionHistory(before);
  expect(
    history.apply({
      type: "bulk",
      before,
      label: "Delete selection",
      actions: [
        { type: "remove-stroke", id: "stroke" },
        { type: "remove-shape", id: "shape" },
        { type: "remove-note", id: "note" },
      ],
    }),
  ).toBe(true);
  expect(history.present.annotations).toHaveLength(0);
  expect(history.present.shapes).toBeUndefined();
  expect(history.present.notes).toBeUndefined();
  expect(history.undoLabel).toBe("Delete highlight");
  expect(history.traverse("undo")).toBe(true);
  expect(history.present.annotations).toEqual(before.annotations);
  expect(history.present.notes).toBeUndefined();
  expect(history.present.shapes).toBeUndefined();
  expect(history.traverse("undo")).toBe(false);
  expect(history.traverse("redo")).toBe(true);
  expect(history.present.annotations).toHaveLength(0);
});
it("rolls back the entire operation if a later child is invalid, stale or collides with a nested pointer ID", () => {
  const before = fixture();
  const invalidChildren: SingleSessionAction[] = [
    { type: "remove-note", id: "missing" },
    { type: "put-shape", shape: { ...before.shapes![0], id: "pointer" } },
    {
      type: "move-stroke",
      before: { ...before.annotations[0] },
      legends: before.legends,
      points: [
        { x: 11, y: 20 },
        { x: 31, y: 20 },
      ],
    },
  ];
  for (const invalid of invalidChildren) {
    const history = new SessionHistory(before);
    expect(
      history.apply({
        type: "bulk",
        before,
        label: "Delete selection",
        actions: [{ type: "remove-shape", id: "shape" }, invalid],
      }),
    ).toBe(false);
    expect(history.present).toBe(before);
    expect(history.undoLabel).toBeUndefined();
  }
});
it("rejects stale snapshots, nested batches and oversized batch requests", () => {
  const before = fixture();
  const action = {
    type: "bulk" as const,
    before,
    label: "Delete selection" as const,
    actions: [{ type: "remove-note" as const, id: "note" }],
  };
  expect(sessionReducer({ ...before }, action)).not.toBe(before);
  expect(sessionReducer(before, { ...action, before: { ...before } })).toBe(
    before,
  );
  expect(
    sessionReducer(before, {
      ...action,
      actions: Array.from({ length: 1001 }, () => action.actions[0]),
    }),
  ).toBe(before);
  expect(
    sessionReducer(before, {
      ...action,
      actions: [action as unknown as SingleSessionAction],
    }),
  ).toBe(before);
});
