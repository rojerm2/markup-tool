# Changelog

Versioned changes follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Debounced local crash checkpoints and startup recovery of unsaved projects,
  including a verified PDF snapshot without repeated large-file copies.
- Bounded recovery retention, automatic checkpoint retries, and cleanup after
  Save, Discard and interrupted writes.
- Corresponding font source and provenance checks in build/distribution assets.
- Collapsible Pages, Bookmarks and searchable Markups navigation, with bounded
  thumbnail previews and direct selection of off-page annotations.
- Project bookmarks and restored page, zoom and PDF-space view position without
  adding navigation steps to annotation undo history.
- Undoable category visibility and locking, enforced by the annotation state
  layer and preserved in version 3 projects.
- Mixed-markup selection with Shift-click and list checkboxes; group movement,
  category assignment, duplicate, copy/paste across pages and atomic undo/redo.

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

[0.3.0]: https://github.com/rojerm2/markup-tool/releases/tag/v0.3.0
[0.2.6]: https://github.com/rojerm2/markup-tool/commit/b14aa6b
