import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { PDFPageProxy } from 'pdfjs-dist';
import App from '../src/App';
import * as exports from '../src/services/exportService';
vi.mock('../src/services/exportService', () => ({ exportPdf: vi.fn() }));
import * as files from '../src/services/projectService';
import { emptySession } from '../src/services/annotationSession';
import { parseProject } from '../src/services/projectFormat';
vi.mock('../src/services/projectService', () => ({ choosePdf: vi.fn(), loadSource: vi.fn(), readProject: vi.fn(), resolveSource: vi.fn(), writeProject: vi.fn() }));
const native = vi.hoisted(() => ({ close: null as null | ((event: { preventDefault: () => void }) => void), destroy: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ onCloseRequested: async (handler: typeof native.close) => { native.close = handler; return () => {}; }, destroy: native.destroy }) }));
const source = { reference: 'C:\\plans\\原本.pdf', filename: '原本.pdf', sha256: 'a'.repeat(64), size: 123, pages: 2 };
function pages() { return [1, 2].map(pageNumber => ({ pageNumber,
  getViewport: () => ({ width: 600, height: 800, convertToViewportPoint: (x: number, y: number) => [x, 800-y], convertToPdfPoint: (x: number, y: number) => [x, 800-y] }),
  render: () => ({ promise: Promise.resolve(), cancel() {} }),
})) as unknown as PDFPageProxy[]; }
const click = (name: string) => fireEvent.click(screen.getByRole('button', { name, exact: true }));
const status = () => screen.getAllByRole('status').map(x => x.textContent).join(' ');
async function idle() { await waitFor(() => expect(screen.getByRole('button', {name:'Open PDF'}).hasAttribute('disabled')).toBe(false)); }
async function openPdf() { click('Open PDF'); await screen.findByLabelText('PDF page 2'); await idle(); }
function create(name = 'Walls') {
  if (!screen.queryByLabelText('Legend name')) click('Legends (0)');
  fireEvent.change(screen.getByLabelText('Legend name'), {target:{value:name}}); click('Create legend');
}
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: Error) => void; const promise = new Promise<T>((yes,no) => { resolve=yes; reject=no; }); return {promise,resolve,reject}; }
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as CanvasRenderingContext2D);
  vi.mocked(files.choosePdf).mockResolvedValue(source.reference);
  vi.mocked(files.loadSource).mockImplementation(async () => ({ pages: pages(), source }));
  vi.mocked(files.writeProject).mockResolvedValue('C:\\plans\\one.pmarkup');
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('first Save, subsequent Save, Save As, reopen and continued legend edits preserve stable state', async () => {
  render(<App />); await openPdf(); create(); click('Thick');
  expect(status()).toContain('Unsaved changes'); click('Save Project'); await idle();
  const [path, sourcePath, text] = vi.mocked(files.writeProject).mock.calls[0];
  expect(path).toBeNull(); expect(sourcePath).toBe(source.reference);
  const saved = parseProject(text); expect(saved.session.drawing.width).toBe(20);
  click('Save Project'); await idle(); expect(vi.mocked(files.writeProject).mock.calls[1][0]).toContain('one.pmarkup');
  vi.mocked(files.writeProject).mockResolvedValueOnce('D:\\备份\\two.pmarkup'); click('Save As'); await idle();
  expect(vi.mocked(files.writeProject).mock.calls[2][0]).toBeNull(); expect(status()).toContain('two.pmarkup');
  vi.mocked(files.readProject).mockResolvedValue({path:'C:\\plans\\one.pmarkup',project:saved});
  vi.mocked(files.resolveSource).mockResolvedValue(source.reference); click('Open Project'); await idle();
  expect(screen.getByLabelText('Active legend').textContent).toBe('Active: Walls');
  click('Legends (1)'); click('Rename legend Walls');
  fireEvent.change(screen.getByLabelText('Legend name'),{target:{value:'Long wall'}}); click('Save name'); click('Save Project'); await idle();
  const renamed = parseProject(vi.mocked(files.writeProject).mock.calls[3][2]);
  expect(renamed.session.legends[0]).toEqual({...saved.session.legends[0],name:'Long wall'});
  click('Delete legend Long wall'); click('Save Project'); await idle();
  expect(parseProject(vi.mocked(files.writeProject).mock.calls[4][2]).session.legends).toEqual([]);
});
it('Save As failure/cancel keeps path and dirty state; edits during save only save the snapshot', async () => {
  render(<App />); await openPdf(); create(); click('Save Project'); await idle(); click('Thick');
  vi.mocked(files.writeProject).mockRejectedValueOnce(new Error('Disk full')); click('Save As'); await idle();
  expect(screen.getByRole('alert').textContent).toContain('Disk full'); expect(status()).toContain('one.pmarkup'); expect(status()).toContain('Unsaved changes');
  vi.mocked(files.writeProject).mockResolvedValueOnce(null); click('Save As'); await idle(); expect(status()).toContain('one.pmarkup');
  const save = deferred<string | null>(); vi.mocked(files.writeProject).mockReturnValueOnce(save.promise);
  click('Save Project'); click('Thin');
  expect(screen.getByRole('button',{name:'Open PDF'}).hasAttribute('disabled')).toBe(true);
  await act(async () => save.resolve('C:\\plans\\one.pmarkup')); await idle(); expect(status()).toContain('Unsaved changes');
  const snapshot = parseProject(vi.mocked(files.writeProject).mock.calls[3][2]); expect(snapshot.session.drawing.width).toBe(20);
  click('Save Project'); await idle(); expect(status()).not.toContain('Unsaved changes');
});
it('dirty guards cancel, failed save and cancelled save abort replacement; discard plus cancelled picker retains work', async () => {
  render(<App />); await openPdf(); create();
  click('Open PDF'); await screen.findByRole('button',{name:'Cancel'}); click('Cancel'); await idle();
  expect(files.choosePdf).toHaveBeenCalledTimes(1);
  vi.mocked(files.writeProject).mockResolvedValueOnce(null); click('Open PDF'); click('Save changes'); await idle(); expect(files.choosePdf).toHaveBeenCalledTimes(1);
  vi.mocked(files.writeProject).mockRejectedValueOnce(new Error('Denied')); click('Open PDF'); click('Save changes'); await idle(); expect(files.choosePdf).toHaveBeenCalledTimes(1);
  vi.mocked(files.choosePdf).mockResolvedValueOnce(null); click('Open PDF'); click('Discard changes'); await idle();
  expect(screen.getByLabelText('Active legend').textContent).toContain('Walls'); expect(status()).toContain('Unsaved changes');
  click('Open PDF'); click('Save changes'); await idle(); expect(screen.getByLabelText('Active legend').textContent).toContain('Manual');
});
it('missing source Locate cancellation and mismatch retain work, matching relocated source hydrates atomically', async () => {
  render(<App />); await openPdf();
  const project = parseProject(JSON.stringify({format:'pdf-markup-project',version:1,source,session:{...emptySession,drawing:{...emptySession.drawing,width:20}}}));
  vi.mocked(files.readProject).mockResolvedValue({path:'D:\\moved.pmarkup',project}); vi.mocked(files.resolveSource).mockResolvedValue(null);
  vi.mocked(files.choosePdf).mockResolvedValueOnce(null); click('Open Project'); await idle(); expect(status()).toContain('Unsaved project');
  vi.mocked(files.loadSource).mockResolvedValueOnce({pages:pages(),source:{...source,sha256:'b'.repeat(64)}});
  click('Open Project'); await idle(); expect(screen.getByRole('alert').textContent).toContain('identity mismatch');
  expect(vi.mocked(files.loadSource).mock.calls[1][1].aborted).toBe(true);
  expect(vi.mocked(files.loadSource).mock.calls[0][1].aborted).toBe(false);
  click('Open Project'); await idle(); expect(status()).toContain('moved.pmarkup');
  expect(screen.getByRole('button',{name:'Thick'}).getAttribute('aria-pressed')).toBe('true');
  expect(vi.mocked(files.loadSource).mock.calls[0][1].aborted).toBe(true);
});
it('failed project/PDF load preserves current session; stale unmounted load is aborted', async () => {
  const view = render(<App />); await openPdf();
  vi.mocked(files.readProject).mockRejectedValueOnce(new Error('Invalid project: unsupported version'));
  click('Open Project'); await idle(); expect(screen.getByRole('alert').textContent).toContain('unsupported version');
  vi.mocked(files.loadSource).mockRejectedValueOnce(new Error('Broken PDF')); click('Open PDF'); await idle();
  expect(screen.getByLabelText('PDF page 2')).toBeTruthy(); expect(vi.mocked(files.loadSource).mock.calls[1][1].aborted).toBe(true);
  const pending = deferred<Awaited<ReturnType<typeof files.loadSource>>>(); vi.mocked(files.loadSource).mockReturnValueOnce(pending.promise);
  click('Open PDF'); await waitFor(() => expect(files.loadSource).toHaveBeenCalledTimes(3)); view.unmount();
  expect(vi.mocked(files.loadSource).mock.calls[2][1].aborted).toBe(true);
  await act(async () => pending.resolve({pages:pages(),source}));
});
it('native close prevents immediate destruction and obeys cancel/save/discard including active save lock', async () => {
  render(<App />); await openPdf(); create(); const preventDefault = vi.fn();
  act(() => native.close!({preventDefault})); expect(preventDefault).toHaveBeenCalledOnce();
  const space = new KeyboardEvent('keydown', {key:' ',code:'Space',bubbles:true,cancelable:true});
  fireEvent(screen.getByRole('button',{name:'Cancel',exact:true}),space);
  expect(space.defaultPrevented).toBe(false);
  expect(screen.getByLabelText('PDF pages').className).not.toContain('can-pan');
  click('Cancel'); await idle(); expect(native.destroy).not.toHaveBeenCalled();
  vi.mocked(files.writeProject).mockResolvedValueOnce(null); act(() => native.close!({preventDefault})); click('Save changes'); await idle(); expect(native.destroy).not.toHaveBeenCalled();
  const save = deferred<string|null>(); vi.mocked(files.writeProject).mockReturnValueOnce(save.promise); click('Save Project');
  act(() => native.close!({preventDefault})); expect(native.destroy).not.toHaveBeenCalled();
  await act(async () => save.resolve(null)); await idle();
  act(() => native.close!({preventDefault})); click('Discard changes'); await idle(); expect(native.destroy).toHaveBeenCalledOnce();
});


it('save excludes active draft; a later completed gesture remains dirty until the next save', async () => {
  render(<App />); await openPdf();
  const svg=screen.getByLabelText('Highlights for page 1');
  Object.assign(svg,{setPointerCapture(){},hasPointerCapture:()=>false,getBoundingClientRect:()=>({left:0,top:0,right:600,bottom:800,width:600,height:800})});
  const pointer=(type:string,x:number)=>fireEvent(svg,Object.assign(new MouseEvent(type,{bubbles:true,button:0,buttons:type==='pointerup'?0:1,clientX:x,clientY:50}),{pointerId:7}));
  pointer('pointerdown',40); pointer('pointermove',80);
  const save=deferred<string|null>(); vi.mocked(files.writeProject).mockReturnValueOnce(save.promise); click('Save Project');
  expect(parseProject(vi.mocked(files.writeProject).mock.calls[0][2]).session.annotations).toEqual([]);
  pointer('pointerup',100); await act(async()=>save.resolve('C:\\plans\\one.pmarkup')); await idle();
  expect(status()).toContain('Unsaved changes'); expect(svg.querySelectorAll('polyline')).toHaveLength(1);
  click('Save Project'); await idle(); const saved=parseProject(vi.mocked(files.writeProject).mock.calls[1][2]);
  expect(saved.session.annotations).toHaveLength(1); expect(saved.session.annotations[0].points).toHaveLength(3);
});


async function openEditable() {
  const session={...structuredClone(emptySession),legends:[{id:'walls',name:'Walls',color:'#facc15'},{id:'doors',name:'Doors',color:'#facc15'}],
    annotations:[{id:'one',page:1,type:'freehand',legendId:'walls',color:'#facc15',width:10,opacity:.4,points:[{x:40,y:750},{x:120,y:750}]},
      {id:'two',page:2,type:'freehand',legendId:'doors',color:'#facc15',width:10,opacity:.4,points:[{x:50,y:700},{x:70,y:710},{x:90,y:700}]},
      {id:'three',page:1,type:'freehand',legendId:null,color:'#facc15',width:10,opacity:.4,points:[{x:40,y:650},{x:120,y:650}]}]};
  const project=parseProject(JSON.stringify({format:'pdf-markup-project',version:1,source,session}));
  vi.mocked(files.readProject).mockResolvedValue({path:'C:\\plans\\one.pmarkup',project});
  vi.mocked(files.resolveSource).mockResolvedValue(source.reference);
  render(<App/>);click('Open Project');await screen.findByLabelText('PDF page 2');await idle();
  click('Select/Edit');
  return project;
}
function selected(id:string) {fireEvent.change(screen.getByLabelText('Selected stroke'),{target:{value:id}});}
function editPointer(page=1) {
  const svg=screen.getByLabelText(`Highlights for page ${page}`);
  Object.assign(svg,{setPointerCapture(){},hasPointerCapture:()=>false,getBoundingClientRect:()=>({left:0,top:0,right:600,bottom:800,width:600,height:800})});
  return (type:string,x:number,y=50)=>fireEvent(svg,Object.assign(new MouseEvent(type,{bubbles:true,button:0,buttons:type==='pointerup'?0:1,clientX:x,clientY:y}),{pointerId:7}));
}
it('M7 full App saves/reopens moved, reassigned, manual, resized and deleted multi-page strokes, then deletes the last edited stroke',async()=>{
  const original=await openEditable();selected('one');
  fireEvent.change(screen.getByLabelText('Selected stroke legend'),{target:{value:'doors'}});
  fireEvent.change(screen.getByLabelText('Selected stroke width'),{target:{value:'20'}});
  const pointer=editPointer();pointer('pointerdown',80);pointer('pointermove',110,70);pointer('pointerup',110,70);
  selected('two');click('Selected stroke Yellow');
  selected('three');click('Delete stroke');
  click('Save Project');await idle();
  const saved=parseProject(vi.mocked(files.writeProject).mock.calls[0][2]);
  expect(saved.session.annotations).toEqual([
    {...original.session.annotations[0],legendId:'doors',width:20,points:[{x:70,y:730},{x:150,y:730}]},
    {...original.session.annotations[1],legendId:null}]);
  expect(saved.session.drawing).toEqual(original.session.drawing);
  vi.mocked(files.readProject).mockResolvedValueOnce({path:'C:\\plans\\one.pmarkup',project:saved});click('Open Project');await idle();
  expect(screen.getByRole('button',{name:'Highlight',exact:true}).getAttribute('aria-pressed')).toBe('true');
  expect(screen.queryByLabelText('Selected stroke')).toBeNull();click('Select/Edit');selected('two');
  expect((screen.getByLabelText('Selected stroke legend') as HTMLSelectElement).value).toBe('');
  click('Delete stroke');selected('one');click('Selected stroke Blue');click('Delete stroke');
  expect(screen.getByRole('button',{name:'Delete stroke'}).hasAttribute('disabled')).toBe(true);
  click('Save Project');await idle();expect(parseProject(vi.mocked(files.writeProject).mock.calls[1][2]).session.annotations).toEqual([]);
});
it('M7 save during movement snapshots committed geometry; later move and property commits stay dirty',async()=>{
  await openEditable();selected('one');const pointer=editPointer();
  pointer('pointerdown',80);pointer('pointermove',110,70);
  const pendingSave=deferred<string|null>();vi.mocked(files.writeProject).mockReturnValueOnce(pendingSave.promise);click('Save Project');
  const snapshot=parseProject(vi.mocked(files.writeProject).mock.calls[0][2]);expect(snapshot.session.annotations[0].points[0]).toEqual({x:40,y:750});
  pointer('pointerup',110,70);fireEvent.change(screen.getByLabelText('Selected stroke width'),{target:{value:'20'}});
  await act(async()=>pendingSave.resolve('C:\\plans\\one.pmarkup'));await idle();expect(status()).toContain('Unsaved changes');
  click('Save Project');await idle();const saved=parseProject(vi.mocked(files.writeProject).mock.calls[1][2]);
  expect(saved.session.annotations[0].points[0]).toEqual({x:70,y:730});expect(saved.session.annotations[0].width).toBe(20);
  expect(status()).toContain('Saved');
});
it('M7 keyboard selects via controls, protects typing/dialogs and limits Delete to edit context',async()=>{
  await openEditable();selected('one');const region=screen.getByLabelText('PDF pages');
  for(const name of ['Selected stroke','Selected stroke legend','Selected stroke width','Page number']) {
    const control=screen.getByLabelText(name);fireEvent.keyDown(control,{key:'Delete'});fireEvent.keyDown(control,{key:'Backspace'});
  }
  expect(screen.getByLabelText('Selected stroke').querySelectorAll('option')).toHaveLength(4);
  fireEvent.keyDown(document.body,{key:'Delete'});expect(screen.getByLabelText('Selected stroke').querySelectorAll('option')).toHaveLength(4);
  fireEvent.keyDown(region,{key:'Escape',code:'Escape'});expect((screen.getByLabelText('Selected stroke') as HTMLSelectElement).value).toBe('');
  selected('one');fireEvent(region,new MouseEvent('pointerdown',{bubbles:true,button:0}));
  expect((screen.getByLabelText('Selected stroke') as HTMLSelectElement).value).toBe('');
  selected('one');click('Highlight');fireEvent.keyDown(region,{key:'Delete'});click('Select/Edit');
  expect(screen.getByLabelText('Selected stroke').querySelectorAll('option')).toHaveLength(4);
  selected('one');fireEvent.keyDown(region,{key:'Backspace'});expect(screen.getByLabelText('Selected stroke').querySelectorAll('option')).toHaveLength(3);
  selected('three');click('Open PDF');fireEvent.keyDown(screen.getByRole('button',{name:'Cancel',exact:true}),{key:'Delete'});click('Cancel');await idle();
  expect(screen.getByLabelText('Selected stroke').querySelectorAll('option')).toHaveLength(3);
  click('Legends (2)');fireEvent.keyDown(screen.getByLabelText('Legend name'),{key:'Delete'});
  const space=new KeyboardEvent('keydown',{key:' ',code:'Space',bubbles:true,cancelable:true});fireEvent(screen.getByLabelText('Legend name'),space);expect(space.defaultPrevented).toBe(false);
  click('Delete legend Walls');expect((screen.getByLabelText('Selected stroke legend') as HTMLSelectElement).value).toBe('');
});
it('M7 open/close freeze and abandon movement even when a cancelled transition returns to the same session',async()=>{
  await openEditable();selected('one');click('Selected stroke Blue');const pointer=editPointer();
  pointer('pointerdown',80);pointer('pointermove',110,70);click('Open PDF');
  pointer('pointerup',110,70);click('Cancel');await idle();pointer('pointerup',110,70);
  selected('one');const second=editPointer();second('pointerdown',80);second('pointermove',140,80);
  act(()=>native.close!({preventDefault:vi.fn()}));second('pointerup',140,80);click('Cancel');await idle();
  click('Save Project');await idle();const saved=parseProject(vi.mocked(files.writeProject).mock.calls[0][2]);
  expect(saved.session.annotations[0]).toMatchObject({color:'#38bdf8',points:[{x:40,y:750},{x:120,y:750}]});
  expect(native.destroy).not.toHaveBeenCalled();
});

const historyKey = (key='z', shiftKey=false, target: EventTarget=window) => fireEvent.keyDown(target, {key,ctrlKey:true,shiftKey});
it('history traverses pending save snapshots, dirty equality and successful Save As without losing stacks',async()=>{
 render(<App/>);await openPdf();create();click('Save Project');await idle();click('Thick');
 const save=deferred<string|null>();vi.mocked(files.writeProject).mockReturnValueOnce(save.promise);click('Save As');
 click('Undo');expect(status()).toContain('Saved');click('Redo');
 await act(async()=>save.resolve('D:\\snapshot.pmarkup'));await idle();expect(status()).not.toContain('Unsaved changes');
 click('Undo');expect(status()).toContain('Unsaved changes');historyKey('y');expect(status()).not.toContain('Unsaved changes');
 click('Thin');expect(status()).toContain('Unsaved changes');historyKey();expect(status()).not.toContain('Unsaved changes');
 click('Save Project');await idle();expect(vi.mocked(files.writeProject).mock.calls[2][0]).toBe('D:\\snapshot.pmarkup');
 const saved=parseProject(vi.mocked(files.writeProject).mock.calls[2][2]);expect(Object.keys(saved.session).sort()).toEqual(['activeLegendId','annotations','drawing','legends']);
 expect(screen.getByRole('button',{name:'Redo',exact:true}).hasAttribute('disabled')).toBe(false);
});
it('history survives cancelled/failed replacement and resets only on successful reopen',async()=>{
 render(<App/>);await openPdf();create();click('Thick');click('Undo');
 click('Open PDF');historyKey();expect(screen.getByRole('button',{name:'Undo',exact:true}).hasAttribute('disabled')).toBe(true);click('Cancel');await idle();
 expect(screen.getByLabelText('Active legend').textContent).toContain('Walls');click('Redo');expect(screen.getByRole('button',{name:'Thick'}).getAttribute('aria-pressed')).toBe('true');
 vi.mocked(files.choosePdf).mockResolvedValueOnce(null);click('Open PDF');click('Discard changes');await idle();click('Undo');
 vi.mocked(files.loadSource).mockRejectedValueOnce(new Error('Broken'));click('Open PDF');click('Discard changes');await idle();click('Redo');
 click('Save Project');await idle();const project=parseProject(vi.mocked(files.writeProject).mock.calls[0][2]);
 vi.mocked(files.readProject).mockResolvedValue({path:'C:\\one.pmarkup',project});vi.mocked(files.resolveSource).mockResolvedValue(source.reference);
 click('Open Project');await idle();expect(screen.getByRole('button',{name:'Undo',exact:true}).hasAttribute('disabled')).toBe(true);expect(screen.getByRole('button',{name:'Redo',exact:true}).hasAttribute('disabled')).toBe(true);
});
it('history shortcuts exclude editable and modal targets, unrelated modifiers, and clear selection only on traversal',async()=>{
 render(<App/>);await openPdf();create();click('Thick');
 for(const html of ['<input>','<textarea></textarea>','<select></select>','<div contenteditable="true"><span>x</span></div>','<div role="dialog"><button>x</button></div>','<dialog><button>x</button></dialog>']){
 const host=document.createElement('div');host.innerHTML=html;document.body.append(host);const target=host.querySelector('span,button,input,textarea,select')!;
 expect(historyKey('z',false,target)).toBe(true);host.remove();
 }
 for(const opts of [{altKey:true},{metaKey:true},{key:'y',shiftKey:true},{key:'x'}])expect(fireEvent.keyDown(window,{key:'z',ctrlKey:true,...opts})).toBe(true);
 expect(screen.getByRole('button',{name:'Thick'}).getAttribute('aria-pressed')).toBe('true');
 expect(historyKey()).toBe(false);expect(screen.getByRole('button',{name:'Medium'}).getAttribute('aria-pressed')).toBe('true');
 expect(historyKey('z',true)).toBe(false);expect(screen.getByRole('button',{name:'Thick'}).getAttribute('aria-pressed')).toBe('true');
});

it.each(['highlight','edit'])('history cancels %s previews with empty and nonempty stacks; late up is harmless',async tool=>{
 const original=await openEditable();if(tool==='highlight')click('Highlight');else selected('one');
 const pointer=editPointer(),svg=screen.getByLabelText('Highlights for page 1');
 let captured=false;const release=vi.fn(()=>{captured=false;});Object.assign(svg,{setPointerCapture:()=>{captured=true;},hasPointerCapture:()=>captured,releasePointerCapture:release});
 pointer('pointerdown',80);pointer('pointermove',110,70);expect(svg.querySelector('[data-draft]')).toBeTruthy();
 historyKey();expect(release).toHaveBeenCalledTimes(1);expect(svg.querySelector('[data-draft]')).toBeNull();pointer('pointerup',110,70);
 click('Save Project');await idle();expect(parseProject(vi.mocked(files.writeProject).mock.calls[0][2]).session).toEqual(original.session);
 if(tool==='highlight')click('Thick');else {selected('one');click('Selected stroke Blue');}
 pointer('pointerdown',80);pointer('pointermove',120,90);click('Undo');historyKey('y');pointer('pointerup',120,90);
 expect(svg.querySelector('[data-draft]')).toBeNull();expect(svg.querySelector('[data-selection-indicator]')).toBeNull();
 click('Save Project');await idle();const saved=parseProject(vi.mocked(files.writeProject).mock.calls[1][2]);expect(saved.session.annotations).toHaveLength(3);expect(saved.session.annotations[0].points).toEqual(original.session.annotations[0].points);
 expect(screen.getByRole('button',{name:tool==='highlight'?'Highlight':'Select/Edit',exact:true}).getAttribute('aria-pressed')).toBe('true');
});
it('failed/cancelled saves preserve redo and dirty close locks history until cancellation',async()=>{
 await openEditable();selected('one');click('Selected stroke Blue');click('Undo');
 vi.mocked(files.writeProject).mockResolvedValueOnce(null);click('Save As');await idle();
 vi.mocked(files.writeProject).mockRejectedValueOnce(new Error('Denied'));click('Save Project');await idle();click('Redo');
 act(()=>native.close!({preventDefault:vi.fn()}));historyKey();click('Cancel');await idle();
 expect(screen.getByLabelText('Highlights for page 1').querySelector('[data-annotation-id="one"]')?.getAttribute('stroke')).toBe('#38bdf8');
 historyKey();expect(status()).toContain('Saved');
});

it('undo creation clears a stale legend rename target and allows a new category',async()=>{
 render(<App/>);await openPdf();create();click('Rename legend Walls');click('Undo');
 expect(screen.queryByRole('button',{name:'Save name'})).toBeNull();
 fireEvent.change(screen.getByLabelText('Legend name'),{target:{value:'Doors'}});click('Create legend');
 expect(screen.getByLabelText('Active legend').textContent).toContain('Doors');
 expect(screen.getByRole('button',{name:'Redo',exact:true}).hasAttribute('disabled')).toBe(true);
});

it('export snapshots committed state while edits/history continue and locks other file operations', async () => {
  render(<App />); await openPdf(); create(); click('Save Project'); await idle(); click('Thick');
  const pendingExport = deferred<string|null>(); vi.mocked(exports.exportPdf).mockReturnValueOnce(pendingExport.promise);
  click('Export Annotated PDF');
  const args = vi.mocked(exports.exportPdf).mock.calls[0];
  expect(args[1]).toContain('one.pmarkup'); expect(args[3].drawing.width).toBe(20);
  click('Undo'); click('Thin'); click('Redo');
  expect(screen.getByRole('button',{name:'Open PDF'}).hasAttribute('disabled')).toBe(true);
  expect(screen.getByRole('button',{name:'Save Project'}).hasAttribute('disabled')).toBe(true);
  act(() => native.close!({preventDefault:vi.fn()})); expect(native.destroy).not.toHaveBeenCalled();
  expect(args[3].drawing.width).toBe(20);
  await act(async () => pendingExport.resolve('C:/marked.pdf')); await idle();
  expect(status()).toContain('Exported marked.pdf'); expect(status()).toContain('one.pmarkup'); expect(status()).toContain('Unsaved changes');
  expect(screen.getByRole('button',{name:'Undo'}).hasAttribute('disabled')).toBe(false);
  click('Undo'); expect(status()).not.toContain('Unsaved changes');
});
it('cancelled/failed exports preserve dirty baseline and unmount aborts a pending export', async () => {
  const view = render(<App />); await openPdf(); click('Thick');
  vi.mocked(exports.exportPdf).mockResolvedValueOnce(null); click('Export Annotated PDF'); await idle();
  expect(screen.queryByRole('alert')).toBeNull(); expect(status()).toContain('Unsaved changes');
  vi.mocked(exports.exportPdf).mockRejectedValueOnce(new Error('Source PDF changed'));
  click('Export Annotated PDF'); await idle(); expect(screen.getByRole('alert').textContent).toContain('Source PDF changed');
  const pendingExport = deferred<string|null>(); vi.mocked(exports.exportPdf).mockReturnValueOnce(pendingExport.promise);
  click('Export Annotated PDF'); const signal = vi.mocked(exports.exportPdf).mock.calls[2][4]; view.unmount(); expect(signal.aborted).toBe(true);
  await act(async () => pendingExport.resolve('C:/late.pdf'));
});
