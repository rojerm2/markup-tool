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
Treat them with the same care as the original document. Export retains the
original PDF contents; markup is not secure redaction and does not remove
hidden text, metadata, scripts, or attachments.

There is no application telemetry or cloud document upload. WebView2 runtime
updates and installer provisioning are supplied by Microsoft. Keep that runtime
and Windows patched. This project has not undergone an independent security audit.
