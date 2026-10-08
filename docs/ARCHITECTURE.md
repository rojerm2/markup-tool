# Architecture

PDF Markup is a Windows desktop application, with a React/TypeScript editor in
Tauri's WebView2 frontend and Rust handling authorized local file operations.

```mermaid
flowchart LR
  UI[React editor] --> State[Session and undo history]
  UI --> Render[PDF.js rendering]
  State --> Worker[PDF export worker]
  Worker --> Bridge[Binary native bridge]
  Bridge --> Files[Rust identity checks and atomic writes]
  Files --> Project[Portable .pmarkup]
  Files --> PDF[Annotated PDF]
  Files --> Print[Isolated print preview]
```

- `src/components/`: controls, PDF navigation, raster tiles, vector overlays.
- `src/services/`: project schema, geometry, undo, preferences, loading/export.
- `src-tauri/src/`: portable container, scoped persistence, recents, printing.
- `tests/`: frontend unit/component tests; Rust tests live beside native code.
- `scripts/`: asset provisioning, release checks, checksums, benchmarks.

Coordinates are stored in PDF space. Rotation, crop boxes, user units, zoom,
and scrolling are handled at the view boundary. Overlays and export reuse
the same geometry/layout functions. Rendering bounds the full-page raster
and adds detail only for the visible area.

Committed annotations belong to the session. Pointer/input drafts are separate
until committed. History records highlight creation, deletion and movement as
geometry deltas, preserving current appearance, settings and other markup types
during traversal. Settings do not clear highlight redo. Restoration respects
category locks and ID ownership, and detaches references to deleted categories.
Save, export, and print snapshot committed state and cancel pending
gestures without applying unfinished text/property drafts.

Bulk edits validate an immutable starting snapshot and every child operation
before accepting the batch; only its highlight geometry changes form a history
entry. Selection and the bounded, document-local
clipboard are transient UI state. Paste transforms through source and destination
PDF viewports, gives objects and nested pointers fresh IDs, checks category policy
and validates resulting project limits. Hidden categories affect workspace
rendering only; locks are enforced centrally for every annotation mutation.

Measurements store PDF points and per-page two-point calibrations. Shared
geometry validates simple polygons, finite scales and bounded vertex counts;
shared text layout and font advances drive canvas labels and PDF operators.
Recalibration changes derived values without rewriting geometry; category locks
protect those derived values. Paste carries geometry and style, then uses the
destination scale and bounds its labels. Measurement/calibration data requires
schema 4, while older annotation-only projects retain their compatible schema.

Reusable presets are bounded versioned JSON with drawing styles, category
definitions and original selected-object symbols. They contain no document
source, view metadata or calibration. Symbol geometry uses a canonical viewport
and the same validated clipboard transforms as ordinary paste. Applying a
preset or placing a symbol is a guarded atomic session transaction; highlight
placement alone enters undo history. Name/color
conflicts add a renamed category instead of mutating an existing definition.
Shape and measurement defaults are optional schema-4 session data. The local
library is capped at 24 entries/4 MiB, each portable file at 1 MiB, and each
symbol at 100 objects. Native reads/writes require the editor window and a
dialog-authorized path; writes are atomic and reject non-preset replacements.
Library errors retain the prior data. Imports are previewed before application.

Portable projects contain a versioned container, validated JSON metadata, and
the original PDF bytes. The native layer checks length and SHA-256 identity,
extracts embedded PDFs to owned temporary files, and prevents source-PDF
replacement through aliases or hard links. Legacy project references never
authorize a new filesystem path.

Export runs in a dedicated worker and preserves original PDF streams rather
than rasterizing the document. The full PDF is rewritten. Binary IPC avoids
JSON arrays; native source verification streams through a bounded buffer.

Export selection is validated before file dialogs and again against the
actual PDF page count. Filtering retains original page numbers until vector
annotations are applied; selected pages are copied in document order to the
output. Locked categories do not prohibit output, while hidden-category
inclusion is an explicit policy. Page legends lose excluded rows and empty
legends are omitted. Print uses the same generation pipeline and selection.

Each export/print owns a separate abort controller combined with the document
signal. Worker termination stops CPU processing and ignores late messages.
Cancellation is disabled during atomic publication; no post-publication abort
check can misreport a completed file as cancelled. Annotation history and the
saved baseline are independent of the immutable export snapshot.

Report workers receive validated annotation state, selection and the filename,
without PDF bytes or source paths. The shared model supplies individual rows,
counts and separate unit/calibration totals. CSV neutralizes formula-like
text; PDF wraps and paginates with the bundled verified font. CSV saves require
the main window, native-dialog path authorization, bounded UTF-8 binary data,
source identity revalidation and a protected atomic destination. PDF reports
reuse the protected PDF writer. Reports introduce no new dependencies or
filesystem permissions.

The application identifier remains `com.orcific.pdf-markup-tool` across
releases to retain local preferences and recent-files storage.

Revision comparison borrows the open project's source pages without taking
ownership, or loads dialog-authorized PDFs through the existing bounded native
reader. Independently owned PDF.js documents are aborted on replacement/close;
cancelled or failed loads retain prior documents. Page pairing never silently
clamps missing pages. Viewport-space alignment handles crop, PDF rotation and
user units with offsets independent of display zoom; union bounds retain moved
or rotated sheets. Separate scroll surfaces synchronize both sides.

Comparison overview and visible-detail canvases are each limited to four million
pixels and 4096 pixels per edge. Inverse sheet transforms locate visible detail
on rotated/scaled revisions. Replaced renders are cancelled and stale results
cannot publish. Overlay tint affects rendered pixels only, and the overview is
masked beneath its detail tile to avoid doubling ink. Comparison settings remain
temporary; no document bytes, paths or new permissions are persisted by it.

Each open document owns a serialized recovery journal. Debounced checkpoints
store project metadata and a source PDF snapshot in the app's local data
directory. Native checkpoint writes run outside the UI thread and copy the PDF
only when creating a new record. Save and Discard queue cleanup behind pending
writes; failures retain the previous checkpoint and retry. Startup recovery
verifies the cached PDF identity, validates the project, extracts an owned
temporary source and opens an unsaved copy rather than overwriting a project.
Recovery commands accept generated identifiers, require the editor window and
never authorize stored references. Completed retention is limited to eight
records and 512 MiB, and interrupted internal temporary files are cleaned up.
