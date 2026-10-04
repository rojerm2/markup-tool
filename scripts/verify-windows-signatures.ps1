param([Parameter(Mandatory = $true)][string]$Thumbprint)
$ErrorActionPreference = 'Stop'
if ($Thumbprint -notmatch '^[a-fA-F0-9]{40}$') { throw 'Expected a SHA-1 certificate thumbprint' }
$taskRepoRoot = Split-Path -Parent $PSScriptRoot
$taskPackage = Get-Content -LiteralPath (Join-Path $taskRepoRoot 'package.json') -Raw | ConvertFrom-Json
$taskInstallers = @(Get-ChildItem -LiteralPath (Join-Path $taskRepoRoot 'src-tauri/target/release/bundle/nsis') -File | Where-Object { $_.Name.EndsWith('_' + $taskPackage.version + '_x64-setup.exe') })
if ($taskInstallers.Count -ne 1) { throw 'Expected one installer for this version' }
$taskInstaller = $taskInstallers[0].FullName
$taskExecutable = Join-Path $taskRepoRoot 'src-tauri/target/release/pdf-markup-tool.exe'
foreach ($taskFile in @($taskExecutable, $taskInstaller)) {
  if (!(Test-Path -LiteralPath $taskFile)) { throw "Missing release file: $taskFile" }
  $taskSignature = Get-AuthenticodeSignature -LiteralPath $taskFile
  if ($taskSignature.Status -ne 'Valid' -or !$taskSignature.TimeStamperCertificate -or $taskSignature.SignerCertificate.Thumbprint -ne $Thumbprint) {
    throw "Expected a valid timestamped publisher signature: $taskFile"
  }
}
