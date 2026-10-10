#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PACKAGE_JSON="$REPO_ROOT/package.json"
VERSION="$(node -p "require('$PACKAGE_JSON').version")"
TAG="${1:-v$VERSION}"
TARGET="${2:-aarch64-apple-darwin}"

BUILD_ROOT="$REPO_ROOT/src-tauri/target/$TARGET/release"
if [ ! -d "$BUILD_ROOT" ]; then
  BUILD_ROOT="$REPO_ROOT/src-tauri/target/release"
fi

ASSET_ROOT="$REPO_ROOT/release/$TAG"
mkdir -p "$ASSET_ROOT"

# 查找 DMG 安装包
DMG_FILE=$(find "$BUILD_ROOT/bundle/dmg" -name "*.dmg" 2>/dev/null | head -n 1 || true)
if [ -n "$DMG_FILE" ] && [ -f "$DMG_FILE" ]; then
  ARCH_NAME="aarch64"
  if [[ "$TARGET" == *"x86_64"* ]]; then
    ARCH_NAME="x64"
  elif [[ "$TARGET" == *"universal"* ]]; then
    ARCH_NAME="universal"
  fi
  TARGET_DMG="$ASSET_ROOT/AI-Helper-$TAG-macOS-$ARCH_NAME.dmg"
  cp "$DMG_FILE" "$TARGET_DMG"
  echo "Copied macOS DMG to: $TARGET_DMG"

  # 若有 DMG 签名文件也同步保留
  if [ -f "$DMG_FILE.sig" ]; then
    cp "$DMG_FILE.sig" "$TARGET_DMG.sig"
  fi
fi

# 查找 Tauri Updater 增量升级包 (*.tar.gz)
TAR_GZ=$(find "$BUILD_ROOT/bundle/macos" -name "*.tar.gz" 2>/dev/null | head -n 1 || true)
if [ -n "$TAR_GZ" ] && [ -f "$TAR_GZ" ]; then
  cp "$TAR_GZ" "$ASSET_ROOT/"
  if [ -f "$TAR_GZ.sig" ]; then
    cp "$TAR_GZ.sig" "$ASSET_ROOT/"
  fi
  echo "Copied macOS updater artifact: $(basename "$TAR_GZ")"
fi

ls -la "$ASSET_ROOT"
