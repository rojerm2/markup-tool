import { textError } from '../../services/pageLegend';
import { useEffect, useId, useState, type Dispatch, type FormEvent } from 'react';
import { legendNameError, type AnnotationSession, type SessionAction } from '../../services/annotationSession';
import { COLORS } from './DrawingControls';

export default function LegendControls({ session, dispatch }: { session: AnnotationSession; dispatch: Dispatch<SessionAction> }) {
  const [expanded, setExpanded] = useState(false);
  const [name, setName] = useState('');
  const [color, setColor] = useState(COLORS[0].value);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const formId = useId(), errorId = useId();
  const active = session.legends.find(item => item.id === session.activeLegendId);
  function reset() { setEditing(null); setName(''); setError(null); }
  useEffect(() => {
    if (editing && !session.legends.some(legend => legend.id === editing)) reset();
  }, [editing, session.legends]);
  function submit(event: FormEvent) {
    event.preventDefault();
    const message = legendNameError(session.legends, name, editing ?? undefined) ?? (editing && session.pageLegends?.some(k=>k.categoryIds.includes(editing)) ? textError(name) : null);
    setError(message);
    if (message) return;
    if (editing) dispatch({ type: 'rename', id: editing, name });
    else dispatch({ type: 'create', legend: { id: crypto.randomUUID(), name, color } });
    reset();
  }
  return <section className="legend-controls" aria-label="Legends">
    <div className="legend-bar">
      <button aria-expanded={expanded} aria-controls={formId} onClick={() => setExpanded(!expanded)}>Legends ({session.legends.length})</button>
      <span className="legend-drawing-label">New strokes:</span>
      <output aria-label="Active legend" className="legend-active">
        {active && <span className="legend-dot" style={{ background: active.color }} />}
        {active ? `Active: ${active.name}` : 'Unassigned · Manual color'}
      </output>
      <button aria-pressed={!active} onClick={() => dispatch({ type: 'select', id: null })}>Unassigned</button>
    </div>
    {expanded && <div id={formId} className="legend-editor">
      <div className="legend-list">
        {session.legends.length === 0 && <p>No legends yet. Draw with a palette color or create a category.</p>}
        {session.legends.map(legend => <div className="legend-row" key={legend.id}>
          <button className="legend-select" aria-label={`Select legend ${legend.name}`} aria-pressed={session.activeLegendId === legend.id}
            onClick={() => dispatch({ type: 'select', id: legend.id })}>
            <span className="legend-dot" style={{ background: legend.color }} /><span>{legend.name}</span>
          </button>
          <button aria-label={`Rename legend ${legend.name}`} onClick={() => { setEditing(legend.id); setName(legend.name); setError(null); }}>Rename</button>
          <button aria-label={`Delete legend ${legend.name}`} aria-describedby={`${formId}-delete`}
            onClick={() => { dispatch({ type: 'delete', id: legend.id }); if (editing === legend.id) reset(); }}>Delete</button>
        </div>)}
      </div>
      <p id={`${formId}-delete`} className="legend-note">Deleting a category keeps its strokes and colors and makes them unassigned. Its rows are removed from every page legend; empty page legends are removed. Undo restores everything.</p>
      <form onSubmit={submit} className="legend-form">
        <label>{editing ? 'Rename legend' : 'New legend'}<input aria-label="Legend name" maxLength={256} value={name}
          aria-invalid={!!error} aria-describedby={error ? errorId : undefined}
          onChange={event => { setName(event.target.value); setError(null); }} /></label>
        {!editing && <div className="control-group" role="group" aria-label="New legend color">
          {COLORS.map(item => <button type="button" className="color-swatch" key={item.value}
            aria-label={`Legend color ${item.name}`} aria-pressed={color === item.value} onClick={() => setColor(item.value)}>
            <span style={{ background: item.value }}>{color === item.value ? '✓' : ''}</span>{item.name}
          </button>)}
        </div>}
        <button type="submit">{editing ? 'Save name' : 'Create legend'}</button>
        {editing && <button type="button" onClick={reset}>Cancel rename</button>}
        {error && <p id={errorId} role="alert" className="legend-error">{error}</p>}
      </form>
    </div>}
  </section>;
}
