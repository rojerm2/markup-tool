import { COLORS } from './DrawingControls';
import { SHAPE_WIDTHS, type Shape } from '../../services/shapes';

export default function ShapeControls({shapes,selected,onSelect,value,onChange,onDelete,line=false,showProperties=true}: {
  shapes:Shape[];selected:string|null;onSelect:(id:string|null)=>void;value:Pick<Shape,'color'|'width'|'fill'>;onChange:(style:Pick<Shape,'color'|'width'|'fill'>)=>void;onDelete?:()=>void;line?:boolean;showProperties?:boolean;
}) {
  const shape=shapes.find(s=>s.id===selected);
  return <div className="shape-controls" role="group" aria-label="Shape properties">
    <label>Shapes <select aria-label="Selected shape" value={selected??''} onChange={e=>onSelect(e.target.value||null)}><option value="">Choose a shape</option>{shapes.map((s,i)=><option key={s.id} value={s.id}>Page {s.page} · {s.type} {i+1}</option>)}</select></label>
    {showProperties&&<><label>Outline <select aria-label="Shape outline" value={value.color} onChange={e=>onChange({...value,color:e.target.value})}>
      {!COLORS.some(c=>c.value===value.color)&&<option value={value.color}>Saved color</option>}{COLORS.map(c=><option key={c.value} value={c.value}>{c.name}</option>)}
    </select></label>
    <label>Width <select aria-label="Shape width" value={value.width} onChange={e=>onChange({...value,width:Number(e.target.value)})}>
      {!SHAPE_WIDTHS.some(w=>w.value===value.width)&&<option value={value.width}>{value.width} PDF units</option>}{SHAPE_WIDTHS.map(w=><option key={w.value} value={w.value}>{w.name}</option>)}
    </select></label>
    <label>Fill (20%) <select aria-label="Shape fill" disabled={line||shape?.type==='line'} value={value.fill??''} onChange={e=>onChange({...value,fill:e.target.value||null})}><option value="">None</option>
      {value.fill&&!COLORS.some(c=>c.value===value.fill)&&<option value={value.fill}>Saved color</option>}{COLORS.map(c=><option key={c.value} value={c.value}>{c.name}</option>)}
    </select></label>
    <span>Opaque outline</span>{onDelete&&<button onClick={onDelete}>Delete shape</button>}</>}
  </div>;
}
