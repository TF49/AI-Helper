param([string]$Version)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot

Set-Location $repoRoot

# Step 1: bump version
Write-Host ""
Write-Host "==== Step 1: bump version ====" -ForegroundColor Cyan
if ($Version) {
    & "$PSScriptRoot/bump-version.ps1" $Version
} else {
    & "$PSScriptRoot/bump-version.ps1"
}

# Step 2: read new version
$pkg = Get-Content -LiteralPath (Join-Path $repoRoot 'package.json') -Encoding UTF8 -Raw | ConvertFrom-Json
$newVersion = $pkg.version
$tag = "v$newVersion"

# Step 3: git commit
Write-Host ""
Write-Host "==== Step 2: git commit ====" -ForegroundColor Cyan
git add -A
git status --short
git commit -m "release: $tag"
if ($LASTEXITCODE -ne 0) { throw "git commit failed" }

# Step 4: git push
Write-Host ""
Write-Host "==== Step 3: git push ====" -ForegroundColor Cyan
git push origin main
if ($LASTEXITCODE -ne 0) { throw "git push failed" }

Write-Host ""
Write-Host "Done! $tag pushed to GitHub." -ForegroundColor Green
Write-Host "GitHub Actions will build and publish the update automatically." -ForegroundColor Green
Write-Host "Users will be forced to update when they next open the app." -ForegroundColor Green
