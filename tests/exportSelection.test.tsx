import { expect, it } from "vitest";
import {
  emptySession,
  type AnnotationSession,
} from "../src/services/annotationSession";
import {
  defaultExportSelection,
  parsePageSelection,
  selectExportSession,
  validateExportSelection,
} from "../src/services/exportSelection";

const session: AnnotationSession = {
  ...emptySession,
  legends: [
    { id: "visible", name: "Walls", color: "#facc15", locked: true },
    { id: "hidden", name: "Doors", color: "#ff0000", hidden: true },
  ],
  annotations: [
    {
      id: "v1",
      page: 1,
      legendId: "visible",
      type: "freehand",
      color: "#facc15",
      opacity: 0.4,
      width: 10,
      points: [
        { x: 10, y: 10 },
        { x: 20, y: 20 },
      ],
    },
    {
      id: "h2",
      page: 2,
      legendId: "hidden",
      type: "freehand",
      color: "#ff0000",
      opacity: 0.4,
      width: 10,
      points: [
        { x: 10, y: 10 },
        { x: 20, y: 20 },
      ],
    },
  ],
  shapes: [
    {
      id: "s2",
      page: 2,
      type: "rectangle",
      a: { x: 10, y: 10 },
      b: { x: 30, y: 30 },
      color: "#ff0000",
      width: 2,
      fill: null,
    },
    {
      id: "unassigned",
      page: 2,
      type: "line",
      a: { x: 10, y: 10 },
      b: { x: 30, y: 30 },
      color: "#ff0000",
      width: 2,
      fill: null,
    },
  ],
  objectCategories: { s2: "visible" },
  pageLegends: [
    {
      id: "key",
      page: 2,
      x: 20,
      y: 180,
      width: 120,
      fontSize: 12,
      rotation: 0,
      categoryIds: ["visible", "hidden"],
      title: "Legend",
      layout: "list",
      background: true,
      border: true,
    },
  ],
};

it("parses bounded page ranges in document order and rejects invalid, zero, reversed, oversized and out-of-range input", () => {
  expect(parsePageSelection("3, 1-2, 2", 3)).toEqual([1, 2, 3]);
  expect(parsePageSelection("37", 37)).toEqual([37]);
  for (const value of [
    "",
    "0",
    "4",
    "3-1",
    "1,",
    "1.5",
    "a",
    "1 2",
    "1;2",
    "1e2",
    "1".repeat(5001),
  ])
    expect(() => parsePageSelection(value, 3)).toThrow();
  expect(() => defaultExportSelection(10001)).toThrow();
});

it("validates selections with real category IDs and no sentinel collisions or caller mutation", () => {
  const value = {
    ...defaultExportSelection(3),
    pages: [3, 1],
    categoryIds: ["hidden"],
  };
  expect(validateExportSelection(value, 3, session).pages).toEqual([1, 3]);
  expect(value.pages).toEqual([3, 1]);
  for (const changed of [
    { ...value, pages: [] },
    { ...value, pages: [1, 1] },
    { ...value, pages: [4] },
    { ...value, categoryIds: ["unknown"] },
    { ...value, categoryIds: ["hidden", "hidden"] },
    { ...value, includeHidden: "false" },
    { ...value, includeUnassigned: undefined },
  ])
    expect(() => validateExportSelection(changed, 3, session)).toThrow();
});

it("separates workspace visibility from explicit export inclusion and retains locked marks", () => {
  const all = selectExportSession(session, defaultExportSelection(2), 2);
  expect(all.annotations).toHaveLength(2);
  expect(all.shapes).toHaveLength(2);
  const filtered = selectExportSession(
    session,
    {
      ...defaultExportSelection(2),
      pages: [2],
      categoryIds: ["visible"],
      includeHidden: false,
    },
    2,
  );
  expect(filtered.annotations).toEqual([]);
  expect(filtered.shapes!.map((s) => s.id)).toEqual(["s2", "unassigned"]);
  expect(filtered.pageLegends![0].categoryIds).toEqual(["visible"]);
  expect(filtered.objectCategories).toEqual({ s2: "visible" });
  expect(session.pageLegends![0].categoryIds).toEqual(["visible", "hidden"]);
  expect(filtered.shapes![0]).toBe(session.shapes![0]);
  const assignedOnly = selectExportSession(
    session,
    {
      ...defaultExportSelection(2),
      categoryIds: ["visible"],
      includeUnassigned: false,
    },
    2,
  );
  expect(assignedOnly.annotations.map((a) => a.id)).toEqual(["v1"]);
  expect(assignedOnly.shapes!.map((s) => s.id)).toEqual(["s2"]);
  expect(assignedOnly.pageLegends).toEqual([]);
  expect(
    selectExportSession(
      session,
      {
        ...defaultExportSelection(2),
        categoryIds: [],
        includeUnassigned: false,
      },
      2,
    ).annotations,
  ).toEqual([]);
});

it("removes empty page legends when every displayed category is excluded", () => {
  const onlyUnassigned = selectExportSession(
    session,
    { ...defaultExportSelection(2), categoryIds: [] },
    2,
  );
  expect(onlyUnassigned.shapes!.map((s) => s.id)).toEqual(["unassigned"]);
  expect(onlyUnassigned.pageLegends).toEqual([]);
  const hiddenOnly = selectExportSession(
    session,
    {
      ...defaultExportSelection(2),
      categoryIds: ["hidden"],
      includeHidden: false,
    },
    2,
  );
  expect(hiddenOnly.annotations).toEqual([]);
  expect(hiddenOnly.pageLegends).toEqual([]);
});
