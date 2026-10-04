import { useEffect, useMemo, useRef, useState } from "react";
import type {
  AnnotationSession,
  SessionAction,
} from "../../services/annotationSession";
import {
  applyPreset,
  capturePreset,
  MAX_SYMBOLS,
  parsePreset,
  readPresetLibrary,
  writePresetLibrary,
  type MarkupPreset,
  type ReusableSymbol,
} from "../../services/presets";
import { exportPresetFile, importPresetFile } from "../../services/presetFiles";
import SymbolPreview from "./SymbolPreview";

export default function PresetLibrary({
  session,
  onApply,
  onCapture,
  onPlace,
  onClose,
}: {
  session: AnnotationSession;
  onApply: (action: SessionAction) => void;
  onCapture: (name: string) => ReusableSymbol;
  onPlace: (symbol: ReusableSymbol, categories: boolean) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    alive = useRef(true);
  const [loaded] = useState(() => {
    try {
      return { values: readPresetLibrary(), error: "" };
    } catch (e) {
      return { values: [] as MarkupPreset[], error: message(e) };
    }
  });
  const [library, setLibrary] = useState(loaded.values);
  const [selected, setSelected] = useState(library[0]?.name ?? "");
  const [imported, setImported] = useState<MarkupPreset | null>(null);
  const [name, setName] = useState("");
  const [symbolName, setSymbolName] = useState("");
  const [symbolIndex, setSymbolIndex] = useState(0);
  const [styles, setStyles] = useState(true),
    [categories, setCategories] = useState(true);
  const [symbolCategories, setSymbolCategories] = useState(true);
  const [replace, setReplace] = useState(false),
    [remove, setRemove] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const preset = imported ?? library.find((p) => p.name === selected);
  const symbol = preset?.symbols[symbolIndex];
  const preview = useMemo(() => {
    if (!preset) return null;
    try {
      return {
        plan: applyPreset(session, preset, { styles, categories }),
        error: "",
      };
    } catch (e) {
      return { plan: null, error: message(e) };
    }
  }, [preset, session, styles, categories]);
  useEffect(() => {
    alive.current = true;
    dialog.current?.showModal();
    return () => {
      alive.current = false;
    };
  }, []);

  function run(task: () => void) {
    setError("");
    setStatus("");
    try {
      task();
    } catch (e) {
      setError(message(e));
    }
  }

  async function file(task: () => Promise<string | void>) {
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const result = await task();
      if (alive.current && result) setStatus(result);
    } catch (e) {
      if (alive.current) setError(message(e));
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  function store(next: MarkupPreset[]) {
    if (loaded.error)
      throw new Error(
        "The existing library could not be read. Export any imported preset before repairing local storage.",
      );
    writePresetLibrary(next);
    setLibrary(next);
  }

  function save() {
    const value = imported
      ? parsePreset(JSON.stringify({ ...imported, name: name.trim() }))
      : capturePreset(name, session, preset?.symbols ?? []);
    const exists = library.some(
      (p) => p.name.toLowerCase() === value.name.toLowerCase(),
    );
    if (exists && !replace)
      throw new Error(
        "This name already exists. Choose a new name or enable Replace existing preset.",
      );
    store([
      ...library.filter(
        (p) => !exists || p.name.toLowerCase() !== value.name.toLowerCase(),
      ),
      value,
    ]);
    setSelected(value.name);
    setImported(null);
    setReplace(false);
    setName("");
    setStatus(`Saved ${value.name} to the local library.`);
  }

  return (
    <dialog
      ref={dialog}
      className="preset-library"
      aria-labelledby="preset-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <div className="preset-heading">
        <h2 id="preset-title">Presets</h2>
        <button onClick={onClose} disabled={busy}>
          Close
        </button>
      </div>
      <p className="control-label">
        Reusable styles, categories and symbols · Stored on this computer
      </p>
      {loaded.error && <p role="alert">Library unavailable: {loaded.error}</p>}
      <fieldset disabled={busy}>
        <div className="preset-columns">
          <section aria-label="Preset library">
            <label>
              Saved preset
              <select
                aria-label="Saved preset"
                value={imported ? "" : selected}
                onChange={(e) => {
                  setSelected(e.target.value);
                  setImported(null);
                  setSymbolIndex(0);
                  setRemove(false);
                  setError("");
                  setStatus("");
                }}
              >
                <option value="">Choose a preset</option>
                {library.map((p) => (
                  <option key={p.name}>{p.name}</option>
                ))}
              </select>
            </label>
            <button
              onClick={() =>
                void file(async () => {
                  const value = await importPresetFile();
                  if (value && alive.current) {
                    setImported(value);
                    setName(value.name);
                    setSymbolIndex(0);
                    setReplace(false);
                    setRemove(false);
                    return "Imported preview ready. Review before saving or applying.";
                  }
                })
              }
            >
              Import preset
            </button>
            <label>
              Preset name
              <input
                value={name}
                maxLength={256}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className="preset-check">
              <input
                type="checkbox"
                checked={replace}
                onChange={(e) => setReplace(e.target.checked)}
              />
              Replace existing preset
            </label>
            <button
              disabled={!!loaded.error || !name.trim()}
              onClick={() => run(save)}
            >
              {imported ? "Save imported preset" : "Save current settings"}
            </button>
            {!imported && (
              <p className="control-label">
                Saves current drawing settings and categories; retains the
                chosen preset’s symbols.
              </p>
            )}
            {preset && (
              <button
                onClick={() =>
                  void file(async () => {
                    const path = await exportPresetFile(preset);
                    return path ? `Exported preset to ${path}` : undefined;
                  })
                }
              >
                Export preset
              </button>
            )}
            {!imported && preset && !loaded.error && (
              <>
                <button onClick={() => setRemove(!remove)}>
                  Remove from library
                </button>
                {remove && (
                  <div>
                    <p>Remove {preset.name} from this computer’s library?</p>
                    <button
                      onClick={() =>
                        run(() => {
                          store(library.filter((p) => p.name !== preset.name));
                          setSelected("");
                          setRemove(false);
                          setStatus("Preset removed from the library.");
                        })
                      }
                    >
                      Confirm removal
                    </button>
                    <button onClick={() => setRemove(false)}>
                      Keep preset
                    </button>
                  </div>
                )}
              </>
            )}
          </section>
          <section aria-label="Preset preview">
            {preset ? (
              <>
                <h3>
                  {preset.name}
                  {imported ? " · Imported preview" : ""}
                </h3>
                <div className="preset-style-preview">
                  <span
                    style={{
                      borderBottom: `6px solid ${preset.drawing.color}`,
                    }}
                  >
                    Highlight · {preset.drawing.width} pt ·{" "}
                    {Math.round(preset.drawing.opacity * 100)}% opacity
                  </span>
                  <span
                    style={{
                      borderBottom: `3px solid ${preset.toolStyles.shape.color}`,
                    }}
                  >
                    Shapes · {preset.toolStyles.shape.width} pt
                  </span>
                  <span
                    style={{
                      borderBottom: `3px solid ${preset.toolStyles.measurement.color}`,
                    }}
                  >
                    Measurements · {preset.toolStyles.measurement.width} pt ·{" "}
                    {preset.toolStyles.measurement.fontSize} pt text
                  </span>
                </div>
                <details>
                  <summary>{preset.categories.length} categories</summary>
                  <ul className="preset-category-list">
                    {preset.categories.map((c) => (
                      <li key={c.name}>
                        <i style={{ background: c.color }} />
                        {c.name}
                      </li>
                    ))}
                  </ul>
                </details>
                <label className="preset-check">
                  <input
                    type="checkbox"
                    checked={styles}
                    onChange={(e) => setStyles(e.target.checked)}
                  />
                  Apply drawing styles
                </label>
                <label className="preset-check">
                  <input
                    type="checkbox"
                    checked={categories}
                    onChange={(e) => setCategories(e.target.checked)}
                  />
                  Add categories
                </label>
                <p className="control-label">
                  Applies to new drawings. Existing markups keep their
                  appearance.
                </p>
                {preview?.plan && categories && (
                  <div className="preset-conflicts">
                    <p>
                      {preview.plan.added.length} new ·{" "}
                      {preview.plan.reused.length} reused categories
                    </p>
                    {preview.plan.renamed.map((r) => (
                      <p key={r.from}>
                        Name conflict: {r.from} → {r.to}
                      </p>
                    ))}
                    {session.legends.some(
                      (l) =>
                        (l.hidden || l.locked) &&
                        preview.plan?.reused.includes(l.name),
                    ) && (
                      <p>
                        Reused categories retain their hidden or locked state.
                      </p>
                    )}
                  </div>
                )}
                {preview?.error && <p role="alert">{preview.error}</p>}
                <button
                  disabled={!preview?.plan?.action}
                  onClick={() =>
                    run(() => {
                      const result = applyPreset(session, preset, {
                        styles,
                        categories,
                      });
                      if (result.action) {
                        onApply(result.action);
                        onClose();
                      }
                    })
                  }
                >
                  Apply preset
                </button>
                <h3>Symbols · {preset.symbols.length}</h3>
                {preset.symbols.length > 0 && (
                  <>
                    <label>
                      Symbol
                      <select
                        aria-label="Symbol"
                        value={symbolIndex}
                        onChange={(e) => setSymbolIndex(Number(e.target.value))}
                      >
                        {preset.symbols.map((s, i) => (
                          <option key={s.name} value={i}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    {symbol && <SymbolPreview symbol={symbol} />}
                    <label className="preset-check">
                      <input
                        type="checkbox"
                        checked={symbolCategories}
                        onChange={(e) => setSymbolCategories(e.target.checked)}
                      />
                      Import symbol categories
                    </label>
                    <button
                      onClick={() =>
                        run(() => {
                          if (symbol) {
                            onPlace(symbol, symbolCategories);
                            onClose();
                          }
                        })
                      }
                    >
                      Place on current page
                    </button>
                  </>
                )}
                {!imported && (
                  <>
                    <label>
                      New symbol name
                      <input
                        value={symbolName}
                        maxLength={256}
                        onChange={(e) => setSymbolName(e.target.value)}
                      />
                    </label>
                    <button
                      disabled={
                        !!loaded.error ||
                        !symbolName.trim() ||
                        preset.symbols.length >= MAX_SYMBOLS
                      }
                      onClick={() =>
                        run(() => {
                          const captured = onCapture(symbolName);
                          const value = parsePreset(
                            JSON.stringify({
                              ...preset,
                              symbols: [...preset.symbols, captured],
                            }),
                          );
                          store(
                            library.map((p) =>
                              p.name === preset.name ? value : p,
                            ),
                          );
                          setSymbolIndex(value.symbols.length - 1);
                          setSymbolName("");
                          setStatus("Selection saved as a symbol.");
                        })
                      }
                    >
                      Save selected markups as symbol
                    </button>
                    <p className="control-label">
                      Select up to 100 highlights, shapes, text notes or arrows
                      on one page.
                    </p>
                  </>
                )}
              </>
            ) : (
              <p>
                Choose or import a preset to preview it. Save your current
                settings to start a library.
              </p>
            )}
          </section>
        </div>
      </fieldset>
      {error && <p role="alert">{error}</p>}
      <p role="status" className="preset-status">
        {busy ? "Working…" : status}
      </p>
    </dialog>
  );
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
