import type { Point, Size } from "./coordinates";

export type ComparisonAlignment = {
  /** Percentages of the baseline sheet's width and height, independent of display zoom. */
  x: number;
  y: number;
  scale: number;
  rotation: number;
};
export const defaultComparisonAlignment = (): ComparisonAlignment => ({
  x: 0,
  y: 0,
  scale: 1,
  rotation: 0,
});
export const MAX_COMPARISON_PIXELS = 4_000_000;
export const MAX_COMPARISON_EDGE = 4096;

export function comparisonSize(value: Size): Size {
  if (
    ![value.width, value.height].every(
      (n) => Number.isFinite(n) && n > 0 && n <= 10_000_000,
    )
  )
    throw new Error("This PDF page has invalid comparison dimensions.");
  return { width: value.width, height: value.height };
}

export function validateComparisonAlignment(
  value: ComparisonAlignment,
): ComparisonAlignment {
  if (
    ![value.x, value.y, value.scale, value.rotation].every(Number.isFinite) ||
    Math.abs(value.x) > 200 ||
    Math.abs(value.y) > 200 ||
    value.scale < 0.25 ||
    value.scale > 4 ||
    Math.abs(value.rotation) > 180
  )
    throw new Error(
      "Alignment requires offsets between -200% and 200%, scale 25%-400%, and rotation -180° to 180°.",
    );
  return { ...value };
}

/** Rotate/scale the revision about its sheet center, then translate in baseline-sheet units. */
export function alignedRevisionPoint(
  point: Point,
  baseline: Size,
  revision: Size,
  value: ComparisonAlignment,
): Point {
  const a = comparisonSize(baseline),
    b = comparisonSize(revision),
    alignment = validateComparisonAlignment(value);
  if (![point.x, point.y].every(Number.isFinite))
    throw new Error("Invalid comparison point.");
  const angle = (alignment.rotation * Math.PI) / 180,
    cos = Math.cos(angle),
    sin = Math.sin(angle);
  const dx = (point.x - b.width / 2) * alignment.scale,
    dy = (point.y - b.height / 2) * alignment.scale;
  return {
    x: b.width / 2 + dx * cos - dy * sin + (alignment.x * a.width) / 100,
    y: b.height / 2 + dx * sin + dy * cos + (alignment.y * a.height) / 100,
  };
}

/** Shared bounds keep differently sized, rotated or translated sheets fully available for review. */
export function comparisonFrame(
  baseline: Size,
  revision: Size,
  alignment: ComparisonAlignment,
) {
  const a = comparisonSize(baseline),
    b = comparisonSize(revision);
  const corners = [
    { x: 0, y: 0 },
    { x: b.width, y: 0 },
    { x: b.width, y: b.height },
    { x: 0, y: b.height },
  ].map((p) => alignedRevisionPoint(p, a, b, alignment));
  const left = Math.min(0, ...corners.map((p) => p.x)),
    top = Math.min(0, ...corners.map((p) => p.y));
  const right = Math.max(a.width, ...corners.map((p) => p.x)),
    bottom = Math.max(a.height, ...corners.map((p) => p.y));
  return { left, top, width: right - left, height: bottom - top };
}

export function comparisonRasterScale(size: Size, desired: number): number {
  const valid = comparisonSize(size);
  if (!Number.isFinite(desired) || desired <= 0)
    throw new Error("Invalid comparison render scale.");
  // Flooring pixel dimensions in the renderer keeps both edge and total-pixel budgets exact.
  return Math.min(
    desired,
    MAX_COMPARISON_EDGE / Math.max(valid.width, valid.height),
    Math.sqrt(MAX_COMPARISON_PIXELS / valid.width / valid.height),
  );
}

/** Map the visible screen rectangle back through a centered sheet rotation/scale.
 * Bounding rectangles alone are insufficient for rotated drawings. Returned
 * coordinates are local display pixels, before the sheet's CSS transform.
 */
export function comparisonVisibleTile(
  sheet: Size,
  bounds: { left: number; top: number },
  visible: { left: number; top: number; width: number; height: number },
  rotation: number,
  magnification: number,
) {
  comparisonSize(sheet);
  if (
    ![
      bounds.left,
      bounds.top,
      visible.left,
      visible.top,
      visible.width,
      visible.height,
      rotation,
      magnification,
    ].every(Number.isFinite) ||
    visible.width <= 0 ||
    visible.height <= 0 ||
    magnification < 0.25 ||
    magnification > 4 ||
    Math.abs(rotation) > 180
  )
    return null;
  const angle = (rotation * Math.PI) / 180,
    cos = Math.cos(angle),
    sin = Math.sin(angle),
    cx = sheet.width / 2,
    cy = sheet.height / 2;
  const corners = [
    [0, 0],
    [sheet.width, 0],
    [0, sheet.height],
    [sheet.width, sheet.height],
  ];
  const transformed = corners.map(([x, y]) => ({
    x: cx + magnification * ((x - cx) * cos - (y - cy) * sin),
    y: cy + magnification * ((x - cx) * sin + (y - cy) * cos),
  }));
  const originX = bounds.left - Math.min(...transformed.map((p) => p.x)),
    originY = bounds.top - Math.min(...transformed.map((p) => p.y));
  const local = [
    [visible.left, visible.top],
    [visible.left + visible.width, visible.top],
    [visible.left, visible.top + visible.height],
    [visible.left + visible.width, visible.top + visible.height],
  ].map(([x, y]) => {
    const dx = x - originX - cx,
      dy = y - originY - cy;
    return {
      x: cx + (dx * cos + dy * sin) / magnification,
      y: cy + (-dx * sin + dy * cos) / magnification,
    };
  });
  const left = Math.max(
      0,
      Math.floor(Math.min(...local.map((p) => p.x)) / 64) * 64 - 64,
    ),
    top = Math.max(
      0,
      Math.floor(Math.min(...local.map((p) => p.y)) / 64) * 64 - 64,
    ),
    right = Math.min(
      sheet.width,
      Math.ceil(Math.max(...local.map((p) => p.x)) / 64) * 64 + 64,
    ),
    bottom = Math.min(
      sheet.height,
      Math.ceil(Math.max(...local.map((p) => p.y)) / 64) * 64 + 64,
    );
  return right > left && bottom > top
    ? { left, top, width: right - left, height: bottom - top }
    : null;
}

/** Creates colored ink from a rendered sheet. White becomes transparent; PDF bytes are never touched. */
export function comparisonInk(
  source: Uint8ClampedArray,
  color: readonly [number, number, number],
): Uint8ClampedArray {
  if (
    source.length % 4 ||
    source.length > MAX_COMPARISON_PIXELS * 4 ||
    color.length !== 3 ||
    !color.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)
  )
    throw new Error("Invalid comparison raster.");
  const output = new Uint8ClampedArray(source.length);
  for (let i = 0; i < source.length; i += 4) {
    const darkness =
      1 -
      (source[i] * 0.2126 + source[i + 1] * 0.7152 + source[i + 2] * 0.0722) /
        255;
    output[i] = color[0];
    output[i + 1] = color[1];
    output[i + 2] = color[2];
    output[i + 3] = Math.round(source[i + 3] * Math.max(0, darkness));
  }
  return output;
}

export function comparisonPage(value: string, count: number): number {
  if (
    !Number.isInteger(count) ||
    count < 1 ||
    count > 10000 ||
    !/^\d{1,5}$/.test(value)
  )
    throw new Error("Enter a whole page number.");
  const page = Number(value);
  if (page < 1 || page > count)
    throw new Error(`Choose a page between 1 and ${count}.`);
  return page;
}
