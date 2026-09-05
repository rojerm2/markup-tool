export const COLORS = [
  { name: 'Yellow', value: '#facc15' },
  { name: 'Green', value: '#4ade80' },
  { name: 'Blue', value: '#38bdf8' },
  { name: 'Pink', value: '#f472b6' },
];
export const WIDTHS = [{ name: 'Thin', value: 5 }, { name: 'Medium', value: 10 }, { name: 'Thick', value: 20 }];
export type DrawingStyle = { color: string; width: number; opacity: number };
export const DEFAULT_DRAWING: DrawingStyle = { color: COLORS[0].value, width: 10, opacity: 0.4 };

export default function DrawingControls({ value, onChange }: { value: DrawingStyle; onChange: (value: DrawingStyle, manual: boolean) => void }) {
  return <div className="drawing-controls" role="toolbar" aria-label="Drawing controls">
    <span className="tool-status">Highlighter</span>
    <div className="control-group" role="group" aria-label="Stroke width">
      <span className="control-label">Width</span>
      {WIDTHS.map(width => <button key={width.value} aria-pressed={value.width === width.value}
        title={`${width.value} PDF units`} onClick={() => onChange({ ...value, width: width.value }, false)}>{width.name}</button>)}
    </div>
    <div className="control-group" role="group" aria-label="Highlight color">
      <span className="control-label">Color</span>
      {COLORS.map(color => <button key={color.value} className="color-swatch" aria-label={color.name}
        title={color.name} aria-pressed={value.color === color.value} onClick={() => onChange({ ...value, color: color.value }, true)}>
        <span style={{ background: color.value }}>{value.color === color.value ? '✓' : ''}</span>
      </button>)}
    </div>
  </div>;
}
