import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { clientToPdf, type PageViewport } from '../../services/coordinates';
import { newPageLegend, type PageLegend } from '../../services/pageLegend';
import type { AnnotationSession, SessionAction } from '../../services/annotationSession';
import type { SessionHistory } from '../../services/sessionHistory';
import { isEditingControl } from '../../services/annotationEditing';
import PageLegendGraphic from './PageLegendGraphic';

export default function PageLegendOverlay({rows,page,viewport,session,history,placing,onPlaced,selected,onSelect,dispatch,editing,disabled,revision}: {
  rows:string[];page:number;viewport:PageViewport;session:AnnotationSession;history:SessionHistory;placing:boolean;onPlaced:()=>void;
  selected:string|null;onSelect:(id:string)=>void;dispatch:(a:SessionAction,g?:number)=>void;editing:boolean;disabled:boolean;revision:number;
}) {
  const svg=useRef<SVGSVGElement>(null);
  const placement=useRef<{key:PageLegend;pointer:number;generation:number;legends:AnnotationSession['legends']}|null>(null);
  const move=useRef<{before:PageLegend;start:{x:number;y:number};client:{x:number;y:number};pointer:number;generation:number;legends:AnnotationSession['legends']}|null>(null);
  const previewRef=useRef<PageLegend|null>(null);
  const [preview,setPreview]=useState<PageLegend|null>(null);
  function show(k:PageLegend|null) {previewRef.current=k;setPreview(k);}
  function cancel() {const pointer=move.current?.pointer??placement.current?.pointer;move.current=null;placement.current=null;show(null);if(pointer!==undefined && svg.current?.hasPointerCapture(pointer))svg.current.releasePointerCapture(pointer);}
  useEffect(()=>history.subscribeCancellation(cancel),[history]);
  useEffect(()=>{cancel();},[placing,editing,disabled,revision,viewport.width,viewport.height]);
  useEffect(()=>{if(move.current && (!session.pageLegends?.includes(move.current.before)||move.current.legends!==session.legends||selected!==move.current.before.id))cancel();},[session,selected]);
  useEffect(()=>{
    const key=(e:KeyboardEvent)=>{if(e.key==='Escape'||(e.code==='Space'&&!isEditingControl(e.target)))cancel();};
    const hidden=()=>{if(document.hidden)cancel();};
    window.addEventListener('keydown',key);window.addEventListener('blur',cancel);window.addEventListener('scroll',cancel,true);document.addEventListener('visibilitychange',hidden);
    return ()=>{cancel();window.removeEventListener('keydown',key);window.removeEventListener('blur',cancel);window.removeEventListener('scroll',cancel,true);document.removeEventListener('visibilitychange',hidden);};
  },[]);
  function point(e:PointerEvent<SVGSVGElement>){return clientToPdf({x:e.clientX,y:e.clientY},e.currentTarget.getBoundingClientRect(),viewport);}
  return <svg ref={svg} className="page-legend-overlay" aria-label={`Page legends for page ${page}`} width={viewport.width} height={viewport.height}
    style={{pointerEvents:placing&&!disabled?'auto':'none'}}
    onPointerMove={e=>{
      if(disabled)return;
      if(placing){const p=point(e),k={...(placement.current?.key??newPageLegend(page,viewport,rows)),...p};if(placement.current)placement.current.key=k;show(k);return;}
      const m=move.current;if(!m)return;if(!(e.buttons&1)){cancel();return;}
      if(Math.hypot(e.clientX-m.client.x,e.clientY-m.client.y)<4&&!previewRef.current)return;
      const p=point(e);show({...m.before,x:m.before.x+p.x-m.start.x,y:m.before.y+p.y-m.start.y});
    }}
    onPointerDown={e=>{
      if(disabled||e.button!==0||e.ctrlKey||e.metaKey||e.altKey)return;
      if(placing){e.preventDefault();const key={...newPageLegend(page,viewport,rows),...point(e)};placement.current={key,pointer:e.pointerId,generation:history.generation,legends:session.legends};show(key);e.currentTarget.setPointerCapture(e.pointerId);return;}
      if(!editing)return;
      const id=(e.target as Element).closest('[data-key-id]')?.getAttribute('data-key-id');
      const before=session.pageLegends?.find(k=>k.id===id);if(!before)return;
      e.preventDefault();onSelect(before.id);e.currentTarget.closest<HTMLElement>('.pdf-scroll')?.focus({preventScroll:true});
      move.current={before,start:point(e),client:{x:e.clientX,y:e.clientY},pointer:e.pointerId,generation:history.generation,legends:session.legends};e.currentTarget.setPointerCapture(e.pointerId);
    }}
    onPointerUp={()=>{const m=move.current,k=previewRef.current,p=placement.current;cancel();if(p){dispatch({type:'put-key',key:p.key,legends:p.legends},p.generation);onPlaced();onSelect(p.key.id);}else if(m&&k)dispatch({type:'put-key',key:k,before:m.before,legends:m.legends},m.generation);}}
    onPointerCancel={cancel} onLostPointerCapture={cancel} onPointerLeave={()=>{if(!move.current&&!placement.current)show(null);}}>
    {(session.pageLegends??[]).filter(k=>k.page===page).map(k=><g key={k.id} style={{pointerEvents:editing&&!disabled?'all':'none'}}>
      <PageLegendGraphic value={move.current?.before===k&&preview?preview:k} legends={session.legends} viewport={viewport} selected={selected===k.id}/>
    </g>)}
    {placing&&preview&&<g opacity={.8} pointerEvents="none"><PageLegendGraphic value={preview} legends={session.legends} viewport={viewport}/></g>}
  </svg>;
}
