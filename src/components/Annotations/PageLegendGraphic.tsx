import { keyPoint, layoutLegend, textWidth, type PageLegend } from '../../services/pageLegend';
import { pdfToViewport, type PageViewport } from '../../services/coordinates';
import type { Legend } from '../../services/annotationSession';

export default function PageLegendGraphic({value,legends,viewport,selected=false}: {value:PageLegend;legends:Legend[];viewport?:PageViewport;selected?:boolean}) {
  const layout=layoutLegend(value,legends);
  let transform='';
  if(viewport) {
    const p=pdfToViewport(keyPoint(value,0,0),viewport), x=pdfToViewport(keyPoint(value,1,0),viewport), y=pdfToViewport(keyPoint(value,0,1),viewport);
    transform=`matrix(${x.x-p.x} ${x.y-p.y} ${y.x-p.x} ${y.y-p.y} ${p.x} ${p.y})`;
  }
  return <g transform={transform} data-key-id={value.id}>
    <rect width={value.width} height={layout.height} fill={value.background?'white':'transparent'} stroke={value.border?'#999':'none'} strokeWidth={.5}/>
    {layout.chips.map((c,i)=><rect key={i} x={c.x} y={c.y} width={layout.chip} height={layout.chip} fill={c.color}/>)}
    {layout.texts.map((t,i)=>{let x=t.x;return <text key={i} y={t.y} fontFamily="LegendSans" fontSize={value.fontSize} fill="#1f2429" style={{fontKerning:'none'}}>
      {[...t.text].map((c,j)=>{const at=x;x+=textWidth(c,value.fontSize);return <tspan key={j} x={at}>{c}</tspan>;})}
    </text>;})}
    {selected && <rect x={-2} y={-2} width={value.width+4} height={layout.height+4} fill="none" stroke="#2563eb" strokeWidth={1} strokeDasharray="4 3"/>}
  </g>;
}
