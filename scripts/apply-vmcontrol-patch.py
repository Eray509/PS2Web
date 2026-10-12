#!/usr/bin/env python3
"""
Spielsteuerung für den Web-Build: Savestates, Pause/Weiter und Tempo (Vorlauf).

Fügt dem Emulator diese JavaScript-Funktionen hinzu (alle ohne Blockieren des Hauptthreads):

  Module.pauseVm() / Module.resumeVm() / Module.getVmStatus()   (Status: 1 = läuft, 2 = pausiert)
  Module.setSpeed(prozent)                                       (100 = normal, 200, 300, 1000 = so schnell wie möglich)
  Module.startSaveState(pfad) / Module.startLoadState(pfad)      (Rückgabe 1 = gestartet, 0 = beschäftigt)
  Module.pollStateOperation()                                    (0 = nichts, 1 = läuft, 2 = fertig, 3 = fehlgeschlagen)

Wichtig: Der Emulator-Thread wartet beim Lesen der ISO auf den Hauptthread. Der Hauptthread darf deshalb nie
darauf warten, dass der Emulator-Thread etwas erledigt (Deadlock). Alle Funktionen hier schicken nur Aufträge
und fragen den Zustand später ab.

Beim Tempo-Wechsel wird der Ton abgeschaltet. Sonst würde er schneller erzeugt als er abgespielt wird,
der Puffer liefe voll und der Ton käme danach mehrere Sekunden verspätet.

Aufruf: apply-vmcontrol-patch.py <Pfad zu Play->
Bricht mit Fehler ab, wenn eine erwartete Codestelle nicht gefunden wird, damit nichts still schiefgeht.
"""
import sys
from pathlib import Path

root = Path(sys.argv[1] if len(sys.argv) > 1 else "Play-")
vm_cpp = root / "Source/PS2VM.cpp"
js_h = root / "Source/ui_js/Ps2VmJs.h"
js_cpp = root / "Source/ui_js/Ps2VmJs.cpp"
main_cpp = root / "Source/ui_js/Main.cpp"
proxy_cpp = root / "Source/sound/SH_OpenAL/SH_OpenALProxy.cpp"


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        sys.exit(f"FEHLER: Stelle '{label}' wurde {count}x gefunden (erwartet: 1). Der Emulator-Code hat sich geändert.")
    return text.replace(old, new)


# --- PS2VM.cpp: Tempo im Frame-Limiter -------------------------------------
text = vm_cpp.read_text()
if "g_playSpeedPercent" in text:
    print("PS2VM.cpp bereits gepatcht.")
else:
    text = replace_once(
        text,
        '#include "PS2VM.h"\n',
        '#include "PS2VM.h"\n#include <atomic>\n\n'
        "//Tempo in Prozent (100 = normal, 1000 = unbegrenzt). Wird in Ps2VmJs.cpp definiert und von der Web-Oberfläche gesetzt.\n"
        "extern std::atomic<unsigned int> g_playSpeedPercent;\n",
        "PS2VM Include",
    )
    text = replace_once(
        text,
        "\tm_frameLimiter.SetFrameRate(limitFrameRate ? vRefreshRate : 0);\n",
        "\tconst unsigned int speedPercent = g_playSpeedPercent.load();\n"
        "\tm_frameLimiter.SetFrameRate((limitFrameRate && speedPercent < 1000) ? (vRefreshRate * speedPercent / 100) : 0);\n",
        "SetFrameRate",
    )
    vm_cpp.write_text(text)
    print("PS2VM.cpp gepatcht")

# --- Ps2VmJs.h --------------------------------------------------------------
text = js_h.read_text()
if "SetSpeedPercent" in text:
    print("Ps2VmJs.h bereits gepatcht.")
else:
    text = replace_once(
        text,
        "\tvoid BootDiscImage(std::string);\n};",
        "\tvoid BootDiscImage(std::string);\n\n"
        "\t//Alle Funktionen schicken nur Aufträge an den Emulator-Thread und blockieren nicht.\n"
        "\tvoid ResumeNow();\n"
        "\tvoid SetSpeedPercent(int);\n"
        "\tint StartStateOperation(bool, const std::string&);\n"
        "\tint PollStateOperation();\n\n"
        "private:\n"
        "\tstd::future<bool> m_stateFuture;\n"
        "\tbool m_stateOperationActive = false;\n};",
        "Ps2VmJs.h Klasse",
    )
    js_h.write_text(text)
    print("Ps2VmJs.h gepatcht")

# --- Ps2VmJs.cpp ------------------------------------------------------------
text = js_cpp.read_text()
if "CPs2VmJs::SetSpeedPercent" in text:
    print("Ps2VmJs.cpp bereits gepatcht.")
else:
    text = replace_once(
        text,
        '#include "Ps2VmJs.h"\n',
        '#include "Ps2VmJs.h"\n#include <atomic>\n#include <chrono>\n\n'
        "std::atomic<unsigned int> g_playSpeedPercent{100};\n"
        "std::atomic<bool> g_playMuteAudio{false};\n",
        "Ps2VmJs Include",
    )
    text = text.rstrip("\n") + """

void CPs2VmJs::ResumeNow()
{
	m_mailBox.SendCall([this]() {
		ResumeImpl();
	});
}

void CPs2VmJs::SetSpeedPercent(int percent)
{
	if(percent < 25) percent = 25;
	if(percent > 1000) percent = 1000;
	g_playSpeedPercent.store(static_cast<unsigned int>(percent));
	g_playMuteAudio.store(percent != 100);
	m_mailBox.SendCall([this]() {
		ReloadFrameRateLimit();
	});
}

//Rückgabe: 1 = gestartet, 0 = es läuft schon ein Vorgang
int CPs2VmJs::StartStateOperation(bool save, const std::string& path)
{
	if(m_stateOperationActive)
	{
		return 0;
	}
	m_stateFuture = save ? SaveState(path) : LoadState(path);
	m_stateOperationActive = true;
	return 1;
}

//Rückgabe: 0 = kein Vorgang, 1 = läuft, 2 = fertig, 3 = fehlgeschlagen
int CPs2VmJs::PollStateOperation()
{
	if(!m_stateOperationActive)
	{
		return 0;
	}
	if(m_stateFuture.wait_for(std::chrono::seconds(0)) != std::future_status::ready)
	{
		return 1;
	}
	bool success = m_stateFuture.get();
	m_stateOperationActive = false;
	return success ? 2 : 3;
}
"""
    js_cpp.write_text(text)
    print("Ps2VmJs.cpp gepatcht")

# --- SH_OpenALProxy.cpp: Ton aus bei geändertem Tempo -----------------------
text = proxy_cpp.read_text()
if "g_playMuteAudio" in text:
    print("SH_OpenALProxy.cpp bereits gepatcht.")
else:
    text = replace_once(
        text,
        '#include "SH_OpenALProxy.h"\n',
        '#include "SH_OpenALProxy.h"\n#include <atomic>\n\nextern std::atomic<bool> g_playMuteAudio;\n',
        "Proxy Include",
    )
    text = replace_once(
        text,
        "\tassert(m_bufferCount != 0);\n\tif(m_bufferCount == 0) return;\n\tint16* proxySamples",
        "\tif(g_playMuteAudio.load()) return;\n\tassert(m_bufferCount != 0);\n\tif(m_bufferCount == 0) return;\n\tint16* proxySamples",
        "Proxy Write",
    )
    proxy_cpp.write_text(text)
    print("SH_OpenALProxy.cpp gepatcht")

# --- Main.cpp: JavaScript-Anbindung ------------------------------------------
text = main_cpp.read_text()
if "pollStateOperation" in text:
    print("Main.cpp bereits gepatcht.")
else:
    text = replace_once(
        text,
        "EMSCRIPTEN_BINDINGS(Play)\n{",
        """void pauseVm()
{
	if(g_virtualMachine) g_virtualMachine->PauseAsync();
}

void resumeVm()
{
	if(g_virtualMachine) g_virtualMachine->ResumeNow();
}

int getVmStatus()
{
	return g_virtualMachine ? static_cast<int>(g_virtualMachine->GetStatus()) : 0;
}

void setSpeed(int percent)
{
	if(g_virtualMachine) g_virtualMachine->SetSpeedPercent(percent);
}

int startSaveState(std::string path)
{
	return g_virtualMachine ? g_virtualMachine->StartStateOperation(true, path) : 0;
}

int startLoadState(std::string path)
{
	return g_virtualMachine ? g_virtualMachine->StartStateOperation(false, path) : 0;
}

int pollStateOperation()
{
	return g_virtualMachine ? g_virtualMachine->PollStateOperation() : 0;
}

EMSCRIPTEN_BINDINGS(Play)
{""",
        "Main Bindings",
    )
    text = replace_once(
        text,
        '\tfunction("clearStats", &clearStats);\n',
        '\tfunction("clearStats", &clearStats);\n'
        '\tfunction("pauseVm", &pauseVm);\n'
        '\tfunction("resumeVm", &resumeVm);\n'
        '\tfunction("getVmStatus", &getVmStatus);\n'
        '\tfunction("setSpeed", &setSpeed);\n'
        '\tfunction("startSaveState", &startSaveState);\n'
        '\tfunction("startLoadState", &startLoadState);\n'
        '\tfunction("pollStateOperation", &pollStateOperation);\n',
        "Main Binding-Einträge",
    )
    main_cpp.write_text(text)
    print("Main.cpp gepatcht")
