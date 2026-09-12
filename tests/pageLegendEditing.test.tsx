import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import type { PDFPageProxy } from 'pdfjs-dist';
import PageLegendOverlay from '../src/components/Annotations/PageLegendOverlay';
import PageLegendControls from '../src/components/Annotations/PageLegendControls';
import { emptySession } from '../src/services/annotationSession';
import { SessionHistory } from '../src/services/sessionHistory';
import type { PageViewport } from '../src/services/coordinates';
import type { PageLegend } from '../src/services/pageLegend';
const viewport={width:600,height:800,rotation:0,transform:[1,0,0,-1,0,800],convertToPdfPoint:(x:number,y:number)=>[x,800-y],convertToViewportPoint:(x:number,y:number)=>[x,800-y]} as unknown as PageViewport;
const legends=[{id:'wall',name:'Walls',color:'#4ade80'}];
const key:PageLegend={id:'key',page:1,x:20,y:700,rotation:0,categoryIds:['wall'],title:'LEGEND',layout:'list',width:200,fontSize:12,background:true,border:true};
let captured:number|null=null;
beforeEach(()=>{
  vi.stubGlobal('PointerEvent',class extends MouseEvent{pointerId:number;constructor(type:string,init:PointerEventInit={}){super(type,init);this.pointerId=init.pointerId??1;}});
  Object.defineProperties(Element.prototype,{setPointerCapture:{configurable:true,value:(id:number)=>{captured=id;}},hasPointerCapture:{configurable:true,value:(id:number)=>captured===id},releasePointerCapture:{configurable:true,value:()=>{captured=null;}}});
  vi.spyOn(SVGElement.prototype,'getBoundingClientRect').mockReturnValue({x:0,y:0,left:0,top:0,right:600,bottom:800,width:600,height:800,toJSON(){}});
});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});
function Harness({history,placing=false}:{history:SessionHistory;placing?:boolean}){
  const [,refresh]=useState(0),[selected,select]=useState<string|null>('key');
  const dispatch:Parameters<typeof PageLegendOverlay>[0]['dispatch']=(a,g)=>{history.apply(a,g);refresh(v=>v+1);};
  return <><PageLegendControls rows={['wall']} onRows={()=>{}} session={history.present} selected={selected} onSelect={select} pages={[{pageNumber:1,getViewport:()=>viewport} as PDFPageProxy]} current={1} placing={placing} onPlace={()=>{}} dispatch={dispatch} history={history} revision={0} disabled={false}/>
    <PageLegendOverlay rows={['wall']} page={1} viewport={viewport} session={history.present} history={history} placing={placing} onPlaced={()=>{}} selected={selected} onSelect={select} dispatch={dispatch} editing disabled={false} revision={0}/></>;
}
const pointer=(target:Element,kind:'pointerDown'|'pointerMove'|'pointerUp',x:number,y:number)=>fireEvent[kind](target,{pointerId:1,button:0,buttons:kind==='pointerUp'?0:1,clientX:x,clientY:y});
it('keeps placement out of snapshots until release and cancels an incomplete click',()=>{
  const h=new SessionHistory({...emptySession,legends});render(<Harness history={h} placing/>);
  const svg=screen.getByLabelText('Page legends for page 1');pointer(svg,'pointerDown',25,110);
  expect(h.present.pageLegends).toBeUndefined();fireEvent.keyDown(window,{key:'Escape'});pointer(svg,'pointerUp',25,110);
  expect(h.present.pageLegends).toBeUndefined();expect(h.undoLabel).toBeUndefined();
  pointer(svg,'pointerDown',25,110);pointer(svg,'pointerUp',25,110);
  expect(h.present.pageLegends).toHaveLength(1);expect(captured).toBeNull();
});
it.each(['Escape','blur','scroll','history','cancel'])('abandons movement on %s without dirty content or capture',reason=>{
  const h=new SessionHistory({...emptySession,legends,pageLegends:[key]});render(<Harness history={h}/>);
  const svg=screen.getByLabelText('Page legends for page 1');pointer(svg.querySelector('[data-key-id] rect')!,'pointerDown',25,110);pointer(svg,'pointerMove',60,140);
  expect(h.present.pageLegends![0]).toBe(key);expect(captured).toBe(1);
  act(()=>{if(reason==='Escape')fireEvent.keyDown(window,{key:'Escape'});else if(reason==='history')h.invalidate();else if(reason==='cancel')fireEvent.pointerCancel(svg);else fireEvent(window,new Event(reason));});
  pointer(svg,'pointerUp',60,140);expect(h.present.pageLegends![0]).toBe(key);expect(h.undoLabel).toBeUndefined();expect(captured).toBeNull();
});
it('commits a whole move once and excludes property drafts from snapshots until Apply',()=>{
  const h=new SessionHistory({...emptySession,legends,pageLegends:[key]});render(<Harness history={h}/>);
  const svg=screen.getByLabelText('Page legends for page 1');pointer(svg.querySelector('[data-key-id] rect')!,'pointerDown',25,110);pointer(svg,'pointerMove',60,140);pointer(svg,'pointerUp',60,140);
  expect(h.present.pageLegends![0]).toMatchObject({x:55,y:670});const snapshot=h.present;
  fireEvent.change(screen.getByLabelText('Legend heading'),{target:{value:'Draft'}});expect(h.present).toBe(snapshot);
  fireEvent.blur(screen.getByLabelText('Legend heading'));expect(h.present).toBe(snapshot);
  fireEvent.keyDown(screen.getByLabelText('Legend heading'),{key:'Escape'});expect((screen.getByLabelText('Legend heading') as HTMLInputElement).value).toBe('LEGEND');
  fireEvent.change(screen.getByLabelText('Legend heading'),{target:{value:'New title'}});fireEvent.click(screen.getByRole('button',{name:'Apply legend changes'}));
  expect(h.present.pageLegends![0].title).toBe('New title');expect(snapshot.pageLegends![0].title).toBe('LEGEND');
  h.traverse('undo');expect(h.present).toBe(snapshot);h.traverse('undo');expect(h.present.pageLegends![0]).toBe(key);
});

it('changes the explicitly named key background independently of Border with Apply and undo',()=>{
 const h=new SessionHistory({...emptySession,legends,pageLegends:[key]});render(<Harness history={h}/>);
 expect((screen.getByLabelText('Legend background') as HTMLSelectElement).value).toBe('white');
 fireEvent.change(screen.getByLabelText('Legend background'),{target:{value:'transparent'}});
 expect(h.present.pageLegends![0]).toBe(key);
 fireEvent.click(screen.getByText('Apply legend changes'));
 expect(h.present.pageLegends![0]).toMatchObject({background:false,border:true});
 h.traverse('undo');expect(h.present.pageLegends![0]).toBe(key);
});
