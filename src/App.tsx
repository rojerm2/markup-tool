import ToolIcon from './components/Toolbar/ToolIcon';
import './App.css';
import { readLargerControls, writeLargerControls, readTheme, writeTheme, readSoundsEnabled, writeSoundsEnabled, readSoundVolume, writeSoundVolume, type Theme } from './services/uiPreferences';
import { configureActionSounds, listenForControlSounds, playActionSound } from './services/actionSounds';
import { useEffect, useRef, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import PdfNavigationView from './components/PdfViewer/PdfNavigationView';
import { emptySession, type AnnotationSession, type SessionAction } from './services/annotationSession';
import { sameSource, serializeProject, type SourceIdentity } from './services/projectFormat';
import { choosePdf, loadSource, readProject, resolveSource, writeProject } from './services/projectService';
import { exportPdf } from './services/exportService';
import { SessionHistory } from './services/sessionHistory';
import type { PDFPageProxy } from 'pdfjs-dist';
import { listRecentFiles, rememberRecentFile, authorizeRecentFile, clearRecentFiles, type RecentFile } from './services/recentFiles';
import RecentFilesMenu from './components/Toolbar/RecentFilesMenu';

type Work = { id: number; sourcePath: string; projectPath: string | null; source: SourceIdentity;
  pages: PDFPageProxy[]; history: SessionHistory; session: AnnotationSession; saved: string; controller: AbortController };
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
  const [largerControls, setLargerControls] = useState(readLargerControls);
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [sounds, setSounds] = useState(readSoundsEnabled);
  const [volume, setVolume] = useState(readSoundVolume);
  const [recentFiles, setRecentFiles] = useState<RecentFile[]>([]);
  const appRoot = useRef<HTMLElement>(null);
  const preferences = useRef<HTMLDetailsElement>(null);
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => { configureActionSounds(sounds, volume); }, [sounds, volume]);
  useEffect(() => {
    let current = true;
    void listRecentFiles().then(files => { if (current) setRecentFiles(files); }).catch(err => console.warn('Recent files unavailable', err));
    return () => { current = false; };
  }, []);
  useEffect(() => { if (appRoot.current) return listenForControlSounds(appRoot.current); }, []);
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !preferences.current?.contains(event.target) && preferences.current) preferences.current.open = false; };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && preferences.current?.open) { preferences.current.open = false; if (event.target instanceof Node && preferences.current.contains(event.target)) preferences.current.querySelector('summary')?.focus(); } };
    window.addEventListener('pointerdown', outside); window.addEventListener('keydown', escape);
    return () => { window.removeEventListener('pointerdown', outside); window.removeEventListener('keydown', escape); };
  }, []);
  const [work, setWork] = useState<Work | null>(null);
  const live = useRef<Work | null>(null), counter = useRef(0), locked = useRef(false), alive = useRef(true);
  const staging = useRef<AbortController | null>(null);
  const replacing = useRef(false);
  const [operation, setOperation] = useState<'opening' | 'saving' | 'exporting' | 'closing' | null>(null);
  const [error, setError] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null);
  const [exportProgress, setExportProgress] = useState('Exporting…');
  const [question, setQuestion] = useState(false);
  const pending = useRef<((choice: Choice) => void) | null>(null);
  const dirty = (value: Work | null) => !!value && JSON.stringify(value.session) !== value.saved;
  function publish(value: Work) { live.current = value; setWork(value); }
  async function remember(path: string) {
    try { const files = await rememberRecentFile(path); if (alive.current) setRecentFiles(files); }
    catch (err) { if (alive.current) setError(`File opened or saved, but the recent files list could not be updated: ${String(err)}`); }
  }
  function mutate(action: SessionAction, generation: number | undefined, workId: number) {
    const current = live.current;
    if (!current || current.id !== workId || replacing.current) return;
    if (current.history.apply(action, generation)) publish({ ...current, session: current.history.present });
  }
  function traverse(direction: 'undo' | 'redo') {
    const current = live.current;
    if (!current || replacing.current) return false;
    const changed = current.history.traverse(direction);
    if (changed) publish({ ...current, session: current.history.present });
    return changed;
  }
  function answer(choice: Choice) { setQuestion(false); pending.current?.(choice); pending.current = null; }
  async function saveCurrent(as = false): Promise<boolean> {
    const snapshot = live.current;
    if (!snapshot) return false;
    snapshot.history.cancelSnapshotDrafts();
    const serialized = serializeProject(snapshot.source, snapshot.session);
    const saved = JSON.stringify(snapshot.session);
    const path = await writeProject(as ? null : snapshot.projectPath, snapshot.sourcePath, serialized);
    if (!path || !alive.current || live.current?.id !== snapshot.id) return false;
    publish({ ...live.current, projectPath: path, saved });
    await remember(path);
    playActionSound('success');
    return !dirty(live.current);
  }
  async function guard() {
    if (!dirty(live.current)) return true;
    setQuestion(true);
    const choice = await new Promise<Choice>(resolve => { pending.current = resolve; });
    if (choice === 'cancel') return false;
    return choice === 'discard' || await saveCurrent();
  }
  async function run(kind: 'opening' | 'saving' | 'exporting' | 'closing', task: () => Promise<void>) {
    if (locked.current) return;
    locked.current = true; replacing.current = kind === 'opening' || kind === 'closing';
    if (replacing.current) live.current?.history.invalidate();
    setOperation(kind); setError(null); setNotice(null);
    try { await task(); }
    catch (err) { if (alive.current) { playActionSound('error'); setError(`${err instanceof Error ? err.message : String(err)} Please retry or choose another file.`); } }
    finally { locked.current = false; replacing.current = false; if (alive.current) { setOperation(null); if (kind !== 'exporting') setNotice(null); } }
  }
  async function exportCurrent() {
    await run('exporting', async () => {
      const snapshot = live.current;
      if (!snapshot) return;
      snapshot.history.invalidate();
      setExportProgress('Choosing destination…');
      const path = await exportPdf(snapshot.sourcePath, snapshot.projectPath, snapshot.source,
        snapshot.session, snapshot.controller.signal, setExportProgress);
      if (path && alive.current && live.current?.id === snapshot.id) {
        setNotice(`Exported ${path.split(/[\\/]/).pop()}. Editable project unchanged.`);
        playActionSound('success');
      }
    });
  }
  async function openWork(projectMode: boolean, recent?: RecentFile) {
    await run('opening', async () => {
      if (!await guard() || !alive.current) return;
      if (recent) await authorizeRecentFile(recent.path);
      const selected = projectMode ? await readProject(recent?.path) : null;
      if (projectMode && !selected) return;
      let path = selected ? await resolveSource(selected.path, selected.project.source.reference) : recent?.path ?? await choosePdf();
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
          ...loaded, source: { ...loaded.source, filename: selected?.project.source.filename ?? loaded.source.filename },
          session, history: new SessionHistory(session), saved: JSON.stringify(session), controller });
        staging.current = null;
        playActionSound('success');
        previous?.controller.abort();
        await remember(selected?.path ?? path);
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
  return <main ref={appRoot} className={`app-shell${largerControls ? ' larger-controls' : ''}`}>
    <header className="app-header"><h1><span className="app-mark"><ToolIcon name="file" /></span> PDF Markup</h1>
      <div className="project-actions" role="toolbar" aria-label="Project files">
        <button disabled={!!operation} onClick={() => void openWork(false)}>Open PDF</button>
        <button disabled={!!operation} onClick={() => void openWork(true)}>Open Project</button>
        <RecentFilesMenu files={recentFiles} disabled={!!operation} onOpen={file => void openWork(file.kind === 'project', file)} onClear={() => void run('saving', async () => { await clearRecentFiles(); if (alive.current) setRecentFiles([]); })} />
        <button className="save-action" title="Save the PDF and editable annotations together in one project" disabled={!work || !!operation} onClick={() => void run('saving', async () => { await saveCurrent(); })}>Save Project</button>
        <button disabled={!work || !!operation} onClick={() => void run('saving', async () => { await saveCurrent(true); })}>Save As</button>
        <button className="primary-action" disabled={!work || !!operation} onClick={() => void exportCurrent()}>Export Annotated PDF</button>
      </div><details ref={preferences} className="ui-preferences"><summary>Preferences</summary><div className="preferences-popover">
        <label><input type="checkbox" checked={theme === 'dark'} onChange={e => { const value = e.target.checked ? 'dark' : 'light'; setTheme(value); writeTheme(value); }} />Dark mode</label>
        <label><input type="checkbox" checked={largerControls} onChange={e => { setLargerControls(e.target.checked); writeLargerControls(e.target.checked); }} />Larger controls</label>
        <label><input type="checkbox" checked={sounds} onChange={e => { setSounds(e.target.checked); writeSoundsEnabled(e.target.checked); configureActionSounds(e.target.checked, volume); }} />Action sounds</label>
        <div className="sound-volume"><label htmlFor="sound-volume">Volume <output>{volume}%</output></label>
          <input id="sound-volume" type="range" min="0" max="100" step="1" value={volume} disabled={!sounds} onChange={e => { const value = Number(e.target.value); setVolume(value); writeSoundVolume(value); configureActionSounds(sounds, value); }} />
          <button disabled={!sounds || volume === 0} data-own-feedback onClick={() => playActionSound('success')}>Test sound</button>
        </div>
      </div></details></header>
    <p className="document-name" role="status">{work ? `${work.projectPath?.split(/[\\/]/).pop() ?? 'Unsaved project'} · PDF: ${work.source.filename} · ${dirty(work) ? 'Unsaved changes' : work.projectPath ? 'Saved' : 'Ready to save'}` : 'Open a PDF or an editable project.'}{operation && ` · ${operation === 'exporting' ? exportProgress : operation === 'saving' ? 'Saving…' : operation === 'opening' ? 'Opening…' : 'Closing…'}`}{!operation && notice && ` | ${notice}`}</p>
    {work && <div className="document-location" aria-label="Current file"><strong>{work.projectPath?.split(/[\\/]/).pop() ?? work.source.filename}</strong><span title={work.projectPath ?? work.sourcePath}>{work.projectPath ?? work.sourcePath}</span></div>}
    {error && <p role="alert" className="project-error">{error}</p>}
    {operation && notice && <p role="status" className="document-name">{notice}</p>}
    <div className="project-workspace" inert={operation === 'opening' || operation === 'closing'}>
      {work ? <PdfNavigationView largerControls={largerControls} key={work.id} pages={work.pages} session={work.session} history={work.history} onHistory={traverse} onAction={(action, generation) => mutate(action, generation, work.id)} disabled={operation === 'opening' || operation === 'closing'} /> : <section className="empty-document"><span className="empty-icon"><ToolIcon name="file" /></span><h2>A clear space for your ideas.</h2><p>Highlight, draw, and add notes to your PDF.<br />Save your PDF and edits together in one project.</p><button className="primary-action" disabled={!!operation} onClick={() => void openWork(false)}>Open a PDF to get started</button><p className="empty-tip">Already started? Use Open Project to pick up where you left off.</p></section>}
    </div>
    {question && <DirtyDialog answer={answer} />}
  </main>;
}
