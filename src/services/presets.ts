import {
  emptySession,
  sessionReducer,
  type AnnotationSession,
  type Legend,
  type SessionAction,
  type SingleSessionAction,
} from "./annotationSession";
import {
  copyMarkups,
  pasteMarkups,
  selectedObjects,
  selectionBounds,
} from "./bulkEditing";
import type { PageViewport, Point } from "./coordinates";
import { parseProject, serializeProject } from "./projectFormat";
import { sameSession } from "./sessionHistory";
import {
  DEFAULT_TOOL_STYLES,
  parseToolStyles,
  type ToolStyles,
} from "./toolStyles";
import type { DrawingStyle } from "../components/Annotations/DrawingControls";
import type { NoteObject } from "./notes";

export const MAX_PRESET_BYTES = 1024 * 1024;
export const MAX_PRESETS = 24;
export const MAX_LIBRARY_BYTES = 4 * 1024 * 1024;
export const MAX_SYMBOLS = 32;
export const MAX_SYMBOL_OBJECTS = 100;
const LIBRARY_KEY = "pdf-markup.presets.v1";
const SYMBOL_SOURCE = {
  reference: "symbol.pdf",
  filename: "symbol.pdf",
  sha256: "0".repeat(64),
  size: 1,
  pages: 1,
};
export type ReusableSymbol = {
  name: string;
  width: number;
  height: number;
  session: AnnotationSession;
};
export type MarkupPreset = {
  format: "pdf-markup-preset";
  version: 1;
  name: string;
  drawing: DrawingStyle;
  toolStyles: ToolStyles;
  categories: Pick<Legend, "name" | "color">[];
  symbols: ReusableSymbol[];
};

function fail(field: string): never {
  throw new Error(`Invalid preset: ${field}.`);
}

function name(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value !== value.trim() ||
    value.length > 256 ||
    // eslint-disable-next-line no-control-regex -- Reject control characters in portable names.
    /[\u0000-\u001f\u007f]/.test(value)
  )
    return fail("name");
  return value;
}

function categories(value: unknown) {
  if (!Array.isArray(value) || value.length > 256) return fail("categories");
  const seen = new Set<string>();
  return value.map((v) => {
    const label = name(v?.name);
    if (
      seen.has(label.toLowerCase()) ||
      typeof v.color !== "string" ||
      !/^#[0-9a-f]{6}$/.test(v.color)
    )
      return fail("duplicate category or color");
    seen.add(label.toLowerCase());
    return { name: label, color: v.color as string };
  });
}

export function symbolViewport(width: number, height: number): PageViewport {
  if (![width, height].every((n) => Number.isFinite(n) && n >= 1 && n <= 1e6))
    return fail("symbol frame");
  return {
    width,
    height,
    convertToViewportPoint: (x: number, y: number) => [x, height - y],
    convertToPdfPoint: (x: number, y: number) => [x, height - y],
  } as PageViewport;
}

function note(value: NoteObject): NoteObject {
  // Reconstruct known fields so unrecognized imported metadata never follows a symbol.
  if (value.type === "arrow")
    return {
      id: value.id,
      page: value.page,
      type: value.type,
      a: { x: value.a.x, y: value.a.y },
      b: { x: value.b.x, y: value.b.y },
      color: value.color,
      width: value.width,
      head: value.head,
    };
  return {
    id: value.id,
    page: value.page,
    type: value.type,
    x: value.x,
    y: value.y,
    rotation: value.rotation,
    width: value.width,
    height: value.height,
    fontSize: value.fontSize,
    color: value.color,
    background: value.background,
    border: value.border,
    text: value.text,
    pointers: value.pointers.map((p) => ({
      id: p.id,
      target: { x: p.target.x, y: p.target.y },
      color: p.color,
      width: p.width,
      head: p.head,
    })),
  };
}

function symbol(value: unknown): ReusableSymbol {
  if (!value || typeof value !== "object") return fail("symbol");
  const v = value as ReusableSymbol,
    label = name(v.name),
    viewport = symbolViewport(v.width, v.height);
  const parsed = parseProject(
    JSON.stringify({
      format: "pdf-markup-project",
      version: 4,
      source: SYMBOL_SOURCE,
      session: v.session,
    }),
  ).session;
  if (
    parsed.measurements?.length ||
    parsed.calibrations?.length ||
    parsed.pageLegends?.length ||
    parsed.toolStyles
  )
    return fail("symbols support highlights, shapes, text and arrows only");
  const session: AnnotationSession = {
    ...emptySession,
    legends: parsed.legends.map((l) => ({
      id: l.id,
      name: l.name,
      color: l.color,
    })),
    annotations: parsed.annotations,
    ...(parsed.shapes?.length ? { shapes: parsed.shapes } : {}),
    ...(parsed.notes?.length ? { notes: parsed.notes.map(note) } : {}),
    ...(parsed.objectCategories
      ? { objectCategories: parsed.objectCategories }
      : {}),
  };
  const ids = [
    ...session.annotations,
    ...(session.shapes ?? []),
    ...(session.notes ?? []),
  ].map((o) => o.id);
  if (!ids.length || ids.length > MAX_SYMBOL_OBJECTS)
    return fail("symbol object count");
  const bounds = selectionBounds(
    selectedObjects(session, ids),
    session.legends,
    viewport,
  );
  if (
    bounds.left < -1e-6 ||
    bounds.top < -1e-6 ||
    bounds.right > viewport.width + 1e-6 ||
    bounds.bottom > viewport.height + 1e-6
  )
    return fail("symbol outside frame");
  return { name: label, width: v.width, height: v.height, session };
}

export function parsePreset(text: string): MarkupPreset {
  if (
    text.length > MAX_PRESET_BYTES ||
    new TextEncoder().encode(text).length > MAX_PRESET_BYTES
  )
    return fail("exceeds 1 MiB");
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return fail("JSON syntax");
  }
  if (!value || typeof value !== "object") return fail("root");
  const v = value as MarkupPreset;
  if (v.format !== "pdf-markup-preset" || v.version !== 1)
    return fail("format or unsupported version");
  const drawing = parseProject(
    serializeProject(SYMBOL_SOURCE, { ...emptySession, drawing: v.drawing }),
  ).session.drawing;
  if (drawing.width < 0.25 || drawing.width > 100)
    return fail("highlight width must be 0.25–100 pt");
  const toolStyles = parseToolStyles(v.toolStyles),
    definitions = categories(v.categories);
  if (!Array.isArray(v.symbols) || v.symbols.length > MAX_SYMBOLS)
    return fail("symbols");
  const seen = new Set<string>();
  const symbols = v.symbols.map((s) => {
    const result = symbol(s),
      key = result.name.toLowerCase();
    if (seen.has(key)) return fail("duplicate symbol name");
    seen.add(key);
    return result;
  });
  return {
    format: "pdf-markup-preset",
    version: 1,
    name: name(v.name),
    drawing,
    toolStyles,
    categories: definitions,
    symbols,
  };
}

export function serializePreset(value: MarkupPreset) {
  const text = JSON.stringify(parsePreset(JSON.stringify(value)), null, 2);
  if (new TextEncoder().encode(text).length > MAX_PRESET_BYTES)
    return fail("exceeds 1 MiB");
  return text;
}

export function capturePreset(
  label: string,
  session: AnnotationSession,
  symbols: ReusableSymbol[] = [],
): MarkupPreset {
  return parsePreset(
    JSON.stringify({
      format: "pdf-markup-preset",
      version: 1,
      name: label.trim(),
      drawing: session.drawing,
      toolStyles: session.toolStyles ?? DEFAULT_TOOL_STYLES,
      categories: session.legends.map((l) => ({
        name: l.name,
        color: l.color,
      })),
      symbols,
    }),
  );
}

export function captureSymbol(
  label: string,
  session: AnnotationSession,
  ids: string[],
  viewport: PageViewport,
): ReusableSymbol {
  const objects = selectedObjects(session, ids);
  if (
    objects.length > MAX_SYMBOL_OBJECTS ||
    objects.some((o) => o.kind === "measurement" || o.kind === "legend")
  )
    throw new Error(
      "Select up to 100 highlights, shapes, text notes or arrows on one page.",
    );
  const usedCategories = new Set(
    objects.map((o) =>
      o.kind === "highlight"
        ? o.value.legendId
        : session.objectCategories?.[o.value.id],
    ),
  );
  const legends = session.legends
    .filter((l) => usedCategories.has(l.id))
    .map((l) => ({ id: l.id, name: l.name, color: l.color }));
  const base = { ...emptySession, legends },
    target = symbolViewport(viewport.width, viewport.height),
    result = pasteMarkups(
      base,
      copyMarkups(session, ids, viewport),
      1,
      target,
      { x: target.width / 2, y: target.height / 2 },
    );
  return symbol({
    name: label.trim(),
    width: target.width,
    height: target.height,
    session: sessionReducer(base, result.action),
  });
}

function categoryPlan(
  session: AnnotationSession,
  definitions: Pick<Legend, "name" | "color">[],
  createId: () => string,
) {
  const existing = [...session.legends],
    added: Legend[] = [],
    reused: string[] = [],
    renamed: { from: string; to: string }[] = [];
  const used = new Set(
    [
      ...session.legends,
      ...session.annotations,
      ...(session.notes ?? []),
      ...(session.shapes ?? []),
      ...(session.measurements ?? []),
      ...(session.pageLegends ?? []),
    ].flatMap((v) => [
      v.id,
      ...("pointers" in v ? v.pointers.map((p) => p.id) : []),
    ]),
  );
  for (const definition of definitions) {
    const match = existing.find(
      (l) =>
        l.name.toLowerCase() === definition.name.toLowerCase() &&
        l.color === definition.color,
    );
    if (match) {
      reused.push(match.name);
      continue;
    }
    let label = definition.name;
    for (
      let suffix = 2;
      existing.some((l) => l.name.toLowerCase() === label.toLowerCase());
      suffix++
    )
      label = `${definition.name.slice(0, 240)} (${suffix})`;
    if (label !== definition.name)
      renamed.push({ from: definition.name, to: label });
    let id = "";
    for (let tries = 0; tries < 32; tries++) {
      const candidate = createId();
      if (
        typeof candidate === "string" &&
        candidate.length > 0 &&
        candidate.length <= 256 &&
        // eslint-disable-next-line no-control-regex -- Validate IDs before entering history.
        !/[\u0000-\u001f]/.test(candidate) &&
        !used.has(candidate)
      ) {
        id = candidate;
        break;
      }
    }
    if (!id) throw new Error("Could not create a unique category ID.");
    used.add(id);
    const legend = { id, name: label, color: definition.color };
    added.push(legend);
    existing.push(legend);
  }
  if (existing.length > 1000)
    throw new Error("The project category limit is 1,000.");
  return { added, reused, renamed };
}

export function applyPreset(
  session: AnnotationSession,
  preset: MarkupPreset,
  options: { styles: boolean; categories: boolean },
  createId: () => string = () => crypto.randomUUID(),
) {
  const valid = parsePreset(serializePreset(preset)),
    plan = categoryPlan(
      session,
      options.categories ? valid.categories : [],
      createId,
    ),
    actions: SingleSessionAction[] = [];
  if (plan.added.length)
    actions.push({
      type: "category-preset",
      before: session.legends,
      legends: plan.added,
    });
  if (options.styles) {
    if (
      !sameSession(session.drawing, valid.drawing) ||
      session.activeLegendId !== null
    )
      actions.push({ type: "drawing", drawing: valid.drawing, manual: true });
    if (
      !sameSession(session.toolStyles ?? DEFAULT_TOOL_STYLES, valid.toolStyles)
    )
      actions.push({
        type: "tool-styles",
        before: session.toolStyles,
        styles: valid.toolStyles,
      });
  }
  const action: SessionAction | null = actions.length
    ? { type: "bulk", before: session, actions, label: "Apply preset" }
    : null;
  if (action && sessionReducer(session, action) === session)
    throw new Error("This preset could not be applied safely.");
  return { ...plan, action };
}

export function placeSymbol(
  session: AnnotationSession,
  value: ReusableSymbol,
  page: number,
  viewport: PageViewport,
  center: Point,
  importCategories: boolean,
  createId: () => string = () => crypto.randomUUID(),
) {
  const valid = symbol(value),
    plan = categoryPlan(
      session,
      importCategories ? valid.session.legends : [],
      createId,
    ),
    actions: SingleSessionAction[] = [];
  if (plan.added.length)
    actions.push({
      type: "category-preset",
      before: session.legends,
      legends: plan.added,
    });
  const destination = actions.length
    ? sessionReducer(session, actions[0])
    : session;
  // Remap conflicting definitions to the renamed categories before the usual clipboard mapping.
  const source = {
    ...valid.session,
    legends: valid.session.legends.map((l) => ({
      ...l,
      name: (() => {
        const desired =
          plan.renamed.find((r) => r.from === l.name)?.to ?? l.name;
        return (
          destination.legends.find(
            (d) =>
              d.color === l.color &&
              d.name.toLowerCase() === desired.toLowerCase(),
          )?.name ?? desired
        );
      })(),
    })),
  };
  const ids = [
    ...source.annotations,
    ...(source.shapes ?? []),
    ...(source.notes ?? []),
  ].map((o) => o.id);
  const pasted = pasteMarkups(
    destination,
    copyMarkups(source, ids, symbolViewport(valid.width, valid.height)),
    page,
    viewport,
    center,
    createId,
  );
  if (pasted.action.type !== "bulk")
    throw new Error("Invalid symbol placement.");
  actions.push(...pasted.action.actions);
  const action: SessionAction = {
    type: "bulk",
    before: session,
    actions,
    label: "Place symbol",
  };
  const next = sessionReducer(session, action);
  if (next === session)
    throw new Error("This symbol could not be placed safely.");
  serializeProject({ ...SYMBOL_SOURCE, pages: 10000 }, next);
  return {
    action,
    ids: pasted.ids,
    ...plan,
  };
}

export function readPresetLibrary(
  storage: Pick<Storage, "getItem"> = localStorage,
): MarkupPreset[] {
  const text = storage.getItem(LIBRARY_KEY);
  if (!text) return [];
  if (
    text.length > MAX_LIBRARY_BYTES ||
    new TextEncoder().encode(text).length > MAX_LIBRARY_BYTES
  )
    throw new Error("Preset library exceeds 4 MiB.");
  const values: unknown = JSON.parse(text);
  if (!Array.isArray(values) || values.length > MAX_PRESETS)
    throw new Error("Invalid preset library.");
  const seen = new Set<string>();
  return values.map((v) => {
    const result = parsePreset(JSON.stringify(v)),
      key = result.name.toLowerCase();
    if (seen.has(key)) throw new Error("Duplicate preset name.");
    seen.add(key);
    return result;
  });
}

export function writePresetLibrary(
  values: MarkupPreset[],
  storage: Pick<Storage, "setItem"> = localStorage,
) {
  if (values.length > MAX_PRESETS)
    throw new Error("Keep up to 24 presets in the local library.");
  const seen = new Set<string>();
  const validated = values.map((v) => {
    const result = parsePreset(serializePreset(v)),
      key = result.name.toLowerCase();
    if (seen.has(key))
      throw new Error(
        "A preset with this name already exists. Rename it or explicitly replace it.",
      );
    seen.add(key);
    return result;
  });
  const text = JSON.stringify(validated);
  if (new TextEncoder().encode(text).length > MAX_LIBRARY_BYTES)
    throw new Error("Preset library exceeds 4 MiB. Export some presets first.");
  storage.setItem(LIBRARY_KEY, text);
}
