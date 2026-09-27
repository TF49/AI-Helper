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

# Sync website files (index.html, script.js, version.json)
$websiteDir = Join-Path $repoRoot 'website'
if (Test-Path -LiteralPath $websiteDir) {
    # 1. Update website/assets/script.js
    $scriptJsPath = Join-Path $websiteDir 'assets/script.js'
    if (Test-Path -LiteralPath $scriptJsPath) {
        $scriptJsContent = Get-Content -LiteralPath $scriptJsPath -Encoding UTF8 -Raw
        $scriptJsContent = $scriptJsContent -replace 'const CURRENT_VERSION = "v[^"]+";', "const CURRENT_VERSION = `"v$NewVersion`";"
        [System.IO.File]::WriteAllText($scriptJsPath, $scriptJsContent, $utf8NoBom)
        Write-Host "Synced version v$NewVersion into website/assets/script.js"
    }

    # 2. Update website/index.html
    $indexHtmlPath = Join-Path $websiteDir 'index.html'
    if (Test-Path -LiteralPath $indexHtmlPath) {
        $indexHtmlContent = Get-Content -LiteralPath $indexHtmlPath -Encoding UTF8 -Raw
        $indexHtmlContent = [System.Text.RegularExpressions.Regex]::Replace(
            $indexHtmlContent,
            'AI-Helper-v\d+\.\d+\.\d+',
            "AI-Helper-v$NewVersion"
        )
        $indexHtmlContent = [System.Text.RegularExpressions.Regex]::Replace(
            $indexHtmlContent,
            'releases/download/v\d+\.\d+\.\d+',
            "releases/download/v$NewVersion"
        )
        $indexHtmlContent = [System.Text.RegularExpressions.Regex]::Replace(
            $indexHtmlContent,
            'releases/tag/v\d+\.\d+\.\d+',
            "releases/tag/v$NewVersion"
        )
        $indexHtmlContent = [System.Text.RegularExpressions.Regex]::Replace(
            $indexHtmlContent,
            '<span class="tag-version current-version-tag">v\d+\.\d+\.\d+</span>',
            "<span class=`"tag-version current-version-tag`">v$NewVersion</span>"
        )
        $indexHtmlContent = [System.Text.RegularExpressions.Regex]::Replace(
            $indexHtmlContent,
            '<strong class="current-version-tag"[^>]*>v\d+\.\d+\.\d+</strong>',
            "<strong class=`"current-version-tag`" style=`"color: var(--accent-blue);`">v$NewVersion</strong>"
        )
        $indexHtmlContent = [System.Text.RegularExpressions.Regex]::Replace(
            $indexHtmlContent,
            '<span id="hero-btn-text">[^<]+</span>',
            "<span id=`"hero-btn-text`">立即下载 Windows 安装版 (v$NewVersion)</span>"
        )
        $indexHtmlContent = [System.Text.RegularExpressions.Regex]::Replace(
            $indexHtmlContent,
            '<span id="checksum-setup-filename">[^<]+</span>',
            "<span id=`"checksum-setup-filename`">AI-Helper-v$NewVersion-Windows-x64-Setup.exe</span>"
        )
        [System.IO.File]::WriteAllText($indexHtmlPath, $indexHtmlContent, $utf8NoBom)
        Write-Host "Synced version v$NewVersion into website/index.html"
    }

    # 3. Generate or update website/version.json
    $versionJsonPath = Join-Path $websiteDir 'version.json'
    $repoName = "TF49/AI-Helper"
    $versionInfo = [ordered]@{
        version = $NewVersion
        tag = "v$NewVersion"
        releaseDate = (Get-Date -Format "yyyy-MM-dd")
        setupFileName = "AI-Helper-v$NewVersion-Windows-x64-Setup.exe"
        zipFileName = "AI-Helper-v$NewVersion-Windows-x64-Standalone.zip"
        setupDownloadUrl = "https://github.com/$repoName/releases/download/v$NewVersion/AI-Helper-v$NewVersion-Windows-x64-Setup.exe"
        fastSetupDownloadUrl = "https://ghfast.top/https://github.com/$repoName/releases/download/v$NewVersion/AI-Helper-v$NewVersion-Windows-x64-Setup.exe"
        zipDownloadUrl = "https://github.com/$repoName/releases/download/v$NewVersion/AI-Helper-v$NewVersion-Windows-x64-Standalone.zip"
        fastZipDownloadUrl = "https://ghfast.top/https://github.com/$repoName/releases/download/v$NewVersion/AI-Helper-v$NewVersion-Windows-x64-Standalone.zip"
        releasePageUrl = "https://github.com/$repoName/releases/tag/v$NewVersion"
    }
    $versionJsonStr = ($versionInfo | ConvertTo-Json -Depth 4) + "`n"
    [System.IO.File]::WriteAllText($versionJsonPath, $versionJsonStr, $utf8NoBom)
    Write-Host "Generated/updated website/version.json"
}

Write-Host "Version successfully bumped to $NewVersion across package.json, tauri.conf.json, Cargo.toml, and website!"
