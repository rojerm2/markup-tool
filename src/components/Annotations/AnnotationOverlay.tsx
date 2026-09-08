import { highlightOutline, svgPath } from '../../services/highlightGeometry';
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { clientToPdf, pdfToViewport, pdfWidthToViewport, type PageViewport, type Point } from '../../services/coordinates';
import { DEFAULT_DRAWING, type DrawingStyle } from './DrawingControls';
import type { Highlight } from '../../types/annotation';
import { highlightGroups, isEditingControl, pickHighlight, translatedHighlight } from '../../services/annotationEditing';
import type { Legend, SessionAction } from '../../services/annotationSession';

import type { SessionHistory } from '../../services/sessionHistory';

type Props = { page: number; viewport: PageViewport; annotations: Highlight[]; onCommit: (stroke: Highlight, generation?: number) => void; style?: DrawingStyle; legendId?: string | null;
  tool?: 'highlight' | 'edit'; selectedId?: string | null; onSelect?: (id: string | null) => void;
  onAction?: (action: SessionAction, generation?: number) => void; legends?: Legend[]; disabled?: boolean; viewRevision?: number; history?: SessionHistory };
const NO_LEGENDS: Legend[] = [];

export default function AnnotationOverlay({ page, viewport, annotations, onCommit, style = DEFAULT_DRAWING, legendId = null,
  tool = 'highlight', selectedId = null, onSelect, onAction, legends = NO_LEGENDS, disabled = false, viewRevision = 0, history }: Props) {
  const svg = useRef<SVGSVGElement>(null);
  const draft = useRef<{ pointer: number; generation?: number; stroke: Highlight; samples: Point[] } | null>(null);
  const move = useRef<{ pointer: number; generation?: number; before: Highlight; start: Point; client: Point; legends: Legend[]; preview: Highlight | null } | null>(null);
  const [preview, setPreview] = useState<Highlight | null>(null);
  function cancel() {
    const pointer = draft.current?.pointer ?? move.current?.pointer;
    draft.current = null;
    move.current = null;
    setPreview(null);
    if (pointer !== undefined && svg.current?.hasPointerCapture(pointer)) svg.current.releasePointerCapture(pointer);
  }
  useEffect(() => history?.subscribeCancellation(cancel), [history]);
  useEffect(() => {
    const surface = svg.current;
    const key = (event: KeyboardEvent) => {
      if ((event.code === 'Space' && !isEditingControl(event.target)) || event.code === 'Escape') cancel();
      if (event.key === 'Shift') projectDraft(event.type === 'keydown');
    };
    const hidden = () => { if (document.hidden) cancel(); };
    window.addEventListener('keydown', key);
    window.addEventListener('keyup', key);
    window.addEventListener('blur', cancel);
    window.addEventListener('scroll', cancel, true);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      const pointer = draft.current?.pointer ?? move.current?.pointer;
      draft.current = null;
      move.current = null;
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
  useEffect(() => { cancel(); }, [tool, disabled, viewRevision]);
  useEffect(() => {
    const active = move.current;
    if (active && (!annotations.includes(active.before) || legends !== active.legends || selectedId !== active.before.id)) cancel();
  }, [annotations, legends, selectedId]);
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
  function appendMove(event: PointerEvent<SVGSVGElement>) {
    const active = move.current;
    if (!active || active.pointer !== event.pointerId) return;
    if (!active.preview && Math.hypot(event.clientX-active.client.x, event.clientY-active.client.y) < 4) return;
    active.preview = translatedHighlight(active.before, active.start, { x: event.clientX, y: event.clientY }, event.currentTarget.getBoundingClientRect(), viewport);
    setPreview(active.preview);
  }
  const displayed = annotations.map(s => move.current && preview?.id === s.id ? preview : s);
  const groups = highlightGroups([...displayed, ...(!move.current && preview ? [preview] : [])]);
  const selected = tool === 'edit' ? displayed.find(s => s.id === selectedId) : undefined;

  return <svg ref={svg} className={`annotation-overlay ${tool === 'edit' ? 'is-editing' : ''}`} aria-label={`Highlights for page ${page}`}
    width={viewport.width} height={viewport.height} viewBox={`0 0 ${viewport.width} ${viewport.height}`}
    onPointerDown={event => {
      if (disabled || event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey || draft.current || move.current) return;
      event.preventDefault();
      if (tool === 'edit') {
        const hit = pickHighlight(annotations, { x: event.clientX, y: event.clientY }, event.currentTarget.getBoundingClientRect(), viewport);
        onSelect?.(hit?.id ?? null);
        event.currentTarget.closest<HTMLElement>('.pdf-scroll')?.focus({ preventScroll: true });
        if (hit) {
          event.currentTarget.setPointerCapture(event.pointerId);
          move.current = { pointer: event.pointerId, generation: history?.generation, before: hit, start: point(event), client: { x: event.clientX, y: event.clientY }, legends, preview: null };
        }
        return;
      }
      event.currentTarget.setPointerCapture(event.pointerId);
      const stroke: Highlight = { id: crypto.randomUUID(), legendId, page, type: 'freehand', points: [point(event)], ...style };
      draft.current = { pointer: event.pointerId, generation: history?.generation, stroke, samples: [...stroke.points] }; setPreview(stroke);
    }}
    onPointerMove={event => { if ((draft.current?.pointer === event.pointerId || move.current?.pointer === event.pointerId) && event.buttons === 0) cancel(); else { append(event); appendMove(event); } }}
    onPointerUp={event => {
      if (move.current?.pointer === event.pointerId) {
        appendMove(event);
        const active = move.current;
        cancel();
        if (!disabled && active.preview) onAction?.({ type: 'move-stroke', before: active.before, points: active.preview.points, legends: active.legends }, active.generation);
        return;
      }
      if (draft.current?.pointer !== event.pointerId) return;
      append(event);
      const { stroke, generation } = draft.current;
      cancel();
      if (!disabled && stroke.points.some(p => p.x !== stroke.points[0].x || p.y !== stroke.points[0].y)) onCommit(stroke, generation);
    }}
    onPointerCancel={cancel} onLostPointerCapture={cancel}>
    {[...groups].map(([key, strokes]) => <g key={key} opacity={strokes[0].opacity} data-highlight-layer={key}>
      {strokes.map(stroke => (stroke.rounding ?? 100) < 100 ? <path key={stroke.id} data-annotation-id={stroke.id} data-legend-id={stroke.legendId ?? ''} data-draft={stroke === preview ? 'true' : undefined} d={svgPath(highlightOutline(stroke), p => pdfToViewport(p, viewport))} fill={stroke.color} pointerEvents="none" /> : <polyline key={stroke.id}
      data-annotation-id={stroke.id} data-legend-id={stroke.legendId ?? ''} data-draft={stroke === preview ? 'true' : undefined}
      points={stroke.points.map(p => { const v = pdfToViewport(p, viewport); return `${v.x},${v.y}`; }).join(' ')}
      fill="none" stroke={stroke.color} strokeWidth={pdfWidthToViewport(stroke.width, viewport)}
      strokeLinecap="round" strokeLinejoin="round" pointerEvents="none" />)}
    </g>)}
    {selected && <polyline data-selection-indicator="true"
      points={selected.points.map(p => { const v = pdfToViewport(p, viewport); return `${v.x},${v.y}`; }).join(' ')}
      fill="none" stroke="#172554" strokeWidth="1.5" strokeDasharray="4 4" vectorEffect="non-scaling-stroke"
      strokeLinecap="round" strokeLinejoin="round" pointerEvents="none" />}
  </svg>;
}
