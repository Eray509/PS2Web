#!/usr/bin/env python3
"""
Gegen Ruckeln und Aussetzer beim Ton.

Der Emulator liefert den Ton in Stücken von ca. 100 ms und startet die Wiedergabe mit dem ersten Stück.
Verspätet sich das nächste Stück nur kurz (z. B. weil der Browser gerade beschäftigt ist), läuft der Puffer leer,
die Wiedergabe stoppt und startet neu. Das klingt wie Knacken, Stottern oder ein "komischer" Ton.

Dieser Patch startet die Wiedergabe erst, wenn mehrere Stücke im Voraus bereitliegen. Die Anzahl lässt sich zur
Laufzeit ändern: Module.setAudioPrebuffer(n), n = 1..8 (1 = wie vorher, jedes Stück entspricht ca. 100 ms Verzögerung).

Aufruf: apply-audio-patch.py <Pfad zu Play->
"""
import sys
from pathlib import Path

root = Path(sys.argv[1] if len(sys.argv) > 1 else "Play-")
al_file = root / "Source/sound/SH_OpenAL/SH_OpenAL.cpp"
main_file = root / "Source/ui_js/Main.cpp"


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        sys.exit(f"FEHLER: Stelle '{label}' wurde {count}x gefunden (erwartet: 1). Der Emulator-Code hat sich geändert.")
    return text.replace(old, new)


# --- SH_OpenAL.cpp --------------------------------------------------------
text = al_file.read_text()
if "g_playAudioPrebuffer" in text:
    print("SH_OpenAL.cpp bereits gepatcht.")
else:
    text = replace_once(
        text,
        '#include "SH_OpenAL.h"\n',
        '#include "SH_OpenAL.h"\n#include <atomic>\n\n'
        "//Anzahl Tonstücke, die vor dem (Neu-)Start der Wiedergabe bereitliegen müssen. Wird von der Web-Oberfläche gesetzt.\n"
        "std::atomic<int> g_playAudioPrebuffer{3};\n",
        "Include",
    )
    text = replace_once(
        text,
        "\tALint sourceState = m_source.GetState();\n\tif(sourceState != AL_PLAYING)\n\t{\n\t\tm_source.Play();\n\t\tassert(m_source.GetState() == AL_PLAYING);\n\t}\n",
        "\tALint sourceState = m_source.GetState();\n\tif(sourceState != AL_PLAYING)\n\t{\n"
        "\t\t//Erst abspielen, wenn genug Stücke bereitliegen, damit kurze Verzögerungen keinen Aussetzer verursachen.\n"
        "\t\tALint queued = 0;\n\t\tALint processed = 0;\n"
        "\t\talGetSourcei(m_source, AL_BUFFERS_QUEUED, &queued);\n"
        "\t\talGetSourcei(m_source, AL_BUFFERS_PROCESSED, &processed);\n"
        "\t\tconst int needed = g_playAudioPrebuffer.load();\n"
        "\t\tif((queued - processed) >= needed)\n\t\t{\n"
        "\t\t\tm_source.Play();\n"
        "\t\t\tassert(m_source.GetState() == AL_PLAYING);\n\t\t}\n\t}\n",
        "Play",
    )
    al_file.write_text(text)
    print("SH_OpenAL.cpp gepatcht")

# --- Main.cpp (JavaScript-Anbindung) --------------------------------------
text = main_file.read_text()
if "setAudioPrebuffer" in text:
    print("Main.cpp bereits gepatcht.")
else:
    text = replace_once(
        text,
        "CPs2VmJs* g_virtualMachine = nullptr;\n",
        "#include <atomic>\nextern std::atomic<int> g_playAudioPrebuffer;\n\nCPs2VmJs* g_virtualMachine = nullptr;\n",
        "Main Anfang",
    )
    text = replace_once(
        text,
        "EMSCRIPTEN_BINDINGS(Play)\n{",
        "void setAudioPrebuffer(int value)\n{\n\tif(value < 1) value = 1;\n\tif(value > 8) value = 8;\n\tg_playAudioPrebuffer.store(value);\n}\n\n"
        "EMSCRIPTEN_BINDINGS(Play)\n{",
        "Bindings",
    )
    text = replace_once(
        text,
        '\tfunction("clearStats", &clearStats);\n',
        '\tfunction("clearStats", &clearStats);\n\tfunction("setAudioPrebuffer", &setAudioPrebuffer);\n',
        "Binding-Eintrag",
    )
    main_file.write_text(text)
    print("Main.cpp gepatcht")
