#!/bin/bash
set -euo pipefail

repo_url="https://github.com/TF49/AI-Helper"
app_name="AI Helper.app"
bundle_id="com.aihelper.app"
install_dir="$HOME/Applications"
work_dir=""
mount_point=""
stage=""
destination=""
mounted=false
installed=false

fail() {
  printf 'AI Helper installation failed: %s\n' "$*" >&2
  exit 1
}

download() {
  curl --disable --fail --show-error --silent --location \
    --proto '=https' --proto-redir '=https' --retry 2 "$@"
}

cleanup() {
  if [[ -n "$stage" ]]; then
    if [[ "$installed" == false && -d "$stage/previous.app" ]]; then
      if [[ -e "$destination" || -L "$destination" ]] ||
        ! mv "$stage/previous.app" "$destination"; then
        printf 'The previous version is available at %s\n' "$stage/previous.app" >&2
        stage=""
      fi
    fi
    if [[ -n "$stage" ]]; then
      rm -rf -- "$stage" || true
    fi
  fi
  if [[ "$mounted" == true ]] &&
    ! hdiutil detach "$mount_point" >/dev/null &&
    ! hdiutil detach -force "$mount_point" >/dev/null; then
    printf 'Detach the installer disk image at %s\n' "$mount_point" >&2
    return
  fi
  rm -rf -- "$work_dir" || true
}

main() {
  case "${1:-}" in
    -h|--help)
      printf 'Usage: bash install-macos.sh [--install-dir PATH]\nInstalls to ~/Applications by default. Requires macOS 11 or later.\n'
      return
      ;;
    --install-dir)
      [[ $# == 2 && -n "$2" ]] || fail "--install-dir requires a directory."
      install_dir="$2"
      ;;
    "") [[ $# == 0 ]] || fail "See --help for installation options." ;;
    *) fail "See --help for installation options." ;;
  esac

  [[ "$(uname -s)" == Darwin ]] || fail "Run the installer on macOS."
  local macos_version
  macos_version="$(sw_vers -productVersion)"
  [[ "${macos_version%%.*}" -ge 11 ]] || fail "macOS 11 or later is required."

  local asset_arch binary_arch
  if [[ "$(/usr/sbin/sysctl -n hw.optional.arm64 2>/dev/null || true)" == 1 ]]; then
    # Rosetta can report x86_64 through uname on Apple Silicon.
    asset_arch=aarch64
    binary_arch=arm64
  else
    case "$(uname -m)" in
      arm64) asset_arch=aarch64; binary_arch=arm64 ;;
      x86_64) asset_arch=x64; binary_arch=x86_64 ;;
      *) fail "Unsupported macOS processor architecture." ;;
    esac
  fi

  work_dir="$(mktemp -d "${TMPDIR:-/tmp}/ai-helper-install.XXXXXX")"
  mount_point="$work_dir/mounted"
  trap cleanup EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM

  local release_url tag asset_name asset_root expected_hash actual_hash
  release_url="$(download --head --output /dev/null --write-out '%{url_effective}' "$repo_url/releases/latest")" ||
    fail "Could not resolve the latest GitHub release."
  tag="${release_url#"$repo_url/releases/tag/"}"
  [[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "Unrecognized GitHub release URL."
  asset_name="AI-Helper-$tag-macOS-$asset_arch.dmg"
  asset_root="$repo_url/releases/download/$tag"

  printf 'Downloading AI Helper %s (%s)…\n' "$tag" "$asset_arch"
  download --output "$work_dir/SHA256SUMS.txt" "$asset_root/SHA256SUMS.txt" ||
    fail "Could not download release checksums."
  expected_hash="$(awk -v name="$asset_name" '$2 == name || $2 == "*" name { print tolower($1) }' "$work_dir/SHA256SUMS.txt")"
  [[ "$expected_hash" =~ ^[a-f0-9]{64}$ ]] || fail "Expected one valid DMG checksum."
  download --output "$work_dir/$asset_name" "$asset_root/$asset_name" ||
    fail "Could not download the DMG."
  actual_hash="$(shasum -a 256 "$work_dir/$asset_name")"
  [[ "${actual_hash%% *}" == "$expected_hash" ]] || fail "DMG SHA-256 verification failed."

  mkdir "$mount_point"
  hdiutil attach "$work_dir/$asset_name" -readonly -nobrowse -mountpoint "$mount_point" >/dev/null ||
    fail "Could not mount the DMG."
  mounted=true

  local source_app plist binary
  source_app="$mount_point/$app_name"
  plist="$source_app/Contents/Info.plist"
  binary="$source_app/Contents/MacOS/ai-helper"
  [[ -d "$source_app" && ! -L "$source_app" && ! -L "$source_app/Contents" &&
    -f "$plist" && ! -L "$plist" && ! -L "$source_app/Contents/MacOS" &&
    -x "$binary" && ! -L "$binary" ]] ||
    fail "The DMG does not contain the expected application bundle."
  [[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$plist")" == "$bundle_id" &&
    "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$plist")" == "${tag#v}" &&
    "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$plist")" == ai-helper &&
    "$(LC_ALL=C file -b "$binary")" == "Mach-O 64-bit executable $binary_arch" ]] ||
    fail "Application identity, version, or architecture did not match the release."

  mkdir -p -- "$install_dir" || fail "Could not create the installation directory $install_dir."
  install_dir="$(cd -- "$install_dir" && pwd -P)"
  destination="$install_dir/$app_name"
  local staging_dir="$install_dir/.ai-helper-install"
  mkdir "$staging_dir" || fail "Could not reserve $staging_dir. Another installation may be in progress."
  stage="$staging_dir"
  ditto "$source_app" "$stage/$app_name" || fail "Could not copy the application bundle."
  hdiutil detach "$mount_point" >/dev/null || fail "Could not detach the installer disk image."
  mounted=false

  if [[ -e "$destination" || -L "$destination" ]]; then
    [[ -d "$destination" && ! -L "$destination" &&
      "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$destination/Contents/Info.plist" 2>/dev/null)" == "$bundle_id" ]] ||
      fail "A different item already exists at $destination."
    if pgrep -u "$(id -u)" -x ai-helper >/dev/null; then
      fail "Quit AI Helper before running the installer again."
    fi
    mv "$destination" "$stage/previous.app" || fail "Could not stage the previous version."
  fi
  mv "$stage/$app_name" "$destination" || fail "Could not move the application into place."
  installed=true
  printf 'Installed AI Helper %s at %s\n' "$tag" "$destination"
  printf 'To start it, run open %q\n' "$destination"
}

main "$@"
