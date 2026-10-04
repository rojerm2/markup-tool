import { expect, it } from "vitest";
import {
  alignedRevisionPoint,
  comparisonFrame,
  comparisonInk,
  comparisonPage,
  comparisonRasterScale,
  comparisonVisibleTile,
  defaultComparisonAlignment,
  MAX_COMPARISON_EDGE,
  MAX_COMPARISON_PIXELS,
  validateComparisonAlignment,
} from "../src/services/revisionComparison";

it("aligns unequal rotated sheets around the revision center with zoom-independent offsets and uncropped bounds", () => {
  const a = { width: 600, height: 800 },
    b = { width: 400, height: 200 };
  const alignment = { x: -50, y: 25, scale: 2, rotation: 90 };
  const corner = alignedRevisionPoint({ x: 0, y: 0 }, a, b, alignment);
  expect(corner.x).toBeCloseTo(100);
  expect(corner.y).toBeCloseTo(-100);
  const frame = comparisonFrame(a, b, alignment);
  expect(frame.left).toBeCloseTo(-300);
  expect(frame.top).toBeCloseTo(-100);
  expect(frame.width).toBeCloseTo(900);
  expect(frame.height).toBeCloseTo(900);
  for (const point of [
    { x: 0, y: 0 },
    { x: 400, y: 0 },
    { x: 400, y: 200 },
    { x: 0, y: 200 },
  ]) {
    const transformed = alignedRevisionPoint(point, a, b, alignment);
    expect(transformed.x).toBeGreaterThanOrEqual(frame.left - 0.0001);
    expect(transformed.y).toBeGreaterThanOrEqual(frame.top - 0.0001);
    expect(transformed.x).toBeLessThanOrEqual(
      frame.left + frame.width + 0.0001,
    );
    expect(transformed.y).toBeLessThanOrEqual(
      frame.top + frame.height + 0.0001,
    );
  }
  expect(comparisonFrame(a, b, defaultComparisonAlignment())).toEqual({
    left: 0,
    top: 0,
    width: 600,
    height: 800,
  });
});
it("maps viewport tiles through rotated/scaled sheets without cropping visible detail", () => {
  const sheet = { width: 4000, height: 3000 };
  for (const rotation of [0, 45, 90, -135]) {
    for (const magnification of [0.25, 1, 4]) {
      const angle = (rotation * Math.PI) / 180,
        cos = Math.cos(angle),
        sin = Math.sin(angle);
      const transform = (x: number, y: number) => ({
        x: 2000 + magnification * ((x - 2000) * cos - (y - 1500) * sin),
        y: 1500 + magnification * ((x - 2000) * sin + (y - 1500) * cos),
      });
      const corners = [
        [0, 0],
        [4000, 0],
        [0, 3000],
        [4000, 3000],
      ].map(([x, y]) => transform(x, y));
      const point = transform(2800, 1800),
        origin = { x: -1200, y: -800 };
      const tile = comparisonVisibleTile(
        sheet,
        {
          left: origin.x + Math.min(...corners.map((p) => p.x)),
          top: origin.y + Math.min(...corners.map((p) => p.y)),
        },
        {
          left: origin.x + point.x - 50,
          top: origin.y + point.y - 50,
          width: 100,
          height: 100,
        },
        rotation,
        magnification,
      )!;
      expect(tile.left).toBeLessThanOrEqual(2800);
      expect(tile.top).toBeLessThanOrEqual(1800);
      expect(tile.left + tile.width).toBeGreaterThanOrEqual(2800);
      expect(tile.top + tile.height).toBeGreaterThanOrEqual(1800);
      expect(tile.left).toBeGreaterThanOrEqual(0);
      expect(tile.left + tile.width).toBeLessThanOrEqual(4000);
      const ratio = comparisonRasterScale(tile, 2 * magnification);
      expect(
        Math.floor(tile.width * ratio) * Math.floor(tile.height * ratio),
      ).toBeLessThanOrEqual(MAX_COMPARISON_PIXELS);
    }
  }
  expect(
    comparisonVisibleTile(
      sheet,
      { left: 0, top: 0 },
      { left: 10000, top: 10000, width: 100, height: 100 },
      0,
      1,
    ),
  ).toBeNull();
  expect(
    comparisonVisibleTile(
      sheet,
      { left: NaN, top: 0 },
      { left: 0, top: 0, width: 100, height: 100 },
      0,
      1,
    ),
  ).toBeNull();
});
it("caps raster memory and edges even for huge sheets and high zoom; rejects invalid geometry", () => {
  for (const size of [
    { width: 100000, height: 80000 },
    { width: 1, height: 100000 },
    { width: 1200, height: 900 },
  ]) {
    const scale = comparisonRasterScale(size, 32),
      width = Math.max(1, Math.floor(size.width * scale)),
      height = Math.max(1, Math.floor(size.height * scale));
    expect(width * height).toBeLessThanOrEqual(MAX_COMPARISON_PIXELS);
    expect(Math.max(width, height)).toBeLessThanOrEqual(MAX_COMPARISON_EDGE);
  }
  expect(() =>
    comparisonRasterScale({ width: Infinity, height: 1 }, 1),
  ).toThrow("dimensions");
  expect(() => comparisonRasterScale({ width: 1, height: 1 }, 0)).toThrow(
    "scale",
  );
  for (const change of [
    { x: NaN },
    { y: 201 },
    { scale: 0 },
    { rotation: 181 },
  ])
    expect(() =>
      validateComparisonAlignment({
        ...defaultComparisonAlignment(),
        ...change,
      }),
    ).toThrow("Alignment");
});
it("creates transparent white and colored ink with source alpha without changing the original raster", () => {
  const source = new Uint8ClampedArray([
    255, 255, 255, 255, 0, 0, 0, 255, 128, 128, 128, 128, 0, 0, 0, 0,
  ]);
  const snapshot = source.slice(),
    color = [0, 102, 255] as const;
  const output = comparisonInk(source, color);
  expect([...output]).toEqual([
    0, 102, 255, 0, 0, 102, 255, 255, 0, 102, 255, 64, 0, 102, 255, 0,
  ]);
  expect(source).toEqual(snapshot);
  expect(() => comparisonInk(new Uint8ClampedArray(3), color)).toThrow(
    "raster",
  );
  expect(() => comparisonInk(new Uint8ClampedArray(4), [256, 0, 0])).toThrow(
    "raster",
  );
});
it("validates independently paired page numbers and rejects letters, spaces, exponent and missing pages", () => {
  expect(comparisonPage("37", 37)).toBe(37);
  expect(comparisonPage("2", 2)).toBe(2);
  for (const value of ["", "0", "38", " 1", "1 ", "1e1", "2a", "1.2"])
    expect(() => comparisonPage(value, 37)).toThrow();
});
