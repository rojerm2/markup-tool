import { useEffect, useMemo, useRef, useState } from "react";
import type { PDFPageProxy } from "pdfjs-dist";
import type { AnnotationSession } from "../../services/annotationSession";
import type { Bookmark } from "../../services/documentNavigation";
import {
  filterMarkups,
  markupRows,
  type MarkupRow,
} from "../../services/markupList";
import PageThumbnail from "./PageThumbnail";
import { objectLocked, objectVisible } from "../../services/categoryPolicy";

const ROW_HEIGHT = 224;
type Tab = "Pages" | "Bookmarks" | "Markups";

export default function DocumentPanel({
  pages,
  current,
  session,
  bookmarks,
  disabled,
  close,
  navigate,
  changeBookmarks,
  reveal,
  selected = [],
  toggleSelection,
}: {
  pages: PDFPageProxy[];
  current: number;
  session: AnnotationSession;
  bookmarks: Bookmark[];
  disabled: boolean;
  close: () => void;
  navigate: (page: number) => void;
  changeBookmarks: (bookmarks: Bookmark[]) => void;
  reveal: (row: MarkupRow) => void;
  selected?: string[];
  toggleSelection?: (id: string) => void;
}) {
  const [tab, setTab] = useState<Tab>("Pages");
  const [start, setStart] = useState(Math.max(0, current - 2));
  const list = useRef<HTMLDivElement>(null);
  const tabs = useRef<HTMLDivElement>(null);
  const [label, setLabel] = useState(`Page ${current}`);
  const [query, setQuery] = useState("");
  const [pageOnly, setPageOnly] = useState(false);
  const [category, setCategory] = useState("");
  const [type, setType] = useState("");
  const [offset, setOffset] = useState(0);
  const [bookmarkError, setBookmarkError] = useState<string | null>(null);
  const rows = useMemo(() => markupRows(session), [session]);
  const filtered = useMemo(
    () =>
      filterMarkups(
        rows,
        query,
        pageOnly ? current : null,
        category === "unassigned" ? null : category.replace(/^category:/, ""),
        type,
      ),
    [rows, query, pageOnly, current, category, type],
  );
  const selectedBookmark = bookmarks.find((b) => b.page === current);
  useEffect(() => {
    setLabel(selectedBookmark?.label ?? `Page ${current}`);
    setBookmarkError(null);
  }, [current, selectedBookmark?.label]);
  useEffect(
    () => setOffset(0),
    [query, pageOnly, category, type, current, session],
  );
  useEffect(() => {
    if (tab !== "Pages" || !list.current) return;
    const host = list.current;
    const top = (current - 1) * ROW_HEIGHT;
    if (
      top < host.scrollTop ||
      top + ROW_HEIGHT > host.scrollTop + (host.clientHeight || 600)
    ) {
      host.scrollTop = top;
      setStart(Math.max(0, current - 2));
    }
  }, [current, tab]);
  // At most eight thumbnails exist, irrespective of the PDF's page count.
  const shown = pages.slice(start, start + 8);
  return (
    <aside
      id="document-panel"
      className="document-panel"
      aria-label="Document navigation"
      onKeyDown={(e) => {
        if (e.key.startsWith("Arrow")) e.stopPropagation();
        if (e.key === "Escape") {
          e.stopPropagation();
          close();
        }
      }}
    >
      <div className="panel-heading">
        <strong>Document</strong>
        <button aria-label="Close document panel" onClick={close}>
          ×
        </button>
      </div>
      <div
        ref={tabs}
        role="tablist"
        aria-label="Document sections"
        className="document-tabs"
      >
        {(["Pages", "Bookmarks", "Markups"] as Tab[]).map((name, i) => (
          <button
            key={name}
            role="tab"
            id={`document-tab-${name}`}
            aria-selected={tab === name}
            aria-controls="document-panel-content"
            tabIndex={tab === name ? 0 : -1}
            onClick={() => setTab(name)}
            onKeyDown={(e) => {
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key))
                return;
              e.preventDefault();
              e.stopPropagation();
              const next =
                e.key === "Home"
                  ? 0
                  : e.key === "End"
                    ? 2
                    : (i + (e.key === "ArrowRight" ? 1 : 2)) % 3;
              const name = (["Pages", "Bookmarks", "Markups"] as Tab[])[next];
              setTab(name);
              tabs.current
                ?.querySelectorAll<HTMLButtonElement>("button")
                [next]?.focus();
            }}
          >
            {name}
          </button>
        ))}
      </div>
      <div
        id="document-panel-content"
        role="tabpanel"
        aria-labelledby={`document-tab-${tab}`}
        className="document-panel-content"
      >
        {tab === "Pages" && (
          <div
            ref={list}
            className="thumbnail-list"
            aria-label="Page thumbnails"
            onScroll={(e) =>
              setStart(
                Math.max(
                  0,
                  Math.min(
                    pages.length - 1,
                    Math.floor(e.currentTarget.scrollTop / ROW_HEIGHT) - 1,
                  ),
                ),
              )
            }
          >
            <div
              style={{
                height: pages.length * ROW_HEIGHT,
                position: "relative",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  top: start * ROW_HEIGHT,
                  left: 0,
                  right: 0,
                }}
              >
                {shown.map((page) => (
                  <button
                    key={page.pageNumber}
                    className="thumbnail-row"
                    style={{ height: ROW_HEIGHT }}
                    disabled={disabled}
                    aria-current={
                      current === page.pageNumber ? "page" : undefined
                    }
                    aria-label={`Go to page ${page.pageNumber}`}
                    onClick={() => navigate(page.pageNumber)}
                  >
                    <span>
                      Page {page.pageNumber}
                      {bookmarks.some((b) => b.page === page.pageNumber)
                        ? " · Bookmarked"
                        : ""}
                    </span>
                    <PageThumbnail page={page} session={session} />
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
        {tab === "Bookmarks" && (
          <div className="document-list">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (disabled) return;
                const text = label.trim();
                if (
                  !text ||
                  text.length > 256 ||
                  // eslint-disable-next-line no-control-regex -- Reject control characters in labels.
                  /[\u0000-\u001f]/.test(text)
                ) {
                  setBookmarkError("Enter a label of up to 256 characters.");
                  return;
                }
                if (!selectedBookmark && bookmarks.length >= 1000) {
                  setBookmarkError("A project can have up to 1,000 bookmarks.");
                  return;
                }
                changeBookmarks(
                  [
                    ...bookmarks.filter((b) => b.page !== current),
                    { page: current, label: text },
                  ].sort((a, b) => a.page - b.page),
                );
                setBookmarkError(null);
              }}
            >
              <label>
                Page {current} label
                <input
                  aria-label="Bookmark label"
                  value={label}
                  maxLength={256}
                  disabled={disabled}
                  onChange={(e) => setLabel(e.target.value)}
                />
              </label>
              <button disabled={disabled}>
                {selectedBookmark ? "Update bookmark" : "Bookmark this page"}
              </button>
            </form>
            {bookmarkError && <p role="alert">{bookmarkError}</p>}
            {!bookmarks.length && <p>No bookmarks yet.</p>}
            <ul>
              {bookmarks.map((b) => (
                <li key={b.page}>
                  <button
                    className="bookmark-jump"
                    aria-label={`${b.label} Page ${b.page}`}
                    disabled={disabled}
                    aria-current={b.page === current ? "page" : undefined}
                    onClick={() => navigate(b.page)}
                  >
                    <strong>{b.label}</strong>
                    <small>Page {b.page}</small>
                  </button>
                  <button
                    disabled={disabled}
                    aria-label={`Remove bookmark ${b.label}`}
                    onClick={() =>
                      changeBookmarks(
                        bookmarks.filter((v) => v.page !== b.page),
                      )
                    }
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {tab === "Markups" && (
          <div className="document-list">
            <label>
              Search
              <input
                type="search"
                aria-label="Search markups"
                value={query}
                maxLength={256}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <label>
              Type
              <select
                aria-label="Markup type filter"
                value={type}
                onChange={(e) => setType(e.target.value)}
              >
                <option value="">All types</option>
                {["highlight", "shape", "text", "arrow", "legend"].map((t) => (
                  <option key={t} value={t}>
                    {t[0].toUpperCase() + t.slice(1)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Category
              <select
                aria-label="Markup category filter"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option value="">All categories</option>
                <option value="unassigned">Unassigned</option>
                {session.legends.map((l) => (
                  <option key={l.id} value={`category:${l.id}`}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={pageOnly}
                onChange={(e) => setPageOnly(e.target.checked)}
              />
              Current page only
            </label>
            <p role="status">
              {filtered.length} markup{filtered.length === 1 ? "" : "s"}
            </p>
            {!filtered.length && <p>No matching markups.</p>}
            <ul>
              {filtered.slice(offset, offset + 50).map((r) => (
                <li key={r.id}>
                  {toggleSelection && (
                    <input
                      type="checkbox"
                      className="markup-select"
                      aria-label={`Select ${r.label.slice(0, 100)} on page ${r.page}`}
                      checked={selected.includes(r.id)}
                      disabled={
                        disabled ||
                        objectLocked(session, r.id) ||
                        !objectVisible(session, r.id)
                      }
                      onChange={() => toggleSelection(r.id)}
                    />
                  )}
                  <button
                    disabled={disabled}
                    className="markup-jump"
                    aria-label={`${r.label.slice(0, 100)} · Page ${r.page} · ${r.category}`}
                    onClick={() => reveal(r)}
                  >
                    <span
                      className="markup-dot"
                      style={{ background: r.color }}
                    />
                    <span>
                      <strong title={r.label}>{r.label}</strong>
                      <small>
                        Page {r.page} · {r.category}
                        {!objectVisible(session, r.id) && " · Hidden"}
                        {objectLocked(session, r.id) && " · Locked"}
                      </small>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {filtered.length > 50 && (
              <div className="markup-pagination">
                <button
                  disabled={offset === 0}
                  onClick={() => setOffset((v) => Math.max(0, v - 50))}
                >
                  Previous results
                </button>
                <span>
                  {offset + 1}–{Math.min(offset + 50, filtered.length)}
                </span>
                <button
                  disabled={offset + 50 >= filtered.length}
                  onClick={() => setOffset((v) => v + 50)}
                >
                  Next results
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
