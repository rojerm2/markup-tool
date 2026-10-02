import type { AnnotationSession, SessionAction } from '../../services/annotationSession';
import { COLORS } from './DrawingControls';
import { showStrokePreview } from '../../services/strokePreview';
import WidthControl from './WidthControl';
import type { SessionHistory } from '../../services/sessionHistory';

export default function EditingControls({ session, selectedId, onSelect, dispatch, history }: {
  session: AnnotationSession; selectedId: string | null; onSelect: (id: string | null) => void; dispatch: (action: SessionAction) => void; history?: SessionHistory;
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
    {stroke && <><label>Legend <select aria-label="Selected stroke legend" value={stroke.legendId ?? ''} onChange={e => edit({ legendId: e.target.value || null })}>
      <option value="">Unassigned</option>
      {session.legends.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
    </select></label>
    <WidthControl key={stroke.id} value={stroke.width} color={stroke.color} history={history} label="Selected stroke width" onChange={width => edit({ width })} />
    {COLORS.map(c => <button key={c.value} className="color-swatch" disabled={!stroke} aria-label={`Selected stroke ${c.name}`} aria-pressed={stroke?.color === c.value}
      onClick={e => { if(stroke)showStrokePreview(e.target,{...stroke,color:c.value}); edit({ color: c.value }); }}><span style={{ background: c.value }}>{stroke?.color === c.value ? '✓' : ''}</span>{c.name}</button>)}
    </>}
    <button disabled={!stroke} onClick={() => stroke && dispatch({ type: 'remove-stroke', id: stroke.id })}>Delete stroke</button>
  </div>;
}
