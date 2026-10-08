import { expect, it } from "vitest";
import {
  emptySession,
  sessionReducer,
} from "../src/services/annotationSession";
import { SessionHistory } from "../src/services/sessionHistory";
import {
  copyMarkups,
  selectedObjects,
  selectionBounds,
} from "../src/services/bulkEditing";
import { parseProject, serializeProject } from "../src/services/projectFormat";
import { DEFAULT_TOOL_STYLES } from "../src/services/toolStyles";
import {
  capturePreset,
  captureSymbol,
  parsePreset,
  serializePreset,
  applyPreset,
  placeSymbol,
  readPresetLibrary,
  writePresetLibrary,
  symbolViewport,
  MAX_PRESET_BYTES,
  MAX_LIBRARY_BYTES,
} from "../src/services/presets";
import type { PageViewport } from "../src/services/coordinates";

const source = {
  reference: "source.pdf",
  filename: "source.pdf",
  sha256: "0".repeat(64),
  size: 1,
  pages: 2,
};
const fixture = () => ({
  ...emptySession,
  legends: [{ id: "walls", name: "Walls", color: "#facc15" }],
  annotations: [
    {
      id: "stroke",
      page: 1,
      type: "freehand" as const,
      legendId: "walls",
      color: "#facc15",
      width: 10,
      opacity: 0.4,
      points: [
        { x: 100, y: 200 },
        { x: 200, y: 200 },
      ],
    },
  ],
  shapes: [
    {
      id: "box",
      page: 1,
      type: "rectangle" as const,
      a: { x: 100, y: 300 },
      b: { x: 200, y: 400 },
      color: "#38bdf8",
      width: 2,
      fill: null,
    },
  ],
  notes: [
    {
      id: "note",
      page: 1,
      type: "text" as const,
      x: 100,
      y: 500,
      rotation: 0 as const,
      width: 180,
      height: 60,
      fontSize: 12,
      color: "#a87951",
      background: true,
      border: true,
      text: "Door",
      pointers: [
        {
          id: "pointer",
          target: { x: 210, y: 300 },
          color: "#a87951",
          width: 2,
          head: 10,
        },
      ],
    },
  ],
  objectCategories: { box: "walls", note: "walls" },
});

it("round-trips a portable preset and original symbol without source paths, PDF bytes or navigation, rejecting unrecognized note metadata", () => {
  const session = fixture(),
    symbol = captureSymbol(
      "Door symbol",
      session,
      ["stroke", "box", "note"],
      symbolViewport(600, 800),
    );
  const preset = capturePreset(
    "Floor plan",
    {
      ...session,
      legends: [{ ...session.legends[0], hidden: true, locked: true }],
    },
    [symbol],
  );
  const raw = {
    ...preset,
    source: { reference: "C:/private.pdf" },
    navigation: { page: 2 },
    symbols: [
      {
        ...symbol,
        session: {
          ...symbol.session,
          sourcePath: "secret",
        },
      },
    ],
  };
  expect(() =>
    parsePreset(
      JSON.stringify({
        ...raw,
        symbols: [
          {
            ...symbol,
            session: {
              ...symbol.session,
              notes: symbol.session.notes!.map((n) => ({
                ...n,
                sourcePath: "secret",
              })),
            },
          },
        ],
      }),
    ),
  ).toThrow(/note text/);
  const parsed = parsePreset(JSON.stringify(raw)),
    text = serializePreset(parsed);
  expect(text).not.toMatch(
    /secret|private|sourcePath|navigation|hidden|locked/,
  );
  expect(parsed.categories).toEqual([{ name: "Walls", color: "#facc15" }]);
  expect(parsePreset(text)).toEqual(parsed);
  expect(session.notes[0].pointers[0].target).toEqual({ x: 210, y: 300 });
  expect(parsed.symbols[0].session.notes![0]).toMatchObject({
    text: "Door",
    fontSize: 12,
  });
});

it("rejects future, oversized, malformed and unsafe presets and symbols", () => {
  const preset = capturePreset("Styles", emptySession);
  for (const changed of [
    { ...preset, version: 99 },
    { ...preset, name: " " + preset.name },
    {
      ...preset,
      categories: [
        { name: "Walls", color: "#ff0000" },
        { name: "walls", color: "#000000" },
      ],
    },
    { ...preset, drawing: { ...preset.drawing, width: 0 } },
    {
      ...preset,
      toolStyles: {
        ...preset.toolStyles,
        measurement: { ...preset.toolStyles.measurement, fontSize: 201 },
      },
    },
    {
      ...preset,
      symbols: [
        { name: "Bad", width: 600, height: 800, session: emptySession },
      ],
    },
  ])
    expect(() => parsePreset(JSON.stringify(changed))).toThrow();
  expect(() => parsePreset("[]")).toThrow();
  expect(() => parsePreset("x".repeat(MAX_PRESET_BYTES + 1))).toThrow(/1 MiB/);
  const session = fixture(),
    symbol = captureSymbol("Door", session, ["box"], symbolViewport(600, 800));
  const outside = {
    ...symbol,
    session: {
      ...symbol.session,
      shapes: symbol.session.shapes!.map((s) => ({
        ...s,
        a: { x: -200, y: 50 },
      })),
    },
  };
  expect(() =>
    parsePreset(JSON.stringify({ ...preset, symbols: [outside] })),
  ).toThrow(/outside frame/);
  expect(() =>
    parsePreset(JSON.stringify({ ...preset, symbols: [symbol, symbol] })),
  ).toThrow(/duplicate symbol/);
  expect(() => symbolViewport(Infinity, 600)).toThrow();
  expect(() =>
    captureSymbol(
      "Mixed",
      {
        ...session,
        pageLegends: [
          {
            id: "legend",
            page: 1,
            x: 0,
            y: 100,
            width: 200,
            fontSize: 12,
            rotation: 0,
            categoryIds: ["walls"],
            title: "Legend",
            layout: "list",
            background: true,
            border: true,
          },
        ],
      },
      ["legend"],
      symbolViewport(600, 800),
    ),
  ).toThrow(/highlights, shapes/);
});

it("previews category conflicts and applies styles/categories outside history without changing existing marks or protection", () => {
  const before = {
    ...fixture(),
    legends: [
      {
        id: "walls",
        name: "Walls",
        color: "#facc15",
        hidden: true,
        locked: true,
      },
    ],
    activeLegendId: null,
  };
  const preset = capturePreset("Alternate", {
    ...emptySession,
    drawing: { color: "#38bdf8", width: 20, opacity: 0.5 },
    toolStyles: {
      ...DEFAULT_TOOL_STYLES,
      measurement: { color: "#ff0000", width: 4, fontSize: 24 },
    },
    legends: [{ id: "other", name: "Walls", color: "#ff0000" }],
  });
  // Preset names are unique, so test the reuse separately from the conflicting definition.
  const conflict = {
    ...preset,
    categories: [{ name: "Walls", color: "#ff0000" }],
  };
  const history = new SessionHistory(before),
    plan = applyPreset(
      before,
      conflict,
      { styles: true, categories: true },
      () => "fresh",
    );
  expect(plan.renamed).toEqual([{ from: "Walls", to: "Walls (2)" }]);
  expect(history.present).toBe(before);
  expect(history.apply(plan.action!)).toBe(true);
  expect(history.undoLabel).toBeUndefined();
  expect(history.present.annotations).toBe(before.annotations);
  expect(history.present.legends[0]).toBe(before.legends[0]);
  expect(history.present.toolStyles?.measurement.fontSize).toBe(24);
  const applied = history.present;
  history.traverse("undo");
  expect(history.present).toBe(applied);
  history.traverse("redo");
  expect(history.present).toBe(applied);
  const reuse = applyPreset(
    before,
    { ...conflict, categories: [{ name: "walls", color: "#facc15" }] },
    { styles: false, categories: true },
  );
  expect(reuse.action).toBeNull();
  expect(reuse.reused).toEqual(["Walls"]);
  const active = { ...fixture(), activeLegendId: "walls" },
    categoriesOnly = applyPreset(
      active,
      conflict,
      { styles: false, categories: true },
      () => "fresh",
    );
  const next = sessionReducer(active, categoriesOnly.action!);
  expect(next.activeLegendId).toBe("walls");
  expect(next.drawing).toBe(active.drawing);
  expect(history.apply(plan.action!)).toBe(false);
});

it("places a mixed symbol on rotated UserUnit pages with fresh IDs and undoes only its highlights", () => {
  const original = fixture(),
    symbol = captureSymbol(
      "Door",
      original,
      ["stroke", "box", "note"],
      symbolViewport(600, 800),
    );
  const destination = {
    ...emptySession,
    legends: [{ id: "collision", name: "Walls", color: "#ff0000" }],
  };
  const target = {
    width: 1600,
    height: 1200,
    convertToViewportPoint: (x: number, y: number) => [2 * y, 2 * x],
    convertToPdfPoint: (x: number, y: number) => [y / 2, x / 2],
  } as PageViewport;
  let i = 0;
  const placed = placeSymbol(
      destination,
      symbol,
      2,
      target,
      { x: 300, y: 400 },
      true,
      () => `fresh-${++i}`,
    ),
    history = new SessionHistory(destination);
  expect(history.apply(placed.action)).toBe(true);
  expect(history.undoLabel).toBe("Draw highlight");
  expect(history.present.legends[1].name).toBe("Walls (2)");
  const objects = selectedObjects(history.present, placed.ids),
    bounds = selectionBounds(objects, history.present.legends, target);
  expect(objects.every((o) => o.value.page === 2)).toBe(true);
  expect(
    new Set([
      ...placed.ids,
      history.present.notes![0].type === "text"
        ? history.present.notes![0].pointers[0].id
        : "",
    ]).size,
  ).toBe(4);
  const canonical = copyMarkups(
    symbol.session,
    [
      ...symbol.session.annotations,
      ...symbol.session.shapes!,
      ...symbol.session.notes!,
    ].map((o) => o.id),
    symbolViewport(symbol.width, symbol.height),
  );
  expect(bounds.right - bounds.left).toBeCloseTo(
    canonical.bounds.right - canonical.bounds.left,
  );
  expect(bounds.bottom - bounds.top).toBeCloseTo(
    canonical.bounds.bottom - canonical.bounds.top,
  );
  expect(history.present.annotations[0].legendId).toBe(
    history.present.legends[1].id,
  );
  expect(history.present.objectCategories?.[history.present.notes![0].id]).toBe(
    history.present.legends[1].id,
  );
  expect(history.present.calibrations).toBeUndefined();
  const after = history.present;
  history.traverse("undo");
  expect(history.present.annotations).toEqual(destination.annotations);
  expect(history.present.shapes).toBe(after.shapes);
  expect(history.present.notes).toBe(after.notes);
  expect(history.present.legends).toBe(after.legends);
  history.traverse("redo");
  expect(history.present).toEqual(after);
  const protectedDestination = {
    ...destination,
    legends: [
      { id: "matching", name: "Walls", color: "#facc15", locked: true },
    ],
  };
  expect(() =>
    placeSymbol(
      protectedDestination,
      symbol,
      1,
      symbolViewport(600, 800),
      { x: 300, y: 400 },
      true,
    ),
  ).toThrow(/unlock/);
  const matching = {
    ...emptySession,
    legends: [{ id: "matching", name: "walls", color: "#facc15" }],
  };
  const reused = placeSymbol(
      matching,
      symbol,
      1,
      symbolViewport(600, 800),
      { x: 300, y: 400 },
      false,
    ),
    reusedState = sessionReducer(matching, reused.action);
  expect(reusedState.annotations[0].legendId).toBe("matching");
  expect(reusedState.objectCategories?.[reusedState.notes![0].id]).toBe(
    "matching",
  );
  expect(reusedState.legends).toHaveLength(1);
});

it("bounds local libraries, rejects duplicate/corrupt imports and reports storage failure without overwriting the previous library", () => {
  let text: string | null = null;
  const storage = {
      getItem: () => text,
      setItem: (_key: string, value: string) => {
        text = value;
      },
    },
    preset = capturePreset("Default", emptySession);
  writePresetLibrary([preset], storage);
  expect(readPresetLibrary(storage)).toEqual([preset]);
  const before = text;
  expect(() => writePresetLibrary([preset, preset], storage)).toThrow(
    /already exists/,
  );
  expect(text).toBe(before);
  expect(() => writePresetLibrary(Array(25).fill(preset), storage)).toThrow(
    /24 presets/,
  );
  expect(() =>
    writePresetLibrary([preset], {
      setItem: () => {
        throw Error("Quota exceeded");
      },
    }),
  ).toThrow(/Quota/);
  text = "{";
  expect(() => readPresetLibrary(storage)).toThrow();
  text = "x".repeat(MAX_LIBRARY_BYTES + 1);
  expect(() => readPresetLibrary(storage)).toThrow(/4 MiB/);
});

it("persists tool styles in schema 4, preserves older defaults, rejects invalid/stale actions, and rolls back a failed preset transaction", () => {
  const styles = {
    ...DEFAULT_TOOL_STYLES,
    shape: { color: "#ff0000", width: 4, fill: null },
  };
  const history = new SessionHistory(emptySession);
  expect(
    history.apply({ type: "tool-styles", before: undefined, styles }),
  ).toBe(true);
  const project = parseProject(serializeProject(source, history.present));
  expect(project.version).toBe(4);
  expect(project.session.toolStyles).toEqual(styles);
  expect(
    parseProject(serializeProject(source, emptySession)).session.toolStyles,
  ).toBeUndefined();
  expect(() =>
    parseProject(JSON.stringify({ ...project, version: 3 })),
  ).toThrow(/version 4/);
  expect(
    history.apply({
      type: "tool-styles",
      before: undefined,
      styles: DEFAULT_TOOL_STYLES,
    }),
  ).toBe(false);
  expect(
    sessionReducer(emptySession, {
      type: "tool-styles",
      before: undefined,
      styles: { ...styles, shape: { ...styles.shape, width: Infinity } },
    }),
  ).toBe(emptySession);
  expect(
    sessionReducer(emptySession, {
      type: "bulk",
      before: emptySession,
      label: "Apply preset",
      actions: [
        {
          type: "category-preset",
          before: emptySession.legends,
          legends: [{ id: "new", name: "New", color: "#ff0000" }],
        },
        { type: "tool-styles", before: styles, styles: DEFAULT_TOOL_STYLES },
      ],
    }),
  ).toBe(emptySession);
});
