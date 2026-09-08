import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import RoundingControl from '../src/components/Annotations/RoundingControl';
import ShapeOverlay from '../src/components/Annotations/ShapeOverlay';
import { emptySession } from '../src/services/annotationSession';
import { SessionHistory } from '../src/services/sessionHistory';
import type { PageViewport } from '../src/services/coordinates';
import { SHAPE_DEFAULTS, type ShapeKind, type Shape } from '../src/services/shapes';
const viewport={width:600,height:800,rotation:0,transform:[1,0,0,-1,0,800],convertToPdfPoint:(x:number,y:number)=>[x,800-y],convertToViewportPoint:(x:number,y:number)=>[x,800-y]} as unknown as PageViewport;
let captured:number|null=null;
beforeEach(()=>{
 vi.stubGlobal('PointerEvent',class extends MouseEvent{pointerId:number;constructor(type:string,init:PointerEventInit={}){super(type,init);this.pointerId=init.pointerId??1;}});
 Object.defineProperties(Element.prototype,{setPointerCapture:{configurable:true,value:(id:number)=>{captured=id;}},hasPointerCapture:{configurable:true,value:(id:number)=>captured===id},releasePointerCapture:{configurable:true,value:()=>{captured=null;}}});
 vi.spyOn(SVGElement.prototype,'getBoundingClientRect').mockReturnValue({x:0,y:0,left:0,top:0,right:600,bottom:800,width:600,height:800,toJSON(){}});
});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});
function Rounding({h}:{h:SessionHistory}){const [,refresh]=useState(0);return <RoundingControl value={h.present.drawing.rounding??100} identity={h.present.drawing} history={h} onPreview={()=>{}} onCommit={(rounding,g)=>{h.apply({type:'drawing',drawing:{...h.present.drawing,rounding},manual:false},g);refresh(v=>v+1);}}/>;}
it('rounding pointer/key previews commit once; Escape, blur, cancellation, snapshot and history discard drafts',()=>{
 const h=new SessionHistory(emptySession);render(<Rounding h={h}/>);const slider=screen.getByRole('slider',{hidden:true});
 fireEvent.pointerDown(slider,{pointerId:1});for(const value of [25,50,75])fireEvent.change(slider,{target:{value}});expect(h.present).toBe(emptySession);fireEvent.pointerUp(slider);expect(h.present.drawing.rounding).toBe(75);expect(captured).toBeNull();
 act(()=>{h.traverse('undo');});expect(h.present).toBe(emptySession);
 for(const reason of ['Escape','blur','cancel','snapshot','history']) {fireEvent.pointerDown(slider,{pointerId:1});fireEvent.change(slider,{target:{value:25}});act(()=>{if(reason==='Escape')fireEvent.keyDown(window,{key:'Escape'});if(reason==='blur')fireEvent.blur(slider);if(reason==='cancel')fireEvent.pointerCancel(slider);if(reason==='snapshot')h.cancelSnapshotDrafts();if(reason==='history'){h.traverse('redo');h.traverse('undo');}});fireEvent.pointerUp(slider);expect(h.present).toBe(emptySession);expect(captured).toBeNull();}
 fireEvent.keyDown(slider,{key:'ArrowLeft'});fireEvent.change(slider,{target:{value:99}});fireEvent.change(slider,{target:{value:98}});expect(h.present).toBe(emptySession);fireEvent.keyUp(slider,{key:'ArrowLeft'});expect(h.present.drawing.rounding).toBe(98);h.traverse('undo');expect(h.present).toBe(emptySession);
});
function Shapes({h,tool='rectangle',revision=0,disabled=false}:{h:SessionHistory;tool?:ShapeKind|'edit';revision?:number;disabled?:boolean}){const [,refresh]=useState(0),[selected,select]=useState<string|null>(h.present.shapes?.[0].id??null);return <ShapeOverlay page={1} viewport={viewport} shapes={h.present.shapes??[]} tool={tool} style={SHAPE_DEFAULTS} selected={selected} onSelect={select} history={h} revision={revision} disabled={disabled} dispatch={(a,g)=>{h.apply(a,g);refresh(v=>v+1);}}/>;}
const pointer=(target:Element,kind:'pointerDown'|'pointerMove'|'pointerUp',x:number,y:number,shiftKey=false)=>fireEvent[kind](target,{pointerId:1,button:0,buttons:kind==='pointerUp'?0:1,clientX:x,clientY:y,shiftKey});
it.each(['rectangle','ellipse','line'] as const)('creates %s in all directions once, excludes draft and click-only gestures',tool=>{
 const h=new SessionHistory(emptySession);render(<Shapes h={h} tool={tool}/>);const svg=screen.getByLabelText('Shapes for page 1');
 pointer(svg,'pointerDown',200,200);pointer(svg,'pointerUp',201,201);expect(h.present).toBe(emptySession);
 for(const dx of [-80,80])for(const dy of [-40,40]){const before=h.present;pointer(svg,'pointerDown',200,200);pointer(svg,'pointerMove',200+dx,200+dy,true);expect(h.present).toBe(before);pointer(svg,'pointerUp',200+dx,200+dy,true);expect(h.present.shapes).toHaveLength((before.shapes?.length??0)+1);expect(captured).toBeNull();}
 const count=h.present.shapes!.length;h.traverse('undo');expect(h.present.shapes).toHaveLength(count-1);h.traverse('redo');expect(h.present.shapes).toHaveLength(count);
});
const shape:Shape={id:'s',page:1,type:'rectangle',a:{x:100,y:600},b:{x:200,y:700},...SHAPE_DEFAULTS};
it.each(['Escape','blur','scroll','snapshot','history','cancel','lost','view','disabled','unmount'])('cancels shape move and capture on %s without stale commit',reason=>{
 const h=new SessionHistory({...emptySession,shapes:[shape]});const r=render(<Shapes h={h} tool="edit"/>);const svg=screen.getByLabelText('Shapes for page 1');pointer(svg,'pointerDown',100,150);pointer(svg,'pointerMove',130,180);expect(captured).toBe(1);expect(h.present.shapes![0]).toBe(shape);
 act(()=>{if(reason==='Escape')fireEvent.keyDown(window,{key:'Escape'});if(reason==='blur'||reason==='scroll')fireEvent(window,new Event(reason));if(reason==='snapshot')h.cancelSnapshotDrafts();if(reason==='history')h.traverse('undo');if(reason==='cancel')fireEvent.pointerCancel(svg);if(reason==='lost')fireEvent.lostPointerCapture(svg);if(reason==='view')r.rerender(<Shapes h={h} tool="edit" revision={1}/>);if(reason==='disabled')r.rerender(<Shapes h={h} tool="edit" disabled/>);if(reason==='unmount')r.unmount();});
 pointer(svg,'pointerUp',130,180);expect(h.present.shapes![0]).toBe(shape);expect(captured).toBeNull();expect(h.undoLabel).toBeUndefined();
});
it.each(['rectangle','ellipse','line'] as const)('moves and resizes %s with single undoable gestures and original snapshots',type=>{
 const s={...shape,type},h=new SessionHistory({...emptySession,shapes:[s]});render(<Shapes h={h} tool="edit"/>);const svg=screen.getByLabelText('Shapes for page 1');const start=type==='line'?[150,150]:[100,150];
 pointer(svg,'pointerDown',start[0],start[1]);pointer(svg,'pointerMove',start[0]+20,start[1]+30);pointer(svg,'pointerUp',start[0]+20,start[1]+30);expect(h.present.shapes![0].a).toEqual({x:120,y:570});const moved=h.present;
 const handle=svg.querySelector('[data-shape-handle="0"]')!;pointer(handle,'pointerDown',120,230);pointer(svg,'pointerMove',250,260);pointer(svg,'pointerUp',250,260);expect(h.present).not.toBe(moved);expect(h.present.shapes![0]).not.toEqual(moved.shapes![0]);h.traverse('undo');expect(h.present).toBe(moved);h.traverse('undo');expect(h.present.shapes![0]).toBe(s);
});

it('keyboard handle resize previews remain out of snapshots and commit once on release',()=>{
 const h=new SessionHistory({...emptySession,shapes:[shape]});render(<Shapes h={h} tool="edit"/>);const handle=screen.getByRole('button',{name:'Resize rectangle corner 1'});
 fireEvent.keyDown(handle,{key:'ArrowRight'});fireEvent.keyDown(handle,{key:'ArrowRight',repeat:true});expect(h.present.shapes![0]).toBe(shape);fireEvent.keyUp(handle,{key:'ArrowRight'});expect(h.present.shapes![0].a.x).toBe(104);h.traverse('undo');expect(h.present.shapes![0]).toBe(shape);
});
