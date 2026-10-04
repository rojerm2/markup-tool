import type {
  AnnotationSession,
  Legend,
  SessionAction,
  SingleSessionAction,
} from "./annotationSession";
import { sessionReducer } from "./annotationSession";
import { serializeProject } from "./projectFormat";
import type { Highlight } from "../types/annotation";
import type { Shape } from "./shapes";
import { notePoint, type NoteObject } from "./notes";
import {
  keyMatrix,
  keyPoint,
  layoutLegend,
  type PageLegend,
} from "./pageLegend";
import {
  pdfToViewport,
  viewportToPdf,
  pdfWidthToViewport,
  type Point,
  type PageViewport,
} from "./coordinates";
import { objectCategory, objectLocked, objectVisible } from "./categoryPolicy";

export const MAX_SELECTION = 500;
export type SelectedObject =
  | { kind: "highlight"; value: Highlight }
  | { kind: "shape"; value: Shape }
  | { kind: "note"; value: NoteObject }
  | { kind: "legend"; value: PageLegend };
export type MarkupClipboard = {
  objects: SelectedObject[];
  viewport: PageViewport;
  legends: Legend[];
  categories: Record<string, string | null>;
  bounds: { left: number; top: number; right: number; bottom: number };
};

export function selectedObjects(
  session: AnnotationSession,
  ids: string[],
): SelectedObject[] {
  if (
    !ids.length ||
    ids.length > MAX_SELECTION ||
    new Set(ids).size !== ids.length
  )
    throw new Error(`Select between 1 and ${MAX_SELECTION} markups.`);
  const objects = new Map<string, SelectedObject>();
  session.annotations.forEach((value) =>
    objects.set(value.id, { kind: "highlight", value }),
  );
  session.shapes?.forEach((value) =>
    objects.set(value.id, { kind: "shape", value }),
  );
  session.notes?.forEach((value) =>
    objects.set(value.id, { kind: "note", value }),
  );
  session.pageLegends?.forEach((value) =>
    objects.set(value.id, { kind: "legend", value }),
  );
  return ids.map((id) => {
    const object = objects.get(id);
    if (!object) throw new Error("A selected markup no longer exists.");
    if (objectLocked(session, id) || !objectVisible(session, id))
      throw new Error("Unlock and show the selected categories first.");
    return object;
  });
}

export function copyMarkups(
  session: AnnotationSession,
  ids: string[],
  viewport: PageViewport,
): MarkupClipboard {
  const objects = selectedObjects(session, ids);
  if (new Set(objects.map((o) => o.value.page)).size !== 1)
    throw new Error("Select markups on one page to copy.");
  if (
    new TextEncoder().encode(JSON.stringify(objects)).length >
    2 * 1024 * 1024
  )
    throw new Error("Selection exceeds the 2 MiB clipboard limit.");
  const bounds = {
    left: Infinity,
    top: Infinity,
    right: -Infinity,
    bottom: -Infinity,
  };
  const include = (point: Point, padding = 0) => {
    const p = pdfToViewport(point, viewport),
      margin = pdfWidthToViewport(padding, viewport);
    bounds.left = Math.min(bounds.left, p.x - margin);
    bounds.top = Math.min(bounds.top, p.y - margin);
    bounds.right = Math.max(bounds.right, p.x + margin);
    bounds.bottom = Math.max(bounds.bottom, p.y + margin);
  };
  for (const o of objects) {
    const v = o.value;
    if (o.kind === "highlight")
      o.value.points.forEach((p) => include(p, o.value.width / 2));
    else if (o.kind === "shape") {
      include(o.value.a, o.value.width / 2);
      include(o.value.b, o.value.width / 2);
    } else if (o.kind === "note" && o.value.type === "arrow") {
      include(o.value.a, o.value.head);
      include(o.value.b, o.value.head);
    } else if (o.kind === "note" && o.value.type === "text") {
      for (const [x, y] of [
        [0, 0],
        [o.value.width, 0],
        [0, o.value.height],
        [o.value.width, o.value.height],
      ])
        include(notePoint(o.value, x, y));
      o.value.pointers.forEach((p) => include(p.target, p.head));
    } else if (o.kind === "legend") {
      const height = layoutLegend(o.value, session.legends).height;
      for (const [x, y] of [
        [0, 0],
        [o.value.width, 0],
        [0, height],
        [o.value.width, height],
      ])
        include(keyPoint(o.value, x, y));
    }
    if (!Number.isInteger(v.page)) throw new Error("Invalid markup page.");
  }
  if (!Object.values(bounds).every(Number.isFinite))
    throw new Error("Invalid selection geometry.");
  return {
    objects: structuredClone(objects),
    viewport,
    legends: structuredClone(session.legends),
    categories: Object.fromEntries(
      objects.map((o) => [o.value.id, objectCategory(session, o.value.id)]),
    ),
    bounds,
  };
}

export function pasteMarkups(
  session: AnnotationSession,
  clipboard: MarkupClipboard,
  page: number,
  viewport: PageViewport,
  center: Point,
  createId: () => string = () => crypto.randomUUID(),
): { action: SessionAction; ids: string[] } {
  if (
    !Number.isInteger(page) ||
    page < 1 ||
    page > 10000 ||
    ![center.x, center.y, viewport.width, viewport.height].every(
      Number.isFinite,
    )
  )
    throw new Error("Invalid paste destination.");
  const box = clipboard.bounds,
    width = box.right - box.left,
    height = box.bottom - box.top;
  if (width > viewport.width || height > viewport.height)
    throw new Error(
      "The selection is larger than this page. Choose a larger page.",
    );
  const anchor = pdfToViewport(center, viewport);
  const left = Math.max(
      0,
      Math.min(viewport.width - width, anchor.x - width / 2),
    ),
    top = Math.max(
      0,
      Math.min(viewport.height - height, anchor.y - height / 2),
    );
  const transform = (point: Point) => {
    const p = pdfToViewport(point, clipboard.viewport);
    return viewportToPdf(
      { x: p.x - box.left + left, y: p.y - box.top + top },
      viewport,
    );
  };
  const origin = transform({ x: 0, y: 0 }),
    unit = transform({ x: 1, y: 0 }),
    ratio = Math.hypot(unit.x - origin.x, unit.y - origin.y);
  if (!Number.isFinite(ratio) || ratio <= 0)
    throw new Error("Invalid PDF coordinate scale.");
  const ids: string[] = [],
    used = new Set(
      [
        ...session.legends,
        ...session.annotations,
        ...(session.shapes ?? []),
        ...(session.notes ?? []),
        ...(session.pageLegends ?? []),
      ].flatMap((v) => [
        v.id,
        ...("pointers" in v ? v.pointers.map((p) => p.id) : []),
      ]),
    );
  const fresh = () => {
    for (let i = 0; i < 32; i++) {
      const id = createId();
      if (id && id.length <= 256 && !used.has(id)) {
        used.add(id);
        return id;
      }
    }
    throw new Error("Could not create a unique markup ID.");
  };
  const mapCategory = (id: string | null) => {
    const old = clipboard.legends.find((l) => l.id === id),
      next =
        session.legends.find(
          (l) => l.id === id && l.name === old?.name && l.color === old?.color,
        ) ??
        session.legends.find(
          (l) => l.name === old?.name && l.color === old?.color,
        );
    if (next?.locked || next?.hidden)
      throw new Error(
        "Show and unlock the destination category before pasting.",
      );
    return next?.id ?? null;
  };
  const rotation = (value: {
    x: number;
    y: number;
    rotation: 0 | 90 | 180 | 270;
  }) => {
    const [a, b] = keyMatrix(value);
    const p = transform(value),
      q = transform({ x: value.x + a, y: value.y + b });
    return ((((Math.round(
      (Math.atan2(q.y - p.y, q.x - p.x) * 180) / Math.PI / 90,
    ) *
      90) %
      360) +
      360) %
      360) as 0 | 90 | 180 | 270;
  };
  const actions: SingleSessionAction[] = [],
    assignments = new Map<string, string>();
  for (const o of clipboard.objects) {
    const id = fresh();
    ids.push(id);
    const category = mapCategory(clipboard.categories[o.value.id]);
    if (o.kind === "highlight")
      actions.push({
        type: "commit",
        stroke: {
          ...o.value,
          id,
          page,
          legendId: category,
          points: o.value.points.map(transform),
          width: o.value.width * ratio,
        },
      });
    else if (o.kind === "shape")
      actions.push({
        type: "put-shape",
        shape: {
          ...o.value,
          id,
          page,
          a: transform(o.value.a),
          b: transform(o.value.b),
          width: o.value.width * ratio,
        },
      });
    else if (o.kind === "note") {
      const n = o.value;
      const note: NoteObject =
        n.type === "arrow"
          ? {
              ...n,
              id,
              page,
              a: transform(n.a),
              b: transform(n.b),
              width: n.width * ratio,
              head: n.head * ratio,
            }
          : {
              ...n,
              id,
              page,
              ...transform(n),
              rotation: rotation(n),
              width: n.width * ratio,
              height: n.height * ratio,
              fontSize: n.fontSize * ratio,
              pointers: n.pointers.map((p) => ({
                ...p,
                id: fresh(),
                target: transform(p.target),
                width: p.width * ratio,
                head: p.head * ratio,
              })),
            };
      actions.push({ type: "put-note", note });
    } else {
      const k = o.value,
        categoryIds = k.categoryIds
          .map(mapCategory)
          .filter((v): v is string => v !== null);
      if (!categoryIds.length)
        throw new Error("Restore the page legend's categories before pasting.");
      actions.push({
        type: "put-key",
        key: {
          ...k,
          id,
          page,
          ...transform(k),
          rotation: rotation(k),
          categoryIds,
          width: k.width * ratio,
          ...(k.height !== undefined ? { height: k.height * ratio } : {}),
          fontSize: k.fontSize * ratio,
        },
        legends: session.legends,
      });
    }
    if (category && o.kind !== "highlight") assignments.set(id, category);
  }
  for (const [id, categoryId] of assignments)
    actions.push({ type: "assign-category", ids: [id], categoryId });
  const action: SessionAction = {
    type: "bulk",
    before: session,
    label: "Paste markups",
    actions,
  };
  const next = sessionReducer(session, action);
  if (next === session)
    throw new Error("The markups cannot be placed safely on this page.");
  serializeProject(
    {
      reference: "clipboard.pdf",
      filename: "clipboard.pdf",
      sha256: "0".repeat(64),
      size: 1,
      pages: 10000,
    },
    next,
  );
  return { action, ids };
}
