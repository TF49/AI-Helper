param(
    [Parameter(Mandatory = $true)][string]$AssetRoot,
    [string]$Tag
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
$package = Get-Content -LiteralPath (Join-Path $repoRoot 'package.json') -Encoding UTF8 -Raw | ConvertFrom-Json
if (-not $Tag) { $Tag = "v$($package.version)" }
if ($Tag -cne "v$($package.version)") { throw 'Release tag and package.json versions must match.' }
if ($env:GITHUB_REF_TYPE -ceq 'tag' -and $env:GITHUB_REF_NAME -cne $Tag) {
    throw 'GitHub trigger tag must match the release tag and configured version.'
}
$assetRoot = [System.IO.Path]::GetFullPath($AssetRoot)
if (-not (Test-Path -LiteralPath $assetRoot -PathType Container)) { throw "Release asset directory does not exist: $assetRoot" }

$platforms = [ordered]@{}
$requiredArtifacts = [ordered]@{
    'windows-x86_64' = "AI-Helper-$Tag-Windows-x64-Setup.exe"
    'darwin-aarch64' = "AI-Helper-$Tag-macOS-aarch64.dmg"
    'darwin-x86_64' = "AI-Helper-$Tag-macOS-x64.dmg"
}
foreach ($platformKey in $requiredArtifacts.Keys) {
    $fileName = $requiredArtifacts[$platformKey]
    $artifactPath = Join-Path $assetRoot $fileName
    if (-not (Test-Path -LiteralPath $artifactPath -PathType Leaf)) { throw "Missing required $platformKey installer: $artifactPath" }
    $sigPath = "$artifactPath.sig"
    if (-not (Test-Path -LiteralPath $sigPath -PathType Leaf)) { throw "Missing $platformKey installer signature: $sigPath" }
    $sig = (Get-Content -LiteralPath $sigPath -Raw -Encoding UTF8).Trim()
    if ([string]::IsNullOrWhiteSpace($sig)) { throw "Empty $platformKey installer signature: $sigPath" }
    $platforms[$platformKey] = [ordered]@{ signature = $sig; url = "https://github.com/TF49/AI-Helper/releases/download/$Tag/$fileName"; sha256 = (Get-FileHash -LiteralPath $artifactPath -Algorithm SHA256).Hash.ToLowerInvariant() }
}
$notesPath = Join-Path $repoRoot "docs/releases/$Tag.md"
$notes = if (Test-Path -LiteralPath $notesPath) { Get-Content -LiteralPath $notesPath -Raw -Encoding UTF8 } else { "AI Helper $Tag" }
$versionParts = $package.version.ToString().Split('.')
$releaseSeq = ([int64]$versionParts[0] * 1000000) + ([int64]$versionParts[1] * 1000) + ([int64]$versionParts[2])
$manifest = [ordered]@{ schema_version = 1; product = 'ai-helper'; channel = 'stable'; version = $package.version; release_seq = $releaseSeq; notes = $notes.Trim(); pub_date = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ'); platforms = $platforms }
$manifestPath = Join-Path $assetRoot 'latest.json'
[System.IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json -Depth 8), $utf8NoBom)
& (Join-Path $PSScriptRoot 'sign-update-file.ps1') -FilePath $manifestPath
$checksums = Get-ChildItem -LiteralPath $assetRoot -File | Where-Object { $_.Name -ne 'SHA256SUMS.txt' } | Sort-Object Name | ForEach-Object {
    "$((Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant())  $($_.Name)"
}
[System.IO.File]::WriteAllText((Join-Path $assetRoot 'SHA256SUMS.txt'), (($checksums -join "`n") + "`n"), $utf8NoBom)
Write-Host "Final signed update manifest contains: $($platforms.Keys -join ', ')"
