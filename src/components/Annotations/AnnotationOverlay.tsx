import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { clientToPdf, pdfToViewport, pdfWidthToViewport, type PageViewport, type Point } from '../../services/coordinates';
import { DEFAULT_DRAWING, type DrawingStyle } from './DrawingControls';
import type { Highlight } from '../../types/annotation';

type Props = { page: number; viewport: PageViewport; annotations: Highlight[]; onCommit: (stroke: Highlight) => void; style?: DrawingStyle; legendId?: string | null };

export default function AnnotationOverlay({ page, viewport, annotations, onCommit, style = DEFAULT_DRAWING, legendId = null }: Props) {
  const svg = useRef<SVGSVGElement>(null);
  const draft = useRef<{ pointer: number; stroke: Highlight; samples: Point[] } | null>(null);
  const [preview, setPreview] = useState<Highlight | null>(null);
  function cancel() {
    const pointer = draft.current?.pointer;
    draft.current = null;
    setPreview(null);
    if (pointer !== undefined && svg.current?.hasPointerCapture(pointer)) svg.current.releasePointerCapture(pointer);
  }
  useEffect(() => {
    const surface = svg.current;
    const key = (event: KeyboardEvent) => {
      if (event.code === 'Space' || event.code === 'Escape') cancel();
      if (event.key === 'Shift') projectDraft(event.type === 'keydown');
    };
    const hidden = () => { if (document.hidden) cancel(); };
    window.addEventListener('keydown', key);
    window.addEventListener('keyup', key);
    window.addEventListener('blur', cancel);
    window.addEventListener('scroll', cancel, true);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      const pointer = draft.current?.pointer;
      draft.current = null;
      if (pointer !== undefined && surface?.hasPointerCapture(pointer)) surface.releasePointerCapture(pointer);
      window.removeEventListener('keydown', key);
      window.removeEventListener('keyup', key);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('scroll', cancel, true);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, []);
  // A view change abandons an unfinished gesture, never connecting two views.
  useEffect(() => { cancel(); }, [viewport.width, viewport.height, ...(viewport.transform ?? [])]);
  function point(event: PointerEvent<SVGSVGElement>): Point {
    const rect = event.currentTarget.getBoundingClientRect();
    return clientToPdf({ x: Math.max(rect.left, Math.min(rect.right, event.clientX)),
      y: Math.max(rect.top, Math.min(rect.bottom, event.clientY)) }, rect, viewport);
  }
  function projectDraft(straight: boolean) {
    const active = draft.current;
    if (!active) return;
    const samples = active.samples;
    active.stroke = { ...active.stroke, points: straight && samples.length > 1
      ? [samples[0], samples[samples.length - 1]] : [...samples] };
    setPreview(active.stroke);
  }
  function append(event: PointerEvent<SVGSVGElement>) {
    const active = draft.current;
    if (!active || active.pointer !== event.pointerId) return;
    const next = point(event), last = active.samples[active.samples.length - 1];
    if (next.x !== last.x || next.y !== last.y) active.samples.push(next);
    projectDraft(event.shiftKey);
  }
  // First occurrence fixes layer order; preview joins its existing color/opacity layer.
  const groups = new Map<string, Highlight[]>();
  for (const stroke of [...annotations, ...(preview ? [preview] : [])]) {
    const key = `${stroke.color.toLowerCase()}:${stroke.opacity}`;
    const group = groups.get(key) ?? [];
    group.push(stroke);
    groups.set(key, group);
  }

  return <svg ref={svg} className="annotation-overlay" aria-label={`Highlights for page ${page}`}
    width={viewport.width} height={viewport.height} viewBox={`0 0 ${viewport.width} ${viewport.height}`}
    onPointerDown={event => {
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey || draft.current) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      const stroke: Highlight = { id: crypto.randomUUID(), legendId, page, type: 'freehand', points: [point(event)], ...style };
      draft.current = { pointer: event.pointerId, stroke, samples: [...stroke.points] }; setPreview(stroke);
    }}
    onPointerMove={event => { if (draft.current?.pointer === event.pointerId && event.buttons === 0) cancel(); else append(event); }}
    onPointerUp={event => {
      if (draft.current?.pointer !== event.pointerId) return;
      append(event);
      const stroke = draft.current.stroke;
      cancel();
      if (stroke.points.some(p => p.x !== stroke.points[0].x || p.y !== stroke.points[0].y)) onCommit(stroke);
    }}
    onPointerCancel={cancel} onLostPointerCapture={cancel}>
    {[...groups].map(([key, strokes]) => <g key={key} opacity={strokes[0].opacity} data-highlight-layer={key}>
      {strokes.map(stroke => <polyline key={stroke.id}
      data-annotation-id={stroke.id} data-legend-id={stroke.legendId ?? ''} data-draft={stroke === preview ? 'true' : undefined}
      points={stroke.points.map(p => { const v = pdfToViewport(p, viewport); return `${v.x},${v.y}`; }).join(' ')}
      fill="none" stroke={stroke.color} strokeWidth={pdfWidthToViewport(stroke.width, viewport)}
      strokeLinecap="round" strokeLinejoin="round" pointerEvents="none" />)}
    </g>)}
  </svg>;
}
