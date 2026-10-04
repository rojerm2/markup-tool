import type { Point } from "./coordinates";

export const MEASUREMENT_UNITS = ["mm", "cm", "m", "in", "ft", "yd"] as const;
export type MeasurementUnit = (typeof MEASUREMENT_UNITS)[number];
export const MAX_MEASUREMENTS = 1000;
export const MAX_MEASUREMENT_VERTICES = 128;
export type PageCalibration = {
  page: number;
  a: Point;
  b: Point;
  distance: number;
  unit: MeasurementUnit;
};
export type Measurement = {
  id: string;
  page: number;
  type: "length" | "area" | "perimeter";
  points: Point[];
  color: string;
  width: number;
  fontSize: number;
};
const meters: Record<MeasurementUnit, number> = {
  mm: 0.001,
  cm: 0.01,
  m: 1,
  in: 0.0254,
  ft: 0.3048,
  yd: 0.9144,
};
const point = (p: Point) =>
  !!p && [p.x, p.y].every((v) => Number.isFinite(v) && Math.abs(v) <= 1e9);
const distance = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);
const validPage = (p: number, pages: number) =>
  Number.isInteger(p) && p >= 1 && p <= pages;

export function validCalibration(
  value: PageCalibration,
  pages = 10000,
): boolean {
  if (
    !value ||
    !validPage(value.page, pages) ||
    !point(value.a) ||
    !point(value.b) ||
    !MEASUREMENT_UNITS.includes(value.unit) ||
    !Number.isFinite(value.distance) ||
    value.distance < 1e-6 ||
    value.distance > 1e9
  )
    return false;
  const span = distance(value.a, value.b);
  if (span < 1e-6 || span > 1e6) return false;
  const ratio = (value.distance * meters[value.unit]) / span;
  return ratio >= 1e-12 && ratio <= 1e12;
}

export function convertMeasurementUnit(
  value: number,
  from: MeasurementUnit,
  to: MeasurementUnit,
  area = false,
): number {
  if (
    !Number.isFinite(value) ||
    !MEASUREMENT_UNITS.includes(from) ||
    !MEASUREMENT_UNITS.includes(to)
  )
    throw new Error("Invalid measurement unit conversion.");
  const ratio = meters[from] / meters[to];
  const result = value * (area ? ratio * ratio : ratio);
  if (!Number.isFinite(result))
    throw new Error("Measurement is outside the supported range.");
  return result;
}

// Test non-adjacent edges, including touching and collinear overlaps. Coordinates
// are translated before the area sum to avoid cancellation on offset CropBoxes.
export function simplePolygon(points: Point[]): boolean {
  if (
    !Array.isArray(points) ||
    points.length < 3 ||
    points.length > MAX_MEASUREMENT_VERTICES ||
    !points.every(point)
  )
    return false;
  const left = Math.min(...points.map((p) => p.x)),
    right = Math.max(...points.map((p) => p.x)),
    bottom = Math.min(...points.map((p) => p.y)),
    top = Math.max(...points.map((p) => p.y));
  const span = Math.max(right - left, top - bottom);
  if (span < 1e-6 || span > 1e6) return false;
  const epsilon = Math.max(1e-9, span * 1e-10),
    orientationEpsilon = epsilon * span;
  const cross = (a: Point, b: Point, c: Point) =>
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const sign = (v: number) =>
    Math.abs(v) <= orientationEpsilon ? 0 : Math.sign(v);
  const on = (a: Point, b: Point, c: Point) =>
    sign(cross(a, b, c)) === 0 &&
    c.x >= Math.min(a.x, b.x) - epsilon &&
    c.x <= Math.max(a.x, b.x) + epsilon &&
    c.y >= Math.min(a.y, b.y) - epsilon &&
    c.y <= Math.max(a.y, b.y) + epsilon;
  for (let i = 0; i < points.length; i++) {
    const a = points[i],
      b = points[(i + 1) % points.length],
      prev = points[(i + points.length - 1) % points.length];
    if (
      distance(a, b) <= epsilon ||
      (sign(cross(prev, a, b)) === 0 &&
        (prev.x - a.x) * (b.x - a.x) + (prev.y - a.y) * (b.y - a.y) > 0)
    )
      return false;
    for (let j = i + 1; j < points.length; j++) {
      if (j === i + 1 || (i === 0 && j === points.length - 1)) continue;
      const c = points[j],
        d = points[(j + 1) % points.length];
      if (
        (sign(cross(a, b, c)) * sign(cross(a, b, d)) < 0 &&
          sign(cross(c, d, a)) * sign(cross(c, d, b)) < 0) ||
        on(a, b, c) ||
        on(a, b, d) ||
        on(c, d, a) ||
        on(c, d, b)
      )
        return false;
    }
  }
  return polygonArea(points) > orientationEpsilon;
}

export function polygonArea(points: Point[]): number {
  const origin = points[0];
  if (!origin) return 0;
  return (
    Math.abs(
      points.reduce((sum, p, i) => {
        const q = points[(i + 1) % points.length];
        return (
          sum +
          (p.x - origin.x) * (q.y - origin.y) -
          (q.x - origin.x) * (p.y - origin.y)
        );
      }, 0),
    ) / 2
  );
}

export function validMeasurement(value: Measurement, pages = 10000): boolean {
  if (
    !value ||
    typeof value.id !== "string" ||
    !value.id ||
    value.id.length > 256 ||
    // eslint-disable-next-line no-control-regex -- Reject control characters in persisted IDs.
    /[\u0000-\u001f]/.test(value.id) ||
    !validPage(value.page, pages) ||
    !["length", "area", "perimeter"].includes(value.type) ||
    typeof value.color !== "string" ||
    !/^#[0-9a-f]{6}$/.test(value.color) ||
    !Number.isFinite(value.width) ||
    value.width < 0.01 ||
    value.width > 100 ||
    !Number.isFinite(value.fontSize) ||
    value.fontSize < 1 ||
    value.fontSize > 200 ||
    !Array.isArray(value.points) ||
    value.points.length < 2 ||
    value.points.length > MAX_MEASUREMENT_VERTICES ||
    !value.points.every(point)
  )
    return false;
  if (value.type !== "length") return simplePolygon(value.points);
  return (
    value.points.length === 2 &&
    distance(value.points[0], value.points[1]) >= 1e-6 &&
    distance(value.points[0], value.points[1]) <= 1e6
  );
}

export function measurementValues(
  value: Measurement,
  calibration?: PageCalibration,
): {
  calibrated: boolean;
  unit: string;
  length?: number;
  perimeter?: number;
  area?: number;
} {
  if (
    !validMeasurement(value) ||
    (calibration &&
      (!validCalibration(calibration) || calibration.page !== value.page))
  )
    throw new Error("Invalid measurement or page calibration.");
  const ratio = calibration
    ? calibration.distance / distance(calibration.a, calibration.b)
    : 1;
  const closed = value.type !== "length";
  const perimeter =
    value.points.reduce(
      (sum, p, i) =>
        sum +
        (i + 1 < value.points.length
          ? distance(p, value.points[i + 1])
          : closed
            ? distance(p, value.points[0])
            : 0),
      0,
    ) * ratio;
  return {
    calibrated: !!calibration,
    unit: calibration?.unit ?? "PDF units",
    ...(value.type === "length" ? { length: perimeter } : { perimeter }),
    ...(value.type === "area"
      ? { area: polygonArea(value.points) * ratio * ratio }
      : {}),
  };
}

export function measurementLabel(
  value: Measurement,
  calibration?: PageCalibration,
): string {
  const values = measurementValues(value, calibration),
    format = (v: number) =>
      v > 0 && v < 0.001
        ? v.toPrecision(3)
        : new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(
            v,
          );
  const result =
    values.area !== undefined
      ? `${format(values.area)} ${values.unit}²`
      : `${format(values.length ?? values.perimeter!)} ${values.unit}`;
  return values.calibrated ? result : `${result} (uncalibrated)`;
}

export function measurementAnchor(value: Measurement): Point {
  const points = value.points;
  return {
    x:
      (Math.min(...points.map((p) => p.x)) +
        Math.max(...points.map((p) => p.x))) /
      2,
    y:
      (Math.min(...points.map((p) => p.y)) +
        Math.max(...points.map((p) => p.y))) /
      2,
  };
}
