import { showStrokePreview } from '../../services/strokePreview';
import { useEffect, useRef, useState } from 'react';
import type { SessionHistory } from '../../services/sessionHistory';
import { focusCanvas } from '../../services/canvasFocus';

export const MIN_HIGHLIGHT_WIDTH = 0.25;
export const MAX_HIGHLIGHT_WIDTH = 100;

export default function WidthControl({ value, color, label = 'Highlight width', history, onChange }: {
  value: number; color: string; label?: string; history?: SessionHistory; onChange: (width: number) => void;
}) {
  const [draft, setDraft] = useState<number | null>(null);
  const pending = useRef<number | null>(null);
  const cancel = () => { pending.current = null; setDraft(null); };
  const commit = () => {
    const next = pending.current;
    cancel();
    if (next !== null && next !== value) onChange(next);
  };
  useEffect(cancel, [value, color]);
  useEffect(() => history?.subscribeCancellation(cancel), [history]);
  useEffect(() => history?.subscribeSnapshotCancellation(cancel), [history]);
  const width = draft ?? value;
  return <div className="highlight-width-control" onFocus={e => showStrokePreview(e.target, { width, color })} onPointerDown={e => showStrokePreview(e.target, { width, color })}>
    <div className="width-heading"><span className="control-label">Width</span>
      <label><input aria-label={label} type="number" min={MIN_HIGHLIGHT_WIDTH} max={MAX_HIGHLIGHT_WIDTH} step="0.25" value={width}
        onChange={e => { const next = e.currentTarget.valueAsNumber; if (Number.isFinite(next) && next >= MIN_HIGHLIGHT_WIDTH && next <= MAX_HIGHLIGHT_WIDTH) { cancel(); showStrokePreview(e.target, { width: next, color }); onChange(next); } }}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); focusCanvas(e.currentTarget); } }} /> pt</label>
    </div>
    <input aria-label={`${label} slider`} type="range" min={MIN_HIGHLIGHT_WIDTH} max={MAX_HIGHLIGHT_WIDTH} step="0.25" value={Math.min(MAX_HIGHLIGHT_WIDTH, Math.max(MIN_HIGHLIGHT_WIDTH, width))}
      onPointerDown={e => e.currentTarget.setPointerCapture(e.pointerId)}
      onChange={e => { pending.current = Number(e.currentTarget.value); setDraft(pending.current); showStrokePreview(e.target, { width: pending.current, color }); }}
      onPointerUp={e => { commit(); focusCanvas(e.currentTarget); }} onPointerCancel={cancel} onLostPointerCapture={cancel} onBlur={commit}
      onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); cancel(); } if (e.key === 'Enter') { e.preventDefault(); commit(); focusCanvas(e.currentTarget); } }}
      onKeyUp={e => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) commit(); }} />
    <div className="width-scale"><span>Very thin</span><span>Very thick</span></div>
    <svg className="width-preview" viewBox="0 0 200 48" aria-hidden="true"><path d="M24 24H176" stroke={color} strokeWidth={Math.min(width, MAX_HIGHLIGHT_WIDTH) * 0.4} strokeLinecap="round" opacity="0.5" /></svg>
  </div>;
}
