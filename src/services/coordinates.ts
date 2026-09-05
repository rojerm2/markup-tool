import type { PDFPageProxy } from "pdfjs-dist";

export type PageViewport = ReturnType<PDFPageProxy["getViewport"]>;
export type Point = { x: number; y: number };
export type Size = { width: number; height: number };
export type PageRect = Size & { left: number; top: number };

// Persist raw PDF user-space coordinates, including CropBox offsets. PDF.js
// handles rotation, UserUnit and the PDF-up / viewport-down axis conversion.
// Viewport units are CSS pixels; backing-canvas/device pixels never enter here.
export function pdfToViewport(point: Point, viewport: PageViewport): Point {
  const [x, y] = viewport.convertToViewportPoint(point.x, point.y);
  return { x, y };
}

export function viewportToPdf(point: Point, viewport: PageViewport): Point {
  const [x, y] = viewport.convertToPdfPoint(point.x, point.y);
  return { x, y };
}

export function clientToPdf(point: Point, rect: PageRect, viewport: PageViewport): Point {
  return viewportToPdf({
    x: (point.x - rect.left) * viewport.width / rect.width,
    y: (point.y - rect.top) * viewport.height / rect.height,
  }, viewport);
}

export function pdfToClient(point: Point, rect: PageRect, viewport: PageViewport): Point {
  const position = pdfToViewport(point, viewport);
  return {
    x: rect.left + position.x * rect.width / viewport.width,
    y: rect.top + position.y * rect.height / viewport.height,
  };
}

export type ZoomMode = "manual" | "page" | "width";
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 8;
export const clampZoom = (scale: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale));

// Fit modes deliberately allow scales below the manual minimum for huge sheets.
export function fitScale(page: Size, available: Size, mode: "page" | "width"): number {
  const width = Math.max(1, available.width) / page.width;
  return mode === "width" ? width : Math.min(width, Math.max(1, available.height) / page.height);
}
