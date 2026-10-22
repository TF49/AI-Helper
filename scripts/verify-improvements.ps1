$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot

function Invoke-Required([string]$Program, [string[]]$Arguments) {
    Write-Host "Running $Program $($Arguments -join ' ')"
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Program failed with exit code $LASTEXITCODE" }
}

Push-Location $repoRoot
try {
    Invoke-Required cargo @('fmt', '--manifest-path', 'src-tauri/Cargo.toml', '--', '--check')
    Invoke-Required cargo @('check', '--manifest-path', 'src-tauri/Cargo.toml', '--locked', '--lib')
    Invoke-Required cargo @('clippy', '--manifest-path', 'src-tauri/Cargo.toml', '--locked', '--all-targets', '--', '-D', 'warnings')
    Invoke-Required cargo @('test', '--manifest-path', 'src-tauri/Cargo.toml', '--locked', '--lib', '--', '--test-threads=1')
    if ([System.Environment]::OSVersion.Platform -eq [System.PlatformID]::Win32NT) {
        Invoke-Required cargo @('test', '--manifest-path', 'src-tauri/Cargo.toml', '--locked', '--lib', 'secret_storage::native_windows_tests', '--', '--ignored')
    }
    Invoke-Required pnpm @('typecheck')
    Invoke-Required pnpm @('test:security')
    Invoke-Required pnpm @('test:workflows')
    Invoke-Required pnpm @('build:renderer')
    & (Join-Path $PSScriptRoot 'test-release-artifacts.ps1')
    Write-Host 'Local regressions passed. Native Unix services and real DMG checks run in isolated CI jobs.'
} finally {
    Pop-Location
}
