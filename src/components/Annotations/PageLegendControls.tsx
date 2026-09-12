import { useEffect, useState } from 'react';
import type { PDFPageProxy } from 'pdfjs-dist';
import type { AnnotationSession, SessionAction } from '../../services/annotationSession';
import { keyPoint, layoutLegend, legendTextError, newPageLegend, type PageLegend } from '../../services/pageLegend';
import { pdfToViewport } from '../../services/coordinates';
import type { SessionHistory } from '../../services/sessionHistory';
import PageLegendGraphic from './PageLegendGraphic';

export default function PageLegendControls({rows,onRows,session,selected,onSelect,pages,placing,onPlace,dispatch,history,revision,disabled}: {
  rows:string[];onRows:(ids:string[])=>void;session:AnnotationSession;selected:string|null;onSelect:(id:string)=>void;pages:PDFPageProxy[];current:number;placing:boolean;onPlace:()=>void;
  dispatch:(a:SessionAction,g?:number)=>void;history:SessionHistory;revision:number;disabled:boolean;
}) {
  const key=session.pageLegends?.find(k=>k.id===selected);
  const [draft,setDraft]=useState<PageLegend|null>(null), [target,setTarget]=useState('1');
  const [generation,setGeneration]=useState(history.generation);
  const value=draft??key;
  function reset(){setDraft(null);setGeneration(history.generation);}
  useEffect(reset,[key,session.legends,revision,disabled]);
  useEffect(()=>history.subscribeCancellation(reset),[history]);
  useEffect(()=>{const cancel=(e:KeyboardEvent)=>{if(e.key==='Escape')reset();};const hidden=()=>{if(document.hidden)reset();};window.addEventListener('keydown',cancel);window.addEventListener('blur',reset);document.addEventListener('visibilitychange',hidden);return()=>{window.removeEventListener('keydown',cancel);window.removeEventListener('blur',reset);document.removeEventListener('visibilitychange',hidden);};},[]);
  function edit(change:Partial<PageLegend>){if(value){if(!draft)setGeneration(history.generation);setDraft({...value,...change});}}
  const initial={title:'LEGEND',categoryIds:rows} as PageLegend;
  const error=value ? (!Number.isFinite(value.width)||value.width<(value.layout==='columns'?140:100)||value.width>2000 ? `Use a width from ${value.layout==='columns'?140:100} to 2000 PDF units.` : legendTextError(value,session.legends)) : legendTextError(initial,session.legends);
  const layout=value?layoutLegend(value,session.legends):null;
  let clipped=false;
  if(value&&layout){const vp=pages[value.page-1].getViewport({scale:1});clipped=[[0,0],[value.width,0],[0,layout.height],[value.width,layout.height]].some(([x,y])=>{const p=pdfToViewport(keyPoint(value,x,y),vp);return p.x<0||p.y<0||p.x>vp.width||p.y>vp.height;});}
  return <section className="page-key-controls" aria-label="Page legend properties">
    <div className="page-key-bar">
      <button disabled={disabled||!rows.length||!!legendTextError(initial,session.legends)} aria-pressed={placing} onClick={onPlace}>{placing?'Cancel placement':'Add legend to page'}</button>
      <label>Page legends <select aria-label="Select page legend" value={selected??''} onChange={e=>onSelect(e.target.value)}>
        <option value="">Choose a placement</option>{session.pageLegends?.map((k,i)=><option key={k.id} value={k.id}>Page {k.page} · {k.title||'Untitled legend'} ({i+1})</option>)}
      </select></label>
      {!session.legends.length&&<span>Create categories in Legends first.</span>}
      {placing&&<span>Click the page to place · Escape cancels</span>}
    </div>
    {!value&&session.legends.length>0&&<details className="placement-rows"><summary>Choose rows for the next placement</summary><div>
      {session.legends.map(l=><label key={l.id}><input type="checkbox" checked={rows.includes(l.id)} onChange={e=>onRows(e.target.checked?[...rows,l.id]:rows.filter(id=>id!==l.id))}/>{l.name}</label>)}
    </div></details>}
    {error&&<p role="alert">{error}</p>}
    {value&&layout&&<details open className="key-properties"><summary>Tools / Properties — selected page legend</summary>
      <div className="key-properties-body">
      <form onSubmit={e=>{e.preventDefault();if(draft&&key&&!error){dispatch({type:'put-key',key:draft,before:key,legends:session.legends},generation);reset();}}}>
        <label>Heading <input aria-label="Legend heading" value={value.title} maxLength={256} onChange={e=>edit({title:e.target.value})}/></label>
        <label>Layout <select aria-label="Legend layout" value={value.layout} onChange={e=>edit({layout:e.target.value as PageLegend['layout']})}><option value="list">List</option><option value="columns">Compact two-column</option></select></label>
        <label>Text size <select aria-label="Legend text size" value={value.fontSize} onChange={e=>edit({fontSize:Number(e.target.value)})}>{[10,12,16].map(n=><option key={n} value={n}>{n===10?'Small':n===12?'Regular':'Large'}</option>)}</select></label>
        <label>Width <input aria-label="Legend width" type="number" min={100} max={2000} step={20} value={value.width} onChange={e=>edit({width:Number(e.target.value)})}/></label>
          <label>Background<select aria-label="Legend background" value={value.background?'white':'transparent'} onChange={e=>edit({background:e.target.value==='white'})}><option value="white">White</option><option value="transparent">Transparent</option></select></label>
          <label><input type="checkbox" checked={value.border} onChange={e=>edit({border:e.target.checked})}/> Border</label>
        <details><summary>Rows and more options</summary>
          <p>Blank heading hides the title. Colors are full opacity; highlights are translucent.</p>
          {value.categoryIds.map((id,i)=><div key={id} className="key-row"><span>{session.legends.find(l=>l.id===id)?.name}</span>
            <button type="button" disabled={i===0} aria-label={`Move row ${i+1} up`} onClick={()=>{const ids=[...value.categoryIds];[ids[i-1],ids[i]]=[ids[i],ids[i-1]];edit({categoryIds:ids});}}>Up</button>
            <button type="button" disabled={i===value.categoryIds.length-1} aria-label={`Move row ${i+1} down`} onClick={()=>{const ids=[...value.categoryIds];[ids[i+1],ids[i]]=[ids[i],ids[i+1]];edit({categoryIds:ids});}}>Down</button>
            <button type="button" disabled={value.categoryIds.length===1} onClick={()=>edit({categoryIds:value.categoryIds.filter(v=>v!==id)})}>Remove row</button></div>)}
          {session.legends.filter(l=>!value.categoryIds.includes(l.id)).map(l=><button type="button" key={l.id} onClick={()=>edit({categoryIds:[...value.categoryIds,l.id]})}>Add {l.name}</button>)}
        </details>
        <button disabled={!draft||!!error||value.width<100||value.width>2000} type="submit">Apply legend changes</button>
        <button disabled={!draft} type="button" onClick={reset}>Cancel changes</button>
      </form>
      <div className="key-preview"><svg aria-label="Legend live preview" viewBox={`0 0 ${value.width} ${layout.height}`} width={Math.min(value.width,300)}><PageLegendGraphic value={value} legends={session.legends}/></svg></div>
      <div className="key-actions"><label>Duplicate to page <select aria-label="Duplicate to page" value={target} onChange={e=>setTarget(e.target.value)}>{pages.map(p=><option key={p.pageNumber}>{p.pageNumber}</option>)}</select></label>
      <button disabled={!!draft||!!error} onClick={()=>{if(!key)return;const p=Number(target),base=newPageLegend(p,pages[p-1].getViewport({scale:1}),key.categoryIds);dispatch({type:'put-key',key:{...key,id:base.id,page:p,x:base.x,y:base.y,rotation:base.rotation},legends:session.legends});}}>Duplicate legend</button>
      <button onClick={()=>dispatch({type:'remove-key',id:value.id})}>Delete page legend</button><span>Drag to move · Arrow keys nudge · Delete removes this placement only</span></div>
      {clipped&&<p role="alert">This legend extends beyond the page and will be clipped in export. Reduce its width/text size or move it into the page.</p>}
      </div>
    </details>}
  </section>;
}
