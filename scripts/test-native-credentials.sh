#!/usr/bin/env bash
set -euo pipefail

# This script deliberately changes an OS service configuration. Run it only in
# a disposable Actions runner, using a private bus or a temporary keychain.
if [[ "${GITHUB_ACTIONS:-}" != true || -z "${RUNNER_TEMP:-}" || "${AI_HELPER_NATIVE_CREDENTIAL_TESTS:-}" != 1 ]]; then
  echo 'Native service checks require a disposable Actions runner and explicit opt-in.' >&2
  exit 1
fi

case "${RUNNER_OS:-}" in
  Linux)
    native_root="$(mktemp -d "$RUNNER_TEMP/ai-helper-keyring.XXXXXX")"
    export XDG_DATA_HOME="$native_root/data"
    export XDG_CONFIG_HOME="$native_root/config"
    export XDG_RUNTIME_DIR="$native_root/runtime"
    mkdir -p "$XDG_DATA_HOME" "$XDG_CONFIG_HOME" "$XDG_RUNTIME_DIR"
    chmod 700 "$native_root" "$XDG_DATA_HOME" "$XDG_CONFIG_HOME" "$XDG_RUNTIME_DIR"
    # D-Bus and keyring daemon die with this private session. The job's data
    # stays in its temporary runner directory, without changing HOME.
    dbus-run-session -- bash -euo pipefail -c '
      printf "%s" "ai-helper-ci-only" | gnome-keyring-daemon \
        --components=secrets --daemonize --unlock \
        --control-directory="$XDG_RUNTIME_DIR/keyring"
      cargo test --manifest-path src-tauri/Cargo.toml --locked --lib \
        native_secret_service -- --ignored --nocapture --test-threads=1
    '
    ;;
  macOS)
    native_keychain="$RUNNER_TEMP/ai-helper-$(uuidgen).keychain-db"
    cleanup_keychain() { security delete-keychain "$native_keychain"; }
    security create-keychain -p 'ai-helper-ci-only' "$native_keychain"
    trap cleanup_keychain EXIT
    security set-keychain-settings -lut 21600 "$native_keychain"
    security unlock-keychain -p 'ai-helper-ci-only' "$native_keychain"
    security default-keychain -d user -s "$native_keychain"
    security list-keychains -d user -s "$native_keychain"
    cargo test --manifest-path src-tauri/Cargo.toml --locked --lib \
      native_keychain -- --ignored --nocapture --test-threads=1
    ;;
  *)
    echo 'This script supports only Linux and macOS disposable runners.' >&2
    exit 1
    ;;
esac
