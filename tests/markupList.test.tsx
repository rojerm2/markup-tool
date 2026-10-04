import { expect, it } from "vitest";
import {
  emptySession,
  type AnnotationSession,
} from "../src/services/annotationSession";
import { filterMarkups, markupRows } from "../src/services/markupList";
import { TEXT_DEFAULTS } from "../src/services/notes";

const session: AnnotationSession = {
  ...emptySession,
  legends: [{ id: "wall", name: "Walls", color: "#facc15" }],
  annotations: [
    {
      id: "highlight",
      type: "freehand",
      page: 2,
      legendId: "wall",
      color: "#facc15",
      width: 10,
      opacity: 0.4,
      points: [
        { x: -20, y: 10 },
        { x: 80, y: 30 },
      ],
    },
  ],
  shapes: [
    {
      id: "shape",
      type: "line",
      page: 1,
      a: { x: 0, y: 0 },
      b: { x: 10, y: 20 },
      color: "#facc15",
      width: 2,
      fill: null,
    },
  ],
  notes: [
    {
      ...TEXT_DEFAULTS,
      id: "text",
      type: "text",
      page: 2,
      x: 300,
      y: 500,
      rotation: 90,
      width: 100,
      height: 40,
      text: "Check doorway",
    },
    {
      id: "arrow",
      type: "arrow",
      page: 3,
      a: { x: 10, y: 20 },
      b: { x: 30, y: 60 },
      color: "#facc15",
      width: 2,
      head: 10,
    },
  ],
  pageLegends: [
    {
      id: "legend",
      page: 1,
      x: 30,
      y: 50,
      rotation: 0,
      categoryIds: ["wall"],
      title: "Legend",
      layout: "list",
      width: 240,
      fontSize: 12,
      background: true,
      border: true,
    },
  ],
};
it("indexes every markup type in page order and reveals rotated notes in PDF space", () => {
  const rows = markupRows(session);
  expect(rows.map((r) => r.type).sort()).toEqual([
    "arrow",
    "highlight",
    "legend",
    "shape",
    "text",
  ]);
  expect(rows.map((r) => r.page)).toEqual([1, 1, 2, 2, 3]);
  expect(rows.find((r) => r.id === "highlight")?.center).toEqual({
    x: 30,
    y: 20,
  });
  const center = rows.find((r) => r.id === "text")!.center;
  expect(Math.abs(center.x - 300)).toBeLessThanOrEqual(20);
  expect(Math.abs(center.y - 500)).toBeCloseTo(50);
  expect(session.notes![0]).toMatchObject({ x: 300, y: 500 });
});
it("combines search, page, category and type filters without losing unassigned objects", () => {
  const rows = markupRows(session);
  expect(
    filterMarkups(rows, "walls", 2, "wall", "highlight").map((r) => r.id),
  ).toEqual(["highlight"]);
  expect(
    filterMarkups(rows, "DOORWAY", 2, null, "text").map((r) => r.id),
  ).toEqual(["text"]);
  expect(filterMarkups(rows, "", null, null, "")).toHaveLength(4);
  expect(filterMarkups(rows, "walls", 1, "wall", "")).toEqual([]);
});
it("scans very long freehand paths without spreading geometry into function arguments", () => {
  const points = Array.from({ length: 100000 }, (_, i) => ({ x: i, y: -i }));
  const rows = markupRows({
    ...emptySession,
    annotations: [{ ...session.annotations[0], points, legendId: null }],
  });
  expect(rows[0].center).toEqual({ x: 49999.5, y: -49999.5 });
  expect(rows[0].category).toBe("Unassigned");
});
it("does not confuse a category named unassigned with the unassigned filter", () => {
  const rows = markupRows({
    ...session,
    legends: [{ id: "unassigned", name: "Special", color: "#facc15" }],
    annotations: [{ ...session.annotations[0], legendId: "unassigned" }],
    pageLegends: [],
  });
  expect(
    filterMarkups(rows, "", null, "unassigned", "").map((r) => r.id),
  ).toEqual(["highlight"]);
  expect(
    filterMarkups(rows, "", null, null, "").some((r) => r.id === "highlight"),
  ).toBe(false);
});
