import { useEffect, useRef, useState } from 'react';
import { highlightOutline, svgPath } from '../../services/highlightGeometry';
import type { SessionHistory } from '../../services/sessionHistory';
import type { Highlight } from '../../types/annotation';

function Sample({ value }: { value: number }) {
  const stroke: Highlight = { id: 'sample', type: 'freehand', page: 1, legendId: null, color: '#facc15', opacity: 1, width: 20, rounding: value, points: [{x:20,y:45},{x:65,y:45},{x:65,y:15}] };
  return <svg width="90" height="65" viewBox="0 0 90 65" aria-hidden="true">
    {value === 100 ? <polyline points="20,45 65,45 65,15" fill="none" stroke={stroke.color} strokeWidth="20" strokeLinecap="round" strokeLinejoin="round" /> : <path d={svgPath(highlightOutline(stroke))} fill={stroke.color} />}
    <path d="M20 45H65V15" fill="none" stroke="#475569" strokeWidth="1" />
  </svg>;
}

export default function RoundingControl({ value, history, identity, onPreview, onCommit }: {
  value: number; history: SessionHistory; identity: unknown; onPreview: (value: number | null) => void; onCommit: (value: number, generation: number) => void;
}) {
  const [top,setTop]=useState(180);
  const details=useRef<HTMLDetailsElement>(null);
  const [draft, setDraft] = useState<number | null>(null);
  const active = useRef<{value:number; generation:number; commit:typeof onCommit} | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const capturedElement = useRef<HTMLInputElement|null>(null);
  const pointer = useRef<number | null>(null);
  const previewCallback = useRef(onPreview); previewCallback.current = onPreview;
  function cancel() {
    active.current = null; setDraft(null); previewCallback.current(null);
    const id = pointer.current; pointer.current = null;
    if (id !== null && capturedElement.current?.hasPointerCapture(id)) capturedElement.current.releasePointerCapture(id);
    capturedElement.current=null;
  }
  function change(next: number) {
    active.current ??= {value:next,generation:history.generation,commit:onCommit};
    active.current.value = next; setDraft(next); onPreview(next);
  }
  function commit() { const pending = active.current; cancel(); if (pending) pending.commit(pending.value, pending.generation); }
  useEffect(()=>history.subscribeSnapshotCancellation(cancel),[history]);
  useEffect(() => history.subscribeCancellation(cancel), [history]);
  useEffect(() => { cancel(); }, [identity]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') cancel(); };
    const hidden=()=>{if(document.hidden)cancel();};
    window.addEventListener('keydown',key); window.addEventListener('blur',cancel); window.addEventListener('scroll',cancel,true); document.addEventListener('visibilitychange',hidden);
    return () => { cancel(); window.removeEventListener('keydown',key); window.removeEventListener('blur',cancel); window.removeEventListener('scroll',cancel,true); document.removeEventListener('visibilitychange',hidden); };
  }, []);
  return <details ref={details} className="rounding-control" onToggle={e => { if (!e.currentTarget.open) cancel(); else setTop(e.currentTarget.getBoundingClientRect().bottom+6); }}>
    <summary>Rounding {draft ?? value}%</summary>
    <div className="rounding-popover" style={{top,maxHeight:`calc(100vh - ${top+12}px)`}} role="group" aria-label="Highlight rounding">
      <strong>Highlight ends and bends</strong><button className="rounding-close" onClick={()=>{cancel();if(details.current)details.current.open=false;}}>Close rounding</button>
      <div className="rounding-presets">{[['Sharp',0],['Soft',50],['Round',100]].map(([name,n]) => <button key={name} aria-pressed={(draft ?? value) === n} onClick={() => { cancel(); onCommit(Number(n),history.generation); }}><Sample value={Number(n)} />{name}</button>)}</div>
      <label>Rounding <output>{draft ?? value}%</output><input ref={input} aria-label="Rounding" type="range" min="0" max="100" step="1" value={draft ?? value}
        onPointerDown={e => { capturedElement.current=e.currentTarget; pointer.current=e.pointerId; e.currentTarget.setPointerCapture(e.pointerId); }}
        onChange={e => change(Number(e.target.value))} onPointerUp={commit} onPointerCancel={cancel} onLostPointerCapture={cancel}
        onKeyUp={e => { if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown'].includes(e.key)) commit(); }} onBlur={cancel} /></label>
      <Sample value={draft ?? value} /><small>Radius = percentage of half the width. Ends extend by this radius. Release to apply; Escape cancels.</small>
    </div>
  </details>;
}
