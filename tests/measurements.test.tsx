import { expect, it } from "vitest";
import {
  emptySession,
  sessionReducer,
} from "../src/services/annotationSession";
import { SessionHistory } from "../src/services/sessionHistory";
import {
  copyMarkups,
  pasteMarkups,
  moveMarkups,
  deleteMarkups,
  selectedObjects,
  selectionBounds,
} from "../src/services/bulkEditing";
import { historyChangeRegions } from "../src/services/historyFeedback";
import type { PageViewport } from "../src/services/coordinates";
import { serializeProject, parseProject } from "../src/services/projectFormat";
import {
  convertMeasurementUnit,
  measurementLabel,
  measurementValues,
  polygonArea,
  simplePolygon,
  validCalibration,
  validMeasurement,
  type Measurement,
  type PageCalibration,
} from "../src/services/measurements";

it("keeps wide measurement labels inside page bounds after movement and paste with a different destination scale", () => {
  const viewport = {
    width: 600,
    height: 800,
    convertToViewportPoint: (x: number, y: number) => [x, 800 - y],
    convertToPdfPoint: (x: number, y: number) => [x, 800 - y],
  } as unknown as PageViewport;
  const value: Measurement = {
      ...area,
      id: "short",
      type: "length",
      points: [
        { x: 295, y: 400 },
        { x: 305, y: 400 },
      ],
      fontSize: 20,
    },
    session = {
      ...emptySession,
      measurements: [value],
      calibrations: [calibration],
    },
    moved = sessionReducer(
      session,
      moveMarkups(session, [value.id], 1000, 0, () => viewport),
    ),
    movedBounds = selectionBounds(
      selectedObjects(moved, [value.id]),
      [],
      viewport,
      moved.calibrations,
    );
  expect(movedBounds.right).toBeCloseTo(600);
  const pasted = pasteMarkups(
      session,
      copyMarkups(session, [value.id], viewport),
      2,
      viewport,
      { x: 595, y: 400 },
      () => "copy",
    ),
    next = sessionReducer(session, pasted.action),
    bounds = selectionBounds(
      selectedObjects(next, pasted.ids),
      [],
      viewport,
      next.calibrations,
    );
  expect(bounds.right).toBeCloseTo(600);
  expect(bounds.left).toBeGreaterThanOrEqual(0);
  expect(measurementLabel(next.measurements![1])).toContain("uncalibrated");
  const history = new SessionHistory(session);
  expect(history.apply(pasted.action)).toBe(true);
  expect(history.present.measurements).toHaveLength(2);
  history.traverse("undo");
  expect(history.present).toBe(session);
  const tooWide = { ...session, measurements: [{ ...value, fontSize: 200 }] };
  expect(() =>
    pasteMarkups(
      tooWide,
      copyMarkups(tooWide, [value.id], viewport),
      2,
      viewport,
      { x: 300, y: 400 },
      () => "copy",
    ),
  ).toThrow(/labels are larger/);
});

const calibration: PageCalibration = {
  page: 1,
  a: { x: 0, y: 0 },
  b: { x: 100, y: 0 },
  distance: 10,
  unit: "m",
};
const area: Measurement = {
  id: "area",
  page: 1,
  type: "area",
  points: [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 50 },
    { x: 0, y: 50 },
  ],
  color: "#38bdf8",
  width: 2,
  fontSize: 12,
};

it("calculates calibrated length, polygon area and perimeter and updates after recalibration", () => {
  expect(measurementValues(area, calibration)).toEqual({
    calibrated: true,
    unit: "m",
    area: 50,
    perimeter: 30,
  });
  expect(measurementLabel(area, calibration)).toBe("50 m²");
  expect(
    measurementValues(
      { ...area, type: "length", points: area.points.slice(0, 2) },
      calibration,
    ).length,
  ).toBe(10);
  expect(
    measurementValues({ ...area, type: "perimeter" }, calibration).perimeter,
  ).toBe(30);
  expect(measurementValues(area, { ...calibration, distance: 20 }).area).toBe(
    200,
  );
  expect(
    measurementValues(area, { ...calibration, distance: 20 }).perimeter,
  ).toBe(60);
  expect(measurementLabel(area)).toBe("5,000 PDF units² (uncalibrated)");
  expect(() => measurementValues(area, { ...calibration, page: 2 })).toThrow(
    "page calibration",
  );
});

it("converts length and squared units without rounding internal values", () => {
  expect(convertMeasurementUnit(1, "in", "mm")).toBeCloseTo(25.4);
  expect(convertMeasurementUnit(1, "ft", "in")).toBeCloseTo(12);
  expect(convertMeasurementUnit(1, "yd", "ft")).toBeCloseTo(3);
  expect(convertMeasurementUnit(1, "m", "cm", true)).toBe(10000);
  expect(() => convertMeasurementUnit(Infinity, "m", "mm")).toThrow();
  expect(() =>
    convertMeasurementUnit(1, "constructor" as never, "mm"),
  ).toThrow();
});

it("retains dimensions under rotation, reversed winding, and offset PDF coordinates", () => {
  const rotate = (p: { x: number; y: number }) => ({
    x: 1e8 - p.y,
    y: 1e8 + p.x,
  });
  const rotated = { ...area, points: area.points.map(rotate).reverse() };
  expect(validMeasurement(rotated)).toBe(true);
  expect(polygonArea(rotated.points)).toBe(5000);
  expect(
    measurementValues(rotated, {
      ...calibration,
      a: rotate(calibration.a),
      b: rotate(calibration.b),
    }),
  ).toEqual(measurementValues(area, calibration));
  const concave = [
    { x: 0, y: 0 },
    { x: 4, y: 0 },
    { x: 4, y: 4 },
    { x: 2, y: 2 },
    { x: 0, y: 4 },
  ];
  expect(simplePolygon(concave)).toBe(true);
  expect(polygonArea(concave)).toBe(12);
});

it("rejects self crossings, touching edges, backtracking, duplicates and unsafe calibration", () => {
  const polygons = [
    [
      { x: 0, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
      { x: 4, y: 0 },
    ],
    [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 2, y: 0 },
      { x: 0, y: 4 },
    ],
    [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 2, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
    ],
    [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 0 },
      { x: 0, y: 4 },
    ],
    [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
    ],
  ];
  polygons.forEach((points) =>
    expect(validMeasurement({ ...area, points })).toBe(false),
  );
  for (const c of [
    { ...calibration, distance: 0 },
    { ...calibration, distance: NaN },
    { ...calibration, b: calibration.a },
    { ...calibration, unit: "constructor" },
    { ...calibration, page: 0 },
    { ...calibration, a: { x: Infinity, y: 0 } },
  ])
    expect(validCalibration(c as PageCalibration)).toBe(false);
  expect(validCalibration(calibration)).toBe(true);
  expect(validCalibration(calibration, 0)).toBe(false);
  expect(
    validMeasurement({
      ...area,
      points: Array.from({ length: 129 }, () => ({ x: 0, y: 0 })),
    }),
  ).toBe(false);
  expect(validMeasurement({ ...area, fontSize: 201 })).toBe(false);
  expect(validMeasurement({ ...area, width: 0 })).toBe(false);
  expect(
    validMeasurement({
      ...area,
      type: "length",
      points: [
        { x: 0, y: 0 },
        { x: 0, y: 0 },
      ],
    }),
  ).toBe(false);
});

it("persists calibration and geometry in version 4, validates input bounds and retains older project defaults", () => {
  const source = {
    reference: "plan.pdf",
    filename: "plan.pdf",
    sha256: "a".repeat(64),
    size: 100,
    pages: 2,
  };
  const state = {
    ...emptySession,
    measurements: [area],
    calibrations: [calibration],
    legends: [{ id: "walls", name: "Walls", color: "#facc15", locked: false }],
    objectCategories: { area: "walls" },
  };
  const text = serializeProject(source, state),
    parsed = parseProject(text);
  expect(parsed.version).toBe(4);
  expect(parsed.session).toEqual(state);
  expect(
    measurementLabel(
      parsed.session.measurements![0],
      parsed.session.calibrations![0],
    ),
  ).toBe("50 m²");
  expect(
    parseProject(serializeProject(source, emptySession)).session.measurements,
  ).toBeUndefined();
  for (const patch of [
    { version: 3 },
    { session: { ...state, calibrations: [calibration, calibration] } },
    { session: { ...state, calibrations: [{ ...calibration, page: 3 }] } },
    { session: { ...state, calibrations: [{ ...calibration, distance: 0 }] } },
    { session: { ...state, measurements: [area, area] } },
    { session: { ...state, measurements: [{ ...area, id: "walls" }] } },
    { session: { ...state, measurements: [{ ...area, page: 3 }] } },
    {
      session: {
        ...state,
        measurements: Array.from({ length: 1001 }, (_, i) => ({
          ...area,
          id: `m${i}`,
        })),
      },
    },
    { session: { ...state, objectCategories: { missing: "walls" } } },
  ])
    expect(() =>
      parseProject(JSON.stringify({ ...JSON.parse(text), ...patch })),
    ).toThrow("Invalid project");
});

it("undoes calibration and geometry, rejects stale edits and prevents locks or ID collisions being bypassed", () => {
  const history = new SessionHistory(emptySession);
  expect(
    history.apply({
      type: "calibrate-page",
      page: 1,
      calibration,
      before: undefined,
    }),
  ).toBe(true);
  expect(history.apply({ type: "put-measurement", measurement: area })).toBe(
    true,
  );
  expect(history.undoLabel).toBe("Draw/edit measurement");
  const before = history.present;
  expect(
    history.apply({
      type: "put-measurement",
      measurement: { ...area, fontSize: 20 },
      before: { ...area },
    }),
  ).toBe(false);
  expect(history.present).toBe(before);
  expect(
    history.apply({
      type: "calibrate-page",
      page: 1,
      calibration: { ...calibration, distance: 20 },
      before: calibration,
    }),
  ).toBe(true);
  expect(measurementValues(area, history.present.calibrations![0]).area).toBe(
    200,
  );
  history.traverse("undo");
  expect(history.present).toBe(before);
  history.traverse("undo");
  expect(history.present.measurements).toBeUndefined();
  history.traverse("undo");
  expect(history.present).toBe(emptySession);
  const protectedState = {
    ...before,
    legends: [{ id: "walls", name: "Walls", color: "#facc15", locked: true }],
    objectCategories: { area: "walls" },
  };
  expect(
    sessionReducer(protectedState, { type: "remove-measurement", id: "area" }),
  ).toBe(protectedState);
  expect(
    sessionReducer(protectedState, {
      type: "put-measurement",
      measurement: { ...area, fontSize: 20 },
      before: area,
    }),
  ).toBe(protectedState);
  expect(
    sessionReducer(protectedState, {
      type: "calibrate-page",
      page: 1,
      calibration: null,
      before: calibration,
    }),
  ).toBe(protectedState);
  expect(
    sessionReducer(before, {
      type: "create",
      legend: { id: "area", name: "Collision", color: "#facc15" },
    }),
  ).toBe(before);
  expect(
    sessionReducer(before, {
      type: "put-shape",
      shape: {
        id: "area",
        page: 1,
        type: "line",
        a: { x: 0, y: 0 },
        b: { x: 10, y: 10 },
        color: "#facc15",
        width: 2,
        fill: null,
      },
    }),
  ).toBe(before);
  const removed = sessionReducer(
    {
      ...protectedState,
      legends: [{ ...protectedState.legends[0], locked: false }],
    },
    { type: "remove-measurement", id: "area" },
  );
  expect(removed.measurements).toBeUndefined();
  expect(removed.objectCategories).toBeUndefined();
});

it("copies, moves and deletes measurements through bulk history while using only the destination page calibration", () => {
  const viewport = {
    width: 600,
    height: 800,
    convertToViewportPoint: (x: number, y: number) => [x, 800 - y],
    convertToPdfPoint: (x: number, y: number) => [x, 800 - y],
  } as unknown as PageViewport;
  const before = {
      ...emptySession,
      measurements: [area],
      calibrations: [calibration],
      legends: [{ id: "walls", name: "Walls", color: "#facc15" }],
      objectCategories: { area: "walls" },
    },
    history = new SessionHistory(before);
  expect(
    history.apply(moveMarkups(before, ["area"], 20, -10, () => viewport)),
  ).toBe(true);
  expect(history.present.measurements![0].points[0]).toEqual({ x: 20, y: 10 });
  expect(
    measurementValues(history.present.measurements![0], calibration).area,
  ).toBe(50);
  history.traverse("undo");
  const pasted = pasteMarkups(
    before,
    copyMarkups(before, ["area"], viewport),
    2,
    viewport,
    { x: 300, y: 400 },
    () => "copy",
  );
  expect(history.apply(pasted.action)).toBe(true);
  const copy = history.present.measurements![1];
  expect(copy.id).toBe("copy");
  expect(copy.page).toBe(2);
  expect(history.present.objectCategories?.copy).toBe("walls");
  expect(
    measurementValues(
      copy,
      history.present.calibrations?.find((c) => c.page === 2),
    ).calibrated,
  ).toBe(false);
  expect(history.present.calibrations).toEqual([calibration]);
  const copied = history.present;
  history.apply(deleteMarkups(copied, ["area", "copy"]));
  expect(history.present.measurements).toBeUndefined();
  history.traverse("undo");
  expect(history.present).toBe(copied);
  const changed = {
    ...copied,
    calibrations: [{ ...calibration, distance: 20 }],
  };
  expect(historyChangeRegions(copied, changed).every((r) => r.page === 1)).toBe(
    true,
  );
  expect(historyChangeRegions(copied, changed)).toHaveLength(1);
});
