# PDF Markup

Open a PDF, highlight or annotate it, and choose **Save Project** to keep the PDF and editable annotations together in a single `.pmarkup` file. Use **Open Project** to continue later. The original PDF is not needed to reopen, edit, save a copy, or export a newly saved project.

**Export Annotated PDF** creates a PDF for sharing or printing. **Save As** creates another editable project.

Hold **Space** and drag to pan, including after clicking a toolbar button. Text fields retain normal typing, and buttons reached with **Tab** retain normal Space activation. **Hand** mode keeps panning enabled without holding Space.

Use the **Width** slider in Properties to set highlights from **0.25 to 100 pt**, or enter an exact value. The colored dot and dashed outline both show the actual thickness at the current zoom, including very thin widths. Release the slider to apply the adjustment. Thin, Medium, and Thick remain available as quick presets. Select an existing highlight in **Select/Edit** to adjust its width with the same control.

Space returns numeric fields and sliders to the canvas for panning. Enter finishes width or page entry; page entry accepts digits only, validates the page range, and restores the current page when abandoned. Click the PDF to resume drawing. Real text fields keep normal spaces and editing shortcuts.

**Shift + drag** draws a straight highlight at any angle; **Ctrl + Shift + drag** snaps it to the nearest horizontal, vertical, or 45-degree direction. In Select/Edit, arrow keys move a selected highlight by 2 view units at 100% zoom; hold Shift for 10. These movements are undoable.

**Preferences** contains Dark mode, Larger controls, and Action sounds. These preferences persist locally and do not affect project contents or PDF colors. Dark mode initially follows the system appearance. Sounds are off by default; enable them and adjust the **Volume** slider from 0 to 100%. Use **Test sound** to hear the current level. The default enabled volume is louder than in 0.2.4.

Zoom extends from **10% to 3200%**, using the buttons or Ctrl + wheel. For large sheets and high zoom, a sharp tile follows the visible area while a bounded overview preserves the rest of the page. This avoids allocating a canvas for the entire sheet at full resolution. Drawing and exported annotations remain vectors.

The current filename and full path appear above the workspace. For a saved or opened project, this shows the `.pmarkup` location instead of the temporary copy of its included PDF. **Recent files** lists the last 12 PDFs and projects, with full paths and last-opened date/time. Click a file to reopen it directly, including after restarting the app. **Clear list** removes only the recent history. Moved or missing files show an error and leave the current work open. Recent files are stored locally in the app's configuration directory; only previously authorized file paths can be reopened.

In **Select/Edit**, a hand pointer marks clickable highlights, shapes, notes, arrows, and page legends. Resize handles retain their editing cursor, and panning shows grab/grabbing cursors.

**Undo/Redo** applies only to creating, deleting, and moving highlight strokes. Color, width, rounding, category changes, drawing defaults, shapes, text, measurements, and page legends do not add history steps. Undoing a highlight movement keeps its latest appearance; undoing or redoing a highlight does not revert settings or other markups. Setting changes keep existing highlight redo available. Locked categories must be unlocked before their highlights can be undone or redone.

Undo/redo briefly outlines affected highlight areas and shows the action/page in a status message. Offscreen changes are brought into view; deleted highlights are outlined where they used to be. Reduced-motion settings use a static outline instead of pulsing.

## Document navigation

Choose **Pages & markups** to open the document sidebar. **Pages** shows page
thumbnails; clicking one jumps to that page. Preview rendering is limited to
nearby thumbnails, even in a document with thousands of pages. Pages with very
complex annotations show a source preview and an annotation count.

**Bookmarks** lets you name the current page and jump back to it later. Bookmarks
are saved inside the project, including recovery checkpoints. Adding, changing
or removing a bookmark creates unsaved project changes. Annotation Undo/Redo
continues to affect highlights; use the bookmark controls to change bookmarks.

**Markups** lists highlights, shapes, text, arrows, measurements and page legends. Search by
label, page, type or category, and combine the type/category/current-page filters.
Click a result to bring it into view and select it for editing. Keyboard focus
returns to the page so arrow keys move the selected object and Space pans.

The last page, zoom and view position are restored locally when reopening the
same document or project. Manual saves include the view for another computer.
View changes do not create unsaved edits or annotation Undo steps. Local view
preferences retain up to 12 document identities; they contain no PDF contents
or annotation data.

## Editing several markups

In **Select/Edit**, hold **Shift** and click markups to add or remove them from
the selection. The **Markups** list also provides selection checkboxes, including
for objects on different pages. **Ctrl+A** on the canvas selects editable marks
on the current page. A selection can contain up to 500 objects.

The selection bar offers **Copy**, **Paste**, **Duplicate**, **Delete selected**,
and category assignment. **Ctrl+C**, **Ctrl+V**, **Ctrl+D**, and **Delete** also
work outside text fields. Copy takes marks from one page; navigate to another
page and paste near the center of its current view. Copy remains available after
changing pages and is local to the open document, separate from the Windows
clipboard. Opening another document clears it. Duplicate keeps each mark on its
own page with a small offset. Highlight changes within a bulk edit use one Undo
step; other selected markup changes remain applied.

Drag the outer selection outline to move the group, or use arrow keys on the
canvas (2 view units at 100% zoom, or 10 with Shift). Movement respects page
bounds and includes text pointer targets. Escape, Space, view changes, Save and
Undo cancel unfinished group drags. Locked or hidden categories cannot be
selected for bulk edits. Hiding and locking a selected category clears its
selection; copying never unlocks destination categories.

## Measurements

Choose **Measure → Calibrate page**, drag between two points with a known
real-world distance, then enter the distance and unit in Properties and choose
**Apply scale**. Dashed reference points stay visible until you apply or cancel.
Scale belongs to that page; other pages remain uncalibrated. Units include mm,
cm, m, in, ft and yd. Changing the unit converts the entered reference distance.
Use **Change page scale** to reuse the reference points or draw a new reference.
Recalibration updates that page's measurements without adding an Undo step. Unlock any
locked measurements on the page before changing its scale.

**Length** measures a dragged straight line. **Area** and **Perimeter** use a
closed polygon: click each vertex, then press Enter, double-click, or click the
first point to finish. Escape, Space, view changes, Save and Undo cancel an
unfinished drawing. Crossing, overlapping or degenerate polygons are rejected;
a polygon supports up to 128 vertices, and a project supports 1,000 measurements.
Without a scale, labels explicitly show **PDF units (uncalibrated)**.

In **Select/Edit**, click a measurement to move it, drag its endpoint/vertex
handles to change its geometry, or use arrow keys to nudge it. Properties offers
color, line width (0.01–100 pt) and text size (1–200 pt); **Apply appearance**
commits the selected object's changes together. Save and view changes cancel
unapplied appearance drafts. Measurements support category assignment, hide/lock,
search, multi-selection, duplicate and copy/paste. Pasted measurements use the
destination page's scale; pasting never copies or replaces a page calibration.

Exported PDFs and print previews include the same vector geometry and labels.
Labels follow the sheet's orientation on rotated pages. Measurements are
estimates: verify drawing scales and dimensions against authoritative sources.
Projects containing measurements or calibrations use schema version 4, which
older releases reject instead of silently losing measurements.

## Existing projects

In **Legends**, **Hide/Show** controls workspace visibility; exported PDFs still
include hidden categories. **Lock/Unlock** protects assigned markups from moves,
deletion and style changes. Locked categories cannot be deleted or selected for
new highlighting until explicitly unlocked. These settings are
saved in the project. Projects with category protection use schema version 3;
older releases reject them instead of silently dropping the protection.

Older projects stored a reference to the original PDF. Open one and locate that PDF if prompted, then save it to upgrade it. New portable projects require this version of the app; older app versions cannot open them. Project files now include the PDF's contents, so they are larger than the old annotation-only files.

## Run and build

```powershell
npm ci
npm run tauri dev
```

To build a standalone desktop executable without an installer:

```powershell
npm run tauri build -- --debug --no-bundle
```

The Windows executable is `src-tauri/target/debug/pdf-markup-tool.exe`. It includes the frontend and does not need a development server. A browser preview (`npm run dev`) does not provide native file dialogs.

To create the Windows installer:

```powershell
npm run tauri build -- --bundles nsis
```

Run `npm run release:checksums`, then copy `src-tauri/target/release/bundle/nsis/pdf-markup-tool_0.4.0_x64-setup.exe` to another 64-bit Windows computer and run it. Launch **PDF Markup** from the Start menu after installation. Node.js and Rust are not needed on that computer. The installer can download Microsoft WebView2 if it is missing.

## Validation

Run `npm run format` to format frontend code, tests, scripts, and configuration with Prettier, enforce blank lines before function declarations with ESLint, and format Rust with `cargo fmt`. The style uses two-space indentation, double quotes, semicolons, trailing commas, and an 80-column wrapping guideline. Generated assets and build output are excluded. Rust formatting requires the Rust toolchain and rustfmt.

Run `npm run format:check` to check formatting and lint without modifying files.

```powershell
npm run typecheck
npm test -- --maxWorkers=1
cargo test --manifest-path src-tauri/Cargo.toml
```

## Large PDFs

Export preserves the original pages as vectors and retains original image streams. The PDF is parsed and written in a dedicated worker, without per-object timer delays. Output crosses the native bridge as binary bytes; it is not expanded into a number array or JSON. Source revalidation uses a 64 KiB buffer. The status line shows preparing, building, and saving stages; these are stages, not estimated percentages.

Export still parses the source PDF, so complexity, file size, disk speed, and available memory affect duration. All-page export rewrites the full PDF; selected-page export copies the chosen pages with their original vectors and images into a new PDF. This is not incremental PDF saving. The current 256 MiB input/output limits remain.

**Export Annotated PDF** keeps the usual one-click all-page workflow. Use
**Export options…** to choose all pages, the current page, or ranges such as
`1, 3-5`, then select categories and whether to include unassigned and hidden
markup. Hidden content is included by default, matching earlier exports;
locked markup can always be exported. The preview shows the selected page and
markup counts. Pages keep their original document order. **Print annotated
pages** uses the same selection and vector output as export.

Processing shows real stages and elapsed seconds. **Cancel** stops processing
without publishing a partial output; source reading may finish before the
cancellation is acknowledged. Cancel is unavailable while choosing a native
destination, during the final atomic save, or while opening print preview.
Cancel the native Save dialog to return without creating a file. A completed
save is reported as successful even if cancellation arrives afterward.

Choose **CSV markup report** or **PDF markup report** in the same options
dialog. Reports list source and exported page numbers, markup type, category,
color, annotation text, counts and measurements. Length, area and perimeter
totals remain separate by unit and calibrated/uncalibrated status. Area units
are square units. Measurements are review aids; check page calibration and
drawing accuracy before relying on quantities. Review annotation text before
sharing reports. Reports contain the PDF filename, never an automatic full
source path or embedded original PDF.

CSV uses UTF-8 with a BOM, quoted cells and one rectangular table. **Record
type** identifies individual Markup rows, per-page/category/type Count rows,
and measurement Total rows. Text that could become a spreadsheet formula is
prefixed with an apostrophe. PDF reports wrap and paginate text using the
bundled font; unsupported characters appear as `[U+XXXX]`, while CSV retains
the original text. CSV output is limited to 64 MiB. Report destinations cannot
replace the source PDF or current editable project, including hard-link aliases.

Run the opt-in synthetic benchmark and bridge microbenchmark separately from normal tests:

```powershell
$env:PDF_MARKUP_BENCHMARK = '1'
npm test -- tests/largeExport.test.tsx --maxWorkers=1
Remove-Item Env:PDF_MARKUP_BENCHMARK
node --expose-gc scripts/benchmark-export-bridge.mjs
```

The fixture has 32 pages, roughly 101 MB of raw image streams plus 50,000 indirect objects, and one highlight. It is not a real CAD floor plan. Generated fixtures and measurements are saved under `internal_docs/performance-qa/` and ignored by Git. The baseline measures default PDF parsing/saving without markup; the optimized run also adds the highlight. Bridge measurements exclude WebView transmission, Rust JSON parsing, and disk I/O.

One local run measured default parsing/saving at 7.34 seconds and optimized PDF generation at 1.51 seconds. The former array/JSON preparation alone took another 5.40 seconds and grew the JavaScript heap by about 1.44 GB. These are separate measurements, not a combined end-to-end comparison. A release 0.2.3 desktop export completed in approximately 8.6 seconds from confirming the destination to the output's final write. The exported PDF reopened with all 32 pages, the highlight, and every original image stream byte-for-byte intact. Actual CAD drawings may behave differently; these results are not a performance guarantee.

## Project storage

Portable projects contain an 8-byte `PMARKUP` magic/version marker, a little-endian 32-bit metadata length, a little-endian 64-bit PDF length, project JSON, and the original PDF bytes. Metadata uses version 2 for ordinary annotations, version 3 when category protection or non-highlight category assignments are present, and version 4 for measurements, page calibrations or saved drawing defaults. Legacy JSON project versions 1 and 2 can still be read.

The application limits annotation metadata to 16 MiB and the included PDF to 256 MiB. It checks the included PDF's size and SHA-256 identity before opening it, extracts only to an application-generated temporary file, and saves atomically using a temporary sibling file. Embedded filenames do not authorize access to other local files.

## Text boxes, feedback, and printing (0.2.6)

Select a page legend or text note in **Select/Edit**, then drag an edge or corner handle to resize its box. Text reflows when the width changes. The box stays large enough to contain its text; dragging top or left edges holds the opposite edge in place, including on rotated sheets. These edits are outside highlight history. Escape or changing views cancels an unfinished resize.

Legend and note properties offer a **1–200 pt** slider plus direct numeric entry, including fractional sizes. Existing projects keep their original sizes. Saved legends retain their manually expanded box height, and the exported PDF uses the same layout.

Right-click offers application actions: undo/redo, markup tools, selected-object deletion, fitting the view, file operations, and printing. Right-clicking an object selects it. Text fields additionally offer copy, cut, paste, and select-all actions. Keyboard and browser-style menus are replaced inside the editor.

**Print** or **Ctrl+P** prepares a PDF containing every committed annotation and opens its PDF preview. Click the preview’s printer icon. If browser print settings appear, choose **Print using system dialog** to open the Windows print UI. Choose the printer and pages there; cancelling does not alter the project. The print preview keeps a temporary PDF until it closes. Printing does not require exporting or saving a project first. Unsaved text/property drafts must be applied before they can appear in print. **Ctrl+S** saves, and **Ctrl+Shift+S** saves as a new project.

A green check confirms project saves; a blue outgoing arrow confirms exports. Both display the resulting filename, can be dismissed, and respect reduced-motion settings. Highlighter width and color controls show a temporary dot on the visible page at the actual stroke thickness for the current zoom. This preview is not a saved markup and disappears when drawing begins.

The actual user-supplied floor-plan benchmark (96,382,176 bytes, 37 pages) generated an annotated PDF in about **2.45 seconds** on this machine, excluding native transfer and file writing. A desktop export took about **11.7 seconds** from destination confirmation to the final file write while a release build was also running. It preserved all **4,413 original PDF streams** byte-for-byte, page sizes, crop boxes, and rotations. The original file remained unchanged. Run the local benchmark with `PDF_MARKUP_REAL_PDF` set to the PDF path; the private file and generated outputs are excluded from Git.

## Reusable presets

Open **Presets** to save drawing styles and category sets to a local library.
Enter a name and choose **Save current settings**. The library holds up to 24
presets and 4 MiB in total. Replacing a matching name requires enabling
**Replace existing preset**. Saving a preset does not save or change the project.

Choose a saved preset or **Import preset** to preview it before applying.
Choose whether to apply drawing styles, add categories, or both. Existing
markups keep their appearance. Matching category names and colors are reused;
name conflicts create a numbered category rather than replacing an existing
one. Reused categories retain their hidden and locked states. **Apply preset**
applies the settings without adding an Undo step. Shape and measurement drawing
defaults also persist in portable projects.

Select up to 100 highlights, shapes, text notes or arrows on one page, then open
**Presets**, choose a saved preset, enter a symbol name and choose **Save selected
markups as symbol**. Preview the symbol and choose **Place on current page** to
insert it near the visible page center with fresh object IDs. Choose whether to
import its categories. Undo removes only the symbol's highlights; its other
markups and imported categories remain. Measurements,
calibration and page legends cannot be saved as symbols.

**Export preset** produces a portable `.pmpreset` file of at most 1 MiB. It
contains drawing geometry, styles and category names, but no source PDF, source
file path, bookmarks or calibration. Symbols can contain text from your
selection; review them before sharing. No network connection is needed.
Invalid imports and storage failures appear in the dialog. A corrupt local
library is left intact rather than automatically replaced.

## Comparing drawing revisions

Choose **Compare PDFs…** to compare two local PDFs. The open project's original
PDF becomes the baseline, or choose a baseline when no project is open. Choose
a revision PDF and pair the matching pages using the independent page controls.
If the revision lacks the baseline's page number, choose its matching sheet
explicitly; the app does not substitute another page automatically.

**Side by side** synchronizes both views. Drag either sheet, use its scrollbars,
or focus it and use the arrow keys (Shift moves farther). **Color overlay** shows
baseline ink in blue, revision ink in red, and overlapping ink darker. White
backgrounds become transparent. This mode compares rendered ink rather than
the semantic contents of the drawings.

Open **Align revision** to adjust horizontal/vertical offsets, scale or rotation.
Offsets are percentages of the baseline's sheet dimensions and remain stable
when zoom changes. Both sheets retain their PDF viewport dimensions, including
crop, rotation and user units. Reset alignment or choose another page pair to
start again. Zoom ranges from 25% to 3200% of the fitted view; a bounded detail
tile follows the visible area at high zoom. **Fit sheets** fits the full aligned
drawing area and resets scrolling on both sides. Changing alignment keeps the
current zoom scale stable; fit again to include the moved or rotated sheet.

Comparison runs locally without modifying either PDF or the project. It shows
original PDF pages, without the project's added markups, and comparison settings
are temporary. Rendering quality and alignment affect what can be seen; visual
comparison does not guarantee detection of every change. Verify significant
findings against the source drawings. Close comparison to resume editing.

## Local recovery

The desktop editor keeps local checkpoints of unsaved changes after a short
pause in editing. The first checkpoint copies and verifies the source PDF;
later checkpoints update annotation metadata rather than copying the PDF again.
“Recovery up to date” indicates a completed checkpoint. A storage error appears
in the editor and checkpoints retry automatically. Changes made immediately
before a crash, before the checkpoint completes, may not be recoverable.

On launch, **Recover unsaved work** lists available checkpoints. **Recover**
opens an editable copy, including its saved source PDF, so the original PDF is
not required. Save the recovered copy as a new `.pmarkup` project. **Dismiss**
permanently removes that checkpoint. Explicit Save and Discard remove the
active checkpoint once pending writes have finished. Recovery does not replace
normal project saving or backups.

Recovery files stay in the application's local data directory. They can contain
the complete PDF and annotations; they are not uploaded or encrypted by the
app. At most eight checkpoints and 512 MiB of completed recovery data are kept,
with older checkpoints removed when the limit is reached. The newest active
checkpoint is retained first.
