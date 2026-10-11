#!/usr/bin/env python3
"""
Dauerhaftes Speichern: Bindet IDBFS (Browser-Datenbank) in den Emscripten-Build ein, damit die Web-Oberfläche
das Verzeichnis mit den Memory Cards darin ablegen kann.

Aufruf: apply-persistence-patch.py <Pfad zu Play->
"""
import sys
from pathlib import Path

root = Path(sys.argv[1] if len(sys.argv) > 1 else "Play-")
cmake = root / "Source/ui_js/CMakeLists.txt"
text = cmake.read_text()

if "lidbfs.js" in text:
    print("Persistenz-Patch bereits angewendet.")
    sys.exit(0)

anchor = 'target_link_options(Play PRIVATE "-sFORCE_FILESYSTEM")\n'
if text.count(anchor) != 1:
    sys.exit(f"FEHLER: Anker wurde {text.count(anchor)}x gefunden (erwartet: 1). Der Emulator-Code hat sich geändert.")

cmake.write_text(text.replace(anchor, anchor + 'target_link_options(Play PRIVATE "-lidbfs.js")\n'))
print("CMakeLists.txt gepatcht (IDBFS)")
