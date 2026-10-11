# PS2 Web

Neues Frontend für den Emulator **Play!** (jpd002/Play-, BSD-2-Clause) mit überarbeitetem Design und weniger Rucklern beim Laden der Disc. Der Emulator selbst (CPU/GPU-Emulation) bleibt Play!.

## Was ist neu
- Neues Design: Startseite, Drag & Drop für das ganze Fenster, Vollbild, FPS-Anzeige mit Farbe.
- **Lese-Cache für die ISO** (`src/DiscImageDevice.ts`): Der Emulator wartete bei jedem Lesezugriff auf den Browser. Jetzt liegen 1-MiB-Blöcke im Speicher und die nächsten Blöcke werden vorausgeladen. Das verringert Ruckler beim Nachladen von Level- und Videodaten.
- **Gamepad-Unterstützung** (`src/gamepad.ts`): Xbox-/PlayStation-Controller werden in die Tasten des Emulators übersetzt.
- **Ton wird freigeschaltet** (`src/audioUnlock.ts`): Browser starten Audio stumm bis zur ersten Eingabe.
- Einstellungen: Bildformat 4:3 oder 16:9, Glätten an/aus, FPS an/aus.
- Optional beim Build: grösserer Start-Speicher (`scripts/apply-perf-tweaks.sh`) gegen Ruckler durch Speicherwachstum.

## Ehrlich zur Geschwindigkeit
Wie schnell ein Spiel läuft, hängt fast ganz von der Emulation im WebAssembly-Modul ab. Das Frontend kann nur die Ruckler rund um Datenzugriff, Ton und Eingabe verbessern, es macht den Emulator nicht grundsätzlich schneller. Spiele, die in Play! langsam sind, bleiben langsam.

## Veröffentlichen (GitHub Pages)
1. Neues, leeres GitHub-Repo anlegen und den Inhalt dieses Ordners hineinkopieren (inkl. `.github`).
2. Settings -> Pages -> Source: **GitHub Actions**.
3. Actions -> „PS2 Web veröffentlichen“ -> Run workflow (ca. 20-40 Minuten).
4. Die Seite liegt dann unter `https://<name>.github.io/<repo>/`.

## Lokal bauen
`./build-local.sh` (Linux/macOS/WSL), danach `npm start`.

## Eigenes Hosting
`build/` ist statisch. Auf eigenem Server müssen diese Header gesetzt sein:
```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Hinweis: Dieses Projekt wurde ohne Zugriff auf npm und den Emscripten-Compiler geschrieben und daher noch nicht gebaut oder getestet. Falls der erste Build einen Fehler meldet, schick mir die Meldung.
