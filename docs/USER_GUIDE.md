# PDF Markup

Open a PDF, highlight or annotate it, and choose **Save Project** to keep the PDF and editable annotations together in a single `.pmarkup` file. Use **Open Project** to continue later. The original PDF is not needed to reopen, edit, save a copy, or export a newly saved project.

**Export Annotated PDF** creates a PDF for sharing or printing. **Save As** creates another editable project.

Hold **Space** and drag to pan, including after clicking a toolbar button. Text fields retain normal typing, and buttons reached with **Tab** retain normal Space activation. **Hand** mode keeps panning enabled without holding Space.

Use the **Width** slider in Properties to set highlights from **0.25 to 100 pt**, or enter an exact value. The preview shows the thickness; release the slider to apply the adjustment as one Undo step. Thin, Medium, and Thick remain available as quick presets. Select an existing highlight in **Select/Edit** to adjust its width with the same control.

Space returns numeric fields and sliders to the canvas for panning. Enter finishes width or page entry; page entry accepts digits only, validates the page range, and restores the current page when abandoned. Click the PDF to resume drawing. Real text fields keep normal spaces and editing shortcuts.

**Shift + drag** draws a straight highlight at any angle; **Ctrl + Shift + drag** snaps it to the nearest horizontal, vertical, or 45-degree direction. In Select/Edit, arrow keys move a selected highlight by 2 view units at 100% zoom; hold Shift for 10. These movements are undoable.

**Preferences** contains Dark mode, Larger controls, and Action sounds. These preferences persist locally and do not affect project contents or PDF colors. Dark mode initially follows the system appearance. Sounds are off by default; enable them and adjust the **Volume** slider from 0 to 100%. Use **Test sound** to hear the current level. The default enabled volume is louder than in 0.2.4.

Zoom extends from **10% to 3200%**, using the buttons or Ctrl + wheel. For large sheets and high zoom, a sharp tile follows the visible area while a bounded overview preserves the rest of the page. This avoids allocating a canvas for the entire sheet at full resolution. Drawing and exported annotations remain vectors.

The current filename and full path appear above the workspace. For a saved or opened project, this shows the `.pmarkup` location instead of the temporary copy of its included PDF. **Recent files** lists the last 12 PDFs and projects, with full paths and last-opened date/time. Click a file to reopen it directly, including after restarting the app. **Clear list** removes only the recent history. Moved or missing files show an error and leave the current work open. Recent files are stored locally in the app's configuration directory; only previously authorized file paths can be reopened.

In **Select/Edit**, a hand pointer marks clickable highlights, shapes, notes, arrows, and page legends. Resize handles retain their editing cursor, and panning shows grab/grabbing cursors.

Undo/redo briefly outlines affected areas and shows the action/page in a status message. Offscreen changes are brought into view; deleted objects are outlined where they used to be. Reduced-motion settings use a static outline instead of pulsing.

## Existing projects

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

Run `npm run release:checksums`, then copy `src-tauri/target/release/bundle/nsis/pdf-markup-tool_0.3.0_x64-setup.exe` to another 64-bit Windows computer and run it. Launch **PDF Markup** from the Start menu after installation. Node.js and Rust are not needed on that computer. The installer can download Microsoft WebView2 if it is missing.

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

Export still rewrites the full PDF, so complexity, file size, disk speed, and available memory affect duration. This is not incremental PDF saving. The current 256 MiB input/output limits remain.

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

Portable projects contain an 8-byte `PMARKUP` magic/version marker, a little-endian 32-bit metadata length, a little-endian 64-bit PDF length, project JSON, and the original PDF bytes. Metadata remains compatible with the version 2 annotation schema. Legacy JSON project versions 1 and 2 can still be read.

The application limits annotation metadata to 16 MiB and the included PDF to 256 MiB. It checks the included PDF's size and SHA-256 identity before opening it, extracts only to an application-generated temporary file, and saves atomically using a temporary sibling file. Embedded filenames do not authorize access to other local files.

## Text boxes, feedback, and printing (0.2.6)

Select a page legend or text note in **Select/Edit**, then drag an edge or corner handle to resize its box. Text reflows when the width changes. The box stays large enough to contain its text; dragging top or left edges holds the opposite edge in place, including on rotated sheets. Resize is one undoable operation. Escape or changing views cancels an unfinished resize.

Legend and note properties offer a **1–200 pt** slider plus direct numeric entry, including fractional sizes. Existing projects keep their original sizes. Saved legends retain their manually expanded box height, and the exported PDF uses the same layout.

Right-click offers application actions: undo/redo, markup tools, selected-object deletion, fitting the view, file operations, and printing. Right-clicking an object selects it. Text fields additionally offer copy, cut, paste, and select-all actions. Keyboard and browser-style menus are replaced inside the editor.

**Print** or **Ctrl+P** prepares a PDF containing every committed annotation and opens its PDF preview. Click the preview’s printer icon. If browser print settings appear, choose **Print using system dialog** to open the Windows print UI. Choose the printer and pages there; cancelling does not alter the project. The print preview keeps a temporary PDF until it closes. Printing does not require exporting or saving a project first. Unsaved text/property drafts must be applied before they can appear in print. **Ctrl+S** saves, and **Ctrl+Shift+S** saves as a new project.

A green check confirms project saves; a blue outgoing arrow confirms exports. Both display the resulting filename, can be dismissed, and respect reduced-motion settings. Highlighter width and color controls show a temporary dot on the visible page at the actual stroke thickness for the current zoom. This preview is not a saved markup and disappears when drawing begins.

The actual user-supplied floor-plan benchmark (96,382,176 bytes, 37 pages) generated an annotated PDF in about **2.45 seconds** on this machine, excluding native transfer and file writing. A desktop export took about **11.7 seconds** from destination confirmation to the final file write while a release build was also running. It preserved all **4,413 original PDF streams** byte-for-byte, page sizes, crop boxes, and rotations. The original file remained unchanged. Run the local benchmark with `PDF_MARKUP_REAL_PDF` set to the PDF path; the private file and generated outputs are excluded from Git.
