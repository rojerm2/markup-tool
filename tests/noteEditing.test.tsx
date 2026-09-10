import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import NoteOverlay from '../src/components/Annotations/NoteOverlay';
import NoteControls from '../src/components/Annotations/NoteControls';
import { emptySession } from '../src/services/annotationSession';
import { SessionHistory } from '../src/services/sessionHistory';
import type { PageViewport } from '../src/services/coordinates';
import { TEXT_DEFAULTS, ARROW_DEFAULTS, type TextNote } from '../src/services/notes';
const viewport={width:600,height:800,rotation:0,transform:[1,0,0,-1,0,800],convertToPdfPoint:(x:number,y:number)=>[x,800-y],convertToViewportPoint:(x:number,y:number)=>[x,800-y]} as unknown as PageViewport;
let captured:number|null=null;
beforeEach(()=>{
 vi.stubGlobal('PointerEvent',class extends MouseEvent{pointerId:number;constructor(type:string,init:PointerEventInit={}){super(type,init);this.pointerId=init.pointerId??1;}});
 Object.defineProperties(Element.prototype,{setPointerCapture:{configurable:true,value:(id:number)=>{captured=id;}},hasPointerCapture:{configurable:true,value:(id:number)=>captured===id},releasePointerCapture:{configurable:true,value:()=>{captured=null;}}});
 vi.spyOn(SVGElement.prototype,'getBoundingClientRect').mockReturnValue({x:0,y:0,left:0,top:0,right:600,bottom:800,width:600,height:800,toJSON(){}});
});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});

const note:TextNote={...TEXT_DEFAULTS,id:'n',type:'text',page:1,x:100,y:650,rotation:0,text:'Note',pointers:[1,2,3].map(i=>({...ARROW_DEFAULTS,id:`p${i}`,target:{x:100*i,y:400}}))};
function Notes({h,tool='edit',revision=0,disabled=false,placing=null}:{h:SessionHistory;tool?:string;revision?:number;disabled?:boolean;placing?:string|null}) {
 const [,refresh]=useState(0),[selected,select]=useState<string|null>(h.present.notes?.[0].id??null);
 return <NoteOverlay page={1} viewport={viewport} notes={h.present.notes??[]} tool={tool} selected={selected} pointer={null} placing={placing} onSelect={select} onEdit={()=>{}} onPlaced={()=>{}} dispatch={(a,g)=>{h.apply(a,g);refresh(v=>v+1);}} history={h} disabled={disabled} revision={revision}/>;
}
const pointer=(target:Element,kind:'pointerDown'|'pointerMove'|'pointerUp',x:number,y:number,shiftKey=false)=>fireEvent[kind](target,{pointerId:1,button:0,buttons:kind==='pointerUp'?0:1,clientX:x,clientY:y,shiftKey});
it.each(['Escape','blur','scroll','snapshot','history','cancel','lost','view','disabled','unmount'])('discards note move and capture on %s',reason=>{
 const h=new SessionHistory({...emptySession,notes:[note]}),r=render(<Notes h={h}/>),svg=screen.getByLabelText('Notes and arrows for page 1'),body=svg.querySelector('[data-note-id="n"] rect')!;
 pointer(body,'pointerDown',120,170);pointer(svg,'pointerMove',160,180);expect(captured).toBe(1);expect(h.present.notes![0]).toBe(note);
 act(()=>{if(reason==='Escape')fireEvent.keyDown(window,{key:'Escape'});if(reason==='blur'||reason==='scroll')fireEvent(window,new Event(reason));if(reason==='snapshot')h.cancelSnapshotDrafts();if(reason==='history')h.traverse('undo');if(reason==='cancel')fireEvent.pointerCancel(svg);if(reason==='lost')fireEvent.lostPointerCapture(svg);if(reason==='view')r.rerender(<Notes h={h} revision={1}/>);if(reason==='disabled')r.rerender(<Notes h={h} disabled/>);if(reason==='unmount')r.unmount();});
 pointer(svg,'pointerUp',160,180);expect(h.present.notes![0]).toBe(note);expect(captured).toBeNull();expect(h.undoLabel).toBeUndefined();
});
it('creates arrows with snapping, ignores tiny gestures and excludes incomplete pointer placement',()=>{
 const h=new SessionHistory(emptySession),r=render(<Notes h={h} tool="arrow"/>),svg=screen.getByLabelText('Notes and arrows for page 1');
 pointer(svg,'pointerDown',100,100);pointer(svg,'pointerUp',101,100);expect(h.present).toBe(emptySession);
 pointer(svg,'pointerDown',100,100);pointer(svg,'pointerMove',200,150,true);expect(h.present).toBe(emptySession);pointer(svg,'pointerUp',200,150,true);expect(h.present.notes).toHaveLength(1);h.traverse('undo');expect(h.present).toBe(emptySession);
 h.apply({type:'put-note',note});r.rerender(<Notes h={h} placing="n"/>);pointer(svg,'pointerDown',50,500);act(()=>h.cancelSnapshotDrafts());pointer(svg,'pointerUp',50,500);expect((h.present.notes![0] as TextNote).pointers).toHaveLength(3);
});
it('moves note, reflows resize and edits one target with a single keyboard transaction',()=>{
 const h=new SessionHistory({...emptySession,notes:[note]});render(<Notes h={h}/>);const svg=screen.getByLabelText('Notes and arrows for page 1'),body=svg.querySelector('[data-note-id="n"] rect')!;
 pointer(body,'pointerDown',120,170);pointer(svg,'pointerMove',140,190);pointer(svg,'pointerUp',140,190);expect(h.present.notes![0]).toMatchObject({x:120,y:630,pointers:note.pointers});
 const moved=h.present,handle=screen.getByRole('button',{name:'Resize note'});fireEvent.keyDown(handle,{key:'ArrowLeft'});fireEvent.keyDown(handle,{key:'ArrowLeft',repeat:true});expect(h.present).toBe(moved);fireEvent.keyUp(handle,{key:'ArrowLeft'});expect((h.present.notes![0] as TextNote).width).toBe(196);
 const target=screen.getByRole('button',{name:'Pointer target 2'}),before=h.present;fireEvent.keyDown(target,{key:'ArrowRight'});fireEvent.keyUp(target,{key:'ArrowRight'});const next=h.present.notes![0] as TextNote;expect(next.pointers[1].target.x).toBe(202);expect(next.pointers[0]).toBe(note.pointers[0]);h.traverse('undo');expect(h.present).toBe(before);
});
function Editor({h}:{h:SessionHistory}){const [editing,setEditing]=useState<TextNote|null>(null),[,refresh]=useState(0);return <><button onClick={()=>setEditing({...note,text:'',pointers:[]})}>New draft</button><NoteControls notes={h.present.notes??[]} selected="n" pointer={null} onSelect={()=>{}} editing={editing} onEdit={setEditing} onClose={()=>setEditing(null)} onPointer={()=>{}} placing={false} history={h} dispatch={(a,g)=>{h.apply(a,g);refresh(v=>v+1);}} disabled={false} revision="0"/></>;}
it('keeps text keystrokes local, shows glyph errors, cancels drafts and commits multiline once',()=>{
 const h=new SessionHistory(emptySession);render(<Editor h={h}/>);fireEvent.click(screen.getByText('New draft'));let area=screen.getByLabelText('Note text');fireEvent.change(area,{target:{value:'unsupported \u{1f600}'}});fireEvent.click(screen.getByText('Apply text'));expect(screen.getByRole('alert').textContent).toContain('cannot render');expect(h.present).toBe(emptySession);
 fireEvent.change(area,{target:{value:'Caf\u00e9\nGreek'}});fireEvent.keyDown(area,{key:'Escape'});expect(h.present).toBe(emptySession);expect(screen.queryByLabelText('Note text')).toBeNull();
 fireEvent.click(screen.getByText('New draft'));area=screen.getByLabelText('Note text');fireEvent.change(area,{target:{value:'Line one\nLine two'}});expect(h.present).toBe(emptySession);fireEvent.click(screen.getByText('Apply text'));expect(h.present.notes![0]).toMatchObject({text:'Line one\nLine two'});h.traverse('undo');expect(h.present).toBe(emptySession);
});

it.each(['snapshot','history','blur','scroll'])('cancels an uncommitted editor on %s and keeps editable-field scrolling local',reason=>{
 const h=new SessionHistory(emptySession);render(<Editor h={h}/>);fireEvent.click(screen.getByText('New draft'));const area=screen.getByLabelText('Note text');fireEvent.change(area,{target:{value:'Draft\nonly'}});fireEvent.scroll(area);expect(screen.getByLabelText('Note text')).toBe(area);
 act(()=>{if(reason==='snapshot')h.cancelSnapshotDrafts();if(reason==='history')h.traverse('undo');if(reason==='blur'||reason==='scroll')fireEvent(window,new Event(reason));});
 expect(screen.queryByLabelText('Note text')).toBeNull();expect(h.present).toBe(emptySession);expect(h.undoLabel).toBeUndefined();
});
