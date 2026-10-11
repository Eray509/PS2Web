#!/usr/bin/env python3
"""
Glättet das Zittern bei Interlace-Ausgabe (z. B. GTA San Andreas).

Viele PS2-Spiele rendern im Halbbild-Modus: jedes Bild ist um eine halbe Zeile versetzt. Auf einem Fernseher
verschmelzen die Halbbilder, der Emulator zeigt jedes einzeln an, das Bild springt dann 60-mal pro Sekunde
auf und ab. Dieser Patch mischt bei Interlace-Ausgabe das neue Bild mit dem zuletzt angezeigten.
Die Stärke (0 = aus) lässt sich zur Laufzeit per JavaScript ändern: Module.setDeinterlace(0.0 .. 0.8).

Aufruf: apply-deinterlace-patch.py <Pfad zu Play->
Bricht mit Fehler ab, wenn eine erwartete Codestelle nicht gefunden wird, damit nichts still schiefgeht.
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
if "g_playDeinterlaceAlpha" in text:
    print("Deinterlace-Patch bereits angewendet.")
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
        "\tFlushVertexBuffer();\n\tm_renderState.isValid = false;\n\tm_validGlState = 0;\n\n\tconst auto& dispLayer = dispInfo.layers[0];\n",
        "\tFlushVertexBuffer();\n\tm_renderState.isValid = false;\n\tm_validGlState = 0;\n\n"
        "\tconst float deinterlaceAlpha = g_playDeinterlaceAlpha.load();\n"
        "\tconst bool blendFrames = (deinterlaceAlpha > 0.0f) && GetCrtIsInterlaced();\n\n"
        "\tconst auto& dispLayer = dispInfo.layers[0];\n",
        "FlipImpl Anfang",
    )
    body = replace_once(
        body,
        "\t\tglViewport(0, 0, m_presentationParams.windowWidth, m_presentationParams.windowHeight);\n\t\tglClear(GL_COLOR_BUFFER_BIT);\n",
        "\t\tglViewport(0, 0, m_presentationParams.windowWidth, m_presentationParams.windowHeight);\n"
        "\t\tif(!blendFrames)\n\t\t{\n\t\t\tglClear(GL_COLOR_BUFFER_BIT);\n\t\t}\n",
        "Clear",
    )
    body = replace_once(
        body,
        "\t\tglDisable(GL_BLEND);\n\t\tglDisable(GL_DEPTH_TEST);\n\n\t\tglActiveTexture(GL_TEXTURE1);\n",
        "\t\tif(blendFrames)\n\t\t{\n\t\t\tglEnable(GL_BLEND);\n"
        "\t\t\tglBlendColor(0.0f, 0.0f, 0.0f, deinterlaceAlpha);\n"
        "\t\t\tglBlendFuncSeparate(GL_CONSTANT_ALPHA, GL_ONE_MINUS_CONSTANT_ALPHA, GL_ONE, GL_ZERO);\n"
        "\t\t\tglBlendEquation(GL_FUNC_ADD);\n\t\t}\n"
        "\t\telse\n\t\t{\n\t\t\tglDisable(GL_BLEND);\n\t\t}\n"
        "\t\tglDisable(GL_DEPTH_TEST);\n\n\t\tglActiveTexture(GL_TEXTURE1);\n",
        "Blend-Zustand",
    )
    body = replace_once(
        body,
        "\t\tglDrawArrays(GL_TRIANGLES, 0, 3);\n\t}\n",
        "\t\tglDrawArrays(GL_TRIANGLES, 0, 3);\n\n\t\tif(blendFrames)\n\t\t{\n\t\t\tglDisable(GL_BLEND);\n\t\t}\n\t}\n",
        "Draw",
    )

    head = replace_once(
        head,
        '#include "GSH_OpenGL.h"\n',
        '#include "GSH_OpenGL.h"\n#include <atomic>\n\n'
        "//Stärke der Halbbild-Glättung (0 = aus). Wird von der Web-Oberfläche gesetzt.\n"
        "std::atomic<float> g_playDeinterlaceAlpha{0.35f};\n",
        "Include",
    )
    gl_file.write_text(head + body + tail)
    print("GSH_OpenGL.cpp gepatcht")

# --- Main.cpp (JavaScript-Anbindung) --------------------------------------
text = main_file.read_text()
if "setDeinterlace" in text:
    print("Main.cpp bereits gepatcht.")
else:
    text = replace_once(
        text,
        "CPs2VmJs* g_virtualMachine = nullptr;\n",
        "#include <atomic>\nextern std::atomic<float> g_playDeinterlaceAlpha;\n\nCPs2VmJs* g_virtualMachine = nullptr;\n",
        "Main Anfang",
    )
    text = replace_once(
        text,
        "EMSCRIPTEN_BINDINGS(Play)\n{",
        "void setDeinterlace(float value)\n{\n\tif(value < 0.0f) value = 0.0f;\n\tif(value > 0.8f) value = 0.8f;\n\tg_playDeinterlaceAlpha.store(value);\n}\n\n"
        "EMSCRIPTEN_BINDINGS(Play)\n{",
        "Bindings",
    )
    text = replace_once(
        text,
        '\tfunction("clearStats", &clearStats);\n',
        '\tfunction("clearStats", &clearStats);\n\tfunction("setDeinterlace", &setDeinterlace);\n',
        "Binding-Eintrag",
    )
    main_file.write_text(text)
    print("Main.cpp gepatcht")
