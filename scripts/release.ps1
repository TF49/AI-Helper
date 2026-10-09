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

# Ensure website files are strictly synced with $newVersion before commit
$websiteDir = Join-Path $repoRoot 'website'
if (Test-Path -LiteralPath $websiteDir) {
    $utf8NoBom = [System.Text.UTF8Encoding]::new($false)
    $scriptJsPath = Join-Path $websiteDir 'assets/script.js'
    if (Test-Path -LiteralPath $scriptJsPath) {
        $scriptJsContent = Get-Content -LiteralPath $scriptJsPath -Encoding UTF8 -Raw
        if ($scriptJsContent -notmatch [regex]::Escape("const CURRENT_VERSION = `"v$newVersion`";")) {
            $scriptJsContent = $scriptJsContent -replace 'const CURRENT_VERSION = "v[^"]+";', "const CURRENT_VERSION = `"v$newVersion`";"
            [System.IO.File]::WriteAllText($scriptJsPath, $scriptJsContent, $utf8NoBom)
            Write-Host "  Synced website/assets/script.js to v$newVersion" -ForegroundColor DarkGray
        }
    }
    $indexHtmlPath = Join-Path $websiteDir 'index.html'
    if (Test-Path -LiteralPath $indexHtmlPath) {
        $indexHtmlContent = Get-Content -LiteralPath $indexHtmlPath -Encoding UTF8 -Raw
        $indexHtmlContent = [System.Text.RegularExpressions.Regex]::Replace($indexHtmlContent, 'AI-Helper-v\d+\.\d+\.\d+', "AI-Helper-v$newVersion")
        $indexHtmlContent = [System.Text.RegularExpressions.Regex]::Replace($indexHtmlContent, 'releases/download/v\d+\.\d+\.\d+', "releases/download/v$newVersion")
        $indexHtmlContent = [System.Text.RegularExpressions.Regex]::Replace($indexHtmlContent, 'helper\.bob-api\.com/downloads/AI-Helper-v\d+\.\d+\.\d+', "helper.bob-api.com/downloads/AI-Helper-v$newVersion")
        $indexHtmlContent = [System.Text.RegularExpressions.Regex]::Replace($indexHtmlContent, 'releases/tag/v\d+\.\d+\.\d+', "releases/tag/v$newVersion")
        $indexHtmlContent = [System.Text.RegularExpressions.Regex]::Replace($indexHtmlContent, '<span class="tag-version current-version-tag">v\d+\.\d+\.\d+</span>', "<span class=`"tag-version current-version-tag`">v$newVersion</span>")
        $indexHtmlContent = [System.Text.RegularExpressions.Regex]::Replace($indexHtmlContent, '<strong class="current-version-tag"[^>]*>v\d+\.\d+\.\d+</strong>', "<strong class=`"current-version-tag`" style=`"color: var(--accent-blue);`">v$newVersion</strong>")
        $indexHtmlContent = [System.Text.RegularExpressions.Regex]::Replace($indexHtmlContent, '<span id="hero-btn-text">[^<]+</span>', "<span id=`"hero-btn-text`">立即下载 Windows 安装版 (v$newVersion)</span>")
        $indexHtmlContent = [System.Text.RegularExpressions.Regex]::Replace($indexHtmlContent, '<span id="checksum-setup-filename">[^<]+</span>', "<span id=`"checksum-setup-filename`">AI-Helper-v$newVersion-Windows-x64-Setup.exe</span>")
        [System.IO.File]::WriteAllText($indexHtmlPath, $indexHtmlContent, $utf8NoBom)
    }
    $versionJsonPath = Join-Path $websiteDir 'version.json'
    $repoName = "TF49/AI-Helper"
    $mirrorBase = "https://helper.bob-api.com/downloads"
    $versionInfo = [ordered]@{
        version              = $newVersion
        tag                  = "v$newVersion"
        releaseDate          = (Get-Date -Format "yyyy-MM-dd")
        setupFileName        = "AI-Helper-v$newVersion-Windows-x64-Setup.exe"
        zipFileName          = "AI-Helper-v$newVersion-Windows-x64-Standalone.zip"
        setupDownloadUrl     = "$mirrorBase/AI-Helper-v$newVersion-Windows-x64-Setup.exe"
        zipDownloadUrl       = "$mirrorBase/AI-Helper-v$newVersion-Windows-x64-Standalone.zip"
        fastSetupDownloadUrl = "https://ghfast.top/https://github.com/$repoName/releases/download/v$newVersion/AI-Helper-v$newVersion-Windows-x64-Setup.exe"
        fastZipDownloadUrl   = "https://ghfast.top/https://github.com/$repoName/releases/download/v$newVersion/AI-Helper-v$newVersion-Windows-x64-Standalone.zip"
        githubSetupDownloadUrl = "https://github.com/$repoName/releases/download/v$newVersion/AI-Helper-v$newVersion-Windows-x64-Setup.exe"
        githubZipDownloadUrl   = "https://github.com/$repoName/releases/download/v$newVersion/AI-Helper-v$newVersion-Windows-x64-Standalone.zip"
        releasePageUrl       = "https://github.com/$repoName/releases/tag/v$newVersion"
    }
    $versionJsonStr = ($versionInfo | ConvertTo-Json -Depth 4) + "`n"
    [System.IO.File]::WriteAllText($versionJsonPath, $versionJsonStr, $utf8NoBom)
    Write-Host "  Verified website files synced with $tag" -ForegroundColor Green
}

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

# Step 4: auto-format & pre-flight checks
Write-Host ""
Write-Host "==== Step 3: auto-format & verify code ====" -ForegroundColor Cyan
Write-Host "  Formatting Rust code..." -ForegroundColor DarkGray
cargo fmt --manifest-path (Join-Path $repoRoot 'src-tauri/Cargo.toml')
if ($LASTEXITCODE -ne 0) { throw "cargo fmt failed" }

Write-Host "  Running Clippy check..." -ForegroundColor DarkGray
cargo clippy --manifest-path (Join-Path $repoRoot 'src-tauri/Cargo.toml') -- -D warnings
if ($LASTEXITCODE -ne 0) { throw "cargo clippy failed" }

# Step 5: git commit
Write-Host ""
Write-Host "==== Step 4: git commit ====" -ForegroundColor Cyan
git add -A
git status --short
git commit -m "release: $tag"
if ($LASTEXITCODE -ne 0) { throw "git commit failed" }

# Step 6: git push
Write-Host ""
Write-Host "==== Step 5: git push ====" -ForegroundColor Cyan
git push origin main
if ($LASTEXITCODE -ne 0) { throw "git push failed" }

Write-Host ""
Write-Host "Done! $tag pushed to GitHub." -ForegroundColor Green
Write-Host "GitHub Actions will build and publish the update automatically." -ForegroundColor Green
Write-Host "Users will be forced to update when they next open the app." -ForegroundColor Green
