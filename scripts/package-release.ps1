param([string]$Tag)

$ErrorActionPreference = 'Stop'
# UTF-8 without BOM encoder (PowerShell 5.x Set-Content -Encoding UTF8 adds BOM)
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
$repoRoot = Split-Path -Parent $PSScriptRoot
$package = Get-Content -LiteralPath (Join-Path $repoRoot 'package.json') -Encoding UTF8 -Raw | ConvertFrom-Json
$tauri = Get-Content -LiteralPath (Join-Path $repoRoot 'src-tauri/tauri.conf.json') -Encoding UTF8 -Raw | ConvertFrom-Json
if (-not $Tag) { $Tag = "v$($package.version)" }
if ($Tag -cne "v$($package.version)" -or $tauri.version -cne $package.version) {
    throw 'Release tag, package.json and tauri.conf.json versions must match.'
}

$buildRoot = Join-Path $repoRoot 'src-tauri/target/release'
$installer = Join-Path $buildRoot "bundle/nsis/BobAPI Tool_$($package.version)_x64-setup.exe"
$binary = Join-Path $buildRoot 'bobapi-tool.exe'
foreach ($required in @($installer, $binary)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
        throw "Missing release build: $required. Run pnpm tauri build --bundles nsis first."
    }
}

$assetRoot = Join-Path $repoRoot "release/$Tag"
$standaloneRoot = Join-Path $assetRoot 'standalone'
New-Item -ItemType Directory -Force -Path $standaloneRoot | Out-Null
$installerName = "BobAPI-Tool-$Tag-Windows-x64-Setup.exe"
$zipName = "BobAPI-Tool-$Tag-Windows-x64-Standalone.zip"
Copy-Item -LiteralPath $installer -Destination (Join-Path $assetRoot $installerName)
Copy-Item -LiteralPath $binary -Destination (Join-Path $standaloneRoot 'bobapi-tool.exe')
Copy-Item -LiteralPath (Join-Path $repoRoot 'LICENSE') -Destination (Join-Path $standaloneRoot 'LICENSE.txt')
Copy-Item -LiteralPath (Join-Path $repoRoot 'THIRD_PARTY_NOTICES.md') -Destination $standaloneRoot
Copy-Item -LiteralPath (Join-Path $repoRoot 'docs/standalone-readme.txt') -Destination (Join-Path $standaloneRoot 'README.txt')
Compress-Archive -LiteralPath @(
    (Join-Path $standaloneRoot 'bobapi-tool.exe'),
    (Join-Path $standaloneRoot 'LICENSE.txt'),
    (Join-Path $standaloneRoot 'THIRD_PARTY_NOTICES.md'),
    (Join-Path $standaloneRoot 'README.txt')
) -DestinationPath (Join-Path $assetRoot $zipName) -Force

$installerSig = "$installer.sig"
$sigName = "$installerName.sig"
$hasSig = Test-Path -LiteralPath $installerSig -PathType Leaf

if ($hasSig) {
    Copy-Item -LiteralPath $installerSig -Destination (Join-Path $assetRoot $sigName)
    $sigContent = (Get-Content -LiteralPath $installerSig -Raw -Encoding UTF8).Trim()
    
    $notesFile = Join-Path $repoRoot "docs/releases/$Tag.md"
    $notes = if (Test-Path -LiteralPath $notesFile) {
        Get-Content -LiteralPath $notesFile -Raw -Encoding UTF8
    } else {
        "BobAPI Tool $Tag"
    }

    $latestManifest = [ordered]@{
        version = $package.version
        notes = $notes.Trim()
        pub_date = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
        platforms = @{
            "windows-x86_64" = @{
                signature = $sigContent
                url = "https://github.com/TF49/Bobapi-Tool/releases/download/$Tag/$installerName"
            }
        }
    }

    $latestJsonPath = Join-Path $assetRoot 'latest.json'
    $latestJsonContent = $latestManifest | ConvertTo-Json -Depth 5
    [System.IO.File]::WriteAllText($latestJsonPath, $latestJsonContent, $utf8NoBom)
    Write-Host "Generated update manifest: $latestJsonPath"
} else {
    Write-Warning "Signature file not found: $installerSig. (Updater latest.json will not be generated. Ensure TAURI_SIGNING_PRIVATE_KEY is set during build.)"
}

$filesToCheck = @($installerName, $zipName)
if ($hasSig) {
    $filesToCheck += $sigName
    $filesToCheck += 'latest.json'
}

$checksums = foreach ($name in $filesToCheck) {
    $filePath = Join-Path $assetRoot $name
    if (Test-Path -LiteralPath $filePath) {
        $hash = Get-FileHash -LiteralPath $filePath -Algorithm SHA256
        "$($hash.Hash.ToLowerInvariant())  $name"
    }
}
$checksumContent = $checksums -join "`n"
[System.IO.File]::WriteAllText((Join-Path $assetRoot 'SHA256SUMS.txt'), $checksumContent, $utf8NoBom)
Get-ChildItem -LiteralPath $assetRoot -File | Select-Object Name, Length
