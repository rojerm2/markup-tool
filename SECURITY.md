# Security policy

## Supported versions

Security fixes target the latest release. Upgrade before reporting a defect
that may already be fixed. Historical development versions are not supported.

## Report a vulnerability

Use [GitHub's private vulnerability reporting](https://github.com/rojerm2/markup-tool/security/advisories/new).
If private reporting is unavailable, contact the repository owner through
GitHub without posting exploit details or confidential files publicly.
Do not attach sensitive PDFs, credentials, or personally identifying data.

Include the app version, Windows/WebView2 versions, reproduction steps using a
synthetic PDF, expected impact, and relevant sanitized logs. No response-time
or security-audit guarantee is implied.

## Security boundaries

The editor loads bundled code and uses a restrictive content security policy.
Native filesystem operations require a path authorized by a file dialog or
the validated recent-files registry. The print-preview window has no native
file-operation capability and cannot navigate away from its generated PDF.

The app verifies PDF identities, bounds input/output to 256 MiB and project
metadata to 16 MiB, and writes projects/exports atomically. These checks reduce
accidental corruption and excessive allocation; complex PDFs may still consume
substantial memory. Temporary embedded/print PDFs live until their owning
session/window closes.

Projects include the entire source PDF and are **not encrypted**.
Local recovery checkpoints also contain the source PDF and unsaved annotations,
are not encrypted, and persist across process crashes. Recovery commands are
restricted to the editor window and generated identifiers inside the app's
local data directory. Opening recovery data verifies the PDF identity and
validates project contents; stored references do not grant filesystem access.
Completed checkpoints are bounded to eight entries and 512 MiB. Save, Discard
and Dismiss remove the relevant checkpoint; older checkpoints can be evicted.
Treat them with the same care as the original document. Export retains the
original PDF contents; markup is not secure redaction and does not remove
hidden text, metadata, scripts, or attachments.

There is no application telemetry or cloud document upload. WebView2 runtime
updates and installer provisioning are supplied by Microsoft. Keep that runtime
and Windows patched. This project has not undergone an independent security audit.

CSV reports neutralize spreadsheet formula prefixes and use bounded, atomic
saving. Presets can contain annotation text; review their contents before
sharing. Imported presets do not grant access to document paths. Measurements
depend on calibration and drawing accuracy; revision comparison is a visual
review aid rather than an automated engineering approval.

## Dependency review

The 0.4.2 review on 2026-10-08 updated `source-map-js` to 1.2.2 for
[GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q).
The patched npm lockfile and current Windows Rust audit report no known
vulnerabilities. The upstream maintenance warnings below remain unchanged.

The 0.4.0 review on 2026-10-04 found no known vulnerabilities in the npm
lockfile (including development dependencies) or Cargo lockfile. The Windows
Rust audit also reports maintenance warnings for five `unic-*` crates used
through Tauri's `urlpattern` dependency:
[unic-char-property](https://rustsec.org/advisories/RUSTSEC-2025-0081.html),
[unic-char-range](https://rustsec.org/advisories/RUSTSEC-2025-0075.html),
[unic-common](https://rustsec.org/advisories/RUSTSEC-2025-0080.html),
[unic-ucd-ident](https://rustsec.org/advisories/RUSTSEC-2025-0100.html), and
[unic-ucd-version](https://rustsec.org/advisories/RUSTSEC-2025-0098.html).
They remain an upstream maintenance concern and must be reviewed on updates.

The lockfile's [GLib warning](https://rustsec.org/advisories/RUSTSEC-2024-0429.html)
and [proc-macro-error maintenance warning](https://rustsec.org/advisories/RUSTSEC-2024-0370.html)
are absent from the resolved Windows build graph. CI checks the current RustSec
database and blocks known vulnerabilities and other unresolved Windows warnings.
These checks do not cover unpublished defects or yanked package status.

## Distribution and contributions

Keep third-party notices and required source materials with distributions.
See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and the font provenance
record in [third_party/fonts/README.md](third_party/fonts/README.md).
Only contribute code and assets that you have permission to distribute under
compatible terms. Do not bundle private documents, credentials, or customer
content. License checks and the MIT license do not guarantee legal clearance
for every use or jurisdiction.
