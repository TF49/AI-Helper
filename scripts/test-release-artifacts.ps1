param([string]$BashPath)

# Runs the real packaging/finalizing scripts against disposable assets. No real key,
# installer, network request, or published release is used.
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$tempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
$fixtureRoot = Join-Path $tempRoot ('ai-helper-release-test-' + [guid]::NewGuid().ToString('N'))
$utf8 = [System.Text.UTF8Encoding]::new($false)
$mockSignerState = [pscustomobject]@{ ExitCode = 0; Calls = 0 }
$previousRefType = $env:GITHUB_REF_TYPE
$previousRefName = $env:GITHUB_REF_NAME

function Assert-Release($Condition, [string]$Message) {
    if (-not $Condition) { throw "Release regression: $Message" }
}

function Write-Fixture([string]$Path, [string]$Content) {
    [System.IO.Directory]::CreateDirectory((Split-Path -Parent $Path)) | Out-Null
    [System.IO.File]::WriteAllText($Path, $Content, $utf8)
}

function Assert-Rejected([scriptblock]$Action, [string]$ExpectedMessage) {
    $failure = $null
    try { & $Action } catch { $failure = $_.Exception.Message }
    Assert-Release ($null -ne $failure -and $failure.Contains($ExpectedMessage)) "Expected rejection containing '$ExpectedMessage'; got '$failure'."
}

function Write-MacosDmg([string]$Path, [string]$Architecture, [string]$Version = '1.0.70', [string]$Identifier = 'com.aihelper.app', [string]$Product = 'AI Helper') {
    $content = @(
        'APP_DIRECTORY=AI Helper.app'
        "CFBundleShortVersionString=$Version"
        "CFBundleIdentifier=$Identifier"
        "CFBundleDisplayName=$Product"
        'CFBundleExecutable=ai-helper'
        "BINARY_ARCH=$Architecture"
    ) -join "`n"
    Write-Fixture $Path $content
    return $content
}

function Get-MacosSignCount {
    $trace = Join-Path $fixtureRoot 'scripts/mock-tools.log'
    if (-not (Test-Path -LiteralPath $trace)) { return 0 }
    return @(Get-Content -LiteralPath $trace -Encoding UTF8 | Where-Object { $_ -eq 'sign' }).Count
}

function Assert-MacosRejected([string]$Tag, [string]$Target, [string]$ExpectedMessage) {
    $callsBefore = Get-MacosSignCount
    $previousErrorAction = $ErrorActionPreference
    try {
        # Windows PowerShell surfaces native stderr as ErrorRecords; capture the
        # intended failure instead of stopping before we inspect its exit code.
        $ErrorActionPreference = 'Continue'
        $output = & $BashPath './scripts/mock-package-driver.sh' $Tag $Target 2>&1 | Out-String
        $exitCode = $LASTEXITCODE
    } finally { $ErrorActionPreference = $previousErrorAction }
    Assert-Release ($exitCode -ne 0 -and $output.Contains($ExpectedMessage)) "Expected macOS rejection '$ExpectedMessage'; got '$output'."
    Assert-Release ((Get-MacosSignCount) -eq $callsBefore) 'Invalid macOS metadata/target must fail before signing.'
    Assert-Release (@(Get-ChildItem -LiteralPath (Join-Path $fixtureRoot 'tmp') -Directory).Count -eq 0) 'DMG validation left a temporary directory/mount behind.'
}

function pnpm {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$SignerArgs)
    Assert-Release (($SignerArgs[0..3] -join ' ') -eq 'exec tauri signer sign') 'Unexpected signer invocation.'
    $mockSignerState.Calls++
    $global:LASTEXITCODE = $mockSignerState.ExitCode
    if ($mockSignerState.ExitCode -eq 0) {
        $path = $SignerArgs[4]
        Write-Fixture "$path.sig" ('mock-signature:' + (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash)
    }
}

try {
    $env:GITHUB_REF_TYPE = 'branch'
    $env:GITHUB_REF_NAME = 'fixture-branch'
    New-Item -ItemType Directory -Path (Join-Path $fixtureRoot 'scripts') | Out-Null
    foreach ($name in @('package-macos.sh', 'package-release.ps1', 'finalize-update-manifest.ps1', 'sign-update-file.ps1')) {
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination (Join-Path $fixtureRoot "scripts/$name")
    }
    Write-Fixture (Join-Path $fixtureRoot 'package.json') '{"version":"1.0.70"}'
    Write-Fixture (Join-Path $fixtureRoot 'src-tauri/tauri.conf.json') '{"productName":"AI Helper","identifier":"com.aihelper.app","version":"1.0.70"}'
    # Mock node avoids native Windows node interpreting Git Bash's /tmp path.
    Write-Fixture (Join-Path $fixtureRoot 'scripts/mock-package-driver.sh') @'
#!/usr/bin/env bash
export TAURI_SIGNING_PRIVATE_KEY=fixture-private-key
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=fixture-password
export MOCK_TOOL_TRACE="$PWD/scripts/mock-tools.log"
export TMPDIR="$PWD/tmp"
mkdir -p "$TMPDIR"
node() {
  local property
  case "$2" in
    *.productName) property=productName ;;
    *.identifier) property=identifier ;;
    *.version) property=version ;;
    *) return 95 ;;
  esac
  sed -nE 's/.*"'"$property"'"[[:space:]]*:[[:space:]]*"([^"]*)".*/\1/p' "$3"
}
hdiutil() {
  if [[ "$1" == attach ]]; then
    [[ "$3 $4 $5" == '-readonly -nobrowse -mountpoint' ]] || return 94
    printf 'attach\n' >> "$MOCK_TOOL_TRACE"
    [[ "${MOCK_MOUNT_FAIL:-0}" == 0 ]] || return 17
    local app="$6/AI Helper.app"
    mkdir -p "$app/Contents/MacOS"
    sed -n '/^CFBundle/p' "$2" > "$app/Contents/Info.plist"
    sed -n 's/^BINARY_ARCH=//p' "$2" > "$app/Contents/MacOS/ai-helper"
  elif [[ "$1" == detach ]]; then
    printf 'detach\n' >> "$MOCK_TOOL_TRACE"
    [[ "${MOCK_DETACH_FAIL:-0}" == 0 || "$2" == -force ]] || return 19
    local app="${@: -1}/AI Helper.app"
    rm -f "$app/Contents/Info.plist" "$app/Contents/MacOS/ai-helper"
    rmdir "$app/Contents/MacOS" "$app/Contents" "$app"
  else return 93
  fi
}
plutil() {
  [[ "$1" == -extract && "$3 $4 $5" == 'raw -o -' ]] || return 92
  sed -n "s/^$2=//p" "$6"
}
lipo() { [[ "$1" == -archs ]] || return 91; cat "$2"; }
pnpm() {
  [[ "$1 $2 $3 $4" == "exec tauri signer sign" ]] || return 97
  [[ "$TAURI_PRIVATE_KEY" == fixture-private-key && "$TAURI_PRIVATE_KEY_PASSWORD" == fixture-password ]] || return 98
  printf 'sign\n' >> "$MOCK_TOOL_TRACE"
  [[ "${MOCK_SIGNER_FAIL:-0}" == 0 ]] || return 23
  printf 'mock-dmg-signature:%s' "$(cat "$5")" > "$5.sig"
}
export -f node hdiutil plutil lipo pnpm
bash ./scripts/package-macos.sh "$@"
exit $?
'@
    if (-not $BashPath) {
        if ($env:ProgramFiles -and (Test-Path -LiteralPath (Join-Path $env:ProgramFiles 'Git/bin/bash.exe'))) {
            $BashPath = Join-Path $env:ProgramFiles 'Git/bin/bash.exe'
        } else { $BashPath = (Get-Command bash -ErrorAction Stop).Source }
    }
    $assetRoot = Join-Path $fixtureRoot 'release/v1.0.70'
    Push-Location $fixtureRoot
    try {
        # A different target's generic output must not be reused and relabelled.
        $fallbackDmg = Join-Path $fixtureRoot 'src-tauri/target/release/bundle/dmg/AI Helper_1.0.69_aarch64.dmg'
        Write-MacosDmg $fallbackDmg arm64 '1.0.69' | Out-Null
        Assert-MacosRejected v1.0.70 x86_64-apple-darwin 'Target-specific release directory not found'
        Assert-MacosRejected v1.0.71 aarch64-apple-darwin 'versions must match'
        Assert-MacosRejected v1.0.70 universal-apple-darwin 'Unsupported macOS release target'
        $env:GITHUB_REF_TYPE = 'tag'
        $env:GITHUB_REF_NAME = 'v1.0.71'
        Assert-MacosRejected v1.0.70 aarch64-apple-darwin 'GitHub trigger tag must match'
        Assert-Rejected { & (Join-Path $fixtureRoot 'scripts/package-release.ps1') -Tag v1.0.70 } 'GitHub trigger tag must match'
        Assert-Rejected { & (Join-Path $fixtureRoot 'scripts/finalize-update-manifest.ps1') -AssetRoot $assetRoot -Tag v1.0.70 } 'GitHub trigger tag must match'
        $env:GITHUB_REF_NAME = 'v1.0.70'
        foreach ($target in @('aarch64-apple-darwin', 'x86_64-apple-darwin')) {
            $bundle = Join-Path $fixtureRoot "src-tauri/target/$target/release/bundle"
            $arch = if ($target.StartsWith('aarch64')) { 'aarch64' } else { 'x64' }
            $binaryArch = if ($target.StartsWith('aarch64')) { 'arm64' } else { 'x86_64' }
            $dmgSource = Join-Path $bundle "dmg/AI Helper_1.0.70_$arch.dmg"
            $dmgContent = Write-MacosDmg $dmgSource $binaryArch
            # A clean `--bundles dmg` run has neither an intermediate .app nor an
            # updater archive. Old/unrelated filenames must not influence selection.
            Write-MacosDmg (Join-Path $bundle 'dmg/AI Helper_1.0.69_x64.dmg') x86_64 '1.0.69' | Out-Null
            $obsoleteArchive = Join-Path $assetRoot "AI-Helper-v1.0.70-macOS-$arch.app.tar.gz"
            Write-Fixture $obsoleteArchive 'obsolete unchecked archive from an earlier local packaging run'
            Write-Fixture "$obsoleteArchive.sig" 'obsolete archive signature'
            & $BashPath './scripts/mock-package-driver.sh' v1.0.70 $target | Out-Null
            Assert-Release ($LASTEXITCODE -eq 0) "macOS packaging failed for $target."
            $dmg = Join-Path $assetRoot "AI-Helper-v1.0.70-macOS-$arch.dmg"
            Assert-Release ((Get-Content -LiteralPath $dmg -Raw -Encoding UTF8) -eq $dmgContent) 'Published DMG bytes must match the selected and inspected DMG.'
            Assert-Release ((Get-Content -LiteralPath "$dmg.sig" -Raw -Encoding UTF8) -eq "mock-dmg-signature:$dmgContent") 'The inspected DMG must be explicitly signed.'
            Assert-Release (@(Get-ChildItem -LiteralPath (Join-Path $fixtureRoot 'tmp') -Directory).Count -eq 0) 'Successful DMG validation did not clean up.'
        }
        Assert-Release (@(Get-ChildItem -LiteralPath $assetRoot -Filter '*.tar.gz*').Count -eq 0) 'Unused/unverified updater archives must not be published.'

        $armSource = Join-Path $fixtureRoot 'src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/AI Helper_1.0.70_aarch64.dmg'
        $savedArm = Get-Content -LiteralPath $armSource -Raw -Encoding UTF8
        Move-Item -LiteralPath $armSource -Destination "$armSource.held"
        try {
            Assert-MacosRejected v1.0.70 aarch64-apple-darwin 'Exact version/architecture DMG not found'
            Write-MacosDmg (Join-Path (Split-Path -Parent $armSource) 'AI Helper_1.0.70_x64.dmg') x86_64 | Out-Null
            Assert-MacosRejected v1.0.70 aarch64-apple-darwin 'Exact version/architecture DMG not found'
        } finally { Move-Item -LiteralPath "$armSource.held" -Destination $armSource }
        try {
            Write-MacosDmg $armSource arm64 '1.0.69' | Out-Null
            Assert-MacosRejected v1.0.70 aarch64-apple-darwin 'DMG application version/product identity'
            Write-MacosDmg $armSource x86_64 | Out-Null
            Assert-MacosRejected v1.0.70 aarch64-apple-darwin 'DMG application binary does not match target architecture'
            Write-MacosDmg $armSource arm64 '1.0.70' 'com.fake.other' | Out-Null
            Assert-MacosRejected v1.0.70 aarch64-apple-darwin 'DMG application version/product identity'
            Write-MacosDmg $armSource arm64 '1.0.70' 'com.aihelper.app' 'Other App' | Out-Null
            Assert-MacosRejected v1.0.70 aarch64-apple-darwin 'DMG application version/product identity'
        } finally { Write-Fixture $armSource $savedArm }
        $env:MOCK_MOUNT_FAIL = '1'
        try { Assert-MacosRejected v1.0.70 aarch64-apple-darwin 'Cannot mount DMG for identity validation' }
        finally { Remove-Item Env:MOCK_MOUNT_FAIL }
        $env:MOCK_DETACH_FAIL = '1'
        try { Assert-MacosRejected v1.0.70 aarch64-apple-darwin 'Cannot detach DMG validation mount' }
        finally { Remove-Item Env:MOCK_DETACH_FAIL }
        $configPath = Join-Path $fixtureRoot 'src-tauri/tauri.conf.json'
        Write-Fixture $configPath '{"productName":"AI Helper","identifier":"com.aihelper.app","version":"1.0.71"}'
        try { Assert-MacosRejected v1.0.70 aarch64-apple-darwin 'versions must match' }
        finally { Write-Fixture $configPath '{"productName":"AI Helper","identifier":"com.aihelper.app","version":"1.0.70"}' }
        # A stale signature must never mask a failed DMG signer.
        $env:MOCK_SIGNER_FAIL = '1'
        try {
            & $BashPath './scripts/mock-package-driver.sh' v1.0.70 aarch64-apple-darwin 2>&1 | Out-Null
            Assert-Release ($LASTEXITCODE -ne 0) 'DMG signer failure must stop packaging.'
            Assert-Release (-not (Test-Path -LiteralPath (Join-Path $assetRoot 'AI-Helper-v1.0.70-macOS-aarch64.dmg.sig'))) 'A stale DMG signature survived signer failure.'
        } finally { Remove-Item Env:MOCK_SIGNER_FAIL }
        & $BashPath './scripts/mock-package-driver.sh' v1.0.70 aarch64-apple-darwin | Out-Null
        Assert-Release ($LASTEXITCODE -eq 0) 'Failed to restore signed test DMG.'
    } finally { Pop-Location }

    # Exercise Windows packaging too, using only fake files and the mock signer.
    $windowsBuild = Join-Path $fixtureRoot 'src-tauri/target/release'
    $windowsInstaller = Join-Path $windowsBuild 'bundle/nsis/AI Helper_1.0.70_x64-setup.exe'
    Write-Fixture $windowsInstaller 'fake Windows installer'
    Write-Fixture "$windowsInstaller.sig" 'fake Windows installer signature'
    Write-Fixture (Join-Path $windowsBuild 'ai-helper.exe') 'fake standalone binary'
    foreach ($relative in @('LICENSE', 'THIRD_PARTY_NOTICES.md', 'docs/standalone-readme.txt')) {
        Write-Fixture (Join-Path $fixtureRoot $relative) "fixture notice: $relative"
    }
    & (Join-Path $fixtureRoot 'scripts/package-release.ps1') -Tag v1.0.70 | Out-Null
    Assert-Release (Test-Path -LiteralPath (Join-Path $assetRoot 'AI-Helper-v1.0.70-Windows-x64-Standalone.zip')) 'Matching GitHub trigger tag must allow Windows packaging.'

    $windows = Join-Path $assetRoot 'AI-Helper-v1.0.70-Windows-x64-Setup.exe'
    Write-Fixture $windows 'windows installer'
    Write-Fixture "$windows.sig" 'windows signature'
    Write-Fixture (Join-Path $assetRoot 'standalone.zip') 'standalone archive'
    Write-Fixture (Join-Path $assetRoot 'latest.json') 'stale manifest'
    Write-Fixture (Join-Path $assetRoot 'latest.json.sig') 'stale manifest signature'
    Write-Fixture (Join-Path $assetRoot 'SHA256SUMS.txt') 'stale checksums'
    $finalizer = Join-Path $fixtureRoot 'scripts/finalize-update-manifest.ps1'
    & $finalizer -AssetRoot $assetRoot -Tag v1.0.70
    $manifest = Get-Content -LiteralPath (Join-Path $assetRoot 'latest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    $expected = [ordered]@{
        'windows-x86_64' = 'AI-Helper-v1.0.70-Windows-x64-Setup.exe'
        'darwin-aarch64' = 'AI-Helper-v1.0.70-macOS-aarch64.dmg'
        'darwin-x86_64' = 'AI-Helper-v1.0.70-macOS-x64.dmg'
    }
    Assert-Release (@($manifest.platforms.PSObject.Properties).Count -eq 3) 'Final manifest must contain all three required platforms.'
    foreach ($platform in $expected.Keys) {
        $entry = $manifest.platforms.$platform
        $artifact = Join-Path $assetRoot $expected[$platform]
        Assert-Release ($entry.url.EndsWith('/' + $expected[$platform])) "Wrong installer type/name for $platform."
        Assert-Release ($entry.signature -eq (Get-Content -LiteralPath "$artifact.sig" -Raw -Encoding UTF8).Trim()) "Wrong signature for $platform."
        Assert-Release ($entry.sha256 -eq (Get-FileHash -LiteralPath $artifact -Algorithm SHA256).Hash.ToLowerInvariant()) "Wrong installer digest for $platform."
    }
    $sums = @{}
    foreach ($line in Get-Content -LiteralPath (Join-Path $assetRoot 'SHA256SUMS.txt') -Encoding UTF8) {
        Assert-Release ($line -match '^([a-f0-9]{64})  (.+)$') 'Malformed checksum entry.'
        $sums[$Matches[2]] = $Matches[1]
    }
    $published = @(Get-ChildItem -LiteralPath $assetRoot -File | Where-Object { $_.Name -ne 'SHA256SUMS.txt' })
    Assert-Release ($sums.Count -eq $published.Count -and -not $sums.ContainsKey('SHA256SUMS.txt')) 'Checksum coverage must include every published file except itself.'
    foreach ($file in $published) {
        Assert-Release ($sums[$file.Name] -eq (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()) "Stale/missing final checksum: $($file.Name)."
    }
    foreach ($name in $expected.Values) {
        foreach ($suffix in @('', '.sig')) {
            $required = Join-Path $assetRoot ($name + $suffix)
            Move-Item -LiteralPath $required -Destination "$required.held"
            try {
                $callsBefore = $mockSignerState.Calls
                Assert-Rejected { & $finalizer -AssetRoot $assetRoot -Tag v1.0.70 } 'Missing'
                Assert-Release ($mockSignerState.Calls -eq $callsBefore) 'Missing platform/signature must fail before signing.'
            } finally { Move-Item -LiteralPath "$required.held" -Destination $required }
        }
    }
    $emptySignaturePath = "$windows.sig"
    $savedSignature = Get-Content -LiteralPath $emptySignaturePath -Raw -Encoding UTF8
    Write-Fixture $emptySignaturePath ' '
    try {
        Assert-Rejected { & $finalizer -AssetRoot $assetRoot -Tag v1.0.70 } 'Empty windows-x86_64'
    } finally { Write-Fixture $emptySignaturePath $savedSignature }
    Assert-Rejected { & $finalizer -AssetRoot $assetRoot -Tag v1.0.71 } 'versions must match'
    $mockSignerState.ExitCode = 29
    Assert-Rejected { & $finalizer -AssetRoot $assetRoot -Tag v1.0.70 } 'Tauri signer failed'
    Assert-Release (-not (Test-Path -LiteralPath (Join-Path $assetRoot 'latest.json.sig'))) 'Failed final signing must not reuse the old signature.'
    $global:LASTEXITCODE = 0
    Write-Host 'Release artifact regressions passed: exact DMG version/target, mounted app identity/architecture, clean DMG-only builds, three platforms, final checksums, and signer failures.'
} finally {
    $env:GITHUB_REF_TYPE = $previousRefType
    $env:GITHUB_REF_NAME = $previousRefName
    $cleanupPath = [System.IO.Path]::GetFullPath($fixtureRoot)
    if ($cleanupPath.StartsWith($tempRoot, [System.StringComparison]::OrdinalIgnoreCase) -and [System.IO.Path]::GetFileName($cleanupPath).StartsWith('ai-helper-release-test-')) {
        Remove-Item -LiteralPath $cleanupPath -Recurse -Force
    }
}
