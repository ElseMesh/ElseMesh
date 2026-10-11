#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: tools/elsemesh-chromium-webgpu.sh [URL]

Open an ElseMesh URL in a dedicated Chromium window with WebGPU enabled and
full-resolution graphics. The normal tab strip stays visible so you can mute
the game's tab from its speaker icon or tab context menu. The default URL is
https://elsemesh.org/?quality=1.

Set CHROMIUM to choose the Chromium executable and
ELSEMESH_CHROMIUM_PROFILE to choose its isolated profile directory.
EOF
}

if [[ ${1:-} == -h || ${1:-} == --help ]]; then
  usage
  exit 0
fi

url=${1:-https://elsemesh.org/?quality=1}
chromium=${CHROMIUM:-}
if [[ -z $chromium ]]; then
  for candidate in chromium chromium-browser google-chrome; do
    if command -v "$candidate" >/dev/null 2>&1; then
      chromium=$(command -v "$candidate")
      break
    fi
  done
fi

if [[ -z $chromium ]]; then
  echo "Chromium was not found. Set CHROMIUM to its executable path." >&2
  exit 1
fi

profile=${ELSEMESH_CHROMIUM_PROFILE:-${XDG_DATA_HOME:-$HOME/.local/share}/elsemesh/chromium-webgpu}
mkdir -p "$profile"

exec "$chromium" \
  --user-data-dir="$profile" \
  --no-first-run \
  --no-default-browser-check \
  --disable-sync \
  --disable-extensions \
  --enable-unsafe-webgpu \
  --enable-features=Vulkan \
  --use-vulkan \
  --new-window "$url"
