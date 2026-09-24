param([string]$Version)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot

Set-Location $repoRoot

# ────────────────────────────────────────────────────────────────────────────
# Detect whether the user already ran `pnpm run bump` and edited release notes.
# If there are already uncommitted changes in the working tree, we assume the
# version was pre-bumped and skip the auto-bump step to avoid double-bumping.
# ────────────────────────────────────────────────────────────────────────────
$gitStatus = (git status --porcelain | Out-String).Trim()
$alreadyBumped = ($gitStatus -ne '') -and (-not $Version)

if ($alreadyBumped) {
    Write-Host ""
    Write-Host "==== Step 1: version already bumped, skipping auto-bump ====" -ForegroundColor Yellow
    Write-Host "  (Detected uncommitted changes in working tree)" -ForegroundColor DarkGray
} else {
    # Step 1: bump version
    Write-Host ""
    Write-Host "==== Step 1: bump version ====" -ForegroundColor Cyan
    if ($Version) {
        & "$PSScriptRoot/bump-version.ps1" $Version
    } else {
        & "$PSScriptRoot/bump-version.ps1"
    }
}

# Step 2: read new version
$pkg = Get-Content -LiteralPath (Join-Path $repoRoot 'package.json') -Encoding UTF8 -Raw | ConvertFrom-Json
$newVersion = $pkg.version
$tag = "v$newVersion"

# Step 3: verify release notes exist and are not the default placeholder
Write-Host ""
Write-Host "==== Step 2: verify release notes ====" -ForegroundColor Cyan
$relNotesPath = Join-Path $repoRoot "docs/releases/$tag.md"
if (-not (Test-Path -LiteralPath $relNotesPath)) {
    throw "Missing release notes: $relNotesPath`nPlease create this file before releasing."
}
$notesContent = Get-Content -LiteralPath $relNotesPath -Encoding UTF8 -Raw
$placeholders = @(
    "Automatic updates and feature enhancements",
    "Release automation improvements"
)
$isPlaceholder = $false
foreach ($ph in $placeholders) {
    if ($notesContent -match [regex]::Escape($ph)) { $isPlaceholder = $true; break }
}
if ($isPlaceholder) {
    Write-Host ""
    Write-Host "  WARNING: Release notes still contain placeholder text." -ForegroundColor Yellow
    Write-Host "  File: $relNotesPath" -ForegroundColor Yellow
    Write-Host ""
    $confirm = Read-Host "  Continue releasing with placeholder notes? (y/N)"
    if ($confirm -ne 'y' -and $confirm -ne 'Y') {
        Write-Host "  Aborted. Please edit $relNotesPath and run 'pnpm run release' again." -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "  Release notes look good: $relNotesPath" -ForegroundColor Green
}

# Step 4: git commit
Write-Host ""
Write-Host "==== Step 3: git commit ====" -ForegroundColor Cyan
git add -A
git status --short
git commit -m "release: $tag"
if ($LASTEXITCODE -ne 0) { throw "git commit failed" }

# Step 5: git push
Write-Host ""
Write-Host "==== Step 4: git push ====" -ForegroundColor Cyan
git push origin main
if ($LASTEXITCODE -ne 0) { throw "git push failed" }

Write-Host ""
Write-Host "Done! $tag pushed to GitHub." -ForegroundColor Green
Write-Host "GitHub Actions will build and publish the update automatically." -ForegroundColor Green
Write-Host "Users will be forced to update when they next open the app." -ForegroundColor Green
