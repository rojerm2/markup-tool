import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { clientToPdf, pdfToClient, pdfToViewport, pdfWidthToViewport, type PageViewport, type Point } from '../../services/coordinates';
import { constrainedPoint, moveShape, pickShape, resizeShape, shapeHandles, shapePath, validShape, type Shape, type ShapeKind } from '../../services/shapes';
import { svgPath } from '../../services/highlightGeometry';
import { isEditingControl } from '../../services/annotationEditing';
import type { SessionHistory } from '../../services/sessionHistory';
import type { SessionAction } from '../../services/annotationSession';

export default function ShapeOverlay({page,viewport,shapes,tool,style,selected,onSelect,dispatch,history,disabled,revision}: {
  page:number;viewport:PageViewport;shapes:Shape[];tool:'highlight'|'edit'|ShapeKind;style:Pick<Shape,'color'|'width'|'fill'>;
  selected:string|null;onSelect:(id:string|null)=>void;dispatch:(a:SessionAction,g?:number)=>void;history:SessionHistory;disabled:boolean;revision:number;
}) {
  const svg=useRef<SVGSVGElement>(null);
  const capturedElement=useRef<SVGSVGElement|null>(null);
  const gesture=useRef<{pointer:number;generation:number;before?:Shape;shape:Shape;start:Point;client:Point;handle:number|null;last:Point;shift:boolean;preview:Shape|null} | null>(null);
  const [preview,setPreview]=useState<Shape|null>(null);
  const creating=tool!=='highlight'&&tool!=='edit';
  function cancel(){const id=gesture.current?.pointer;gesture.current=null;setPreview(null);if(id!==undefined&&capturedElement.current?.hasPointerCapture(id))capturedElement.current.releasePointerCapture(id);capturedElement.current=null;}
  useEffect(()=>history.subscribeSnapshotCancellation(cancel),[history]);
  useEffect(()=>history.subscribeCancellation(cancel),[history]);
  useEffect(()=>{cancel();},[tool,disabled,revision,viewport.width,viewport.height,...(viewport.transform??[])]);
  useEffect(()=>{const g=gesture.current;if(g?.before&&(!shapes.includes(g.before)||selected!==g.before.id))cancel();},[shapes,selected]);
  function update(client:Point,shift:boolean,force=false){
    const g=gesture.current,element=svg.current;if(!g||!element)return;
    g.last=client;g.shift=shift;
    if(!force&&!g.preview&&Math.hypot(client.x-g.client.x,client.y-g.client.y)<4)return;
    const rect=element.getBoundingClientRect(),end=clientToPdf(client,rect,viewport);
    g.preview=g.before ? g.handle===null ? moveShape(g.before,end.x-g.start.x,end.y-g.start.y) : resizeShape(g.before,g.handle,end,shift,rect,viewport)
      : {...g.shape,b:constrainedPoint(g.start,end,g.shape.type,shift,rect,viewport)};
    setPreview(g.preview);
  }
  useEffect(()=>{
    const key=(e:KeyboardEvent)=>{if(e.key==='Escape'||e.code==='Space'&&!isEditingControl(e.target))cancel();else if(e.key==='Shift'&&gesture.current)update(gesture.current.last,e.type==='keydown');};
    const hidden=()=>{if(document.hidden)cancel();};
    window.addEventListener('keydown',key);window.addEventListener('keyup',key);window.addEventListener('blur',cancel);window.addEventListener('scroll',cancel,true);document.addEventListener('visibilitychange',hidden);
    return()=>{cancel();window.removeEventListener('keydown',key);window.removeEventListener('keyup',key);window.removeEventListener('blur',cancel);window.removeEventListener('scroll',cancel,true);document.removeEventListener('visibilitychange',hidden);};
  },[viewport.width,viewport.height,...(viewport.transform??[])]);
  function down(e:PointerEvent<SVGSVGElement>){
    if(disabled||tool==='highlight'||gesture.current||e.button!==0||e.ctrlKey||e.metaKey||e.altKey)return;
    const rect=e.currentTarget.getBoundingClientRect(),client={x:e.clientX,y:e.clientY},start=clientToPdf(client,rect,viewport);
    const handleElement=(e.target as Element).closest('[data-shape-handle]');
    const before=creating ? undefined : handleElement ? shapes.find(s=>s.id===selected) : pickShape(shapes,client,rect,viewport)??undefined;
    if(!creating&&!before)return;
    e.preventDefault();e.stopPropagation();
    const shape:Shape=before??{id:crypto.randomUUID(),type:tool as ShapeKind,page,a:start,b:start,...style,fill:tool==='line'?null:style.fill};
    if(before)onSelect(before.id);
    e.currentTarget.closest<HTMLElement>('.pdf-scroll')?.focus({preventScroll:true});
    gesture.current={pointer:e.pointerId,generation:history.generation,before,shape,start,client,handle:handleElement?Number(handleElement.getAttribute('data-shape-handle')):null,last:client,shift:e.shiftKey,preview:null};
    capturedElement.current=e.currentTarget; e.currentTarget.setPointerCapture(e.pointerId);
  }
  const displayed=shapes.map(s=>preview&&gesture.current?.before===s?preview:s);
  if(preview&&!gesture.current?.before)displayed.push(preview);
  const selectedShape=tool==='edit'?displayed.find(s=>s.id===selected):undefined;
  return <svg ref={svg} className="shape-overlay" aria-label={`Shapes for page ${page}`} width={viewport.width} height={viewport.height} style={{pointerEvents:creating&&!disabled?'auto':'none'}}
    onPointerDown={down} onPointerMove={e=>{if(gesture.current?.pointer===e.pointerId){if(!(e.buttons&1))cancel();else update({x:e.clientX,y:e.clientY},e.shiftKey);}}}
    onPointerUp={e=>{if(gesture.current?.pointer!==e.pointerId)return;update({x:e.clientX,y:e.clientY},e.shiftKey);const g=gesture.current;cancel();if(!disabled&&g.preview&&validShape(g.preview)){dispatch({type:'put-shape',shape:g.preview,before:g.before},g.generation);if(g.before)onSelect(g.shape.id);}}}
    onPointerCancel={cancel} onLostPointerCapture={cancel}>
    {displayed.map(s=><g key={s.id} data-shape-id={s.id} data-shape-kind={s.type} data-draft={s===preview?'true':undefined}>
      <path d={svgPath(shapePath(s),p=>pdfToViewport(p,viewport))} fill={s.fill??'none'} fillOpacity={.2} stroke={s.color} strokeOpacity={1} strokeWidth={pdfWidthToViewport(s.width,viewport)} strokeLinejoin="miter" strokeMiterlimit={2} strokeLinecap="round" pointerEvents="none" />
      {tool==='edit'&&!disabled&&<path d={svgPath(shapePath(s),p=>pdfToViewport(p,viewport))} fill={s.fill?'transparent':'none'} stroke="transparent" strokeWidth={pdfWidthToViewport(s.width,viewport)+10} style={{pointerEvents:s.fill?'all':'stroke'}} />}
    </g>)}
    {selectedShape&&<g data-shape-selection="true"><path d={svgPath(shapePath(selectedShape),p=>pdfToViewport(p,viewport))} fill="none" stroke="#172554" strokeWidth={1.5} strokeDasharray="4 4" pointerEvents="none" />
      {shapeHandles(selectedShape).map((p,i)=>{const v=pdfToViewport(p,viewport);return <rect key={i} data-shape-handle={i} role="button" tabIndex={disabled?-1:0} aria-label={`Resize ${selectedShape.type} ${selectedShape.type==='line'?'endpoint':'corner'} ${i+1}`} onBlur={()=>{if(gesture.current?.pointer===-1)cancel();}}
        onKeyDown={e=>{
          const deltas:Record<string,Point>={ArrowLeft:{x:-2,y:0},ArrowRight:{x:2,y:0},ArrowUp:{x:0,y:-2},ArrowDown:{x:0,y:2}},delta=deltas[e.key];
          if(disabled||!delta||!svg.current)return;e.preventDefault();e.stopPropagation();
          if(!gesture.current){const client=pdfToClient(p,svg.current.getBoundingClientRect(),viewport);gesture.current={pointer:-1,generation:history.generation,before:selectedShape,shape:selectedShape,start:p,client,handle:i,last:client,shift:e.shiftKey,preview:null};}
          const g=gesture.current;if(g.pointer===-1)update({x:g.last.x+delta.x,y:g.last.y+delta.y},e.shiftKey,true);
        }}
        onKeyUp={e=>{if(!e.key.startsWith('Arrow'))return;e.preventDefault();e.stopPropagation();const g=gesture.current;if(g?.pointer!==-1)return;cancel();if(g.preview&&validShape(g.preview))dispatch({type:'put-shape',shape:g.preview,before:g.before},g.generation);}}
        x={v.x-7} y={v.y-7} width={14} height={14} rx={2} fill="white" stroke="#2563eb" strokeWidth={2} style={{pointerEvents:disabled?'none':'all',cursor:'crosshair'}}/>;})}</g>}
  </svg>;
}
