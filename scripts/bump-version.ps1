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

# Update package.json
$pkgContent = Get-Content -LiteralPath $pkgPath -Encoding UTF8 -Raw
$pkgContent = $pkgContent -replace '"version":\s*"[^"]+"', "`"version`": `"$NewVersion`""
Set-Content -LiteralPath $pkgPath -Value $pkgContent -Encoding UTF8

# Update src-tauri/tauri.conf.json
$tauriContent = Get-Content -LiteralPath $tauriPath -Encoding UTF8 -Raw
$tauriContent = $tauriContent -replace '"version":\s*"[^"]+"', "`"version`": `"$NewVersion`""
Set-Content -LiteralPath $tauriPath -Value $tauriContent -Encoding UTF8

# Update src-tauri/Cargo.toml (only the [package] version)
$cargoContent = Get-Content -LiteralPath $cargoPath -Encoding UTF8 -Raw
$cargoContent = $cargoContent -replace '(?m)^(version\s*=\s*)"[^"]+"', "version = `"$NewVersion`""
Set-Content -LiteralPath $cargoPath -Value $cargoContent -Encoding UTF8

# Check/create release notes file template if not existing
$relNotesPath = Join-Path $repoRoot "docs/releases/v$NewVersion.md"
if (-not (Test-Path -LiteralPath $relNotesPath)) {
    $template = "# BobAPI Tool v$NewVersion`n`n- 自动更新与功能增强`n"
    Set-Content -LiteralPath $relNotesPath -Value $template -Encoding UTF8
    Write-Host "Created release notes draft: $relNotesPath"
}

Write-Host "Version successfully bumped to $NewVersion across package.json, tauri.conf.json, and Cargo.toml!"
