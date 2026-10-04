$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$taskCache = Join-Path $taskRoot '.cache/security'
$taskVersion = '0.22.2'
$taskPrefix = 'cargo-audit-x86_64-pc-windows-msvc-v' + $taskVersion
$taskArchive = Join-Path $taskCache 'cargo-audit.zip'
$taskExpectedHash = '0a7316540862c13d954f648917ceacca593747baed6eec180fafa590be2710ab'
New-Item -ItemType Directory -Path $taskCache -Force | Out-Null
if (!(Test-Path -LiteralPath $taskArchive)) {
    Invoke-WebRequest -Uri ('https://github.com/rustsec/rustsec/releases/download/cargo-audit/v' + $taskVersion + '/' + $taskPrefix + '.zip') -OutFile $taskArchive
}
if ((Get-FileHash -LiteralPath $taskArchive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $taskExpectedHash) {
    throw 'RustSec archive checksum mismatch; the cached tool will not run.'
}
Add-Type -AssemblyName System.IO.Compression.FileSystem
$taskZip = [IO.Compression.ZipFile]::OpenRead($taskArchive)
try {
    $taskAllowed = @('', 'cargo-audit.exe', 'CHANGELOG.md', 'LICENSE-APACHE', 'LICENSE-MIT', 'README.md')
    foreach ($taskEntry in $taskZip.Entries) {
        if (!$taskEntry.FullName.StartsWith($taskPrefix + '/', [StringComparison]::Ordinal) -or
            $taskEntry.FullName.Substring($taskPrefix.Length + 1) -notin $taskAllowed) {
            throw 'Unexpected RustSec archive member; extraction refused.'
        }
    }
    $taskBinaryEntry = $taskZip.GetEntry($taskPrefix + '/cargo-audit.exe')
    if (!$taskBinaryEntry) { throw 'Missing RustSec binary.' }
    $taskStream = $taskBinaryEntry.Open()
    $taskHasher = [Security.Cryptography.SHA256]::Create()
    try { $taskBinaryHash = [BitConverter]::ToString($taskHasher.ComputeHash($taskStream)).Replace('-', '').ToLowerInvariant() }
    finally { $taskStream.Dispose(); $taskHasher.Dispose() }
} finally { $taskZip.Dispose() }
Expand-Archive -LiteralPath $taskArchive -DestinationPath (Join-Path $taskCache 'tool') -Force
$taskBinary = Join-Path $taskCache ('tool/' + $taskPrefix + '/cargo-audit.exe')
if ((Get-FileHash -LiteralPath $taskBinary -Algorithm SHA256).Hash.ToLowerInvariant() -ne $taskBinaryHash) {
    throw 'Extracted RustSec executable checksum mismatch.'
}
Push-Location $taskRoot
try {
    & $taskBinary audit --file src-tauri/Cargo.lock --target-os windows --target-arch x86_64 --db (Join-Path $taskCache 'advisory-db') --no-yanked --json |
        Set-Content -LiteralPath (Join-Path $taskCache 'audit.json') -Encoding utf8
    $taskAuditExit = $LASTEXITCODE
    if ($taskAuditExit -notin @(0, 1)) { throw 'RustSec could not complete its audit.' }
    cargo metadata --manifest-path src-tauri/Cargo.toml --locked --filter-platform x86_64-pc-windows-msvc --format-version 1 |
        Set-Content -LiteralPath (Join-Path $taskCache 'metadata.json') -Encoding utf8
    if ($LASTEXITCODE -ne 0) { throw 'Windows dependency graph could not be resolved.' }
    node scripts/check-rust-advisories.mjs (Join-Path $taskCache 'audit.json') (Join-Path $taskCache 'metadata.json')
    if ($LASTEXITCODE -ne 0) { throw 'Rust dependency audit failed.' }
    if ($taskAuditExit -ne 0) { throw 'RustSec reported a failing audit.' }
} finally { Pop-Location }
