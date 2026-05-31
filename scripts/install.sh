#!/usr/bin/env bash
set -euo pipefail

REPO="xreal/drop2"
INSTALL_DIR="${DROP2_INSTALL_DIR:-$HOME/.local/bin}"
VERSION="${DROP2_VERSION:-latest}"
TMPDIR=""

cleanup() {
  if [ -n "${TMPDIR:-}" ] && [ -d "$TMPDIR" ]; then
    rm -rf "$TMPDIR"
  fi
}

trap cleanup EXIT

require() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf "error: required command not found: %s\n" "$1" >&2
    exit 1
  fi
}

detect_target() {
  local os arch
  os="$(uname -s)"
  arch="$(uname -m)"

  case "$os" in
    Darwin)
      case "$arch" in
        arm64|aarch64)
          printf "aarch64-apple-darwin"
          ;;
        x86_64)
          printf "x86_64-apple-darwin"
          ;;
        *)
          printf "error: unsupported macOS architecture: %s\n" "$arch" >&2
          exit 1
          ;;
      esac
      ;;
    Linux)
      case "$arch" in
        x86_64)
          printf "x86_64-unknown-linux-gnu"
          ;;
        *)
          printf "error: unsupported Linux architecture: %s\n" "$arch" >&2
          exit 1
          ;;
      esac
      ;;
    *)
      printf "error: unsupported OS: %s\n" "$os" >&2
      exit 1
      ;;
  esac
}

download_url() {
  local target asset
  target="$1"
  asset="drop2-$target"

  if [ "$VERSION" = "latest" ]; then
    printf "https://github.com/%s/releases/latest/download/%s" "$REPO" "$asset"
  else
    printf "https://github.com/%s/releases/download/%s/%s" "$REPO" "$VERSION" "$asset"
  fi
}

main() {
  require curl
  require install
  require mktemp
  require uname

  local target url
  target="$(detect_target)"
  url="$(download_url "$target")"
  TMPDIR="$(mktemp -d)"

  printf "Installing drop2 for %s\n" "$target"
  curl -fL --retry 3 --retry-delay 1 "$url" -o "$TMPDIR/drop2"

  mkdir -p "$INSTALL_DIR"
  install -m 0755 "$TMPDIR/drop2" "$INSTALL_DIR/drop2"

  printf "Installed: %s\n" "$INSTALL_DIR/drop2"
  if [[ ":$PATH:" != *":$INSTALL_DIR:"* ]]; then
    printf "Add to PATH: export PATH=\"%s:\$PATH\"\n" "$INSTALL_DIR"
  fi

  "$INSTALL_DIR/drop2" --version
}

main "$@"
