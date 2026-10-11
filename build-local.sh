#!/usr/bin/env bash
# Lokaler Build (Linux/macOS/WSL). Braucht: git, cmake, ninja, node 20+, python3.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="${1:-$HERE/.build}"
mkdir -p "$WORK" && cd "$WORK"

[ -d emsdk ] || git clone --depth 1 https://github.com/emscripten-core/emsdk.git
./emsdk/emsdk install 4.0.1
./emsdk/emsdk activate 4.0.1
# shellcheck disable=SC1091
source ./emsdk/emsdk_env.sh

[ -d Play- ] || git clone --recurse-submodules https://github.com/jpd002/Play-.git
"$HERE/scripts/apply-perf-tweaks.sh" Play-

( cd Play- && emcmake cmake --preset wasm-ninja && cmake --build --preset wasm-ninja-release --target Play )

OUT="$WORK/Play-/build_cmake/build/wasm-ninja/Source/ui_js/Release"
cd "$HERE"
cp "$OUT/Play.js" src/
cp "$OUT/Play.js" public/
cp "$OUT/Play.wasm" public/
[ -f "$OUT/Play.worker.js" ] && cp "$OUT/Play.worker.js" public/ || true

npm install
echo "Fertig. Zum Testen: npm start  ->  http://localhost:3000 (der Dev-Server setzt COOP/COEP-Header)"
