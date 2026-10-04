import { useEffect, useMemo, useRef, useState } from "react";
import type { AnnotationSession } from "../../services/annotationSession";
import {
  defaultExportSelection,
  parsePageSelection,
  selectExportSession,
  type ExportSelection,
} from "../../services/exportSelection";
import { markupRows } from "../../services/markupList";

export type ExportAction = "pdf" | "print" | "csv-report" | "pdf-report";

export default function ExportOptions({
  session,
  pageCount,
  currentPage,
  onClose,
  onExport,
}: {
  session: AnnotationSession;
  pageCount: number;
  currentPage: number;
  onClose: () => void;
  onExport: (selection: ExportSelection, action: ExportAction) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [mode, setMode] = useState("all");
  const [range, setRange] = useState(String(currentPage));
  const [allCategories, setAllCategories] = useState(true);
  const [categoryIds, setCategoryIds] = useState(
    session.legends.map((l) => l.id),
  );
  const [unassigned, setUnassigned] = useState(true),
    [hidden, setHidden] = useState(true);
  const [action, setAction] = useState<ExportAction>("pdf");
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const preview = useMemo(() => {
    try {
      const selection: ExportSelection = {
        ...defaultExportSelection(pageCount),
        pages:
          mode === "all"
            ? defaultExportSelection(pageCount).pages
            : mode === "current"
              ? [currentPage]
              : parsePageSelection(range, pageCount),
        categoryIds: allCategories ? null : categoryIds,
        includeUnassigned: unassigned,
        includeHidden: hidden,
      };
      const count = markupRows(
        selectExportSession(session, selection, pageCount),
      ).length;
      return { selection, count, error: "" };
    } catch (e) {
      return {
        selection: null,
        count: 0,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }, [
    session,
    pageCount,
    currentPage,
    mode,
    range,
    allCategories,
    categoryIds,
    unassigned,
    hidden,
  ]);
  return (
    <dialog
      ref={dialog}
      className="export-options"
      aria-labelledby="export-options-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (preview.selection) onExport(preview.selection, action);
        }}
      >
        <h2 id="export-options-title">Export & reports</h2>
        <fieldset>
          <legend>Pages</legend>
          <label>
            <input
              type="radio"
              name="export-pages"
              checked={mode === "all"}
              onChange={() => setMode("all")}
            />
            All {pageCount} pages
          </label>
          <label>
            <input
              type="radio"
              name="export-pages"
              checked={mode === "current"}
              onChange={() => setMode("current")}
            />
            Current page ({currentPage})
          </label>
          <label>
            <input
              type="radio"
              name="export-pages"
              checked={mode === "custom"}
              onChange={() => setMode("custom")}
            />
            Custom pages
          </label>
          {mode === "custom" && (
            <label>
              Page numbers and ranges
              <input
                value={range}
                maxLength={5000}
                placeholder="1, 3-5"
                onChange={(e) => setRange(e.target.value)}
                aria-invalid={!!preview.error}
                aria-describedby="export-selection-status"
              />
            </label>
          )}
        </fieldset>
        <fieldset>
          <legend>Markup</legend>
          <label>
            <input
              type="checkbox"
              checked={allCategories}
              onChange={(e) => setAllCategories(e.target.checked)}
            />
            All categories
          </label>
          {!allCategories && (
            <div className="export-categories">
              {session.legends.length ? (
                session.legends.map((l) => (
                  <label key={l.id}>
                    <input
                      type="checkbox"
                      checked={categoryIds.includes(l.id)}
                      onChange={(e) =>
                        setCategoryIds((ids) =>
                          e.target.checked
                            ? [...ids, l.id]
                            : ids.filter((id) => id !== l.id),
                        )
                      }
                    />
                    {l.name}
                    {l.hidden ? " (hidden)" : ""}
                    {l.locked ? " (locked)" : ""}
                  </label>
                ))
              ) : (
                <span>No categories in this project.</span>
              )}
            </div>
          )}
          <label>
            <input
              type="checkbox"
              checked={unassigned}
              onChange={(e) => setUnassigned(e.target.checked)}
            />
            Include unassigned markup
          </label>
          <label>
            <input
              type="checkbox"
              checked={hidden}
              onChange={(e) => setHidden(e.target.checked)}
            />
            Include hidden categories
          </label>
        </fieldset>
        <label>
          Output
          <select
            value={action}
            onChange={(e) => setAction(e.target.value as ExportAction)}
          >
            <option value="pdf">Annotated PDF</option>
            <option value="print">Print annotated pages</option>
            <option value="csv-report">CSV markup report</option>
            <option value="pdf-report">PDF markup report</option>
          </select>
        </label>
        <p
          id="export-selection-status"
          role={preview.error ? "alert" : "status"}
        >
          {preview.error ||
            `${preview.selection?.pages.length} ${preview.selection?.pages.length === 1 ? "page" : "pages"} · ${preview.count} markup ${preview.count === 1 ? "item" : "items"}`}
        </p>
        <p className="export-note">
          Pages keep their document order. Locked markup can be exported.
          Reports include annotation text; review before sharing.
        </p>
        <div className="project-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="primary-action"
            disabled={!preview.selection}
          >
            {action === "print" ? "Prepare print" : "Export"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
