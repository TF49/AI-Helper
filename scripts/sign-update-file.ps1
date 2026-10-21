param([Parameter(Mandatory = $true)][string]$FilePath)

$ErrorActionPreference = 'Stop'
$FilePath = [System.IO.Path]::GetFullPath($FilePath)
if (-not (Test-Path -LiteralPath $FilePath -PathType Leaf)) { throw "Cannot sign missing file: $FilePath" }
$signaturePath = "$FilePath.sig"
if (Test-Path -LiteralPath $signaturePath) { Remove-Item -LiteralPath $signaturePath -Force }

# The pinned Tauri CLI 2.8.1 signer subcommand still reads the legacy names.
# Keep secrets in its environment, and restore the caller's environment afterwards.
$previousKey = $env:TAURI_PRIVATE_KEY
$previousPassword = $env:TAURI_PRIVATE_KEY_PASSWORD
try {
    if ($env:TAURI_SIGNING_PRIVATE_KEY) {
        $key = $env:TAURI_SIGNING_PRIVATE_KEY
        if ([System.IO.File]::Exists($key)) { $key = [System.IO.File]::ReadAllText($key).Trim() }
        $env:TAURI_PRIVATE_KEY = $key
    }
    if ($null -ne $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD) {
        $env:TAURI_PRIVATE_KEY_PASSWORD = $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD
    }
    Push-Location (Split-Path -Parent $PSScriptRoot)
    try {
        & pnpm exec tauri signer sign $FilePath
        if ($LASTEXITCODE -ne 0) { throw "Tauri signer failed for $FilePath (exit code $LASTEXITCODE)." }
    } finally { Pop-Location }
} finally {
    $env:TAURI_PRIVATE_KEY = $previousKey
    $env:TAURI_PRIVATE_KEY_PASSWORD = $previousPassword
}
if (-not (Test-Path -LiteralPath $signaturePath -PathType Leaf)) { throw "Signature was not generated: $signaturePath" }
if ([string]::IsNullOrWhiteSpace((Get-Content -LiteralPath $signaturePath -Raw -Encoding UTF8))) { throw "Signature is empty: $signaturePath" }
