import type { Shape } from "./shapes";
import type { Measurement } from "./measurements";

export type ToolStyles = {
  shape: Pick<Shape, "color" | "width" | "fill">;
  measurement: Pick<Measurement, "color" | "width" | "fontSize">;
};

export const DEFAULT_TOOL_STYLES: ToolStyles = {
  shape: { color: "#38bdf8", width: 2, fill: null },
  measurement: { color: "#0284c7", width: 2, fontSize: 12 },
};

export function parseToolStyles(value: unknown): ToolStyles {
  const v = value as ToolStyles,
    color = (c: unknown) => typeof c === "string" && /^#[0-9a-f]{6}$/.test(c),
    width = (n: unknown) =>
      typeof n === "number" && Number.isFinite(n) && n >= 0.01 && n <= 100;
  if (
    !v ||
    !v.shape ||
    !v.measurement ||
    !color(v.shape.color) ||
    !width(v.shape.width) ||
    !(v.shape.fill === null || color(v.shape.fill)) ||
    !color(v.measurement.color) ||
    !width(v.measurement.width) ||
    !Number.isFinite(v.measurement.fontSize) ||
    v.measurement.fontSize < 1 ||
    v.measurement.fontSize > 200
  )
    throw new Error("Invalid tool styles.");
  return {
    shape: { color: v.shape.color, width: v.shape.width, fill: v.shape.fill },
    measurement: {
      color: v.measurement.color,
      width: v.measurement.width,
      fontSize: v.measurement.fontSize,
    },
  };
}
