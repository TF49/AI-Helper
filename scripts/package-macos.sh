#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PACKAGE_JSON="$REPO_ROOT/package.json"
TAURI_CONFIG="$REPO_ROOT/src-tauri/tauri.conf.json"
VERSION="$(node -p 'require(process.argv[1]).version' "$PACKAGE_JSON")"
CONFIG_VERSION="$(node -p 'require(process.argv[1]).version' "$TAURI_CONFIG")"
PRODUCT_NAME="$(node -p 'require(process.argv[1]).productName' "$TAURI_CONFIG")"
PRODUCT_ID="$(node -p 'require(process.argv[1]).identifier' "$TAURI_CONFIG")"
TAG="${1:-v$VERSION}"
TARGET="${2:-aarch64-apple-darwin}"

if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ || "$TAG" != "v$VERSION" || "$CONFIG_VERSION" != "$VERSION" ]]; then
  echo "Release tag, package.json and tauri.conf.json versions must match." >&2
  exit 1
fi
if [[ "${GITHUB_REF_TYPE:-}" == tag && "${GITHUB_REF_NAME:-}" != "$TAG" ]]; then
  echo "GitHub trigger tag must match the release tag and configured version." >&2
  exit 1
fi
if [[ -z "$PRODUCT_NAME" || "$PRODUCT_NAME" == undefined || "$PRODUCT_NAME" == *'/'* || "$PRODUCT_NAME" == *'\'* || -z "$PRODUCT_ID" || "$PRODUCT_ID" == undefined ]]; then
  echo "Missing or invalid Tauri product identity." >&2
  exit 1
fi
case "$TARGET" in
  aarch64-apple-darwin) ARCH_NAME="aarch64"; BINARY_ARCH="arm64" ;;
  x86_64-apple-darwin) ARCH_NAME="x64"; BINARY_ARCH="x86_64" ;;
  *) echo "Unsupported macOS release target: $TARGET" >&2; exit 1 ;;
esac

BUILD_ROOT="$REPO_ROOT/src-tauri/target/$TARGET/release"
if [ ! -d "$BUILD_ROOT" ]; then
  echo "Target-specific release directory not found: $BUILD_ROOT" >&2
  exit 1
fi

# Pinned Tauri CLI: <product>_<version>_{aarch64,x64}.dmg, containing <product>.app.
# Never relabel the first file found or fall back to another target's output.
DMG_FILE="$BUILD_ROOT/bundle/dmg/${PRODUCT_NAME}_${VERSION}_${ARCH_NAME}.dmg"
if [ ! -s "$DMG_FILE" ]; then
  echo "Exact version/architecture DMG not found: $DMG_FILE" >&2
  exit 1
fi

# Inspect the bytes we will distribute. `tauri build --bundles dmg` removes its
# intermediate .app, so checking a neighbouring build directory is insufficient.
CHECK_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/ai-helper-dmg-check.XXXXXX")"
MOUNT_POINT="$CHECK_ROOT/mounted"
STAGED_DMG="$CHECK_ROOT/payload.dmg"
DMG_MOUNTED=false
cleanup_dmg_check() {
  if [[ "$DMG_MOUNTED" == true ]]; then
    if ! hdiutil detach "$MOUNT_POINT" >/dev/null 2>&1 && ! hdiutil detach -force "$MOUNT_POINT" >/dev/null 2>&1; then
      echo "Could not detach validation mount: $MOUNT_POINT" >&2
      return
    fi
  fi
  rmdir "$MOUNT_POINT" 2>/dev/null || true
  rm -f "$STAGED_DMG"
  rmdir "$CHECK_ROOT" 2>/dev/null || true
}
trap cleanup_dmg_check EXIT
mkdir "$MOUNT_POINT"
cp "$DMG_FILE" "$STAGED_DMG"
if ! hdiutil attach "$STAGED_DMG" -readonly -nobrowse -mountpoint "$MOUNT_POINT" >/dev/null; then
  echo "Cannot mount DMG for identity validation." >&2
  exit 1
fi
DMG_MOUNTED=true
APP_PATH="$MOUNT_POINT/$PRODUCT_NAME.app"
PLIST_PATH="$APP_PATH/Contents/Info.plist"
if [[ ! -d "$APP_PATH" || -L "$APP_PATH" || -L "$APP_PATH/Contents" || ! -f "$PLIST_PATH" || -L "$PLIST_PATH" ]]; then
  echo "DMG does not contain the expected application: $PRODUCT_NAME.app" >&2
  exit 1
fi
APP_VERSION="$(plutil -extract CFBundleShortVersionString raw -o - "$PLIST_PATH")"
APP_ID="$(plutil -extract CFBundleIdentifier raw -o - "$PLIST_PATH")"
APP_NAME="$(plutil -extract CFBundleDisplayName raw -o - "$PLIST_PATH")"
APP_EXECUTABLE="$(plutil -extract CFBundleExecutable raw -o - "$PLIST_PATH")"
if [[ "$APP_VERSION" != "$VERSION" || "$APP_ID" != "$PRODUCT_ID" || "$APP_NAME" != "$PRODUCT_NAME" ]]; then
  echo "DMG application version/product identity does not match release metadata." >&2
  exit 1
fi
if [[ -z "$APP_EXECUTABLE" || "$APP_EXECUTABLE" == . || "$APP_EXECUTABLE" == .. || "$APP_EXECUTABLE" == *'/'* || "$APP_EXECUTABLE" == *'\'* ]]; then
  echo "Invalid DMG application executable name." >&2
  exit 1
fi
APP_BINARY="$APP_PATH/Contents/MacOS/$APP_EXECUTABLE"
if [[ -L "$APP_PATH/Contents/MacOS" || ! -f "$APP_BINARY" || -L "$APP_BINARY" || "$(lipo -archs "$APP_BINARY")" != "$BINARY_ARCH" ]]; then
  echo "DMG application binary does not match target architecture: $BINARY_ARCH" >&2
  exit 1
fi
if ! hdiutil detach "$MOUNT_POINT" >/dev/null; then
  echo "Cannot detach DMG validation mount; packaging stopped." >&2
  exit 1
fi
DMG_MOUNTED=false
rmdir "$MOUNT_POINT"

# This custom updater consumes DMGs, not Tauri's optional .app.tar.gz artifacts.
# With --bundles dmg the pinned CLI does not create the latter; do not require or
# relabel a leftover archive from an earlier build.
ASSET_ROOT="$REPO_ROOT/release/$TAG"
mkdir -p "$ASSET_ROOT"
# Remove only the known obsolete outputs for this exact version/architecture so
# a reused local release directory cannot re-publish an unchecked old archive.
rm -f "$ASSET_ROOT/AI-Helper-$TAG-macOS-$ARCH_NAME.app.tar.gz" \
  "$ASSET_ROOT/AI-Helper-$TAG-macOS-$ARCH_NAME.app.tar.gz.sig"
TARGET_DMG="$ASSET_ROOT/AI-Helper-$TAG-macOS-$ARCH_NAME.dmg"
cp "$STAGED_DMG" "$TARGET_DMG"
rm -f "$TARGET_DMG.sig"
(
  cd "$REPO_ROOT"
  # Tauri CLI 2.8.1's standalone signer still uses these legacy env names.
  SIGNING_KEY="${TAURI_SIGNING_PRIVATE_KEY:-${TAURI_PRIVATE_KEY:-}}"
  if [[ -f "$SIGNING_KEY" ]]; then SIGNING_KEY="$(cat "$SIGNING_KEY")"; fi
  TAURI_PRIVATE_KEY="$SIGNING_KEY" \
    TAURI_PRIVATE_KEY_PASSWORD="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD-${TAURI_PRIVATE_KEY_PASSWORD:-}}" \
    pnpm exec tauri signer sign "$TARGET_DMG"
)
if [ ! -s "$TARGET_DMG.sig" ]; then
  echo "Signed DMG signature not generated: $TARGET_DMG.sig" >&2
  exit 1
fi
echo "Copied and signed macOS DMG: $TARGET_DMG"

ls -la "$ASSET_ROOT"
