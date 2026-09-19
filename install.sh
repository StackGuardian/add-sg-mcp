#!/bin/sh
# Installs the add-sg-mcp standalone executable (no Node.js needed) and runs it.
#
#   curl -fsSL https://github.com/StackGuardian/add-sg-mcp/releases/latest/download/install.sh | sh
#   curl -fsSL https://github.com/StackGuardian/add-sg-mcp/releases/latest/download/install.sh | sh -s -- --region eu -a claude-code
#
# ADD_SG_MCP_VERSION       release to install, e.g. v0.2.0 (default: latest)
# ADD_SG_MCP_INSTALL_DIR   install directory (default: ~/.local/bin)
# ADD_SG_MCP_DOWNLOAD_URL  base URL serving the release files, e.g. an internal mirror
# ADD_SG_MCP_NO_RUN=1      install only; do not run add-sg-mcp afterwards
set -eu

RELEASES=https://github.com/StackGuardian/add-sg-mcp/releases

say() { printf 'add-sg-mcp: %s\n' "$*" >&2; }
fail() {
  say "$*"
  exit 1
}

detect_target() {
  case "$(uname -s)" in
    Darwin) os=darwin ;;
    Linux) os=linux ;;
    *) fail "no build for $(uname -s); on Windows use install.ps1, elsewhere run: npx add-sg-mcp" ;;
  esac
  case "$(uname -m)" in
    x86_64 | amd64) arch=x64 ;;
    arm64 | aarch64) arch=arm64 ;;
    *) fail "no build for $(uname -m) CPUs; run: npx add-sg-mcp" ;;
  esac
  # A shell running under Rosetta reports x86_64 on Apple Silicon; install the native build.
  if [ "$os" = darwin ] && [ "$arch" = x64 ] && [ "$(sysctl -n sysctl.proc_translated 2>/dev/null)" = 1 ]; then
    arch=arm64
  fi
  # The Linux builds need glibc's loader, which musl systems such as Alpine lack.
  if [ "$os" = linux ]; then
    loader=/lib64/ld-linux-x86-64.so.2
    if [ "$arch" = arm64 ]; then loader=/lib/ld-linux-aarch64.so.1; fi
    [ -e "$loader" ] || fail "this Linux has no glibc ($loader is missing); run: npx add-sg-mcp"
  fi
  TARGET="$os-$arch"
}

download() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL --retry 3 -o "$2" "$1"
  elif command -v wget >/dev/null 2>&1; then
    wget -q -O "$2" "$1"
  else
    fail "curl or wget is required"
  fi || fail "could not download $1"
}

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1"
  else
    shasum -a 256 "$1"
  fi | cut -d ' ' -f 1
}

main() {
  detect_target
  archive="add-sg-mcp-$TARGET.tar.gz"
  if [ -n "${ADD_SG_MCP_DOWNLOAD_URL:-}" ]; then
    base=${ADD_SG_MCP_DOWNLOAD_URL%/}
  elif [ -n "${ADD_SG_MCP_VERSION:-}" ]; then
    base="$RELEASES/download/v${ADD_SG_MCP_VERSION#v}"
  else
    base="$RELEASES/latest/download"
  fi
  dir=${ADD_SG_MCP_INSTALL_DIR:-$HOME/.local/bin}
  command -v sha256sum >/dev/null 2>&1 || command -v shasum >/dev/null 2>&1 ||
    fail "sha256sum or shasum is required to verify the download"

  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' EXIT
  say "downloading $archive"
  download "$base/$archive" "$tmp/$archive"
  download "$base/SHA256SUMS" "$tmp/SHA256SUMS"
  expected=$(awk -v f="$archive" '$2 == f { print $1 }' "$tmp/SHA256SUMS")
  [ -n "$expected" ] || fail "$archive is not listed in SHA256SUMS"
  [ "$(sha256 "$tmp/$archive")" = "$expected" ] ||
    fail "checksum mismatch for $archive; nothing was installed"

  tar -xzf "$tmp/$archive" -C "$tmp" add-sg-mcp
  mkdir -p "$dir"
  # Move into place so a copy that is running is replaced, not overwritten.
  cp "$tmp/add-sg-mcp" "$dir/.add-sg-mcp.new"
  chmod 755 "$dir/.add-sg-mcp.new"
  mv -f "$dir/.add-sg-mcp.new" "$dir/add-sg-mcp"
  say "installed $dir/add-sg-mcp"
  case ":$PATH:" in
    *":$dir:"*) ;;
    *) say "$dir is not on your PATH; add it with: export PATH=\"$dir:\$PATH\"" ;;
  esac

  if [ "${ADD_SG_MCP_NO_RUN:-}" = 1 ]; then return 0; fi
  # Under `curl | sh` stdin is this script; give add-sg-mcp the terminal for its prompts.
  if [ ! -t 0 ] && (: </dev/tty) 2>/dev/null; then
    "$dir/add-sg-mcp" "$@" </dev/tty
  else
    "$dir/add-sg-mcp" "$@"
  fi
}

# Nothing runs until the whole script has been read, so a cut-off download is harmless.
main "$@"
