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
    # Replace any explicit static version badge if present
    $readmeContent = $readmeContent -replace 'version-(\d+\.\d+\.\d+)-', "version-$NewVersion-"
    # Current version / date markers: <!--ver-->v1.2.3<!--/ver-->, <!--date-->2026-01-01<!--/date-->
    $releaseDate = (Get-Date).ToString('yyyy-MM-dd')
    $readmeContent = $readmeContent -replace '<!--ver-->v?\d+\.\d+\.\d+<!--/ver-->', "<!--ver-->v$NewVersion<!--/ver-->"
    $readmeContent = $readmeContent -replace '<!--date-->\d{4}-\d{2}-\d{2}<!--/date-->', "<!--date-->$releaseDate<!--/date-->"
    # Download links: release asset file names and GitHub release download paths
    $readmeContent = $readmeContent -replace 'AI-Helper-v\d+\.\d+\.\d+-', "AI-Helper-v$NewVersion-"
    $readmeContent = $readmeContent -replace 'releases/download/v\d+\.\d+\.\d+/', "releases/download/v$NewVersion/"
    Write-Host "Note: add a row for v$NewVersion to the README 'Recent updates' table manually."
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

# Sync website files (index.html, script.js, version.json, download-config.json)
$syncScript = Join-Path $PSScriptRoot 'sync-website.js'
if (Test-Path -LiteralPath $syncScript) {
    node $syncScript $NewVersion
    if ($LASTEXITCODE -ne 0) { throw "sync-website.js failed" }
}

Write-Host "Version successfully bumped to $NewVersion across package.json, tauri.conf.json, Cargo.toml, and website!"
