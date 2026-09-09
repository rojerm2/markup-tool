import { arrowGeometry, layoutNote, notePoint, pointerOrigin, type ArrowStyle, type NoteObject } from '../../services/notes';
import { pdfToViewport, pdfWidthToViewport, type PageViewport, type Point } from '../../services/coordinates';
import { svgPath } from '../../services/highlightGeometry';
import { textWidth } from '../../services/pageLegend';

export function ArrowGraphic({a,b,style,viewport,hit=false}:{a:Point;b:Point;style:ArrowStyle;viewport:PageViewport;hit?:boolean}) {
  const g=arrowGeometry(a,b,style),path=(p:typeof g.head)=>svgPath(p,p=>pdfToViewport(p,viewport));
  return <g>
    <path d={path(g.shaft)} fill="none" stroke={style.color} strokeWidth={pdfWidthToViewport(style.width,viewport)} strokeLinecap="butt" pointerEvents="none"/>
    <path d={path(g.head)} fill={style.color} pointerEvents="none"/>
    {hit&&<><path d={path(g.shaft)} fill="none" stroke="transparent" strokeWidth={pdfWidthToViewport(style.width,viewport)+12} pointerEvents="stroke"/>
      <path d={path(g.head)} fill="transparent" stroke="transparent" strokeWidth={10} pointerEvents="all"/></>}
  </g>;
}
export default function NoteGraphic({note,viewport,editing=false}:{note:NoteObject;viewport:PageViewport;editing?:boolean}) {
  if(note.type==='arrow')return <g data-note-id={note.id}><ArrowGraphic a={note.a} b={note.b} style={note} viewport={viewport} hit={editing}/></g>;
  const p=pdfToViewport(notePoint(note,0,0),viewport),x=pdfToViewport(notePoint(note,1,0),viewport),y=pdfToViewport(notePoint(note,0,1),viewport);
  return <g data-note-id={note.id}>
    {note.pointers.map(pointer=>{const a=pointerOrigin(note,pointer.target);return a&&<g key={pointer.id} data-pointer-id={pointer.id}><ArrowGraphic a={a} b={pointer.target} style={pointer} viewport={viewport} hit={editing}/></g>;})}
    <g transform={`matrix(${x.x-p.x} ${x.y-p.y} ${y.x-p.x} ${y.y-p.y} ${p.x} ${p.y})`}>
      <rect width={note.width} height={note.height} fill={note.background?'white':'transparent'} stroke={note.border?note.color:'none'} strokeWidth={.5} pointerEvents={editing?'all':'none'}/>
      {layoutNote(note).lines.map((line,i)=>{let x=8;return <text key={i} y={8+note.fontSize+i*note.fontSize*1.4} fontFamily="LegendSans" fontSize={note.fontSize} fill={note.color} xmlSpace="preserve" pointerEvents="none" style={{fontKerning:'none'}}>
        {[...line].map((c,j)=>{const at=x;x+=textWidth(c,note.fontSize);return <tspan key={j} x={at}>{c}</tspan>;})}
      </text>;})}
    </g>
  </g>;
}
