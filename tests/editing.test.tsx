import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useReducer, useState } from 'react';
import AnnotationOverlay from '../src/components/Annotations/AnnotationOverlay';
import { emptySession, sessionReducer, type AnnotationSession, type SessionAction } from '../src/services/annotationSession';
import { pickHighlight, translatedHighlight, isEditingControl } from '../src/services/annotationEditing';
import type { Highlight } from '../src/types/annotation';
import type { PageViewport } from '../src/services/coordinates';
const stroke: Highlight = { id:'a', page:1, type:'freehand', legendId:'l', color:'#facc15', width:10, opacity:.4, points:[{x:20,y:50},{x:100,y:50}] };
const legend = {id:'l',name:'Walls',color:'#facc15'};
const other = {...stroke,id:'b',page:2};
const initial: AnnotationSession = {...emptySession,legends:[legend,{...legend,id:'m',name:'Doors'}], annotations:[stroke,other]};
const vp = {width:200,height:200,transform:[1,0,0,1,0,0],convertToViewportPoint:(x:number,y:number)=>[x,y],convertToPdfPoint:(x:number,y:number)=>[x,y]} as PageViewport;
const rect = {left:0,top:0,width:200,height:200,right:200,bottom:200} as DOMRect;
let captured: number | null;
beforeEach(()=>{
  captured=null;
  vi.stubGlobal('PointerEvent',class extends MouseEvent {pointerId:number; constructor(type:string,init:PointerEventInit={}) {super(type,init);this.pointerId=init.pointerId??1;}});
  Object.defineProperties(SVGElement.prototype,{
    setPointerCapture:{configurable:true,value:(id:number)=>{captured=id;}},
    hasPointerCapture:{configurable:true,value:(id:number)=>captured===id},
    releasePointerCapture:{configurable:true,value:()=>{captured=null;}},
  });
  vi.spyOn(SVGElement.prototype,'getBoundingClientRect').mockReturnValue(rect);
});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});
it('edits by stable ID with explicit assignment/manual semantics, no-op identity and order preservation',()=>{
  let state=initial;
  const edit=(value:Extract<SessionAction,{type:'edit-stroke'}>['edit'])=>state=sessionReducer(state,{type:'edit-stroke',id:'a',edit:value});
  expect(edit({width:10})).toBe(initial);
  expect(edit({legendId:'missing'})).toBe(initial);
  edit({legendId:'m'}); expect(state.annotations[0]).toEqual({...stroke,legendId:'m'});
  edit({width:20}); expect(state.annotations[0].legendId).toBe('m');
  edit({color:'#facc15'}); expect(state.annotations[0].legendId).toBeNull();
  edit({legendId:'l'}); edit({legendId:null}); expect(state.annotations[0]).toEqual({...stroke,width:20,legendId:null});
  expect(state.annotations[1]).toBe(other); expect(state.annotations.map(s=>s.id)).toEqual(['a','b']);
  expect(state.drawing).toBe(initial.drawing); expect(state.activeLegendId).toBe(initial.activeLegendId);
  const before=state; expect(edit({legendId:null})).toBe(before);
  expect(sessionReducer(state,{type:'remove-stroke',id:'missing'})).toBe(state);
  state=sessionReducer(state,{type:'remove-stroke',id:'a'}); expect(state.annotations).toEqual([other]);
  expect(sessionReducer(state,{type:'edit-stroke',id:'a',edit:{width:5}})).toBe(state);
});
it('assigning another color retains geometry/opacity/width and legend deletion only detaches',()=>{
  let state={...initial,legends:[...initial.legends,{id:'blue',name:'Blue',color:'#38bdf8'}]};
  state=sessionReducer(state,{type:'edit-stroke',id:'a',edit:{legendId:'blue'}});
  expect(state.annotations[0]).toEqual({...stroke,legendId:'blue',color:'#38bdf8'});
  state=sessionReducer(state,{type:'delete',id:'blue'});
  expect(state.annotations[0]).toEqual({...stroke,legendId:null,color:'#38bdf8'});
});
it('picks reverse rendered layer order rather than chronology or empty bounding boxes',()=>{
  const blue={...stroke,id:'blue',color:'#38bdf8'};
  const yellow={...stroke,id:'last',legendId:null};
  expect(pickHighlight([stroke,blue,yellow],{x:60,y:50},rect,vp)?.id).toBe('blue');
  expect(pickHighlight([stroke,yellow],{x:60,y:50},rect,vp)?.id).toBe('last');
  const bent={...stroke,points:[{x:20,y:20},{x:20,y:100},{x:100,y:100}]};
  expect(pickHighlight([bent],{x:70,y:45},rect,vp)).toBeNull();
  expect(pickHighlight([bent],{x:24,y:60},rect,vp)?.id).toBe('a');
  expect(pickHighlight([stroke],{x:14,y:50},rect,vp)?.id).toBe('a');
  expect(pickHighlight([stroke],{x:10,y:50},rect,vp)).toBeNull();
});
it.each([.1,1,2,8])('uses CSS pixel hit tolerance at zoom %s',scale=>{
  const viewport={...vp,width:200*scale,height:200*scale,convertToViewportPoint:(x:number,y:number)=>[x*scale,y*scale]} as PageViewport;
  const bounds={...rect,width:viewport.width,height:viewport.height};
  expect(pickHighlight([stroke],{x:60*scale,y:55*scale+3.9},bounds,viewport)?.id).toBe('a');
  expect(pickHighlight([stroke],{x:60*scale,y:55*scale+4.1},bounds,viewport)).toBeNull();
});
it('moves atomically, rejects stale stroke/legend snapshots and preserves unrelated object identity',()=>{
  const points=stroke.points.map(p=>({x:p.x+5.25,y:p.y-2.125}));
  const action:SessionAction={type:'move-stroke',before:stroke,points,legends:initial.legends};
  const moved=sessionReducer(initial,action);
  expect(moved.annotations[0]).toEqual({...stroke,points}); expect(moved.annotations[1]).toBe(other);
  expect(sessionReducer(initial,{...action,points:stroke.points})).toBe(initial);
  for(const changed of [sessionReducer(initial,{type:'remove-stroke',id:'a'}),sessionReducer(initial,{type:'edit-stroke',id:'a',edit:{width:20}}),sessionReducer(initial,{type:'delete',id:'l'}),structuredClone(initial)]) {
    expect(sessionReducer(changed,action)).toBe(changed);
  }
  expect(sessionReducer(initial,{...action,points:[points[0],{x:99,y:88}]})).toBe(initial);
});
it('clamps the pointer at page edges while retaining every relative point and start-snapshot precision',()=>{
  const result=translatedHighlight(stroke,{x:20,y:50},{x:900,y:-400},rect,vp);
  expect(result.points).toEqual([{x:200,y:0},{x:280,y:0}]);
  expect(stroke.points).toEqual([{x:20,y:50},{x:100,y:50}]);
  for(let i=0;i<100;i++) translatedHighlight(stroke,{x:20,y:50},{x:30+i/11,y:60+i/17},rect,vp);
  expect(translatedHighlight(stroke,{x:20,y:50},{x:20,y:50},rect,vp).points).toEqual(stroke.points);
});
function pointer(svg:Element,type:string,x:number,y=50,id=1) {fireEvent[type as 'pointerDown'](svg,{button:0,buttons:type==='pointerUp'?0:1,pointerId:id,clientX:x,clientY:y});}
function Fixture() {
  const [session,dispatch]=useReducer(sessionReducer,initial);
  const [selected,onSelect]=useState<string|null>(null);
  return <><AnnotationOverlay page={1} viewport={vp} annotations={session.annotations.filter(s=>s.page===1)} legends={session.legends}
    tool="edit" selectedId={selected} onSelect={onSelect} onAction={dispatch} onCommit={()=>{throw Error('Edit drew');}} />
    <output data-testid="state">{JSON.stringify(session)}</output></>;
}
it('selection click never draws or changes data; movement preview replaces one vector and commits exactly once',()=>{
  render(<Fixture/>); const svg=screen.getByLabelText('Highlights for page 1'); const state=()=>JSON.parse(screen.getByTestId('state').textContent!);
  pointer(svg,'pointerDown',40);pointer(svg,'pointerUp',42);
  expect(state()).toEqual(initial); expect(svg.querySelector('[data-selection-indicator]')).toBeTruthy();
  pointer(svg,'pointerDown',40);pointer(svg,'pointerMove',60);
  expect(state()).toEqual(initial); expect(svg.querySelectorAll('[data-annotation-id]')).toHaveLength(1);
  expect(svg.querySelector('[data-annotation-id]')?.getAttribute('points')).toBe('40,50 120,50');
  pointer(svg,'pointerUp',60);pointer(svg,'pointerUp',80);
  expect(state().annotations[0].points).toEqual([{x:40,y:50},{x:120,y:50}]);expect(captured).toBeNull();
  pointer(svg,'pointerDown',180,180);pointer(svg,'pointerUp',180,180);
  expect(svg.querySelector('[data-selection-indicator]')).toBeNull();
});
it.each(['pointerCancel','lostPointerCapture','blur','scroll','Escape','Space','hidden','tool','disabled','view','zoom','legends','selection','stale'])('abandons movement on %s',reason=>{
  const action=vi.fn(); const props={page:1,viewport:vp,annotations:[stroke],legends:initial.legends,selectedId:'a',tool:'edit' as const,onAction:action,onCommit:vi.fn()};
  const view=render(<AnnotationOverlay {...props}/>); const svg=screen.getByLabelText('Highlights for page 1');
  pointer(svg,'pointerDown',40);pointer(svg,'pointerMove',80);
  if(reason==='Escape'||reason==='Space') fireEvent.keyDown(window,{key:reason,code:reason});
  else if(reason==='blur') fireEvent.blur(window);
  else if(reason==='scroll') fireEvent.scroll(window);
  else if(reason==='hidden') {vi.spyOn(document,'hidden','get').mockReturnValue(true);fireEvent(document,new Event('visibilitychange'));}
  else if(reason==='tool') view.rerender(<AnnotationOverlay {...props} tool="highlight"/>);
  else if(reason==='disabled') view.rerender(<AnnotationOverlay {...props} disabled/>);
  else if(reason==='view') view.rerender(<AnnotationOverlay {...props} viewRevision={1}/>);
  else if(reason==='zoom') view.rerender(<AnnotationOverlay {...props} viewport={{...vp,width:400,height:400,transform:[2,0,0,2,0,0]}}/>);
  else if(reason==='legends') view.rerender(<AnnotationOverlay {...props} legends={[...initial.legends]}/>);
  else if(reason==='selection') view.rerender(<AnnotationOverlay {...props} selectedId={null}/>);
  else if(reason==='stale') view.rerender(<AnnotationOverlay {...props} annotations={[{...stroke,width:20}]}/>);
  else fireEvent[reason as 'pointerCancel'](svg);
  pointer(svg,'pointerUp',80); expect(action).not.toHaveBeenCalled();expect(captured).toBeNull();
  expect(svg.querySelector('[data-annotation-id]')?.getAttribute('points')).toBe('20,50 100,50');
});
it('ignores other pointers and no-motion movement after threshold return',()=>{
  render(<Fixture/>);const svg=screen.getByLabelText('Highlights for page 1');
  pointer(svg,'pointerDown',40);pointer(svg,'pointerMove',80,50,2);pointer(svg,'pointerUp',80,50,2);
  expect(captured).toBe(1);pointer(svg,'pointerMove',80);pointer(svg,'pointerUp',40);
  expect(JSON.parse(screen.getByTestId('state').textContent!)).toEqual(initial);
});
it('recognizes editable and dialog contexts, including descendants',()=>{
  const view=render(<><input/><textarea/><select/><div contentEditable/><dialog><button><span>Modal</span></button></dialog><button>Toolbar</button></>);
  for(const target of view.container.querySelectorAll('input,textarea,select,[contenteditable],dialog span')) expect(isEditingControl(target)).toBe(true);
  expect(isEditingControl(screen.getByText('Toolbar'))).toBe(false);
});

