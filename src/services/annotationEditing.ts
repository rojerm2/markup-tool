import type { Highlight } from '../types/annotation';
import { clientToPdf, pdfToClient, pdfWidthToViewport, type PageRect, type PageViewport, type Point } from './coordinates';

export function highlightGroups(strokes: Highlight[]): Map<string, Highlight[]> {
  const groups = new Map<string, Highlight[]>();
  for (const stroke of strokes) {
    const key = `${stroke.color.toLowerCase()}:${stroke.opacity}`;
    const group = groups.get(key) ?? [];
    group.push(stroke);
    groups.set(key, group);
  }
  return groups;
}

function segmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = dx || dy ? Math.max(0, Math.min(1, ((p.x-a.x)*dx + (p.y-a.y)*dy)/(dx*dx+dy*dy))) : 0;
  return Math.hypot(p.x-a.x-t*dx, p.y-a.y-t*dy);
}

// Reverse actual paint order: last color/opacity layer, then last stroke in it.
export function pickHighlight(strokes: Highlight[], point: Point, rect: PageRect, viewport: PageViewport): Highlight | null {
  const ordered = [...highlightGroups(strokes).values()].flat().reverse();
  return ordered.find(stroke => {
    const points = stroke.points.map(p => pdfToClient(p, rect, viewport));
    const radius = pdfWidthToViewport(stroke.width, viewport) * Math.max(rect.width / viewport.width, rect.height / viewport.height) / 2 + 4;
    return points.some((p, i) => i > 0 && segmentDistance(point, points[i-1], p) <= radius);
  }) ?? null;
}

// Pointer is clamped to the page, not individual vertices: shape stays rigid, and
// may extend beyond the crop (SVG clips it). Always derive from the start snapshot.
export function translatedHighlight(stroke: Highlight, start: Point, client: Point, rect: PageRect, viewport: PageViewport): Highlight {
  const end = clientToPdf({ x: Math.max(rect.left, Math.min(rect.left+rect.width, client.x)),
    y: Math.max(rect.top, Math.min(rect.top+rect.height, client.y)) }, rect, viewport);
  const dx = end.x - start.x, dy = end.y - start.y;
  return { ...stroke, points: stroke.points.map(p => ({ x: p.x+dx, y: p.y+dy })) };
}

export function isEditingControl(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest('dialog, [role="dialog"], [role="alertdialog"], input, textarea, select, [contenteditable]:not([contenteditable="false"])');
}
