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

export function selectionBounds(
  objects: SelectedObject[],
  legends: Legend[],
  viewport: PageViewport,
) {
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
      const height = layoutLegend(o.value, legends).height;
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
  return bounds;
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
  return {
    objects: structuredClone(objects),
    viewport,
    legends: structuredClone(session.legends),
    categories: Object.fromEntries(
      objects.map((o) => [o.value.id, objectCategory(session, o.value.id)]),
    ),
    bounds: selectionBounds(objects, session.legends, viewport),
  };
}

export function movementLimits(
  objects: SelectedObject[],
  legends: Legend[],
  viewportFor: (page: number) => PageViewport,
) {
  let minX = -Infinity,
    maxX = Infinity,
    minY = -Infinity,
    maxY = Infinity;
  for (const page of new Set(objects.map((o) => o.value.page))) {
    const viewport = viewportFor(page),
      bounds = selectionBounds(
        objects.filter((o) => o.value.page === page),
        legends,
        viewport,
      );
    minX = Math.max(minX, Math.min(0, -bounds.left));
    maxX = Math.min(maxX, Math.max(0, viewport.width - bounds.right));
    minY = Math.max(minY, Math.min(0, -bounds.top));
    maxY = Math.min(maxY, Math.max(0, viewport.height - bounds.bottom));
  }
  return { minX, maxX, minY, maxY };
}

export function moveMarkups(
  session: AnnotationSession,
  ids: string[],
  dx: number,
  dy: number,
  viewportFor: (page: number) => PageViewport,
): SessionAction {
  if (!Number.isFinite(dx) || !Number.isFinite(dy))
    throw new Error("Invalid movement.");
  const objects = selectedObjects(session, ids);
  const { minX, maxX, minY, maxY } = movementLimits(
    objects,
    session.legends,
    viewportFor,
  );
  dx = Math.max(minX, Math.min(maxX, dx));
  dy = Math.max(minY, Math.min(maxY, dy));
  const actions: SingleSessionAction[] = objects.map((o) => {
    const v = o.value,
      viewport = viewportFor(v.page),
      p = viewportToPdf({ x: 0, y: 0 }, viewport),
      q = viewportToPdf({ x: dx, y: dy }, viewport);
    const shift = (point: Point) => ({
      x: point.x + q.x - p.x,
      y: point.y + q.y - p.y,
    });
    if (o.kind === "highlight")
      return {
        type: "move-stroke",
        before: o.value,
        legends: session.legends,
        points: o.value.points.map(shift),
      };
    if (o.kind === "shape")
      return {
        type: "put-shape",
        before: o.value,
        shape: { ...o.value, a: shift(o.value.a), b: shift(o.value.b) },
      };
    if (o.kind === "legend")
      return {
        type: "put-key",
        before: o.value,
        key: { ...o.value, ...shift(o.value) },
        legends: session.legends,
      };
    const n = o.value,
      note: NoteObject =
        n.type === "arrow"
          ? { ...n, a: shift(n.a), b: shift(n.b) }
          : {
              ...n,
              ...shift(n),
              pointers: n.pointers.map((pointer) => ({
                ...pointer,
                target: shift(pointer.target),
              })),
            };
    return { type: "put-note", before: n, note };
  });
  return { type: "bulk", before: session, actions, label: "Move selection" };
}

export function deleteMarkups(
  session: AnnotationSession,
  ids: string[],
): SessionAction {
  const objects = selectedObjects(session, ids);
  return {
    type: "bulk",
    before: session,
    label: "Delete selection",
    actions: objects.map((o) =>
      o.kind === "highlight"
        ? { type: "remove-stroke", id: o.value.id }
        : o.kind === "shape"
          ? { type: "remove-shape", id: o.value.id }
          : o.kind === "legend"
            ? { type: "remove-key", id: o.value.id }
            : { type: "remove-note", id: o.value.id },
    ),
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

export function duplicateMarkups(
  session: AnnotationSession,
  ids: string[],
  viewportFor: (page: number) => PageViewport,
  createId: () => string = () => crypto.randomUUID(),
) {
  const objects = selectedObjects(session, ids);
  let next = session;
  const actions: SingleSessionAction[] = [],
    created: string[] = [];
  for (const page of new Set(objects.map((o) => o.value.page))) {
    const viewport = viewportFor(page),
      clip = copyMarkups(
        session,
        objects.filter((o) => o.value.page === page).map((o) => o.value.id),
        viewport,
      );
    const center = viewportToPdf(
      {
        x: (clip.bounds.left + clip.bounds.right) / 2 + 12,
        y: (clip.bounds.top + clip.bounds.bottom) / 2 + 12,
      },
      viewport,
    );
    const result = pasteMarkups(next, clip, page, viewport, center, createId);
    if (result.action.type !== "bulk")
      throw new Error("Invalid duplicate transaction.");
    actions.push(...result.action.actions);
    created.push(...result.ids);
    next = sessionReducer(next, result.action);
  }
  return {
    action: {
      type: "bulk" as const,
      before: session,
      label: "Duplicate markups" as const,
      actions,
    },
    ids: created,
  };
}
