import './App.css';
import { useEffect, useRef, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import PdfNavigationView from './components/PdfViewer/PdfNavigationView';
import { emptySession, sessionReducer, type AnnotationSession, type SessionAction } from './services/annotationSession';
import { sameSource, serializeProject, type SourceIdentity } from './services/projectFormat';
import { choosePdf, loadSource, readProject, resolveSource, writeProject } from './services/projectService';
import type { PDFPageProxy } from 'pdfjs-dist';

type Work = { id: number; sourcePath: string; projectPath: string | null; source: SourceIdentity;
  pages: PDFPageProxy[]; session: AnnotationSession; saved: string; controller: AbortController };
type Choice = 'save' | 'discard' | 'cancel';
function DirtyDialog({ answer }: { answer: (choice: Choice) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} aria-labelledby="dirty-title" onCancel={event => { event.preventDefault(); answer('cancel'); }}>
    <h2 id="dirty-title">Save changes to this project?</h2>
    <p>Unsaved changes will be lost if you discard them.</p>
    <div className="project-actions"><button onClick={() => answer('save')}>Save changes</button>
      <button onClick={() => answer('discard')}>Discard changes</button>
      <button autoFocus onClick={() => answer('cancel')}>Cancel</button></div>
  </dialog>;
}
export default function App() {
  const [work, setWork] = useState<Work | null>(null);
  const live = useRef<Work | null>(null), counter = useRef(0), locked = useRef(false), alive = useRef(true);
  const staging = useRef<AbortController | null>(null);
  const replacing = useRef(false);
  const [operation, setOperation] = useState<'opening' | 'saving' | 'closing' | null>(null);
  const [error, setError] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null);
  const [question, setQuestion] = useState(false);
  const pending = useRef<((choice: Choice) => void) | null>(null);
  const dirty = (value: Work | null) => !!value && JSON.stringify(value.session) !== value.saved;
  function publish(value: Work) { live.current = value; setWork(value); }
  function mutate(action: SessionAction) {
    const current = live.current;
    if (!current || replacing.current) return;
    publish({ ...current, session: sessionReducer(current.session, action) });
  }
  function answer(choice: Choice) { setQuestion(false); pending.current?.(choice); pending.current = null; }
  async function saveCurrent(as = false): Promise<boolean> {
    const snapshot = live.current;
    if (!snapshot) return false;
    const serialized = serializeProject(snapshot.source, snapshot.session);
    const saved = JSON.stringify(snapshot.session);
    const path = await writeProject(as ? null : snapshot.projectPath, snapshot.sourcePath, serialized);
    if (!path || !alive.current || live.current?.id !== snapshot.id) return false;
    publish({ ...live.current, projectPath: path, saved });
    return !dirty(live.current);
  }
  async function guard() {
    if (!dirty(live.current)) return true;
    setQuestion(true);
    const choice = await new Promise<Choice>(resolve => { pending.current = resolve; });
    if (choice === 'cancel') return false;
    return choice === 'discard' || await saveCurrent();
  }
  async function run(kind: 'opening' | 'saving' | 'closing', task: () => Promise<void>) {
    if (locked.current) return;
    locked.current = true; replacing.current = kind !== 'saving'; setOperation(kind); setError(null); setNotice(null);
    try { await task(); }
    catch (err) { if (alive.current) setError(`${err instanceof Error ? err.message : String(err)} Please retry or choose another file.`); }
    finally { locked.current = false; replacing.current = false; if (alive.current) { setOperation(null); setNotice(null); } }
  }
  async function openWork(projectMode: boolean) {
    await run('opening', async () => {
      if (!await guard() || !alive.current) return;
      const selected = projectMode ? await readProject() : null;
      if (projectMode && !selected) return;
      let path = selected ? await resolveSource(selected.path, selected.project.source.reference) : await choosePdf();
      if (selected && !path) {
        setNotice(`Locate PDF: ${selected.project.source.filename}. The selected file must match the saved SHA-256 identity.`);
        path = await choosePdf(`Locate PDF — ${selected.project.source.filename}`);
      }
      if (!path || !alive.current) return;
      const controller = new AbortController(); staging.current = controller;
      try {
        const loaded = await loadSource(path, controller.signal);
        if (selected && !sameSource(selected.project.source, loaded.source)) throw new Error('PDF identity mismatch. Locate the original, unchanged PDF');
        if (!alive.current || controller.signal.aborted) return;
        const session = selected?.project.session ?? structuredClone(emptySession);
        const previous = live.current;
        publish({ id: ++counter.current, sourcePath: path, projectPath: selected?.path ?? null,
          ...loaded, session, saved: JSON.stringify(session), controller });
        staging.current = null;
        previous?.controller.abort();
      } finally { if (staging.current === controller) { controller.abort(); staging.current = null; } }
    });
  }
  const close = useRef<() => void>(() => {});
  close.current = () => { void run('closing', async () => {
    if (await guard() && alive.current) await getCurrentWindow().destroy();
  }); };
  useEffect(() => {
    alive.current = true;
    let disposed = false, unlisten: (() => void) | undefined;
    if (isTauri()) void getCurrentWindow().onCloseRequested(event => {
      event.preventDefault(); close.current();
    }).then(fn => { if (disposed) fn(); else unlisten = fn; }).catch(err => setError(`Could not install close protection: ${String(err)}`));
    const beforeUnload = (event: BeforeUnloadEvent) => { if (dirty(live.current)) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', beforeUnload);
    return () => { disposed = true; alive.current = false; unlisten?.(); window.removeEventListener('beforeunload', beforeUnload);
      staging.current?.abort(); live.current?.controller.abort(); pending.current?.('cancel'); pending.current = null; };
  }, []);
  return <main className="app-shell">
    <header className="app-header"><h1>PDF Floor Plan Markup</h1>
      <div className="project-actions" role="toolbar" aria-label="Project files">
        <button disabled={!!operation} onClick={() => void openWork(false)}>Open PDF</button>
        <button disabled={!!operation} onClick={() => void openWork(true)}>Open Project</button>
        <button disabled={!work || !!operation} onClick={() => void run('saving', async () => { await saveCurrent(); })}>Save Project</button>
        <button disabled={!work || !!operation} onClick={() => void run('saving', async () => { await saveCurrent(true); })}>Save As</button>
      </div></header>
    <p className="document-name" role="status">{work ? `${work.projectPath?.split(/[\\/]/).pop() ?? 'Unsaved project'} · PDF: ${work.source.filename} · ${dirty(work) ? 'Unsaved changes' : work.projectPath ? 'Saved' : 'Ready to save'}` : 'Open a PDF or an editable project.'}{operation && ` · ${operation === 'saving' ? 'Saving…' : operation === 'opening' ? 'Opening…' : 'Closing…'}`}</p>
    {error && <p role="alert" className="project-error">{error}</p>}
    {notice && <p role="status" className="project-error">{notice}</p>}
    <div className="project-workspace" inert={operation === 'opening' || operation === 'closing'}>
      {work ? <PdfNavigationView key={work.id} pages={work.pages} session={work.session} onAction={mutate} disabled={operation === 'opening' || operation === 'closing'} /> : <p className="empty-document">No PDF selected.</p>}
    </div>
    {question && <DirtyDialog answer={answer} />}
  </main>;
}
