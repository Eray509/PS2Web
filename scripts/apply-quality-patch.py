#!/usr/bin/env python3
"""
Bildqualität und Emulations-Last für den Web-Build.

  Module.setRenderScale(n)   Grafik-Auflösung als Vielfaches von 640x480 (1 oder 2). Muss VOR initVm gesetzt werden,
                             die Canvas-Größe wird von der Web-Oberfläche passend gesetzt.
  Module.setBilinear(an)     Erzwingt weiche (bilineare) Texturen. Wirkt sofort.
  Module.setEeScale(prozent) Taktrate der emulierten Haupt-CPU (EE) in Prozent, 25..150. Weniger Takt = weniger
                             Rechenaufwand pro Bild. Das Spiel selbst kann dadurch intern mit weniger Bildern laufen.

Aufruf: apply-quality-patch.py <Pfad zu Play->
Bricht mit Fehler ab, wenn eine erwartete Codestelle nicht gefunden wird, damit nichts still schiefgeht.
Läuft nach apply-vmcontrol-patch.py (ergänzt dessen Dateien).
"""
import sys
from pathlib import Path

root = Path(sys.argv[1] if len(sys.argv) > 1 else "Play-")
js_h = root / "Source/ui_js/Ps2VmJs.h"
js_cpp = root / "Source/ui_js/Ps2VmJs.cpp"
gs_js_cpp = root / "Source/ui_js/GSH_OpenGLJs.cpp"
main_cpp = root / "Source/ui_js/Main.cpp"


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        sys.exit(f"FEHLER: Stelle '{label}' wurde {count}x gefunden (erwartet: 1). Der Emulator-Code hat sich geändert.")
    return text.replace(old, new)


# --- Ps2VmJs.h --------------------------------------------------------------
text = js_h.read_text()
if "SetEeScalePercent" in text:
    print("Ps2VmJs.h bereits gepatcht.")
else:
    text = replace_once(
        text,
        "\tvoid BootDiscImage(std::string);\n",
        "\tvoid BootDiscImage(std::string);\n\n"
        "\tvoid SetBilinear(bool);\n"
        "\tvoid SetEeScalePercent(int);\n",
        "Ps2VmJs.h Klasse",
    )
    js_h.write_text(text)
    print("Ps2VmJs.h gepatcht")

# --- Ps2VmJs.cpp ------------------------------------------------------------
text = js_cpp.read_text()
if "CPs2VmJs::SetEeScalePercent" in text:
    print("Ps2VmJs.cpp bereits gepatcht.")
else:
    text = replace_once(
        text,
        '#include "Ps2VmJs.h"\n',
        '#include "Ps2VmJs.h"\n#include <atomic>\n\n'
        "std::atomic<int> g_playRenderScale{1};\n"
        "std::atomic<bool> g_playBilinear{false};\n",
        "Ps2VmJs Include",
    )
    text = text.rstrip("\n") + """

//Entspricht PREF_CGSH_OPENGL_FORCEBILINEARTEXTURES in gs/GSH_OpenGL/GSH_OpenGL.h
void CPs2VmJs::SetBilinear(bool enabled)
{
	g_playBilinear.store(enabled);
	CAppConfig::GetInstance().SetPreferenceBoolean("renderer.opengl.forcebilineartextures", enabled);
	auto gs = GetGSHandler();
	if(gs)
	{
		gs->NotifyPreferencesChanged();
	}
}

//Taktrate der emulierten CPU in Prozent. Läuft im Emulator-Thread.
void CPs2VmJs::SetEeScalePercent(int percent)
{
	if(percent < 25) percent = 25;
	if(percent > 150) percent = 150;
	m_mailBox.SendCall([this, percent]() {
		SetEeFrequencyScale(static_cast<uint32>(percent), 100);
	});
}
"""
    js_cpp.write_text(text)
    print("Ps2VmJs.cpp gepatcht")

# --- GSH_OpenGLJs.cpp: Einstellungen beim Anlegen des Grafik-Teils anwenden ---
text = gs_js_cpp.read_text()
if "g_playRenderScale" in text:
    print("GSH_OpenGLJs.cpp bereits gepatcht.")
else:
    text = replace_once(
        text,
        '#include "GSH_OpenGLJs.h"\n',
        '#include "GSH_OpenGLJs.h"\n#include <atomic>\n#include "AppConfig.h"\n\n'
        "extern std::atomic<int> g_playRenderScale;\n"
        "extern std::atomic<bool> g_playBilinear;\n",
        "GSH Include",
    )
    text = replace_once(
        text,
        "    : m_context(context)\n{\n}\n",
        "    : m_context(context)\n{\n"
        "\t//Die Grundeinstellungen wurden im Konstruktor der Basisklasse schon registriert und geladen.\n"
        "\tCAppConfig::GetInstance().SetPreferenceInteger(PREF_CGSH_OPENGL_RESOLUTION_FACTOR, g_playRenderScale.load());\n"
        "\tCAppConfig::GetInstance().SetPreferenceBoolean(PREF_CGSH_OPENGL_FORCEBILINEARTEXTURES, g_playBilinear.load());\n"
        "\tLoadPreferences();\n}\n",
        "GSH Konstruktor",
    )
    gs_js_cpp.write_text(text)
    print("GSH_OpenGLJs.cpp gepatcht")

# --- Main.cpp ----------------------------------------------------------------
text = main_cpp.read_text()
if "setRenderScale" in text:
    print("Main.cpp bereits gepatcht.")
else:
    text = replace_once(
        text,
        "CPs2VmJs* g_virtualMachine = nullptr;\n",
        "#include <atomic>\nextern std::atomic<int> g_playRenderScale;\nextern std::atomic<bool> g_playBilinear;\n\nCPs2VmJs* g_virtualMachine = nullptr;\n",
        "Main Anfang",
    )
    text = replace_once(
        text,
        "\t\tpresentationParams.windowWidth = 640;\n\t\tpresentationParams.windowHeight = 480;\n",
        "\t\t//Muss zur Größe des Canvas passen. Die Web-Oberfläche setzt sie auf 640x480 mal Auflösungsfaktor.\n"
        "\t\tpresentationParams.windowWidth = 640 * g_playRenderScale.load();\n"
        "\t\tpresentationParams.windowHeight = 480 * g_playRenderScale.load();\n",
        "Main Presentation",
    )
    text = replace_once(
        text,
        "EMSCRIPTEN_BINDINGS(Play)\n{",
        """void setRenderScale(int scale)
{
	if(scale < 1) scale = 1;
	if(scale > 3) scale = 3;
	g_playRenderScale.store(scale);
}

void setBilinear(bool enabled)
{
	if(g_virtualMachine)
	{
		g_virtualMachine->SetBilinear(enabled);
	}
	else
	{
		g_playBilinear.store(enabled);
	}
}

void setEeScale(int percent)
{
	if(g_virtualMachine) g_virtualMachine->SetEeScalePercent(percent);
}

EMSCRIPTEN_BINDINGS(Play)
{""",
        "Main Bindings",
    )
    text = replace_once(
        text,
        '\tfunction("clearStats", &clearStats);\n',
        '\tfunction("clearStats", &clearStats);\n'
        '\tfunction("setRenderScale", &setRenderScale);\n'
        '\tfunction("setBilinear", &setBilinear);\n'
        '\tfunction("setEeScale", &setEeScale);\n',
        "Main Binding-Einträge",
    )
    main_cpp.write_text(text)
    print("Main.cpp gepatcht")
