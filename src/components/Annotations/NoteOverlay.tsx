import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { clientToPdf, pdfToClient, pdfToViewport, type Point, type PageViewport } from '../../services/coordinates';
import { ARROW_DEFAULTS, TEXT_DEFAULTS, fitNote, moveNote, noteLocal, notePoint, validNote, type NoteObject, type TextNote } from '../../services/notes';
import { constrainedPoint } from '../../services/shapes';
import { isEditingControl } from '../../services/annotationEditing';
import type { SessionHistory } from '../../services/sessionHistory';
import type { SessionAction } from '../../services/annotationSession';
import NoteGraphic from './NoteGraphic';

export default function NoteOverlay({page,viewport,notes,tool,selected,pointer,placing,onSelect,onEdit,onPlaced,dispatch,history,disabled,revision}: {
  page:number;viewport:PageViewport;notes:NoteObject[];tool:string;selected:string|null;pointer:string|null;placing:string|null;
  onSelect:(id:string,pointer?:string)=>void;onEdit:(n:TextNote)=>void;onPlaced:()=>void;
  dispatch:(a:SessionAction,g?:number)=>void;history:SessionHistory;disabled:boolean;revision:number;
}) {
  const svg=useRef<SVGSVGElement>(null),capture=useRef<SVGSVGElement|null>(null);
  const gesture=useRef<{id:number;generation:number;before?:NoteObject;value:NoteObject;start:Point;client:Point;last:Point;handle:string|null;changed:boolean}|null>(null);
  const [preview,setPreview]=useState<NoteObject|null>(null);
  function cancel(){const g=gesture.current;gesture.current=null;setPreview(null);if(g&&capture.current?.hasPointerCapture(g.id))capture.current.releasePointerCapture(g.id);capture.current=null;}
  useEffect(()=>history.subscribeCancellation(cancel),[history]);
  useEffect(()=>history.subscribeSnapshotCancellation(cancel),[history]);
  useEffect(()=>{cancel();},[tool,placing,disabled,revision,viewport.width,viewport.height,...(viewport.transform??[])]);
  useEffect(()=>{if(gesture.current?.before&&!notes.includes(gesture.current.before))cancel();},[notes]);
  useEffect(()=>{const key=(e:KeyboardEvent)=>{if(e.key==='Escape'||e.code==='Space'&&!isEditingControl(e.target))cancel();};
    window.addEventListener('keydown',key);window.addEventListener('blur',cancel);window.addEventListener('scroll',cancel,true);
    return()=>{cancel();window.removeEventListener('keydown',key);window.removeEventListener('blur',cancel);window.removeEventListener('scroll',cancel,true);};},[]);
  function update(client:Point,shift:boolean,force=false){
    const g=gesture.current;if(!g||!svg.current)return;
    g.last=client;
    if(!force&&!g.changed&&Math.hypot(client.x-g.client.x,client.y-g.client.y)<4)return;
    const rect=svg.current.getBoundingClientRect(),end=clientToPdf(client,rect,viewport),n=g.before??g.value;
    if(placing&&n.type==='text')return;
    if(!g.before&&n.type==='arrow')g.value={...n,b:constrainedPoint(g.start,end,'line',shift,rect,viewport)};
    else if(g.handle&&n.type==='arrow')g.value={...n,[g.handle]:constrainedPoint(g.handle==='a'?n.b:n.a,end,'line',shift,rect,viewport)};
    else if(g.handle==='resize'&&n.type==='text'){const p=noteLocal(n,end);g.value=fitNote({...n,width:Math.max(40,Math.min(2000,p.x)),height:Math.max(30,Math.min(10000,p.y))});}
    else if(g.handle&&n.type==='text')g.value={...n,pointers:n.pointers.map(p=>p.id===g.handle?{...p,target:end}:p)};
    else g.value=moveNote(n,end.x-g.start.x,end.y-g.start.y);
    g.changed=true;setPreview(g.value);
  }
  function down(e:PointerEvent<SVGSVGElement>){
    if(disabled||gesture.current||e.button!==0||e.ctrlKey||e.metaKey||e.altKey)return;
    const target=e.target as Element,rect=e.currentTarget.getBoundingClientRect(),client={x:e.clientX,y:e.clientY},start=clientToPdf(client,rect,viewport);
    const before=placing?notes.find(n=>n.id===placing):tool==='edit'?notes.find(n=>n.id===target.closest('[data-note-id]')?.getAttribute('data-note-id')):undefined;
    if(!before&&tool!=='text'&&tool!=='arrow')return;
    e.preventDefault();e.stopPropagation();
    const handle=target.closest('[data-note-handle]')?.getAttribute('data-note-handle')??target.closest('[data-pointer-id]')?.getAttribute('data-pointer-id')??null;
    if(before&&!placing)onSelect(before.id,handle&&handle!=='resize'&&handle!=='a'&&handle!=='b'?handle:undefined);
    const value:NoteObject=before??(tool==='text'?{...TEXT_DEFAULTS,id:crypto.randomUUID(),type:'text',page,...start,rotation:((viewport.rotation??0)%360+360)%360 as TextNote['rotation'],text:''}:{...ARROW_DEFAULTS,id:crypto.randomUUID(),type:'arrow',page,a:start,b:start});
    gesture.current={id:e.pointerId,generation:history.generation,before,value,start,client,last:client,handle,changed:false};
    capture.current=e.currentTarget;e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.closest<HTMLElement>('.pdf-scroll')?.focus({preventScroll:true});
  }
  function finish(){const g=gesture.current;cancel();if(!g||disabled)return;
    if(placing&&g.before?.type==='text') {
      const target=clientToPdf(g.last,svg.current!.getBoundingClientRect(),viewport);
      dispatch({type:'put-note',before:g.before,note:{...g.before,pointers:[...g.before.pointers,{...ARROW_DEFAULTS,id:crypto.randomUUID(),target}]}},g.generation);onPlaced();
    }else if(!g.before&&g.value.type==='text')onEdit(g.value);
    else if(g.changed&&validNote(g.value)){dispatch({type:'put-note',note:g.value,before:g.before},g.generation);onSelect(g.value.id);}
  }
  const displayed=notes.map(n=>gesture.current?.before===n&&preview?preview:n);
  if(preview&&!gesture.current?.before)displayed.push(preview);
  const n=tool==='edit'?displayed.find(n=>n.id===selected):undefined;
  const handles:{key:string;p:Point;label:string}[]=n?(n.type==='arrow'?[{key:'a',p:n.a,label:'Arrow start'},{key:'b',p:n.b,label:'Arrow target'}]:[
    {key:'resize',p:notePoint(n,n.width,n.height),label:'Resize note'},...n.pointers.map((p,i)=>({key:p.id,p:p.target,label:`Pointer target ${i+1}`}))]):[];
  return <svg ref={svg} className="note-overlay" aria-label={`Notes and arrows for page ${page}`} width={viewport.width} height={viewport.height} style={{pointerEvents:!disabled&&(tool==='text'||tool==='arrow'||placing!==null)?'auto':'none'}}
    onPointerDown={down} onPointerMove={e=>{if(gesture.current?.id===e.pointerId){gesture.current.last={x:e.clientX,y:e.clientY};if(!(e.buttons&1))cancel();else update(gesture.current.last,e.shiftKey);}}}
    onPointerUp={e=>{if(gesture.current?.id===e.pointerId){gesture.current.last={x:e.clientX,y:e.clientY};if(!placing)update(gesture.current.last,e.shiftKey);finish();}}} onPointerCancel={cancel} onLostPointerCapture={cancel}
    onDoubleClick={e=>{const found=notes.find(n=>n.id===(e.target as Element).closest('[data-note-id]')?.getAttribute('data-note-id'));if(!disabled&&tool==='edit'&&found?.type==='text')onEdit(found);}}>
    {displayed.map(n=><NoteGraphic key={n.id} note={n} viewport={viewport} editing={tool==='edit'&&!disabled&&!placing}/>)}
    {n&&handles.map(h=>{const p=pdfToViewport(h.p,viewport);return <rect key={h.key} data-note-id={n.id} data-note-handle={h.key} aria-label={h.label} role="button" tabIndex={disabled?-1:0}
      x={p.x-8} y={p.y-8} width={16} height={16} fill={pointer===h.key?'#bfdbfe':'white'} stroke="#2563eb" strokeWidth={2} style={{pointerEvents:disabled?'none':'all',cursor:'crosshair'}}
      onBlur={()=>{if(gesture.current?.id===-1)cancel();}}
      onKeyDown={e=>{const delta:Record<string,Point>={ArrowLeft:{x:-2,y:0},ArrowRight:{x:2,y:0},ArrowUp:{x:0,y:-2},ArrowDown:{x:0,y:2}};if(disabled||!delta[e.key]||!svg.current)return;e.preventDefault();e.stopPropagation();
        if(!gesture.current){const client=pdfToClient(h.p,svg.current.getBoundingClientRect(),viewport);gesture.current={id:-1,generation:history.generation,before:n,value:n,start:h.p,client,last:client,handle:h.key,changed:false};}
        const g=gesture.current;update({x:g.last.x+delta[e.key].x,y:g.last.y+delta[e.key].y},e.shiftKey,true);}}
      onKeyUp={e=>{if(e.key.startsWith('Arrow')){e.preventDefault();e.stopPropagation();if(gesture.current?.id===-1)finish();}}}/>;})}
  </svg>;
}
