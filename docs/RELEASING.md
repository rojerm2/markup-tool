# Release process

The supported distributable is a Windows x64 NSIS installer. Development
toolchains are pinned; npm and Cargo lockfiles are committed. No server
deployment is required.

1. Update versions together in `package.json`, `package-lock.json`,
   `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, and
   `src-tauri/tauri.conf.json`.
2. Add `docs/releases/v<VERSION>.md` and update `CHANGELOG.md`.
3. Run the checks in [CONTRIBUTING.md](../CONTRIBUTING.md), then verify the
   packaged app with a synthetic document. Test open/save/reopen without the
   original, export, print/cancel, dark mode, zoom, keyboard focus, and undo.
   Recheck a large PDF when export or rendering changes.
4. Merge verified work into `main`. Tag that commit with `v<VERSION>` and push
   the tag. The release workflow rejects inconsistent versions/tags, runs checks,
   builds the installer, and creates a **draft** GitHub release.
5. Download the CI artifact and compare its SHA-256 with `SHA256SUMS.txt`.
   Inspect the Windows executable/installer signatures and complete installation
   testing on another Windows x64 computer before promoting a signed release.
6. Review the draft release notes and publish using GitHub Releases.

For a local build:

```powershell
npm ci
npm run check:release
npm run tauri build -- --bundles nsis
npm run release:checksums
```

The installer and checksums are under `src-tauri/target/release/bundle/nsis/`.
CI artifacts expire; GitHub Releases are the distribution channel.
The installer uses the current user's account. It provisions WebView2 if
missing, which requires internet access. Existing WebView2 installations allow
offline app use. Back up projects before upgrading; do not remove local user
data as part of an upgrade.

## Signing

Builds are **unsigned** unless an Authenticode signing configuration is supplied.
Checksums verify integrity but do not establish publisher identity. Configure a
publisher-owned certificate or managed signing service using
[Tauri's Windows signing instructions](https://tauri.app/distribute/sign/windows/).
Never commit certificates, private keys, passwords, or access tokens.

For certificate-store signing, the optional repository variable
`WINDOWS_CERTIFICATE_THUMBPRINT` enables Tauri's native Windows signing during
packaging. The matching private key must be provisioned on the Windows
runner beforehand. The build signs both executable and installer, timestamps
them, and `scripts/verify-windows-signatures.ps1` refuses an invalid signature.
If the variable is absent, release notes
explicitly mark the artifact unsigned. GitHub-hosted runners do not contain a
publisher certificate by default.

The initial unsigned release is suitable for evaluation and controlled internal
deployment. Public trusted-publisher distribution still requires signing and
installation validation on the target machines. Do not bypass organizational
installation policies.
