import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { clientToPdf, pdfToViewport, type PageViewport, type Point } from '../../services/coordinates';
import type { Highlight } from '../../types/annotation';

type Props = { page: number; viewport: PageViewport; annotations: Highlight[]; onCommit: (stroke: Highlight) => void };

export default function AnnotationOverlay({ page, viewport, annotations, onCommit }: Props) {
  const svg = useRef<SVGSVGElement>(null);
  const draft = useRef<{ pointer: number; stroke: Highlight } | null>(null);
  const [preview, setPreview] = useState<Highlight | null>(null);
  function cancel() {
    const pointer = draft.current?.pointer;
    draft.current = null;
    setPreview(null);
    if (pointer !== undefined && svg.current?.hasPointerCapture(pointer)) svg.current.releasePointerCapture(pointer);
  }
  useEffect(() => {
    const surface = svg.current;
    const key = (event: KeyboardEvent) => { if (event.code === 'Space' || event.code === 'Escape') cancel(); };
    const hidden = () => { if (document.hidden) cancel(); };
    window.addEventListener('keydown', key);
    window.addEventListener('blur', cancel);
    window.addEventListener('scroll', cancel, true);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      const pointer = draft.current?.pointer;
      draft.current = null;
      if (pointer !== undefined && surface?.hasPointerCapture(pointer)) surface.releasePointerCapture(pointer);
      window.removeEventListener('keydown', key);
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
  function append(event: PointerEvent<SVGSVGElement>) {
    const active = draft.current;
    if (!active || active.pointer !== event.pointerId) return;
    const next = point(event), last = active.stroke.points[active.stroke.points.length - 1];
    if (next.x !== last.x || next.y !== last.y) active.stroke = { ...active.stroke, points: [...active.stroke.points, next] };
    setPreview(active.stroke);
  }
  const origin = pdfToViewport({ x: 0, y: 0 }, viewport);
  const unit = pdfToViewport({ x: 1, y: 0 }, viewport);
  const widthScale = Math.hypot(unit.x - origin.x, unit.y - origin.y);
  return <svg ref={svg} className="annotation-overlay" aria-label={`Highlights for page ${page}`}
    width={viewport.width} height={viewport.height} viewBox={`0 0 ${viewport.width} ${viewport.height}`}
    onPointerDown={event => {
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey || draft.current) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      const stroke: Highlight = { id: crypto.randomUUID(), page, type: 'freehand', points: [point(event)], color: '#facc15', width: 10, opacity: 0.4 };
      draft.current = { pointer: event.pointerId, stroke }; setPreview(stroke);
    }}
    onPointerMove={event => { if (draft.current?.pointer === event.pointerId && event.buttons === 0) cancel(); else append(event); }}
    onPointerUp={event => {
      if (draft.current?.pointer !== event.pointerId) return;
      append(event);
      const stroke = draft.current.stroke;
      cancel();
      if (stroke.points.length > 1) onCommit(stroke);
    }}
    onPointerCancel={cancel} onLostPointerCapture={cancel}>
    {[...annotations, ...(preview ? [preview] : [])].map(stroke => <polyline key={stroke.id}
      data-annotation-id={stroke.id} data-draft={stroke === preview ? 'true' : undefined}
      points={stroke.points.map(p => { const v = pdfToViewport(p, viewport); return `${v.x},${v.y}`; }).join(' ')}
      fill="none" stroke={stroke.color} strokeWidth={stroke.width * widthScale} opacity={stroke.opacity}
      strokeLinecap="round" strokeLinejoin="round" pointerEvents="none" />)}
  </svg>;
}
