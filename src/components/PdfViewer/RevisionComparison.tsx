import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { PDFPageProxy } from "pdfjs-dist";
import type { SourceIdentity } from "../../services/projectFormat";
import { choosePdf, loadSource } from "../../services/projectService";
import {
  comparisonFrame,
  comparisonPage,
  comparisonSize,
  defaultComparisonAlignment,
  validateComparisonAlignment,
  type ComparisonAlignment,
} from "../../services/revisionComparison";
import ComparisonCanvas from "./ComparisonCanvas";

export type ComparisonDocument = {
  source: SourceIdentity;
  pages: PDFPageProxy[];
  path: string;
  controller?: AbortController;
};

function PageChoice({
  label,
  value,
  count,
  onChange,
}: {
  label: string;
  value: number | null;
  count: number;
  onChange: (page: number) => void;
}) {
  const [draft, setDraft] = useState(value === null ? "" : String(value)),
    [error, setError] = useState("");
  useEffect(() => {
    setDraft(value === null ? "" : String(value));
    setError("");
  }, [value, count]);
  const commit = () => {
    try {
      const next = comparisonPage(draft, count);
      setError("");
      if (next !== value) onChange(next);
      setDraft(String(next));
    } catch (e) {
      setError(message(e));
      setDraft(value === null ? "" : String(value));
    }
  };
  return (
    <div className="comparison-page-choice">
      <button
        aria-label={`Previous ${label.toLowerCase()} page`}
        disabled={value === null || value <= 1}
        onClick={() => onChange(value! - 1)}
      >
        −
      </button>
      <label>
        {label} page
        <input
          inputMode="numeric"
          aria-label={`${label} page`}
          value={draft}
          maxLength={5}
          placeholder="Choose"
          onChange={(e) => {
            if (/^\d{0,5}$/.test(e.target.value)) setDraft(e.target.value);
          }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.currentTarget.blur();
              e.currentTarget
                .closest("dialog")
                ?.querySelector<HTMLElement>(".comparison-pan")
                ?.focus();
            }
          }}
        />
      </label>
      <span>of {count}</span>
      <button
        aria-label={
          value === null
            ? `First ${label.toLowerCase()} page`
            : `Next ${label.toLowerCase()} page`
        }
        disabled={value !== null && value >= count}
        onClick={() => onChange(value === null ? 1 : value + 1)}
      >
        +
      </button>
      {error && <span role="alert">{error}</span>}
    </div>
  );
}

function AlignmentInput({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value)),
    [error, setError] = useState("");
  useEffect(() => {
    setDraft(String(value));
    setError("");
  }, [value]);
  const commit = () => {
    const next = Number(draft);
    if (!draft.trim() || !Number.isFinite(next) || next < min || next > max) {
      setError(`Choose ${min} to ${max}.`);
      setDraft(String(value));
      return;
    }
    setError("");
    onChange(next);
    setDraft(String(next));
  };
  return (
    <label>
      {label}
      <input
        inputMode="decimal"
        value={draft}
        maxLength={12}
        onChange={(e) => {
          if (/^-?\d*(?:\.\d*)?$/.test(e.target.value))
            setDraft(e.target.value);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
            e.currentTarget
              .closest("dialog")
              ?.querySelector<HTMLElement>(".comparison-pan")
              ?.focus();
          }
        }}
      />
      {error && <span role="alert">{error}</span>}
    </label>
  );
}

function message(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

export default function RevisionComparison({
  baseline,
  initialPage = 1,
  onClose,
}: {
  baseline?: Omit<ComparisonDocument, "controller">;
  initialPage?: number;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    scroller = useRef<HTMLDivElement>(null),
    alive = useRef(true),
    staging = useRef<AbortController | null>(null);
  const [documents, setDocuments] = useState<
    [ComparisonDocument | null, ComparisonDocument | null]
  >([
    baseline
      ? { source: baseline.source, pages: baseline.pages, path: baseline.path }
      : null,
    null,
  ]);
  const [pages, setPages] = useState<[number, number | null]>([
    baseline ? initialPage : 1,
    null,
  ]);
  const currentPages = useRef(pages);
  currentPages.current = pages;
  const [loading, setLoading] = useState<0 | 1 | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [mode, setMode] = useState<"side" | "overlay">("side"),
    [alignment, setAlignment] = useState(defaultComparisonAlignment),
    [zoom, setZoom] = useState(1);
  const [size, setSize] = useState({ width: 800, height: 500 });
  const [fitBounds, setFitBounds] = useState<{
      width: number;
      height: number;
    } | null>(null),
    [viewReset, setViewReset] = useState(0);
  useLayoutEffect(() => {
    for (const viewport of scroller.current?.querySelectorAll<HTMLElement>(
      ".comparison-viewport",
    ) ?? []) {
      viewport.scrollLeft = 0;
      viewport.scrollTop = 0;
    }
  }, [viewReset]);
  const drag = useRef<{
    pointer: number;
    x: number;
    y: number;
    left: number;
    top: number;
  } | null>(null);
  useEffect(() => {
    alive.current = true;
    dialog.current?.showModal();
    return () => {
      alive.current = false;
      staging.current?.abort();
    };
  }, []);
  // Borrowed baseline pages belong to the open project; only comparison-owned documents are destroyed here.
  useEffect(() => () => documents[0]?.controller?.abort(), [documents[0]]);
  useEffect(() => () => documents[1]?.controller?.abort(), [documents[1]]);
  useEffect(() => {
    const host = scroller.current;
    if (!host) return;
    const update = () => {
      if (!host.clientWidth || !host.clientHeight) return;
      setSize((old) =>
        old.width === host.clientWidth && old.height === host.clientHeight
          ? old
          : { width: host.clientWidth, height: host.clientHeight },
      );
    };
    const observer = new ResizeObserver(update);
    observer.observe(host);
    update();
    return () => observer.disconnect();
  }, []);

  async function openRevision(slot: 0 | 1) {
    if (staging.current) return;
    const controller = new AbortController();
    staging.current = controller;
    let adopted = false;
    setLoading(slot);
    setError("");
    setNotice("");
    try {
      const path = await choosePdf(
        slot === 0 ? "Choose baseline PDF" : "Choose revision PDF",
      );
      controller.signal.throwIfAborted();
      if (!path) return;
      if (typeof path !== "string") throw new Error("Choose one PDF.");
      const loaded = await loadSource(path, controller.signal);
      controller.signal.throwIfAborted();
      if (!alive.current) return;
      const revision = { ...loaded, path, controller };
      setDocuments((old) =>
        slot === 0 ? [revision, old[1]] : [old[0], revision],
      );
      adopted = true;
      if (slot === 0) setPages((old) => [1, old[1]]);
      else if (currentPages.current[0] <= loaded.pages.length)
        setPages((old) => [old[0], old[0]]);
      else {
        setPages((old) => [old[0], null]);
        setNotice(
          `The revision has no page ${currentPages.current[0]}. Choose its matching sheet explicitly.`,
        );
      }
      setAlignment(defaultComparisonAlignment());
      setZoom(1);
      setFitBounds(null);
      setViewReset((old) => old + 1);
    } catch (e) {
      if (alive.current) {
        if (
          e &&
          typeof e === "object" &&
          "name" in e &&
          e.name === "AbortError"
        )
          setNotice("Loading cancelled. Previous files are unchanged.");
        else setError(message(e));
      }
    } finally {
      if (staging.current === controller) staging.current = null;
      if (alive.current) setLoading(null);
      // A successful loaded document owns its controller until replacement/close.
      // Failed/cancelled loading must release any partially created PDF.js document.
      if (!adopted || !alive.current) controller.abort();
    }
  }

  const geometry = useMemo(() => {
    try {
      const a = documents[0]?.pages[pages[0] - 1],
        b = pages[1] === null ? null : documents[1]?.pages[pages[1] - 1];
      if (!a || !b) return { value: null, error: "" };
      const baselineSize = comparisonSize(a.getViewport({ scale: 1 })),
        revisionSize = comparisonSize(b.getViewport({ scale: 1 }));
      const frame = comparisonFrame(baselineSize, revisionSize, alignment);
      const columns = mode === "side" ? 2 : 1;
      const fitted = fitBounds ?? {
        width: Math.max(baselineSize.width, revisionSize.width),
        height: Math.max(baselineSize.height, revisionSize.height),
      };
      const fit = Math.min(
        Math.max(1, (size.width - 32) / columns) / fitted.width,
        Math.max(1, size.height - 40) / fitted.height,
      );
      return {
        value: { a, b, baselineSize, revisionSize, frame, scale: fit * zoom },
        error: "",
      };
    } catch (e) {
      return { value: null, error: message(e) };
    }
  }, [documents, pages, alignment, mode, size, zoom, fitBounds]);
  const view = geometry.value;
  const choosePage = (slot: 0 | 1, page: number) => {
    setPages((old) => (slot === 0 ? [page, old[1]] : [old[0], page]));
    setAlignment(defaultComparisonAlignment());
    setFitBounds(null);
    setNotice("");
  };
  const align = (change: Partial<ComparisonAlignment>) =>
    setAlignment((old) => validateComparisonAlignment({ ...old, ...change }));
  const sheetStyle = view
    ? {
        position: "absolute" as const,
        left: -view.frame.left * view.scale,
        top: -view.frame.top * view.scale,
      }
    : {};
  const viewportEvents = {
    onScroll: (e: React.UIEvent<HTMLDivElement>) => {
      for (const other of scroller.current?.querySelectorAll<HTMLElement>(
        ".comparison-viewport",
      ) ?? []) {
        if (other !== e.currentTarget) {
          other.scrollLeft = e.currentTarget.scrollLeft;
          other.scrollTop = e.currentTarget.scrollTop;
        }
      }
    },
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      drag.current = {
        pointer: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        left: e.currentTarget.scrollLeft,
        top: e.currentTarget.scrollTop,
      };
      e.currentTarget.setPointerCapture(e.pointerId);
      e.currentTarget.focus();
      e.preventDefault();
    },
    onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => {
      const active = drag.current;
      if (active?.pointer === e.pointerId) {
        e.currentTarget.scrollLeft = active.left - e.clientX + active.x;
        e.currentTarget.scrollTop = active.top - e.clientY + active.y;
      }
    },
    onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => {
      drag.current = null;
      if (e.currentTarget.hasPointerCapture(e.pointerId))
        e.currentTarget.releasePointerCapture(e.pointerId);
    },
    onPointerCancel: () => {
      drag.current = null;
    },
    onLostPointerCapture: () => {
      drag.current = null;
    },
    onBlur: () => {
      drag.current = null;
    },
    onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => {
      const amount = e.shiftKey ? 160 : 40;
      const movement: Record<string, [number, number]> = {
        ArrowLeft: [-amount, 0],
        ArrowRight: [amount, 0],
        ArrowUp: [0, -amount],
        ArrowDown: [0, amount],
      };
      if (movement[e.key]) {
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.scrollLeft += movement[e.key][0];
        e.currentTarget.scrollTop += movement[e.key][1];
      }
    },
  };
  return (
    <dialog
      ref={dialog}
      className="revision-comparison"
      aria-labelledby="comparison-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <header className="comparison-heading">
        <h2 id="comparison-title">Compare PDF revisions</h2>
        <button onClick={onClose}>Close comparison</button>
      </header>
      <div className="comparison-files">
        {([0, 1] as const).map((slot) => (
          <section key={slot}>
            <h3>{slot === 0 ? "Baseline · blue" : "Revision · red"}</h3>
            <button
              disabled={loading !== null}
              onClick={() => void openRevision(slot)}
            >
              {documents[slot]
                ? `Replace ${slot === 0 ? "baseline" : "revision"} PDF`
                : `Choose ${slot === 0 ? "baseline" : "revision"} PDF`}
            </button>
            {documents[slot] && (
              <>
                <strong>{documents[slot].source.filename}</strong>
                <span className="comparison-path" title={documents[slot].path}>
                  {documents[slot].path}
                </span>
                <PageChoice
                  label={slot === 0 ? "Baseline" : "Revision"}
                  value={pages[slot]}
                  count={documents[slot].pages.length}
                  onChange={(page) => choosePage(slot, page)}
                />
              </>
            )}
          </section>
        ))}
      </div>
      {loading !== null && (
        <div role="status">
          Opening {loading === 0 ? "baseline" : "revision"} PDF…{" "}
          <button onClick={() => staging.current?.abort()}>
            Cancel loading
          </button>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      {geometry.error && <p role="alert">{geometry.error}</p>}
      {notice && <p role="status">{notice}</p>}
      <div className="comparison-controls">
        <label>
          View
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as "side" | "overlay")}
          >
            <option value="side">Side by side</option>
            <option value="overlay">Color overlay</option>
          </select>
        </label>
        <label>
          Zoom <output>{Math.round(zoom * 100)}% of fit</output>
          <input
            type="range"
            min=".25"
            max="32"
            step=".25"
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
          />
        </label>
        <button
          onClick={() => {
            setFitBounds(
              view
                ? { width: view.frame.width, height: view.frame.height }
                : null,
            );
            setZoom(1);
            setViewReset((old) => old + 1);
          }}
        >
          Fit sheets
        </button>
        <details>
          <summary>Align revision</summary>
          <div className="comparison-alignment">
            <AlignmentInput
              label="Horizontal offset (%)"
              value={alignment.x}
              min={-200}
              max={200}
              onChange={(x) => align({ x })}
            />
            <AlignmentInput
              label="Vertical offset (%)"
              value={alignment.y}
              min={-200}
              max={200}
              onChange={(y) => align({ y })}
            />
            <AlignmentInput
              label="Scale (%)"
              value={alignment.scale * 100}
              min={25}
              max={400}
              onChange={(value) => align({ scale: value / 100 })}
            />
            <AlignmentInput
              label="Rotation (°)"
              value={alignment.rotation}
              min={-180}
              max={180}
              onChange={(rotation) => align({ rotation })}
            />
            <button onClick={() => setAlignment(defaultComparisonAlignment())}>
              Reset alignment
            </button>
          </div>
        </details>
      </div>
      <p className="comparison-note">
        Original PDF pages are shown; project markup is excluded. In overlay,
        blue and red indicate each revision and dark ink overlaps. Alignment and
        rendering resolution affect what is visible; this is a review aid, not a
        guarantee of detecting every change.
      </p>
      <div
        ref={scroller}
        className={`comparison-pan comparison-${mode}`}
        tabIndex={0}
        aria-label="Comparison canvas"
      >
        {view ? (
          <>
            <div
              className="comparison-viewport"
              tabIndex={0}
              aria-label={
                mode === "side" ? "Baseline viewport" : "Overlay viewport"
              }
              {...viewportEvents}
            >
              <div
                className="comparison-board"
                style={{
                  width: view.frame.width * view.scale,
                  height: view.frame.height * view.scale,
                }}
              >
                <ComparisonCanvas
                  page={view.a}
                  scale={view.scale}
                  ink={mode === "overlay" ? "baseline" : null}
                  label={`Baseline page ${pages[0]}`}
                  style={{
                    ...sheetStyle,
                    width: view.baselineSize.width * view.scale,
                    height: view.baselineSize.height * view.scale,
                  }}
                />
                {mode === "overlay" && (
                  <ComparisonCanvas
                    page={view.b}
                    scale={view.scale}
                    ink="revision"
                    rotation={alignment.rotation}
                    magnification={alignment.scale}
                    label={`Revision page ${pages[1]}`}
                    style={{
                      ...sheetStyle,
                      width: view.revisionSize.width * view.scale,
                      height: view.revisionSize.height * view.scale,
                      mixBlendMode: "multiply",
                      transformOrigin: "center",
                      transform: `translate(${(alignment.x * view.baselineSize.width * view.scale) / 100}px, ${(alignment.y * view.baselineSize.height * view.scale) / 100}px) rotate(${alignment.rotation}deg) scale(${alignment.scale})`,
                    }}
                  />
                )}
              </div>
            </div>
            {mode === "side" && (
              <div
                className="comparison-viewport"
                tabIndex={0}
                aria-label="Revision viewport"
                {...viewportEvents}
              >
                <div
                  className="comparison-board"
                  style={{
                    width: view.frame.width * view.scale,
                    height: view.frame.height * view.scale,
                  }}
                >
                  <ComparisonCanvas
                    page={view.b}
                    scale={view.scale}
                    ink={null}
                    rotation={alignment.rotation}
                    magnification={alignment.scale}
                    label={`Revision page ${pages[1]}`}
                    style={{
                      ...sheetStyle,
                      width: view.revisionSize.width * view.scale,
                      height: view.revisionSize.height * view.scale,
                      transformOrigin: "center",
                      transform: `translate(${(alignment.x * view.baselineSize.width * view.scale) / 100}px, ${(alignment.y * view.baselineSize.height * view.scale) / 100}px) rotate(${alignment.rotation}deg) scale(${alignment.scale})`,
                    }}
                  />
                </div>
              </div>
            )}
          </>
        ) : (
          <p>Choose both PDFs and the matching pages to compare.</p>
        )}
      </div>
    </dialog>
  );
}
