# Changelog

Versioned changes follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.4.2] - 2026-10-08

### Changed

- Undo/redo now tracks highlight creation, deletion, and movement only. Property
  adjustments, category settings, and other markup types remain applied.
- Highlight history preserves the latest appearance and keeps redo available
  after setting changes, without bypassing locks or restoring deleted categories.

### Fixed

- The dashed width-preview circle shrinks with the colored dot below the old
  minimum size, including 0.25 pt highlights and different zoom levels.

### Security

- Update transitive `source-map-js` to 1.2.2 for
  [GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q).

## [0.4.1] - 2026-10-04

### Fixed

- Preserve the verified upstream NSIS notice byte for byte and check its digest
  before packaging, preventing silent Git line-ending conversion.
- Use deterministic LF line endings for application and font license text.

Includes the feature set prepared for 0.4.0, whose release draft was not published.

## [0.4.0] - 2026-10-04

### Added

- Read-only PDF revision comparison with synchronized side-by-side views,
  blue/red color overlays, explicit page pairing and manual sheet alignment.
  Bounded overview and visible-detail rendering support large sheets and zoom.
- Optional page/category export and selected-page printing, cancellable worker
  processing, elapsed time and explicit processing/save stages.
- CSV and paginated PDF markup reports with source/export page mapping,
  annotation text, counts and unit/calibration-separated measurement totals;
  formula-safe CSV text and protected atomic report saving.

- Local reusable drawing presets, category sets and original symbol groups;
  portable bounded `.pmpreset` import/export, previews, explicit replacement,
  conflict-safe category mapping and atomic undo for applying and placing.
- Portable, undoable shape and measurement drawing defaults.

- Debounced local crash checkpoints and startup recovery of unsaved projects,
  including a verified PDF snapshot without repeated large-file copies.
- Bounded recovery retention, automatic checkpoint retries, and cleanup after
  Save, Discard and interrupted writes.
- Corresponding font source and provenance checks in build/distribution assets.
- Repeatable Windows Rust dependency audits using a checksum-verified tool;
  development dependencies are included in npm security checks.
- Collapsible Pages, Bookmarks and searchable Markups navigation, with bounded
  thumbnail previews and direct selection of off-page annotations.
- Project bookmarks and restored page, zoom and PDF-space view position without
  adding navigation steps to annotation undo history.
- Undoable category visibility and locking, enforced by the annotation state
  layer and preserved in version 3 projects.
- Mixed-markup selection with Shift-click and list checkboxes; group movement,
  category assignment, duplicate, copy/paste across pages and atomic undo/redo.
- Per-page distance calibration and length, polygon area and perimeter tools;
  editable measurement vertices, matching vector export/print labels and version
  4 project storage. Uncalibrated values are identified explicitly.

## [0.3.0] - 2026-10-04

### Added

- Windows CI and tagged draft-release workflow with installer/checksum artifacts.
- Version consistency checks, pinned toolchains, contributor and release guides.
- MIT license, security policy, issue/PR templates, and third-party license notices.
- Optional Authenticode signing hook with signature verification.

### Changed

- Standardized source formatting and lint checks.
- Updated product metadata and installer branding while retaining the app identifier.
- Enabled a content security policy that excludes dynamic JavaScript evaluation.
- Removed unused starter command and opener capability/dependencies.

## [0.2.6] - 2026-10-02

- Resizable page legends/text notes with 1–200 pt text sizes.
- App-specific right-click menus and annotated PDF printing.
- Distinct save/export feedback and actual-size stroke/color previews.
- Validated exports with a 96 MB, 37-page floor plan.

Earlier commits contain the development history for portable projects,
highlighter/shapes/text editing, large-PDF export, focus handling,
undo/redo, dark mode, zoom, sounds, and recent files.

[0.4.2]: https://github.com/rojerm2/markup-tool/releases/tag/v0.4.2
[0.4.1]: https://github.com/rojerm2/markup-tool/releases/tag/v0.4.1
[0.4.0]: https://github.com/rojerm2/markup-tool/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/rojerm2/markup-tool/releases/tag/v0.3.0
[0.2.6]: https://github.com/rojerm2/markup-tool/commit/b14aa6b
