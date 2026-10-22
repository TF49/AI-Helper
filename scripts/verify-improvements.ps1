#!/usr/bin/env pwsh
# Verify tasks 1-2-3 improvements

Write-Host "=== Verifying Improvements ===" -ForegroundColor Cyan
Write-Host ""

$ErrorActionPreference = "Continue"
$failed = 0

# 1. Check documentation
Write-Host "1. Checking user migration guide..." -ForegroundColor Yellow
if (Test-Path "docs/USER_MIGRATION_GUIDE.md") {
    $lines = (Get-Content -Encoding UTF8 "docs/USER_MIGRATION_GUIDE.md").Count
    Write-Host "   [OK] USER_MIGRATION_GUIDE.md exists ($lines lines)" -ForegroundColor Green
} else {
    Write-Host "   [FAIL] USER_MIGRATION_GUIDE.md not found" -ForegroundColor Red
    $failed++
}

# 2. Check code modifications
Write-Host "`n2. Checking code modifications..." -ForegroundColor Yellow

$secretStorage = Get-Content -Encoding UTF8 "src-tauri/src/secret_storage.rs" -Raw
if ($secretStorage -match "native_keychain_roundtrip_and_cleanup") {
    Write-Host "   [OK] macOS Keychain test added" -ForegroundColor Green
} else {
    Write-Host "   [FAIL] macOS Keychain test not found" -ForegroundColor Red
    $failed++
}

if ($secretStorage -match "native_secret_service_roundtrip_and_cleanup") {
    Write-Host "   [OK] Linux Secret Service test added" -ForegroundColor Green
} else {
    Write-Host "   [FAIL] Linux Secret Service test not found" -ForegroundColor Red
    $failed++
}

$workbuddy = Get-Content -Encoding UTF8 "src-tauri/src/workbuddy.rs" -Raw
if ($workbuddy -match "unix_filesystem_tests") {
    Write-Host "   [OK] Unix filesystem tests added" -ForegroundColor Green
} else {
    Write-Host "   [FAIL] Unix filesystem tests not found" -ForegroundColor Red
    $failed++
}

if ($workbuddy -match "symlink_to_readonly_mount_fails_gracefully") {
    Write-Host "   [OK] Read-only symlink test added" -ForegroundColor Green
} else {
    Write-Host "   [FAIL] Read-only symlink test not found" -ForegroundColor Red
    $failed++
}

# 3. Rust checks
Write-Host "`n3. Running Rust backend checks..." -ForegroundColor Yellow

Write-Host "   Running cargo fmt --check..." -NoNewline
$null = cargo fmt --manifest-path src-tauri/Cargo.toml --check 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host " [OK]" -ForegroundColor Green
} else {
    Write-Host " [FAIL]" -ForegroundColor Red
    $failed++
}

Write-Host "   Running cargo check --locked --lib..." -NoNewline
$null = cargo check --manifest-path src-tauri/Cargo.toml --locked --lib 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host " [OK]" -ForegroundColor Green
} else {
    Write-Host " [FAIL]" -ForegroundColor Red
    $failed++
}

Write-Host "   Running cargo clippy --locked --all-targets..." -NoNewline
$null = cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets -- -D warnings 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host " [OK]" -ForegroundColor Green
} else {
    Write-Host " [FAIL]" -ForegroundColor Red
    $failed++
}

Write-Host "   Running cargo test --locked --lib..." -NoNewline
$null = cargo test --manifest-path src-tauri/Cargo.toml --locked --lib 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host " [OK]" -ForegroundColor Green
} else {
    Write-Host " [FAIL]" -ForegroundColor Red
    $failed++
}

# 4. Frontend checks
Write-Host "`n4. Running Frontend checks..." -ForegroundColor Yellow

Write-Host "   Running pnpm typecheck..." -NoNewline
$null = pnpm typecheck 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host " [OK]" -ForegroundColor Green
} else {
    Write-Host " [FAIL]" -ForegroundColor Red
    $failed++
}

Write-Host "   Running pnpm test:security..." -NoNewline
$null = pnpm test:security 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host " [OK]" -ForegroundColor Green
} else {
    Write-Host " [FAIL]" -ForegroundColor Red
    $failed++
}

Write-Host "   Running pnpm build:renderer..." -NoNewline
$null = pnpm build:renderer 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host " [OK]" -ForegroundColor Green
} else {
    Write-Host " [FAIL]" -ForegroundColor Red
    $failed++
}

# Summary
Write-Host "`n=== Summary ===" -ForegroundColor Cyan
if ($failed -eq 0) {
    Write-Host "[SUCCESS] All checks passed!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Next steps:" -ForegroundColor Yellow
    Write-Host "  1. On macOS: cargo test native_keychain -- --ignored" -ForegroundColor White
    Write-Host "  2. On Linux: cargo test native_secret_service -- --ignored" -ForegroundColor White
    Write-Host "  3. On Linux: cargo test unix_filesystem" -ForegroundColor White
    Write-Host "  4. Collect user feedback to improve docs" -ForegroundColor White
    exit 0
} else {
    Write-Host "[FAILED] Found $failed issues" -ForegroundColor Red
    exit 1
}
