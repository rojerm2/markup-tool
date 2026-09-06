import { expect, it } from 'vitest';
import { SessionHistory, HISTORY_LIMIT } from '../src/services/sessionHistory';
import { emptySession, type AnnotationSession, type SessionAction } from '../src/services/annotationSession';
import type { Highlight } from '../src/types/annotation';
const stroke: Highlight = { id: 'a', page: 1, type: 'freehand', color: '#facc15', width: 10, opacity: .4, legendId: 'l', points: [{x: .123456789, y: -22.75}, {x: 90.125, y: 300.875}] };
const initial: AnnotationSession = { ...emptySession, legends: [{id:'l',name:'Walls',color:'#facc15'}], activeLegendId:'l', annotations:[stroke, {...stroke,id:'b',page:2,legendId:null}, {...stroke,id:'c'}] };
const actions: SessionAction[] = [
 {type:'commit',stroke:{...stroke,id:'new'}}, {type:'remove-stroke',id:'a'},
 {type:'edit-stroke',id:'a',edit:{width:20}}, {type:'edit-stroke',id:'a',edit:{color:'#38bdf8'}},
 {type:'edit-stroke',id:'b',edit:{legendId:'l'}}, {type:'edit-stroke',id:'a',edit:{legendId:null}},
 {type:'move-stroke',before:stroke,legends:initial.legends,points:stroke.points.map(p=>({x:p.x+2.125,y:p.y-4.5}))},
 {type:'create',legend:{id:'door',name:'Doors',color:'#38bdf8'}}, {type:'rename',id:'l',name:'Renamed'},
 {type:'delete',id:'l'}, {type:'select',id:null}, {type:'drawing',drawing:{...emptySession.drawing,width:20},manual:true},
];
it.each(actions)('restores exact whole-session transaction for $type', action => {
 const h = new SessionHistory(initial); expect(h.apply(action)).toBe(true); const after=h.present;
 expect(h.traverse('undo')).toBe(true); expect(h.present).toBe(initial); expect(h.present.annotations[0].points).toBe(stroke.points);
 expect(h.traverse('redo')).toBe(true); expect(h.present).toBe(after); expect(h.redoLabel).toBeUndefined();
 expect(h.traverse('undo')).toBe(true); expect(h.traverse('undo')).toBe(false);
});
it('ignores invalid, missing, data-equivalent and stale actions without erasing redo',()=>{
 const h=new SessionHistory(initial);h.apply({type:'remove-stroke',id:'a'});h.traverse('undo');
 const noops:SessionAction[]=[{type:'rename',id:'l',name:' Walls '},{type:'rename',id:'missing',name:'Name'},
 {type:'delete',id:'missing'},{type:'select',id:'missing'},{type:'select',id:'l'},
 {type:'drawing',drawing:{...initial.drawing},manual:false},{type:'drawing',drawing:{...initial.drawing,width:NaN},manual:false},
 {type:'remove-stroke',id:'missing'},{type:'edit-stroke',id:'a',edit:{width:10}}, {type:'edit-stroke',id:'a',edit:{legendId:'missing'}},
 {type:'commit',stroke}, {type:'create',legend:{id:'x',name:'Walls',color:'#facc15'}},
 {type:'move-stroke',before:{...stroke},legends:initial.legends,points:stroke.points}];
 for(const action of noops){expect(h.apply(action)).toBe(false);expect(h.present).toBe(initial);expect(h.redoLabel).toBe('Delete stroke');}
 expect(h.traverse('redo')).toBe(true);expect(h.present.annotations.map(s=>s.id)).toEqual(['b','c']);
});
it('evicts only oldest transactions at 100, preserves branch order and bounds traversal',()=>{
 const h=new SessionHistory(emptySession);
 for(let i=0;i<105;i++)h.apply({type:'create',legend:{id:String(i),name:String(i),color:'#facc15'}});
 for(let i=0;i<HISTORY_LIMIT;i++)expect(h.traverse('undo')).toBe(true);
 expect(h.present.legends.map(l=>l.id)).toEqual(['0','1','2','3','4']);expect(h.traverse('undo')).toBe(false);
 for(let i=0;i<HISTORY_LIMIT;i++)expect(h.traverse('redo')).toBe(true);
 expect(h.present.legends).toHaveLength(105);expect(h.traverse('redo')).toBe(false);
 h.traverse('undo');h.apply({type:'rename',id:'0',name:'Branch'});expect(h.redoLabel).toBeUndefined();
});
it('rejects ABA draw and move tokens independently of React effects, even empty attempts',()=>{
 const h=new SessionHistory(initial), token=h.generation;
 h.apply({type:'remove-stroke',id:'a'});h.traverse('undo');h.traverse('redo');h.traverse('undo');
 expect(h.present).toBe(initial);
 expect(h.apply({type:'commit',stroke:{...stroke,id:'new'}},token)).toBe(false);
 expect(h.apply(actions[6],token)).toBe(false);
 let cancelled=0; const unsubscribe=h.subscribeCancellation(()=>{cancelled++;expect(h.present).toBe(initial);});
 const emptyToken=h.generation;h.traverse('undo');expect(cancelled).toBe(1);
 expect(h.apply({type:'commit',stroke:{...stroke,id:'new'}},emptyToken)).toBe(false);unsubscribe();
 h.invalidate();expect(cancelled).toBe(1);
 expect(new SessionHistory(h.present).undoLabel).toBeUndefined();
});
it('last legend deletion atomically detaches all pages and settings; last stroke restoration keeps IDs',()=>{
 const h=new SessionHistory(initial);h.apply({type:'delete',id:'l'});
 expect(h.present.activeLegendId).toBeNull();expect(h.present.annotations.every(s=>s.legendId===null)).toBe(true);
 h.traverse('undo');expect(h.present).toBe(initial);
 for(const s of initial.annotations)h.apply({type:'remove-stroke',id:s.id});
 expect(h.present.annotations).toEqual([]);h.traverse('undo');expect(h.present.annotations[0]).toBe(initial.annotations[2]);
 h.traverse('redo');expect(h.present.annotations).toEqual([]);
});
