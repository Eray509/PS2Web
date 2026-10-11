#!/usr/bin/env python3
"""
Gegen das Auf-und-ab-Wackeln bei Interlace-Spielen (z. B. GTA San Andreas).

Zwei Funktionen, beide zur Laufzeit per JavaScript steuerbar (kein neuer Bau nötig):

  Module.setFieldShift(n)   Verschiebt das Bild bei jedem zweiten angezeigten Bild um n Pixel nach oben/unten.
                            Damit lässt sich ein abwechselnder Versatz ausgleichen. 0 = aus.
  Module.logFlips(count)    Schreibt die Anzeigewerte der nächsten <count> Bilder in die Browser-Konsole,
                            damit sich sehen lässt, was sich zwischen den Bildern wirklich ändert.

Aufruf: apply-deinterlace-patch.py <Pfad zu Play->
Bricht mit Fehler ab, wenn eine erwartete Codestelle nicht gefunden wird.
"""
import sys
from pathlib import Path

root = Path(sys.argv[1] if len(sys.argv) > 1 else "Play-")
gl_file = root / "Source/gs/GSH_OpenGL/GSH_OpenGL.cpp"
main_file = root / "Source/ui_js/Main.cpp"


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        sys.exit(f"FEHLER: Stelle '{label}' wurde {count}x gefunden (erwartet: 1). Der Emulator-Code hat sich geändert.")
    return text.replace(old, new)


# --- GSH_OpenGL.cpp -------------------------------------------------------
text = gl_file.read_text()
if "g_playFieldShift" in text:
    print("GSH_OpenGL.cpp bereits gepatcht.")
else:
    start_marker = "void CGSH_OpenGL::FlipImpl(const DISPLAY_INFO& dispInfo)"
    end_marker = "void CGSH_OpenGL::LoadState("
    start = text.find(start_marker)
    end = text.find(end_marker)
    if start < 0 or end < 0 or end < start:
        sys.exit("FEHLER: FlipImpl wurde nicht gefunden.")
    head, body, tail = text[:start], text[start:end], text[end:]

    body = replace_once(
        body,
        "\tauto presentationViewport = GetPresentationViewport();\n",
        "\tauto presentationViewport = GetPresentationViewport();\n"
        "\t{\n"
        "\t\tstatic unsigned int flipCounter = 0;\n"
        "\t\t++flipCounter;\n"
        "\t\tconst int fieldShift = g_playFieldShift.load();\n"
        "\t\tif(fieldShift != 0 && (flipCounter & 1))\n"
        "\t\t{\n"
        "\t\t\tpresentationViewport.offsetY += fieldShift;\n"
        "\t\t}\n"
        "\t\tint remaining = g_playLogFlips.load();\n"
        "\t\tif(remaining > 0)\n"
        "\t\t{\n"
        "\t\t\tg_playLogFlips.store(remaining - 1);\n"
        "\t\t\tconst auto& layer = dispInfo.layers[0];\n"
        "\t\t\tprintf(\"FLIP #%u shift=%d layer: w=%u h=%u buf=0x%x bufw=%u psm=%u | interlaced=%d ffmd=%d field=%d | viewport: x=%d y=%d w=%d h=%d\\r\\n\",\n"
        "\t\t\t       flipCounter, (flipCounter & 1) ? fieldShift : 0,\n"
        "\t\t\t       static_cast<unsigned int>(layer.width), static_cast<unsigned int>(layer.height),\n"
        "\t\t\t       static_cast<unsigned int>(layer.bufPtr), static_cast<unsigned int>(layer.bufWidth),\n"
        "\t\t\t       static_cast<unsigned int>(layer.psm),\n"
        "\t\t\t       GetCrtIsInterlaced() ? 1 : 0, GetCrtIsFrameMode() ? 1 : 0, (m_nCSR & CSR_FIELD) ? 1 : 0,\n"
        "\t\t\t       static_cast<int>(presentationViewport.offsetX), static_cast<int>(presentationViewport.offsetY),\n"
        "\t\t\t       static_cast<int>(presentationViewport.width), static_cast<int>(presentationViewport.height));\n"
        "\t\t}\n"
        "\t}\n",
        "Viewport",
    )

    head = replace_once(
        head,
        '#include "GSH_OpenGL.h"\n',
        '#include "GSH_OpenGL.h"\n#include <atomic>\n\n'
        "//Werden von der Web-Oberfläche gesetzt (siehe Main.cpp).\n"
        "std::atomic<int> g_playFieldShift{0};\n"
        "std::atomic<int> g_playLogFlips{0};\n",
        "Include",
    )
    gl_file.write_text(head + body + tail)
    print("GSH_OpenGL.cpp gepatcht")

# --- Main.cpp (JavaScript-Anbindung) --------------------------------------
text = main_file.read_text()
if "setFieldShift" in text:
    print("Main.cpp bereits gepatcht.")
else:
    text = replace_once(
        text,
        "CPs2VmJs* g_virtualMachine = nullptr;\n",
        "#include <atomic>\nextern std::atomic<int> g_playFieldShift;\nextern std::atomic<int> g_playLogFlips;\n\nCPs2VmJs* g_virtualMachine = nullptr;\n",
        "Main Anfang",
    )
    text = replace_once(
        text,
        "EMSCRIPTEN_BINDINGS(Play)\n{",
        "void setFieldShift(int value)\n{\n\tif(value < -4) value = -4;\n\tif(value > 4) value = 4;\n\tg_playFieldShift.store(value);\n}\n\n"
        "void logFlips(int count)\n{\n\tg_playLogFlips.store(count);\n}\n\n"
        "EMSCRIPTEN_BINDINGS(Play)\n{",
        "Bindings",
    )
    text = replace_once(
        text,
        '\tfunction("clearStats", &clearStats);\n',
        '\tfunction("clearStats", &clearStats);\n\tfunction("setFieldShift", &setFieldShift);\n\tfunction("logFlips", &logFlips);\n',
        "Binding-Eintrag",
    )
    main_file.write_text(text)
    print("Main.cpp gepatcht")
