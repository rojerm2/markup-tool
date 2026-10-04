import AppContextMenu, {
  useAppContextMenu,
  type MenuItem,
} from "./components/Toolbar/AppContextMenu";
import FileFeedback, {
  type FileResult,
} from "./components/Toolbar/FileFeedback";
import { listen } from "@tauri-apps/api/event";
import ToolIcon from "./components/Toolbar/ToolIcon";
import "./App.css";
import {
  readLargerControls,
  writeLargerControls,
  readTheme,
  writeTheme,
  readSoundsEnabled,
  writeSoundsEnabled,
  readSoundVolume,
  writeSoundVolume,
  type Theme,
} from "./services/uiPreferences";
import {
  configureActionSounds,
  listenForControlSounds,
  playActionSound,
} from "./services/actionSounds";
import { useEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import PdfNavigationView from "./components/PdfViewer/PdfNavigationView";
import {
  emptySession,
  type AnnotationSession,
  type SessionAction,
} from "./services/annotationSession";
import {
  sameSource,
  serializeProject,
  type SourceIdentity,
} from "./services/projectFormat";
import {
  choosePdf,
  loadSource,
  readProject,
  resolveSource,
  writeProject,
} from "./services/projectService";
import { exportPdf, printPdf } from "./services/exportService";
import { SessionHistory } from "./services/sessionHistory";
import type { PDFPageProxy } from "pdfjs-dist";
import {
  listRecentFiles,
  rememberRecentFile,
  authorizeRecentFile,
  clearRecentFiles,
  type RecentFile,
} from "./services/recentFiles";
import RecentFilesMenu from "./components/Toolbar/RecentFilesMenu";
import RecoveryPanel from "./components/Toolbar/RecoveryPanel";
import {
  defaultNavigation,
  navigationKey,
  parseNavigation,
  readNavigation,
  writeNavigation,
  type DocumentNavigation,
} from "./services/documentNavigation";
import {
  RecoveryJournal,
  listRecovery,
  readRecovery,
  deleteRecovery,
  type RecoveryEntry,
  type RecoveryState,
} from "./services/recoveryService";

type Work = {
  id: number;
  sourcePath: string;
  projectPath: string | null;
  source: SourceIdentity;
  pages: PDFPageProxy[];
  history: SessionHistory;
  session: AnnotationSession;
  saved: string;
  navigation: DocumentNavigation;
  savedBookmarks: string;
  controller: AbortController;
  recovery: RecoveryJournal;
};
type Choice = "save" | "discard" | "cancel";

function DirtyDialog({ answer }: { answer: (choice: Choice) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby="dirty-title"
      onCancel={(event) => {
        event.preventDefault();
        answer("cancel");
      }}
    >
      <h2 id="dirty-title">Save changes to this project?</h2>
      <p>Unsaved changes will be lost if you discard them.</p>
      <div className="project-actions">
        <button onClick={() => answer("save")}>Save changes</button>
        <button onClick={() => answer("discard")}>Discard changes</button>
        <button autoFocus onClick={() => answer("cancel")}>
          Cancel
        </button>
      </div>
    </dialog>
  );
}

export default function App() {
  return (
    <AppContextMenu>
      <AppContent />
    </AppContextMenu>
  );
}

function AppContent() {
  const openMenu = useAppContextMenu();
  const [fileResult, setFileResult] = useState<FileResult | null>(null);
  const fileResultId = useRef(0);
  const [largerControls, setLargerControls] = useState(readLargerControls);
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [sounds, setSounds] = useState(readSoundsEnabled);
  const [volume, setVolume] = useState(readSoundVolume);
  const [recentFiles, setRecentFiles] = useState<RecentFile[]>([]);
  const [recoveries, setRecoveries] = useState<RecoveryEntry[]>([]);
  const [recoveryStatus, setRecoveryStatus] = useState<RecoveryState>("idle");
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const appRoot = useRef<HTMLElement>(null);
  const preferences = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  useEffect(() => {
    configureActionSounds(sounds, volume);
  }, [sounds, volume]);
  useEffect(() => {
    let current = true;
    void listRecentFiles()
      .then((files) => {
        if (current) setRecentFiles(files);
      })
      .catch((err) => console.warn("Recent files unavailable", err));
    return () => {
      current = false;
    };
  }, []);
  useEffect(() => {
    if (appRoot.current) return listenForControlSounds(appRoot.current);
  }, []);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !preferences.current?.contains(event.target) &&
        preferences.current
      )
        preferences.current.open = false;
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && preferences.current?.open) {
        preferences.current.open = false;
        if (
          event.target instanceof Node &&
          preferences.current.contains(event.target)
        )
          preferences.current.querySelector("summary")?.focus();
      }
    };
    window.addEventListener("pointerdown", outside);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("pointerdown", outside);
      window.removeEventListener("keydown", escape);
    };
  }, []);
  const [work, setWork] = useState<Work | null>(null);
  const live = useRef<Work | null>(null),
    counter = useRef(0),
    locked = useRef(false),
    alive = useRef(true);
  const staging = useRef<AbortController | null>(null);
  const replacing = useRef(false);
  const [operation, setOperation] = useState<
    "opening" | "saving" | "exporting" | "printing" | "closing" | null
  >(null);
  const [error, setError] = useState<string | null>(null),
    [notice, setNotice] = useState<string | null>(null);
  const [exportProgress, setExportProgress] = useState("Exporting…");
  const [question, setQuestion] = useState(false);
  const pending = useRef<((choice: Choice) => void) | null>(null);
  const sessionKeys = useRef<{
    session: AnnotationSession;
    key: string;
  } | null>(null);

  function sessionKey(session: AnnotationSession) {
    if (sessionKeys.current?.session !== session) {
      sessionKeys.current = { session, key: JSON.stringify(session) };
    }
    return sessionKeys.current.key;
  }
  const dirty = (value: Work | null) =>
    !!value &&
    (sessionKey(value.session) !== value.saved ||
      JSON.stringify(value.navigation.bookmarks) !== value.savedBookmarks);

  useEffect(() => {
    let current = true;
    void listRecovery()
      .then((entries) => {
        if (current) setRecoveries(entries);
      })
      .catch((error) => {
        if (current)
          setRecoveryError(`Recovery list unavailable: ${String(error)}`);
      });
    return () => {
      current = false;
    };
  }, []);

  useEffect(() => {
    if (!work) return;
    if (dirty(work)) work.recovery.schedule(work);
    else void work.recovery.clear();
  }, [
    work?.id,
    work?.session,
    work?.navigation.bookmarks,
    work?.saved,
    work?.savedBookmarks,
    work?.projectPath,
  ]);

  function journal(workId: number, recoveryId: string | null = null) {
    return new RecoveryJournal(recoveryId, (state, error) => {
      if (alive.current && live.current?.id === workId) {
        setRecoveryStatus(state);
        setRecoveryError(error ?? null);
      }
    });
  }

  function publish(value: Work) {
    live.current = value;
    setWork(value);
  }

  function updateNavigation(value: DocumentNavigation, workId: number) {
    const current = live.current;
    if (!current || current.id !== workId || !alive.current) return;
    const navigation = parseNavigation(value, current.pages.length);
    const sameBookmarks =
      JSON.stringify(navigation.bookmarks) ===
      JSON.stringify(current.navigation.bookmarks);
    if (replacing.current && !sameBookmarks) return;
    if (sameBookmarks) navigation.bookmarks = current.navigation.bookmarks;
    if (JSON.stringify(navigation) === JSON.stringify(current.navigation))
      return;
    current.recovery.amendNavigation(navigation);
    writeNavigation(
      navigationKey(current.source.sha256, current.projectPath),
      { bookmarks: [], view: navigation.view },
      current.pages.length,
    );
    publish({ ...current, navigation });
  }

  async function remember(path: string) {
    try {
      const files = await rememberRecentFile(path);
      if (alive.current) setRecentFiles(files);
    } catch (err) {
      if (alive.current)
        setError(
          `File opened or saved, but the recent files list could not be updated: ${String(err)}`,
        );
    }
  }

  function mutate(
    action: SessionAction,
    generation: number | undefined,
    workId: number,
  ) {
    const current = live.current;
    if (!current || current.id !== workId || replacing.current) return;
    if (current.history.apply(action, generation))
      publish({ ...current, session: current.history.present });
  }

  function traverse(direction: "undo" | "redo") {
    const current = live.current;
    if (!current || replacing.current) return false;
    const changed = current.history.traverse(direction);
    if (changed) publish({ ...current, session: current.history.present });
    return changed;
  }

  function answer(choice: Choice) {
    setQuestion(false);
    pending.current?.(choice);
    pending.current = null;
  }

  async function saveCurrent(as = false): Promise<boolean> {
    live.current?.history.cancelSnapshotDrafts();
    const snapshot = live.current;
    if (!snapshot) return false;
    const serialized = serializeProject(
      snapshot.source,
      snapshot.session,
      snapshot.navigation,
    );
    const saved = sessionKey(snapshot.session);
    const savedBookmarks = JSON.stringify(snapshot.navigation.bookmarks);
    const path = await writeProject(
      as ? null : snapshot.projectPath,
      snapshot.sourcePath,
      serialized,
    );
    if (!path || !alive.current || live.current?.id !== snapshot.id)
      return false;
    publish({ ...live.current, projectPath: path, saved, savedBookmarks });
    writeNavigation(
      navigationKey(snapshot.source.sha256, path),
      { bookmarks: [], view: live.current!.navigation.view },
      snapshot.pages.length,
    );
    if (!dirty(live.current)) await snapshot.recovery.clear();
    await remember(path);
    setFileResult({ id: ++fileResultId.current, kind: "save", path });
    playActionSound("success");
    return !dirty(live.current);
  }

  async function guard() {
    live.current?.history.cancelSnapshotDrafts();
    if (!dirty(live.current)) {
      await live.current?.recovery.clear();
      return true;
    }
    setQuestion(true);
    const choice = await new Promise<Choice>((resolve) => {
      pending.current = resolve;
    });
    if (choice === "cancel") return false;
    if (choice === "discard") {
      await live.current?.recovery.clear();
      return true;
    }
    return await saveCurrent();
  }

  async function run(
    kind: "opening" | "saving" | "exporting" | "printing" | "closing",
    task: () => Promise<void>,
  ) {
    if (locked.current) return;
    locked.current = true;
    replacing.current = kind === "opening" || kind === "closing";
    if (replacing.current) live.current?.history.invalidate();
    setOperation(kind);
    setError(null);
    setNotice(null);
    setFileResult(null);
    try {
      await task();
    } catch (err) {
      if (alive.current) {
        playActionSound("error");
        setError(
          `${err instanceof Error ? err.message : String(err)} Please retry or choose another file.`,
        );
      }
    } finally {
      locked.current = false;
      replacing.current = false;
      if (alive.current) {
        setOperation(null);
        if (kind === "opening" && live.current && dirty(live.current))
          live.current.recovery.schedule(live.current);
        if (kind !== "exporting" && kind !== "printing") setNotice(null);
      }
    }
  }

  async function exportCurrent() {
    await run("exporting", async () => {
      const snapshot = live.current;
      if (!snapshot) return;
      snapshot.history.invalidate();
      setExportProgress("Choosing destination…");
      const path = await exportPdf(
        snapshot.sourcePath,
        snapshot.projectPath,
        snapshot.source,
        snapshot.session,
        snapshot.controller.signal,
        setExportProgress,
      );
      if (path && alive.current && live.current?.id === snapshot.id) {
        setFileResult({ id: ++fileResultId.current, kind: "export", path });
        setNotice(
          `Exported ${path.split(/[\\/]/).pop()}. Editable project unchanged.`,
        );
        playActionSound("success");
      }
    });
  }

  async function printCurrent() {
    await run("printing", async () => {
      const snapshot = live.current;
      if (!snapshot) return;
      snapshot.history.cancelSnapshotDrafts();
      setExportProgress("Preparing print…");
      await printPdf(
        snapshot.sourcePath,
        snapshot.source,
        snapshot.session,
        snapshot.controller.signal,
        setExportProgress,
      );
      if (alive.current)
        setNotice(
          "Print preview ready. Click its printer icon; choose “Print using system dialog” if print settings appear.",
        );
    });
  }
  const shortcuts = useRef<(e: KeyboardEvent) => void>(() => {});
  shortcuts.current = (e) => {
    if ((e.ctrlKey || e.metaKey) && ["p", "s"].includes(e.key.toLowerCase())) {
      e.preventDefault();
      if (!locked.current && live.current) {
        if (e.key.toLowerCase() === "p") void printCurrent();
        else
          void run("saving", async () => {
            await saveCurrent(e.shiftKey);
          });
      }
    }
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => shortcuts.current(e);
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let stop: (() => void) | undefined;
    void listen<string>("print-error", (e) => setError(e.payload))
      .then((fn) => {
        if (disposed) fn();
        else stop = fn;
      })
      .catch((err) => console.warn("Print feedback unavailable", err));
    return () => {
      disposed = true;
      stop?.();
    };
  }, []);

  async function openWork(projectMode: boolean, recent?: RecentFile) {
    await run("opening", async () => {
      if (!(await guard()) || !alive.current) return;
      if (recent) await authorizeRecentFile(recent.path);
      const selected = projectMode ? await readProject(recent?.path) : null;
      if (projectMode && !selected) return;
      let path = selected
        ? await resolveSource(selected.path, selected.project.source.reference)
        : (recent?.path ?? (await choosePdf()));
      if (selected && !path) {
        setNotice(
          `Locate PDF: ${selected.project.source.filename}. The selected file must match the saved SHA-256 identity.`,
        );
        path = await choosePdf(
          `Locate PDF — ${selected.project.source.filename}`,
        );
      }
      if (!path || !alive.current) return;
      const controller = new AbortController();
      staging.current = controller;
      try {
        const loaded = await loadSource(path, controller.signal);
        if (selected && !sameSource(selected.project.source, loaded.source))
          throw new Error(
            "PDF identity mismatch. Locate the original, unchanged PDF",
          );
        if (!alive.current || controller.signal.aborted) return;
        const session =
          selected?.project.session ?? structuredClone(emptySession);
        const navigation = selected?.project.navigation ?? defaultNavigation();
        const lastView = readNavigation(
          navigationKey(loaded.source.sha256, selected?.path ?? null),
          loaded.pages.length,
        );
        const restoredNavigation = {
          ...navigation,
          view: lastView?.view ?? navigation.view,
        };
        const previous = live.current;
        const workId = ++counter.current;
        publish({
          id: workId,
          sourcePath: path,
          projectPath: selected?.path ?? null,
          ...loaded,
          source: {
            ...loaded.source,
            filename:
              selected?.project.source.filename ?? loaded.source.filename,
          },
          session,
          history: new SessionHistory(session),
          saved: sessionKey(session),
          navigation: restoredNavigation,
          savedBookmarks: JSON.stringify(restoredNavigation.bookmarks),
          controller,
          recovery: journal(workId),
        });
        setRecoveryStatus("idle");
        setRecoveryError(null);
        previous?.recovery.dispose();
        staging.current = null;
        playActionSound("success");
        previous?.controller.abort();
        await remember(selected?.path ?? path);
      } finally {
        if (staging.current === controller) {
          controller.abort();
          staging.current = null;
        }
      }
    });
  }

  async function recoverWork(entry: RecoveryEntry) {
    await run("opening", async () => {
      if (!(await guard()) || !alive.current) return;
      const restored = await readRecovery(entry.id);
      const controller = new AbortController();
      staging.current = controller;
      try {
        const loaded = await loadSource(restored.sourcePath, controller.signal);
        if (!sameSource(restored.project.source, loaded.source))
          throw new Error("Recovery source identity mismatch");
        if (!alive.current || controller.signal.aborted) return;
        const previous = live.current;
        const workId = ++counter.current;
        const session = restored.project.session;
        publish({
          id: workId,
          sourcePath: restored.sourcePath,
          projectPath: null,
          ...loaded,
          source: {
            ...loaded.source,
            filename: restored.project.source.filename,
          },
          history: new SessionHistory(session),
          session,
          saved: "",
          navigation: restored.project.navigation ?? defaultNavigation(),
          savedBookmarks: "",
          controller,
          recovery: journal(workId, entry.id),
        });
        staging.current = null;
        setRecoveryStatus("protected");
        setRecoveryError(null);
        setRecoveries((entries) => entries.filter((v) => v.id !== entry.id));
        previous?.recovery.dispose();
        previous?.controller.abort();
        playActionSound("success");
      } finally {
        if (staging.current === controller) {
          controller.abort();
          staging.current = null;
        }
      }
    });
  }
  const close = useRef<() => void>(() => {});
  close.current = () => {
    void run("closing", async () => {
      if ((await guard()) && alive.current) await getCurrentWindow().destroy();
    });
  };
  useEffect(() => {
    alive.current = true;
    let disposed = false,
      unlisten: (() => void) | undefined;
    if (isTauri())
      void getCurrentWindow()
        .onCloseRequested((event) => {
          event.preventDefault();
          close.current();
        })
        .then((fn) => {
          if (disposed) fn();
          else unlisten = fn;
        })
        .catch((err) =>
          setError(`Could not install close protection: ${String(err)}`),
        );
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (dirty(live.current)) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      disposed = true;
      alive.current = false;
      unlisten?.();
      window.removeEventListener("beforeunload", beforeUnload);
      staging.current?.abort();
      live.current?.controller.abort();
      live.current?.recovery.dispose();
      pending.current?.("cancel");
      pending.current = null;
    };
  }, []);
  const fileActions: MenuItem[] = [
    {
      label: "Open PDF",
      disabled: !!operation,
      action: () => void openWork(false),
    },
    {
      label: "Open project",
      disabled: !!operation,
      action: () => void openWork(true),
    },
    {
      label: "Save project · Ctrl+S",
      disabled: !work || !!operation,
      action: () =>
        void run("saving", async () => {
          await saveCurrent();
        }),
    },
    {
      label: "Export annotated PDF",
      disabled: !work || !!operation,
      action: () => void exportCurrent(),
    },
    {
      label: "Print annotated PDF · Ctrl+P",
      disabled: !work || !!operation,
      action: () => void printCurrent(),
    },
  ];
  return (
    <main
      onContextMenu={(e) => openMenu(e, fileActions)}
      ref={appRoot}
      className={`app-shell${largerControls ? " larger-controls" : ""}`}
    >
      <header className="app-header">
        <h1>
          <span className="app-mark">
            <ToolIcon name="file" />
          </span>{" "}
          PDF Markup
        </h1>
        <div
          className="project-actions"
          role="toolbar"
          aria-label="Project files"
        >
          <button disabled={!!operation} onClick={() => void openWork(false)}>
            Open PDF
          </button>
          <button disabled={!!operation} onClick={() => void openWork(true)}>
            Open Project
          </button>
          <RecentFilesMenu
            files={recentFiles}
            disabled={!!operation}
            onOpen={(file) => void openWork(file.kind === "project", file)}
            onClear={() =>
              void run("saving", async () => {
                await clearRecentFiles();
                if (alive.current) setRecentFiles([]);
              })
            }
          />
          <button
            className="save-action"
            title="Save the PDF and editable annotations together in one project"
            disabled={!work || !!operation}
            onClick={() =>
              void run("saving", async () => {
                await saveCurrent();
              })
            }
          >
            Save Project
          </button>
          <button
            disabled={!work || !!operation}
            onClick={() =>
              void run("saving", async () => {
                await saveCurrent(true);
              })
            }
          >
            Save As
          </button>
          <button
            className="primary-action"
            disabled={!work || !!operation}
            onClick={() => void exportCurrent()}
          >
            Export Annotated PDF
          </button>
          <button
            disabled={!work || !!operation}
            title="Prepare an annotated print preview, then use its printer icon (Ctrl+P)"
            onClick={() => void printCurrent()}
          >
            Print
          </button>
        </div>
        <details ref={preferences} className="ui-preferences">
          <summary>Preferences</summary>
          <div className="preferences-popover">
            <label>
              <input
                type="checkbox"
                checked={theme === "dark"}
                onChange={(e) => {
                  const value = e.target.checked ? "dark" : "light";
                  setTheme(value);
                  writeTheme(value);
                }}
              />
              Dark mode
            </label>
            <label>
              <input
                type="checkbox"
                checked={largerControls}
                onChange={(e) => {
                  setLargerControls(e.target.checked);
                  writeLargerControls(e.target.checked);
                }}
              />
              Larger controls
            </label>
            <label>
              <input
                type="checkbox"
                checked={sounds}
                onChange={(e) => {
                  setSounds(e.target.checked);
                  writeSoundsEnabled(e.target.checked);
                  configureActionSounds(e.target.checked, volume);
                }}
              />
              Action sounds
            </label>
            <div className="sound-volume">
              <label htmlFor="sound-volume">
                Volume <output>{volume}%</output>
              </label>
              <input
                id="sound-volume"
                type="range"
                min="0"
                max="100"
                step="1"
                value={volume}
                disabled={!sounds}
                onChange={(e) => {
                  const value = Number(e.target.value);
                  setVolume(value);
                  writeSoundVolume(value);
                  configureActionSounds(sounds, value);
                }}
              />
              <button
                disabled={!sounds || volume === 0}
                data-own-feedback
                onClick={() => playActionSound("success")}
              >
                Test sound
              </button>
            </div>
          </div>
        </details>
      </header>
      <p className="document-name" role="status">
        {work
          ? `${work.projectPath?.split(/[\\/]/).pop() ?? "Unsaved project"} · PDF: ${work.source.filename} · ${dirty(work) ? "Unsaved changes" : work.projectPath ? "Saved" : "Ready to save"}`
          : "Open a PDF or an editable project."}
        {operation &&
          ` · ${operation === "exporting" || operation === "printing" ? exportProgress : operation === "saving" ? "Saving…" : operation === "opening" ? "Opening…" : "Closing…"}`}
        {!operation && notice && ` | ${notice}`}
        {work && recoveryStatus === "protected" && " · Recovery up to date"}
        {work && recoveryStatus === "writing" && " · Updating recovery…"}
      </p>
      <RecoveryPanel
        entries={recoveries}
        disabled={!!operation}
        recover={(entry) => void recoverWork(entry)}
        dismiss={(entry) =>
          void run("saving", async () => {
            await deleteRecovery(entry.id);
            if (alive.current)
              setRecoveries((entries) =>
                entries.filter((v) => v.id !== entry.id),
              );
          })
        }
      />
      {work && (
        <div className="document-location" aria-label="Current file">
          <strong>
            {work.projectPath?.split(/[\\/]/).pop() ?? work.source.filename}
          </strong>
          <span title={work.projectPath ?? work.sourcePath}>
            {work.projectPath ?? work.sourcePath}
          </span>
        </div>
      )}
      {error && (
        <p role="alert" className="project-error">
          {error}
        </p>
      )}
      {recoveryError && (
        <p role="alert" className="project-error">
          {recoveryError}
        </p>
      )}
      {operation && notice && (
        <p role="status" className="document-name">
          {notice}
        </p>
      )}
      <div
        className="project-workspace"
        inert={operation === "opening" || operation === "closing"}
      >
        {work ? (
          <PdfNavigationView
            fileActions={fileActions}
            largerControls={largerControls}
            key={work.id}
            pages={work.pages}
            session={work.session}
            navigation={work.navigation}
            onNavigation={(navigation) => updateNavigation(navigation, work.id)}
            history={work.history}
            onHistory={traverse}
            onAction={(action, generation) =>
              mutate(action, generation, work.id)
            }
            disabled={operation === "opening" || operation === "closing"}
          />
        ) : (
          <section className="empty-document">
            <span className="empty-icon">
              <ToolIcon name="file" />
            </span>
            <h2>A clear space for your ideas.</h2>
            <p>
              Highlight, draw, and add notes to your PDF.
              <br />
              Save your PDF and edits together in one project.
            </p>
            <button
              className="primary-action"
              disabled={!!operation}
              onClick={() => void openWork(false)}
            >
              Open a PDF to get started
            </button>
            <p className="empty-tip">
              Already started? Use Open Project to pick up where you left off.
            </p>
          </section>
        )}
      </div>
      {fileResult && (
        <FileFeedback
          key={fileResult.id}
          result={fileResult}
          dismiss={() => setFileResult(null)}
        />
      )}
      {question && <DirtyDialog answer={answer} />}
    </main>
  );
}
