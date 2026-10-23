#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
SOURCE_ROOT=${THRUHOLDD_SOURCE_ROOT:-$ROOT}
SERVER=${THRUHOLDD_BUILD_SERVER:-}
TARGET=thruholdd
TARGET_OS=${GOOS:-$(go env GOOS)}
TARGET_ARCH=${GOARCH:-$(go env GOARCH)}
OUT=${THRUHOLDD_OUT:-}
LIBZT_SOURCE_ROOT=${LIBZT_SOURCE_ROOT:-}
LIBZT_BUILD_ROOT=${LIBZT_BUILD_ROOT:-}
LIBZT_INCLUDE_DIR=${LIBZT_INCLUDE_DIR:-}
LIBZT_LIB_DIR=${LIBZT_LIB_DIR:-}
BUILD_REVISION=${BUILD_REVISION:-}
LIBZT_CXX_LIB=${LIBZT_CXX_LIB:-}

usage() {
	cat <<'EOF'
Usage: tools/build-server.sh [options]

Default: build ZeroTier-enabled thruholdd for the current GOOS/GOARCH.

Options:
  --target NAME          thruholdd, worldd, directoryd, accountd, or all
  --os GOOS              target OS (default: GOOS or go env GOOS)
  --arch GOARCH          target architecture (default: GOARCH or go env GOARCH)
  --output DIR           binary output directory (default: <build-server>/bin)
  --build-server DIR     Go server source/build directory (default: <source-root>/server)
  --source-root DIR      source checkout used for revision metadata and defaults
  --libzt-source DIR     libzt source checkout (default: sibling libzt directory)
  --libzt-build DIR      libzt build root (default: sibling libzt.build directory)
  --libzt-include DIR    directory containing ZeroTierSockets.h
  --libzt-lib DIR        directory containing libzt.so
  --help                 show this help

The default world-daemon build is thruholdd, which embeds libzt and enables
ZeroTier. Use target worldd for a CGO-free daemon that relies on the host's
system-managed ZeroTier interface. Target all builds thruholdd, directoryd,
and accountd; it does not build both world-daemon variants.
With cpto installed, a real adjacent build sibling is used when present; a
sibling that resolves to the source tree is ignored. Otherwise the source tree
is used. The helper never synchronizes source and build trees.
EOF
}

build_plain() {
	local program=$1 os=$2 arch=$3 ldflags="-s -w -X main.buildRevision=$BUILD_REVISION"
	if [[ "$os" == android ]]; then ldflags+=' -checklinkname=0'; fi
	printf 'Building %s for %s/%s\n' "$program" "$os" "$arch"
	(
		cd "$SERVER"
		GOOS="$os" GOARCH="$arch" CGO_ENABLED=0 \
			go build -buildvcs=false -trimpath -ldflags="$ldflags" \
			-o "$OUT/$program-$os-$arch" "./$program"
	)
}

build_thruholdd() {
	local os=$1 arch=$2 libzt_cxx_lib=$LIBZT_CXX_LIB default_libzt_lib libzt_lib ldflags
	case "$os/$arch" in
		linux/amd64) default_libzt_lib="$LIBZT_BUILD_ROOT/linux-amd64/lib" ;;
		linux/arm64) default_libzt_lib="$LIBZT_BUILD_ROOT/linux-arm64/lib" ;;
		android/arm64) default_libzt_lib="$LIBZT_BUILD_ROOT/android-arm64/lib" ;;
		*) printf 'No default libzt library path for %s/%s; set --libzt-lib DIR.\n' "$os" "$arch" >&2; return 2 ;;
	esac
	libzt_lib=${LIBZT_LIB_DIR:-$default_libzt_lib}
	if [[ ! -f "$LIBZT_INCLUDE_DIR/ZeroTierSockets.h" || ! -f "$libzt_lib/libzt.so" ]]; then
		printf 'ZeroTier build needs ZeroTierSockets.h and libzt.so; checked %s and %s.\n' "$LIBZT_INCLUDE_DIR" "$libzt_lib" >&2
		return 2
	fi
	if [[ -z "$libzt_cxx_lib" && "$os" != android ]]; then libzt_cxx_lib=-lstdc++; fi
	ldflags="-s -w -X main.buildRevision=$BUILD_REVISION -extldflags=-Wl,-rpath,\$ORIGIN"
	if [[ "$os" == android ]]; then ldflags+=' -checklinkname=0'; fi
	printf 'Building thruholdd for %s/%s with ZeroTier\n' "$os" "$arch"
	(
		cd "$SERVER"
		CGO_ENABLED=1 GOOS="$os" GOARCH="$arch" \
			CGO_CFLAGS="-I$LIBZT_INCLUDE_DIR ${CGO_CFLAGS:-}" \
			CGO_LDFLAGS="-L$libzt_lib -lzt $libzt_cxx_lib -Wl,-rpath,\$ORIGIN ${CGO_LDFLAGS:-}" \
			go build -buildvcs=false -trimpath -tags zerotier \
			-ldflags="$ldflags" -o "$OUT/thruholdd" ./worldd
	)
	cp -p "$libzt_lib/libzt.so" "$OUT/libzt.so"
	printf 'Built %s/thruholdd with bundled libzt.so.\n' "$OUT"
}

while (($#)); do
	case "$1" in
		--target|--os|--arch|--output|--build-server|--source-root|--libzt-source|--libzt-build|--libzt-include|--libzt-lib)
			if (($# < 2)) || [[ -z "$2" || "$2" == --* ]]; then
				printf 'Missing value for %s\n' "$1" >&2
				exit 2
			fi
			option=$1 value=$2
			shift 2
			case "$option" in
				--target) TARGET=$value ;;
				--os) TARGET_OS=$value ;;
				--arch) TARGET_ARCH=$value ;;
				--output) OUT=$value ;;
				--build-server) SERVER=$value ;;
				--source-root) SOURCE_ROOT=$value ;;
				--libzt-source) LIBZT_SOURCE_ROOT=$value; LIBZT_INCLUDE_DIR="$value/include" ;;
				--libzt-build) LIBZT_BUILD_ROOT=$value ;;
				--libzt-include) LIBZT_INCLUDE_DIR=$value ;;
				--libzt-lib) LIBZT_LIB_DIR=$value ;;
			esac
			;;
		--help|-h) usage; exit 0 ;;
		*) printf 'Unknown option or target: %s\n' "$1" >&2; usage >&2; exit 2 ;;
	esac
done

SOURCE_ROOT=$(cd "$SOURCE_ROOT" && pwd -P)
if [[ -z "$SERVER" ]]; then
	SERVER="$SOURCE_ROOT/server"
	if command -v cpto >/dev/null 2>&1; then
		BUILD_SIBLING="${SOURCE_ROOT}.build"
		case "$SOURCE_ROOT" in
			/mnt/kingston/@home/*)
				relative=${SOURCE_ROOT#/mnt/kingston/@home/}
				parent=${relative%/*}
				name=${relative##*/}
				BUILD_SIBLING="/mnt/kingston/builds/$parent/$name.build"
				;;
		esac
		if [[ -d "$BUILD_SIBLING" ]] && [[ "$(realpath -m "$BUILD_SIBLING")" != "$SOURCE_ROOT" ]]; then
			BUILD_ROOT_CANDIDATES=( "$BUILD_SIBLING" "$BUILD_SIBLING/independent" )
			FOUND_BUILD_SERVER=
			for build_root in "${BUILD_ROOT_CANDIDATES[@]}"; do
				for build_server in "$build_root/server" "$build_root"; do
					if [[ -f "$build_server/go.mod" && -d "$build_server/worldd" ]]; then
						FOUND_BUILD_SERVER=$build_server
						break 2
					fi
				done
			done
			if [[ -z "$FOUND_BUILD_SERVER" ]]; then
				printf 'Build sibling exists but has no server Go module: %s\n' "$BUILD_SIBLING" >&2
				exit 2
			fi
			SERVER=$FOUND_BUILD_SERVER
		fi
	fi
fi
SERVER=$(cd "$SERVER" && pwd -P)
OUT=${OUT:-"$SERVER/bin"}
LIBZT_SOURCE_ROOT=${LIBZT_SOURCE_ROOT:-"$(dirname "$SOURCE_ROOT")/libzt"}
LIBZT_BUILD_ROOT=${LIBZT_BUILD_ROOT:-"$(dirname "$SOURCE_ROOT")/libzt.build"}
LIBZT_INCLUDE_DIR=${LIBZT_INCLUDE_DIR:-"$LIBZT_SOURCE_ROOT/include"}
BUILD_REVISION=${BUILD_REVISION:-$(git -C "$SOURCE_ROOT" rev-parse --verify HEAD)}
mkdir -p "$OUT"
OUT=$(cd "$OUT" && pwd -P)

case "$TARGET" in
	thruholdd|worldd|directoryd|accountd) TARGETS=("$TARGET") ;;
	all) TARGETS=(thruholdd directoryd accountd) ;;
	*) printf 'Invalid --target: %s\n' "$TARGET" >&2; usage >&2; exit 2 ;;
esac

for program in "${TARGETS[@]}"; do
	if [[ "$program" == thruholdd ]]; then
		build_thruholdd "$TARGET_OS" "$TARGET_ARCH"
	else
		build_plain "$program" "$TARGET_OS" "$TARGET_ARCH"
	fi
done
