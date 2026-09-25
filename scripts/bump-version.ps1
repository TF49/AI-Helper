param(
    [string]$NewVersion
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot

$pkgPath = Join-Path $repoRoot 'package.json'
$tauriPath = Join-Path $repoRoot 'src-tauri/tauri.conf.json'
$cargoPath = Join-Path $repoRoot 'src-tauri/Cargo.toml'

$pkgJson = Get-Content -LiteralPath $pkgPath -Encoding UTF8 -Raw | ConvertFrom-Json
$currentVer = $pkgJson.version

if (-not $NewVersion) {
    # Auto-increment patch version (e.g. 1.0.1 -> 1.0.2)
    $parts = $currentVer.Split('.')
    if ($parts.Length -eq 3) {
        $parts[2] = [int]$parts[2] + 1
        $NewVersion = $parts -join '.'
    } else {
        throw "Current version format not semver: $currentVer"
    }
}

Write-Host "Updating version: $currentVer -> $NewVersion"

# UTF-8 without BOM encoder (PowerShell 5.x Set-Content -Encoding UTF8 adds BOM)
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)

# Update package.json
$pkgContent = Get-Content -LiteralPath $pkgPath -Encoding UTF8 -Raw
$pkgContent = $pkgContent -replace '"version":\s*"[^"]+"', "`"version`": `"$NewVersion`""
$pkgContent = $pkgContent.TrimEnd("`r", "`n") + "`n"
[System.IO.File]::WriteAllText($pkgPath, $pkgContent, $utf8NoBom)

# Update src-tauri/tauri.conf.json
$tauriContent = Get-Content -LiteralPath $tauriPath -Encoding UTF8 -Raw
$tauriContent = $tauriContent -replace '"version":\s*"[^"]+"', "`"version`": `"$NewVersion`""
$tauriContent = $tauriContent.TrimEnd("`r", "`n") + "`n"
[System.IO.File]::WriteAllText($tauriPath, $tauriContent, $utf8NoBom)

# Update src-tauri/Cargo.toml (only the [package] version)
$cargoContent = Get-Content -LiteralPath $cargoPath -Encoding UTF8 -Raw
$cargoContent = $cargoContent -replace '(?m)^(version\s*=\s*)"[^"]+"', "version = `"$NewVersion`""
$cargoContent = $cargoContent.TrimEnd("`r", "`n") + "`n"
[System.IO.File]::WriteAllText($cargoPath, $cargoContent, $utf8NoBom)

# Regenerate Cargo.lock to match the new version in Cargo.toml
# (CI uses --locked, so lock file must be committed and up-to-date)
Write-Host "Regenerating Cargo.lock..."
cargo update --manifest-path $cargoPath --package ai-helper
if ($LASTEXITCODE -ne 0) { throw "cargo update failed" }

# Sync README.md with the new version
$readmePath = Join-Path $repoRoot 'README.md'
if (Test-Path -LiteralPath $readmePath) {
    $readmeContent = Get-Content -LiteralPath $readmePath -Encoding UTF8 -Raw
    # Replace any explicit static version badge if present, and ensure roadmap has the entry
    $readmeContent = $readmeContent -replace 'version-(\d+\.\d+\.\d+)-', "version-$NewVersion-"
    [System.IO.File]::WriteAllText($readmePath, $readmeContent, $utf8NoBom)
    Write-Host "Synced version $NewVersion into README.md"
}

# Check/create release notes file template if not existing
$relNotesPath = Join-Path $repoRoot "docs/releases/v$NewVersion.md"
if (-not (Test-Path -LiteralPath $relNotesPath)) {
    $lines = @(
        "# AI Helper v$NewVersion",
        "",
        "## What's Changed",
        "",
        "- Automatic updates and feature enhancements",
        ""
    )
    $template = $lines -join "`n"
    [System.IO.File]::WriteAllText($relNotesPath, $template, $utf8NoBom)
    Write-Host "Created release notes draft: $relNotesPath"
}

Write-Host "Version successfully bumped to $NewVersion across package.json, tauri.conf.json, and Cargo.toml!"
