#!/usr/bin/env bash
# Optionale Link-Optionen für den Emulator-Build (Ordner Play-/ muss existieren).
# Der Emulator läuft mit Threads (SharedArrayBuffer). Wächst der Speicher zur Laufzeit, müssen alle
# Threads ihre Sicht auf den Speicher neu aufbauen, das verursacht Ruckler. Mit einem grösseren
# Start-Speicher passiert das praktisch nie. Wachstum bleibt trotzdem erlaubt.
set -euo pipefail
FILE="${1:-Play-}/Source/ui_js/CMakeLists.txt"
if grep -q "INITIAL_MEMORY" "$FILE"; then
  echo "bereits angewendet"; exit 0
fi
sed -i 's|^target_link_options(Play PRIVATE "-sALLOW_MEMORY_GROWTH")|&\ntarget_link_options(Play PRIVATE "-sINITIAL_MEMORY=536870912")|' "$FILE"
grep -n "INITIAL_MEMORY" "$FILE"
