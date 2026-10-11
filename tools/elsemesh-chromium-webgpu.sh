#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: tools/elsemesh-chromium-webgpu.sh [--enable-tab-audio-muting] [URL]

Open an ElseMesh URL in a dedicated Chromium window with WebGPU enabled and
full-resolution graphics. The normal tab strip stays visible so you can mute
the game's tab by clicking its speaker icon. Tab audio muting is enabled by
default; the option is accepted for clarity. The default URL is
https://elsemesh.org/?quality=1.

Set CHROMIUM to choose the Chromium executable and
ELSEMESH_CHROMIUM_PROFILE to choose its isolated profile directory.
EOF
}

url=https://elsemesh.org/?quality=1
url_supplied=false
for arg in "$@"; do
  case "$arg" in
    -h|--help)
      usage
      exit 0
      ;;
    --enable-tab-audio-muting)
      ;;
    -* )
      echo "Unknown option: $arg" >&2
      usage >&2
      exit 2
      ;;
    *)
      if [[ $url_supplied == true ]]; then
        echo "Only one URL may be specified." >&2
        usage >&2
        exit 2
      fi
      url=$arg
      url_supplied=true
      ;;
  esac
done
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
  --enable-tab-audio-muting \
  --use-vulkan \
  --new-window "$url"
