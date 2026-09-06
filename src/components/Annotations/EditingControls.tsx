import type { AnnotationSession, SessionAction } from '../../services/annotationSession';
import { COLORS, WIDTHS } from './DrawingControls';

export default function EditingControls({ session, selectedId, onSelect, dispatch }: {
  session: AnnotationSession; selectedId: string | null; onSelect: (id: string | null) => void; dispatch: (action: SessionAction) => void;
}) {
  const stroke = session.annotations.find(s => s.id === selectedId);
  const edit = (value: Extract<SessionAction, { type: 'edit-stroke' }>['edit']) => {
    if (stroke) dispatch({ type: 'edit-stroke', id: stroke.id, edit: value });
  };
  return <div className="editing-controls" role="group" aria-label="Edit selected stroke">
    <label>Selected stroke <select aria-label="Selected stroke" value={stroke?.id ?? ''} onChange={e => onSelect(e.target.value || null)}>
      <option value="">None — click a stroke</option>
      {session.annotations.map((s, i) => <option key={s.id} value={s.id}>Page {s.page} · Stroke {i+1}</option>)}
    </select></label>
    <label>Legend <select aria-label="Selected stroke legend" disabled={!stroke} value={stroke?.legendId ?? ''} onChange={e => edit({ legendId: e.target.value || null })}>
      <option value="">Unassigned</option>
      {session.legends.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
    </select></label>
    <label>Width <select aria-label="Selected stroke width" disabled={!stroke} value={stroke?.width ?? 10} onChange={e => edit({ width: Number(e.target.value) })}>
      {stroke && !WIDTHS.some(w => w.value === stroke.width) && <option value={stroke.width}>{stroke.width} PDF units</option>}
      {WIDTHS.map(w => <option key={w.value} value={w.value}>{w.name}</option>)}
    </select></label>
    {COLORS.map(c => <button key={c.value} className="color-swatch" disabled={!stroke} aria-label={`Selected stroke ${c.name}`} aria-pressed={stroke?.color === c.value}
      onClick={() => edit({ color: c.value })}><span style={{ background: c.value }}>{stroke?.color === c.value ? '✓' : ''}</span></button>)}
    <button disabled={!stroke} onClick={() => stroke && dispatch({ type: 'remove-stroke', id: stroke.id })}>Delete stroke</button>
  </div>;
}
