# Contributing to PDF Markup

Please open an issue before a substantial feature or project-format change.
Use a feature branch and submit a pull request against `main`.

## Set up

Use Node.js 24 (the tested version is in `.nvmrc`), npm, and the Rust
toolchain in `rust-toolchain.toml`. Windows development also requires the
Microsoft C++ build tools and WebView2.
See [Tauri prerequisites](https://tauri.app/start/prerequisites/).

```powershell
npm ci
npm run tauri dev
```

## Before submitting

```powershell
npm run format:check
npm run typecheck
npm test -- --maxWorkers=1 --testTimeout=20000
npm run check:release
npm audit --audit-level=high
./scripts/audit-rust.ps1
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --locked --jobs 1 -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --locked --jobs 1
npm run build
```

Use `npm run format` to apply formatting. Keep TypeScript strict; use meaningful
regression tests for persistence, coordinate transforms, focus, and undo.
Run memory-intensive PDF benchmarks separately from regular tests and builds.

The Windows Rust audit downloads a pinned, checksum-verified official tool into
the ignored `.cache/security` directory and reads the current RustSec database.
It fails on known vulnerabilities or unresolved warnings other than maintenance
warnings in the Windows dependency graph. Review every maintenance warning;
current findings are recorded in [SECURITY.md](SECURITY.md). Dependencies used
only by other platforms are reported separately. Yank status is not checked.
The npm audit includes development dependencies.

Use Conventional Commit subjects such as `fix: restore focus after page entry`
or `feat: add a markup tool`. Describe the behavior and relevant validation in
the pull request. Include screenshots for visible changes using synthetic PDFs.
Keep unrelated changes out of the pull request.

Never commit customer PDFs, project files, local paths, generated installers,
credentials, or private test outputs. Report security issues privately as
described in [SECURITY.md](SECURITY.md).

The project is MIT-licensed. Contributions must be compatible with that license;
keep third-party license notices intact.
