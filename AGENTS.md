# Repository Guidelines

## Project Structure & Module Organization

This is a Tauri 2 desktop PDF markup application with a React 19/TypeScript frontend and Rust persistence backend.

- `src/components/`: PDF viewer, toolbar, annotation controls, and overlays.
- `src/services/`: PDF loading/export, coordinate transforms, project serialization, annotation state, and undo/redo.
- `src/types/`: shared TypeScript models; `src/assets/`: bundled fonts and metrics.
- `src-tauri/src/`: native commands and persistence; `src-tauri/capabilities/`: desktop permissions.
- `tests/`: frontend unit and component tests.
- `public/`: static assets. `scripts/copy-pdf-assets.mjs` populates ignored `public/pdfjs/` resources before development and builds.

## Build, Test, and Development Commands

Run commands from the repository root. Desktop development requires Rust and the platform's Tauri prerequisites.

- `npm ci`: install dependencies from `package-lock.json`.
- `npm run dev`: start the Vite frontend at port 1420.
- `npm run tauri dev`: launch the desktop app with the development frontend.
- `npm run typecheck`: check frontend TypeScript without emitting files.
- `npm test`: run the Vitest suite once.
- `npm run build`: type-check and bundle the frontend into `dist/`.
- `npm run tauri build`: build desktop distribution bundles.
- `cargo test --manifest-path src-tauri/Cargo.toml`: run Rust tests.

## Coding Style & Naming Conventions

Use two-space indentation in TypeScript/TSX and four spaces in Rust. Match nearby quote style and retain semicolons. Use PascalCase component filenames, camelCase services/functions, `use`-prefixed hooks, and snake_case Rust functions. Keep reusable behavior in services and shared models in `src/types/`.

TypeScript enables strict mode and unused-symbol checks. No dedicated formatter or linter script is configured; avoid unrelated formatting changes.

## Testing Guidelines

Frontend tests use Vitest, jsdom, and React Testing Library. Name files `tests/<feature>.test.tsx`; run a focused suite with `npm test -- tests/projectFormat.test.tsx`. Rust persistence tests reside alongside implementation in `persistence.rs`.

Add regression tests for changed behavior, especially project validation, save/export safety, coordinate transforms, and undo/redo. No coverage threshold is configured. Run relevant suites and type checks before submitting; manually verify desktop file dialogs and visual changes.

## Commit & Pull Request Guidelines

History uses concise Conventional Commit subjects such as `feat: add PDF export workflow` and `fix: harden PDF rendering and operation feedback`. Follow that pattern and keep commits focused.

PRs should describe the problem and resulting behavior, link relevant issues, list validation performed, and include screenshots for visible UI changes. Call out project-format or native-permission changes. Exclude generated assets, build output, credentials, and private PDFs.
