# PDF Markup

[![CI](https://github.com/rojerm2/markup-tool/actions/workflows/ci.yml/badge.svg)](https://github.com/rojerm2/markup-tool/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A Windows desktop app for highlighting, drawing, and annotating PDFs. Save
the PDF and editable markups together in one portable project, then export an
annotated PDF for sharing or printing. Documents stay on your computer.

## Install

Download the Windows x64 installer from [GitHub Releases](https://github.com/rojerm2/markup-tool/releases).
Launch **PDF Markup** after installation. You do not need Node.js or Rust.
WebView2 is downloaded if missing; normal editing works offline.

Windows 11 x64 is the locally tested platform. Each release includes
`SHA256SUMS.txt` and states whether its installer is signed. The initial 0.3.0
build is unsigned; trusted-publisher distribution requires a signing certificate.

## Features

- Highlight with adjustable thickness, color, and corner rounding; draw straight or 45-degree snapped lines.
- Add shapes, text notes, arrows, categories, and resizable page legends.
- Save self-contained `.pmarkup` projects and reopen them without the original PDF.
- Export vector annotations while preserving the original page and drawing data.
- Print an annotated preview using Windows print settings.
- Navigate large sheets with pan, fit controls, and 10–3200% zoom.
- Highlight-only undo/redo with visual feedback; use dark mode, recent files, and optional sounds.
- Recover unsaved work after a crash; navigate with thumbnails, bookmarks, and a searchable markup list.
- Select, copy, and edit multiple markups; hide or lock categories.
- Calibrate each page and measure lengths, areas, and perimeters.
- Reuse drawing presets, category sets, and symbols across projects.
- Export or print selected pages/categories, cancel processing, and create CSV or PDF markup reports.
- Compare original drawing revisions side by side or with color overlays and manual alignment.

## Quick start

1. **Open PDF** and select a markup tool.
2. Draw on the page. Hold **Space** and drag to pan; **Ctrl + wheel** zooms.
3. Use **Select/Edit** to move, resize, or change existing markups.
4. **Save Project** keeps editable work. **Export Annotated PDF** creates a shareable PDF.

**Print** opens an annotated preview. Click its printer icon, then choose
**Print using system dialog** for the Windows print UI. **Ctrl+S** saves;
**Ctrl+Shift+S** saves a copy; **Ctrl+P** prepares printing.

See the [user guide](docs/USER_GUIDE.md) for keyboard controls, portable
projects, text/legend sizing, and performance details.

## Build from source

Use Node.js 24, the pinned Rust toolchain, Microsoft C++ build tools, and WebView2.
See [Tauri prerequisites](https://tauri.app/start/prerequisites/).

```powershell
npm ci
npm run tauri dev
```

To build the Windows installer:

```powershell
npm run check:release
npm run tauri build -- --bundles nsis
npm run release:checksums
```

Output: `src-tauri/target/release/bundle/nsis/`. Browser-only development
does not provide native file dialogs or persistence.

## Quality and maintenance

Windows CI checks formatting/lint, TypeScript, frontend tests, Rust lint/tests,
release versions, JavaScript and Windows Rust dependency advisories, and installer packaging.
Tagged builds create a draft release for review. Dependencies are checked weekly.

- [Contributing](CONTRIBUTING.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Release process and signing](docs/RELEASING.md)
- [Changelog](CHANGELOG.md)
- [Security policy](SECURITY.md)

## Limits and privacy

PDF input/export is limited to 256 MiB; project annotation metadata to 16 MiB.
Complex CAD files can require substantial memory. Export parses the source PDF
and rewrites the selected output pages.
Projects include the entire source PDF and are not encrypted. Markup is not
secure redaction. Unapplied text/property drafts are excluded from output.
Local crash recovery also contains unencrypted document copies. Presets can
contain annotation text; review them before sharing. Measurements depend on
page calibration and drawing accuracy; comparison is a visual review aid.

The application has no document-upload service or telemetry. Recent-file paths
and preferences are stored locally. Bug reports should use synthetic documents and
sanitized logs; never attach confidential files to public issues.

## License

[MIT](LICENSE), Copyright (c) 2026 rojerm2. Third-party components retain
their own licenses; see [Third-party notices](THIRD_PARTY_NOTICES.md).
