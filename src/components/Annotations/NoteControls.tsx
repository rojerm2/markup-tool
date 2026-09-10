import { useEffect, useRef, useState } from 'react';
import { COLORS } from './DrawingControls';
import { fitNote, noteTextError, validNote, type NoteObject, type TextNote } from '../../services/notes';
import type { SessionHistory } from '../../services/sessionHistory';
import type { SessionAction } from '../../services/annotationSession';

export default function NoteControls({notes,selected,pointer,onSelect,editing,onEdit,onClose,onPointer,placing,history,dispatch,disabled,revision}: {
  notes:NoteObject[];selected:string|null;pointer:string|null;onSelect:(id:string,pointer?:string)=>void;
  editing:TextNote|null;onEdit:(n:TextNote)=>void;onClose:()=>void;onPointer:()=>void;placing:boolean;
  history:SessionHistory;dispatch:(a:SessionAction,g?:number)=>void;disabled:boolean;revision:string;
}) {
  const n=notes.find(n=>n.id===selected),p=n?.type==='text'?n.pointers.find(p=>p.id===pointer):undefined;
  const [draft,setDraftState]=useState<TextNote|null>(null),[error,setError]=useState<string|null>(null),[generation,setGeneration]=useState(0);
  const draftRef=useRef<TextNote|null>(null);
  function setDraft(value:TextNote|null){draftRef.current=value;setDraftState(value);}
  const [open,setOpen]=useState(false);
  useEffect(()=>{setDraft(editing);setError(null);setGeneration(history.generation);if(editing)setOpen(true);},[editing]);
  useEffect(()=>history.subscribeCancellation(()=>{setDraft(null);onClose();}),[history]);
  useEffect(()=>history.subscribeSnapshotCancellation(()=>{setDraft(null);onClose();}),[history]);
  useEffect(()=>{setDraft(null);onClose();},[disabled,revision]);
  useEffect(()=>{const cancel=(e?:Event)=>{if(e?.type==='scroll'&&e.target instanceof Element&&e.target.closest('.note-properties'))return;setDraft(null);onClose();};const key=(e:KeyboardEvent)=>{if(e.key==='Escape')cancel();};document.addEventListener('visibilitychange',cancel);window.addEventListener('keydown',key);window.addEventListener('blur',cancel);window.addEventListener('scroll',cancel,true);return()=>{document.removeEventListener('visibilitychange',cancel);window.removeEventListener('keydown',key);window.removeEventListener('blur',cancel);window.removeEventListener('scroll',cancel,true);};},[onClose]);
  function put(value:NoteObject){if(n)dispatch({type:'put-note',note:value,before:n});}
  function property(key:'color'|'width'|'head',value:string|number){
    if(!n)return;
    if(p&&n.type==='text')put({...n,pointers:n.pointers.map(v=>v===p?{...v,[key]:value}:v)});
    else put({...n,[key]:value});
  }
  const style=p??(n?.type==='arrow'?n:undefined);
  return <div className="note-controls">
    <label>Notes/arrows <select aria-label="Selected note or arrow" value={selected??''} onChange={e=>onSelect(e.target.value)}><option value="">Choose object</option>{notes.map((n,i)=><option key={n.id} value={n.id}>Page {n.page} · {n.type==='text'?n.text.slice(0,24):`Arrow ${i+1}`}</option>)}</select></label>
    {n&&<button aria-expanded={open} onClick={()=>setOpen(!open)}>Note / arrow properties</button>}
    {placing&&<span role="status">Click a target on the note’s page. Escape cancels.</span>}
    {open&&(n||draft)&&<div className="note-properties" role="dialog" aria-label="Note and arrow properties">
      <button onClick={()=>{setOpen(false);setDraft(null);onClose();}}>Close properties</button>
      {draft?<>
        <label>Note text<textarea aria-label="Note text" autoFocus rows={5} maxLength={4097} value={draft.text} onChange={e=>setDraft({...draft,text:e.target.value.replace(/\r\n?/g,'\n')})}/></label>
        <label>Text size<select aria-label="Text size" value={draft.fontSize} onChange={e=>setDraft({...draft,fontSize:Number(e.target.value)})}>{[10,12,16,20].map(v=><option key={v} value={v}>{v} PDF units</option>)}</select></label>
        <label>Text color<select aria-label="Text color" value={draft.color} onChange={e=>setDraft({...draft,color:e.target.value})}>{!COLORS.some(c=>c.value===draft.color)&&<option value={draft.color}>Saved color</option>}{COLORS.map(c=><option key={c.value} value={c.value}>{c.name}</option>)}</select></label>
        <label>Box width<input aria-label="Note width" type="number" min={40} max={2000} value={draft.width} onChange={e=>setDraft({...draft,width:Number(e.target.value)})}/></label>
        <label><input type="checkbox" checked={draft.background} onChange={e=>setDraft({...draft,background:e.target.checked})}/>White background</label>
        <label><input type="checkbox" checked={draft.border} onChange={e=>setDraft({...draft,border:e.target.checked})}/>Border</label>
        <span>Enter starts a new line. Apply saves this edit; Escape cancels. Box grows to fit text.</span>
        <button disabled={disabled} onClick={()=>{if(draftRef.current!==draft)return;if(!draft.text.trim()&&!editing?.text){setDraft(null);onClose();return;}const err=noteTextError(draft.text);if(err){setError(err);return;}if(!Number.isFinite(draft.width)||draft.width<40||draft.width>2000){setError('Use a width from 40 to 2000 PDF units.');return;}const value=fitNote(draft);if(!validNote(value)){setError('Enter nonempty text that fits within the supported box size.');return;}dispatch({type:'put-note',note:value,before:editing?.text?editing:undefined},generation);setDraft(null);onClose();onSelect(value.id);}}>Apply text</button>
        <button onClick={()=>{setDraft(null);onClose();}}>Cancel text</button>
        {error&&<p role="alert">{error}</p>}
      </>:<>
        {n?.type==='text'&&<><button onClick={()=>onEdit(n)}>Edit text</button><button disabled={disabled||n.pointers.length>=32} onClick={()=>{setOpen(false);onPointer();}}>Add pointer</button>
          <label>Pointer<select aria-label="Selected pointer" value={pointer??''} onChange={e=>onSelect(n.id,e.target.value||undefined)}><option value="">Whole note</option>{n.pointers.map((p,i)=><option key={p.id} value={p.id}>Pointer {i+1}</option>)}</select></label></>}
        {style&&<><label>Color<select aria-label="Arrow color" value={style.color} onChange={e=>property('color',e.target.value)}>{!COLORS.some(c=>c.value===style.color)&&<option value={style.color}>Saved color</option>}{COLORS.map(c=><option key={c.value} value={c.value}>{c.name}</option>)}</select></label>
          <label>Shaft width<select aria-label="Arrow shaft width" value={style.width} onChange={e=>property('width',Number(e.target.value))}>{![1,2,4].includes(style.width)&&<option value={style.width}>{style.width}</option>}{[1,2,4].map(v=><option key={v} value={v}>{v} PDF units</option>)}</select></label>
          <label>Arrowhead<select aria-label="Arrowhead size" value={style.head} onChange={e=>property('head',Number(e.target.value))}>{![0,6,10,16].includes(style.head)&&<option value={style.head}>{style.head}</option>}{[0,6,10,16].map(v=><option key={v} value={v}>{v?`${v} PDF units`:'No head'}</option>)}</select></label></>}
        {n&&<button disabled={disabled} onClick={()=>{if(p&&n.type==='text')put({...n,pointers:n.pointers.filter(v=>v!==p)});else dispatch({type:'remove-note',id:n.id});}}>{p?'Delete pointer':n.type==='text'?'Delete note and pointers':'Delete arrow'}</button>}
      </>}
    </div>}
  </div>;
}
