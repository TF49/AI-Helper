param(
    [Parameter(Mandatory = $true)][string]$AssetRoot,
    [string]$Tag
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
$package = Get-Content -LiteralPath (Join-Path $repoRoot 'package.json') -Encoding UTF8 -Raw | ConvertFrom-Json
if (-not $Tag) { $Tag = "v$($package.version)" }
$assetRoot = [System.IO.Path]::GetFullPath($AssetRoot)
if (-not (Test-Path -LiteralPath $assetRoot -PathType Container)) { throw "Release asset directory does not exist: $assetRoot" }

$platforms = [ordered]@{}
$windows = Get-ChildItem -LiteralPath $assetRoot -File -Filter "AI-Helper-$Tag-Windows-x64-Setup.exe" | Select-Object -First 1
if ($windows) {
    $sigPath = "$($windows.FullName).sig"
    if (-not (Test-Path -LiteralPath $sigPath -PathType Leaf)) { throw "Missing Windows updater signature: $sigPath" }
    $sig = (Get-Content -LiteralPath $sigPath -Raw -Encoding UTF8).Trim()
    if ([string]::IsNullOrWhiteSpace($sig)) { throw "Empty Windows updater signature: $sigPath" }
    $platforms['windows-x86_64'] = [ordered]@{ signature = $sig; url = "https://github.com/TF49/AI-Helper/releases/download/$Tag/$($windows.Name)"; sha256 = (Get-FileHash -LiteralPath $windows.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
}
foreach ($mac in Get-ChildItem -LiteralPath $assetRoot -File -Filter "AI-Helper-$Tag-macOS-*.app.tar.gz") {
    if ($mac.Name -notmatch 'macOS-(?<arch>[^.]+)\.app\.tar\.gz$') { continue }
    $arch = $Matches.arch
    $platformKey = if ($arch -eq 'aarch64') { 'darwin-aarch64' } elseif ($arch -eq 'x64') { 'darwin-x86_64' } else { throw "Unsupported macOS architecture: $arch" }
    $sigPath = "$($mac.FullName).sig"
    if (-not (Test-Path -LiteralPath $sigPath -PathType Leaf)) { throw "Missing macOS updater signature: $sigPath" }
    $sig = (Get-Content -LiteralPath $sigPath -Raw -Encoding UTF8).Trim()
    if ([string]::IsNullOrWhiteSpace($sig)) { throw "Empty macOS updater signature: $sigPath" }
    $platforms[$platformKey] = [ordered]@{ signature = $sig; url = "https://github.com/TF49/AI-Helper/releases/download/$Tag/$($mac.Name)"; sha256 = (Get-FileHash -LiteralPath $mac.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
}
if ($platforms.Count -eq 0) { throw 'No signed updater artifacts found; refusing to publish an empty manifest.' }
$notesPath = Join-Path $repoRoot "docs/releases/$Tag.md"
$notes = if (Test-Path -LiteralPath $notesPath) { Get-Content -LiteralPath $notesPath -Raw -Encoding UTF8 } else { "AI Helper $Tag" }
$versionParts = $package.version.ToString().Split('.')
$releaseSeq = ([int64]$versionParts[0] * 1000000) + ([int64]$versionParts[1] * 1000) + ([int64]$versionParts[2])
$manifest = [ordered]@{ schema_version = 1; product = 'ai-helper'; channel = 'stable'; version = $package.version; release_seq = $releaseSeq; notes = $notes.Trim(); pub_date = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ'); platforms = $platforms }
$manifestPath = Join-Path $assetRoot 'latest.json'
[System.IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json -Depth 8), $utf8NoBom)
$oldSig = "$manifestPath.sig"
if (Test-Path -LiteralPath $oldSig) { Remove-Item -LiteralPath $oldSig -Force }
Push-Location $repoRoot
try { & pnpm exec tauri signer sign $manifestPath; if ($LASTEXITCODE -ne 0) { throw "Tauri signer failed for final latest.json (exit code $LASTEXITCODE)." } } finally { Pop-Location }
if (-not (Test-Path -LiteralPath $oldSig -PathType Leaf)) { throw 'Final latest.json.sig was not generated.' }
Write-Host "Final signed update manifest contains: $($platforms.Keys -join ', ')"
