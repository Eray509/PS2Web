import './App.css';
import { ChangeEvent, DragEvent, useCallback, useEffect, useRef, useState } from 'react';
import { PlayModule, saveNow } from './PlayModule';
import { useAppDispatch, useAppSelector, bootFile } from "./Actions";
import { resumeAudio } from './audioUnlock';
import { startGamepad, GamepadStatus } from './gamepad';
import TouchControls from './TouchControls';
import { vmControlAvailable, pauseGame, resumeGame, setSpeed, makeGameKey, slotInfo, saveState, loadState, SLOT_COUNT } from './vmControl';
import { exportMemoryCards, importMemoryCards, downloadBlob } from './memcard';
import { defaultSettings, loadSettings, saveSettings, Settings } from './settings';

const ACCEPTED = ".iso,.cso,.chd,.isz,.bin,.elf";

const CONTROLS: Array<[string, string]> = [
  ["Steuerkreuz", "Pfeiltasten"],
  ["Linker Stick", "F H T G"],
  ["Rechter Stick", "J L I K"],
  ["Kreuz ✕", "Z"],
  ["Kreis ○", "X"],
  ["Quadrat □", "A"],
  ["Dreieck △", "S"],
  ["L1 / L2 / L3", "1 / 2 / 3"],
  ["R1 / R2 / R3", "8 / 9 / 0"],
  ["Start", "Enter"],
  ["Select", "Rücktaste"],
  ["Schnellspeichern (Slot 1)", "F5"],
  ["Schnellladen (Slot 1)", "F9"],
  ["Pause / Weiter", "P"],
  ["Vorlauf (halten)", "Tab"],
];

const SPEEDS = [100, 200, 300, 1000];
const speedLabel = (percent: number) => (percent >= 1000 ? "Max" : percent / 100 + "×");

function Fps({ onValue }: { onValue: (fps: number) => void }) {
  useEffect(() => {
    const timer = setInterval(() => {
      if (PlayModule === null) {
        return;
      }
      const frames = PlayModule.getFrames();
      PlayModule.clearStats();
      onValue(frames);
    }, 1000);
    return () => clearInterval(timer);
  }, [onValue]);
  return null;
}

function App() {
  const state = useAppSelector((s) => s.play);
  const dispatch = useAppDispatch();
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [fps, setFps] = useState(0);
  const [gamepad, setGamepad] = useState<GamepadStatus>({ connected: false, name: "" });
  const [gameName, setGameName] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [panel, setPanel] = useState<null | "controls" | "settings" | "states">(null);
  const [paused, setPaused] = useState(false);
  const [speed, setSpeedState] = useState(100);
  const [busy, setBusy] = useState(false);
  const pausedRef = useRef(false);
  const autoPausedRef = useRef(false);
  const speedRef = useRef(100);
  const holdPrevSpeed = useRef<number | null>(null);
  const busyRef = useRef(false);
  const gameKeyRef = useRef<string | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [idle, setIdle] = useState(false);
  const wakeRef = useRef<() => void>(() => undefined);
  const dragDepth = useRef(0);

  const ready = PlayModule !== null;
  const loadFailed = state.value.startsWith("loading failed");

  // Einstellungen auf Canvas anwenden und speichern.
  useEffect(() => {
    const app = document.getElementById("app");
    if (app) {
      app.dataset.aspect = settings.aspect;
      app.dataset.smooth = settings.smooth ? "1" : "0";
    }
    saveSettings(settings);
  }, [settings]);

  // Bildversatz gegen das Wackeln an den Emulator weitergeben (nur vorhanden, wenn er mit dem Patch gebaut wurde).
  useEffect(() => {
    if (PlayModule && typeof PlayModule.setFieldShift === "function") {
      PlayModule.setFieldShift(settings.fieldShift);
    }
  }, [settings.fieldShift, ready]);

  // Ton-Puffer an den Emulator weitergeben (nur vorhanden, wenn er mit dem Patch gebaut wurde).
  useEffect(() => {
    if (PlayModule && typeof PlayModule.setAudioPrebuffer === "function") {
      PlayModule.setAudioPrebuffer(settings.audioBuffer);
    }
  }, [settings.audioBuffer, ready]);

  // Weiche Texturen sofort anwenden. Die Auflösung gilt erst nach dem Neuladen der Seite.
  const activeScale = useRef(settings.quality === "high" ? 2 : 1);
  const needsReload = (settings.quality === "high" ? 2 : 1) !== activeScale.current;
  useEffect(() => {
    if (PlayModule && typeof PlayModule.setBilinear === "function") {
      PlayModule.setBilinear(settings.quality !== "standard");
    }
  }, [settings.quality, ready]);

  // Takt der emulierten CPU (weniger Takt = weniger Rechenaufwand pro Bild).
  useEffect(() => {
    if (PlayModule && typeof PlayModule.setEeScale === "function") {
      PlayModule.setEeScale(settings.eeScale);
    }
  }, [settings.eeScale, ready]);

  // Leiste und Mauszeiger blenden sich im Spiel nach 3 Sekunden ohne Bewegung aus.
  const playingNow = gameName !== null && !loadFailed;
  useEffect(() => {
    const app = document.getElementById("app");
    if (app) {
      app.dataset.playing = playingNow ? "1" : "0";
      app.dataset.idle = playingNow && idle && panel === null ? "1" : "0";
    }
  }, [playingNow, idle, panel]);

  useEffect(() => {
    if (!playingNow) {
      setIdle(false);
      return;
    }
    let timer = 0;
    const wake = (event?: Event) => {
      // Berührungen der Bildschirm-Steuerung sollen die Leiste nicht einblenden.
      const target = event && (event.target as HTMLElement | null);
      if (target && target.closest && target.closest(".touch-layer")) {
        return;
      }
      setIdle((current) => (current ? false : current));
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setIdle(true), 3000);
    };
    wake();
    wakeRef.current = () => wake();
    window.addEventListener("mousemove", wake);
    window.addEventListener("mousedown", wake);
    window.addEventListener("touchstart", wake);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("mousemove", wake);
      window.removeEventListener("mousedown", wake);
      window.removeEventListener("touchstart", wake);
    };
  }, [playingNow]);

  // Gamepad -> Tasten.
  useEffect(() => {
    const canvas = document.getElementById("outputCanvas") as HTMLCanvasElement | null;
    if (!canvas) {
      return;
    }
    return startGamepad(canvas, setGamepad);
  }, []);

  useEffect(() => {
    const onChange = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const focusCanvas = () => {
    const canvas = document.getElementById("outputCanvas") as HTMLCanvasElement | null;
    if (canvas) {
      canvas.focus();
    }
  };

  const notify = useCallback((message: string) => {
    setError(message);
    window.setTimeout(() => setError((current) => (current === message ? null : current)), 3500);
  }, []);

  const applyPause = useCallback((value: boolean) => {
    pausedRef.current = value;
    setPaused(value);
    if (value) {
      pauseGame();
    } else {
      resumeGame();
    }
  }, []);

  const togglePause = useCallback(() => {
    if (!vmControlAvailable() || gameKeyRef.current === null) {
      return;
    }
    autoPausedRef.current = false;
    applyPause(!pausedRef.current);
  }, [applyPause]);

  const applySpeed = useCallback((percent: number) => {
    speedRef.current = percent;
    setSpeedState(percent);
    setSpeed(percent);
  }, []);

  const cycleSpeed = useCallback(() => {
    if (!vmControlAvailable()) {
      return;
    }
    const index = SPEEDS.indexOf(speedRef.current);
    applySpeed(SPEEDS[(index + 1) % SPEEDS.length]);
  }, [applySpeed]);

  const doSave = useCallback(
    async (slot: number) => {
      const key = gameKeyRef.current;
      if (!key || busyRef.current) {
        return;
      }
      busyRef.current = true;
      setBusy(true);
      try {
        const ok = await saveState(key, slot);
        notify(ok ? `Gespeichert in Slot ${slot}.` : "Speichern fehlgeschlagen.");
      } catch (e) {
        notify("Speichern fehlgeschlagen.");
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [notify]
  );

  const doLoad = useCallback(
    async (slot: number) => {
      const key = gameKeyRef.current;
      if (!key || busyRef.current) {
        return;
      }
      busyRef.current = true;
      setBusy(true);
      try {
        const ok = await loadState(key, slot);
        notify(ok ? `Slot ${slot} geladen.` : "Laden fehlgeschlagen (Slot leer?).");
      } catch (e) {
        notify("Laden fehlgeschlagen.");
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [notify]
  );

  // Tastenkürzel: F5 speichern, F9 laden, P Pause, Tab halten = Vorlauf.
  useEffect(() => {
    if (!playingNow) {
      return;
    }
    const ignore = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      return (
        e.ctrlKey || e.metaKey || e.altKey ||
        (!!target && (target.tagName === "INPUT" || target.tagName === "SELECT" || target.tagName === "TEXTAREA"))
      );
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (ignore(e)) {
        return;
      }
      if (e.code === "Tab") {
        e.preventDefault();
        if (!e.repeat && holdPrevSpeed.current === null && vmControlAvailable()) {
          holdPrevSpeed.current = speedRef.current;
          applySpeed(300);
        }
        return;
      }
      if (e.repeat) {
        return;
      }
      if (e.code === "F5") {
        e.preventDefault();
        doSave(1);
      } else if (e.code === "F9") {
        e.preventDefault();
        doLoad(1);
      } else if (e.code === "KeyP") {
        e.preventDefault();
        togglePause();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Tab" && holdPrevSpeed.current !== null) {
        e.preventDefault();
        const previous = holdPrevSpeed.current;
        holdPrevSpeed.current = null;
        applySpeed(previous);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [playingNow, applySpeed, doSave, doLoad, togglePause]);

  // Beim Wechsel in einen anderen Tab pausieren und danach automatisch weiterspielen.
  useEffect(() => {
    if (!playingNow || !settings.autoPause) {
      return;
    }
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        if (!pausedRef.current && vmControlAvailable()) {
          autoPausedRef.current = true;
          applyPause(true);
        }
      } else if (autoPausedRef.current) {
        autoPausedRef.current = false;
        if (pausedRef.current) {
          applyPause(false);
        }
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [playingNow, settings.autoPause, applyPause]);

  const doExport = () => {
    if (!ready) {
      return;
    }
    try {
      const blob = exportMemoryCards();
      if (!blob) {
        notify("Keine Spielstände gefunden. Speichere erst im Spiel.");
        return;
      }
      const d = new Date();
      const two = (n: number) => (n < 10 ? "0" + n : "" + n);
      downloadBlob(blob, `ps2web-memorycard-${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}.zip`);
    } catch (e) {
      notify("Export fehlgeschlagen.");
    }
  };

  const onImportPick = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files && event.target.files[0];
    event.target.value = "";
    if (!file || !ready) {
      return;
    }
    try {
      const result = await importMemoryCards(file);
      notify(`${result.written} Dateien importiert` + (result.skipped ? `, ${result.skipped} übersprungen.` : "."));
    } catch (e: any) {
      notify("Import fehlgeschlagen: " + (e && e.message ? e.message : "unbekannter Fehler"));
    }
  };

  const start = useCallback(
    (file: File) => {
      if (!ready) {
        return;
      }
      setError(null);
      resumeAudio();
      setGameName(file.name.replace(/\.[^.]+$/, ""));
      gameKeyRef.current = makeGameKey(file);
      autoPausedRef.current = false;
      pausedRef.current = false;
      setPaused(false);
      speedRef.current = 100;
      setSpeedState(100);
      setSpeed(100);
      dispatch(bootFile(file));
      setPanel(null);
      setTimeout(focusCanvas, 50);
    },
    [dispatch, ready]
  );

  const onPick = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files && event.target.files[0];
    if (file) {
      start(file);
    }
    event.target.value = "";
  };

  const onDragEnter = (event: DragEvent) => {
    event.preventDefault();
    dragDepth.current++;
    setDragging(true);
  };
  const onDragLeave = (event: DragEvent) => {
    event.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) {
      setDragging(false);
    }
  };
  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    const file = event.dataTransfer.files && event.dataTransfer.files[0];
    if (file) {
      start(file);
    }
  };

  const recordDiagnostics = () => {
    if (PlayModule && typeof PlayModule.logFlips === "function") {
      PlayModule.logFlips(120);
      setError("Aufzeichnung läuft. Öffne mit F12 die Konsole und kopiere die Zeilen „FLIP #…“.");
      setTimeout(focusCanvas, 50);
    } else {
      setError("Diagnose ist in diesem Emulator-Build nicht enthalten.");
    }
  };

  const toggleFullscreen = () => {
    const app = document.getElementById("app") as any;
    const doc = document as any;
    if (document.fullscreenElement || doc.webkitFullscreenElement) {
      if (document.exitFullscreen) {
        document.exitFullscreen().catch(() => undefined);
      } else if (doc.webkitExitFullscreen) {
        doc.webkitExitFullscreen();
      }
    } else if (app && app.requestFullscreen) {
      app.requestFullscreen().then(focusCanvas).catch(() => setError("Vollbild wird vom Browser blockiert."));
    } else if (app && app.webkitRequestFullscreen) {
      app.webkitRequestFullscreen();
    } else {
      setError("Vollbild geht hier nicht. Tipp: Teilen-Symbol → „Zum Home-Bildschirm“, dann von dort öffnen.");
    }
  };

  const playing = gameName !== null && !loadFailed;
  const isTouchDevice =
    typeof window !== "undefined" &&
    ((window.matchMedia && window.matchMedia("(pointer: coarse)").matches) || navigator.maxTouchPoints > 1);
  const showTouch = playing && (settings.touchControls === "on" || (settings.touchControls === "auto" && isTouchDevice));
  const fpsClass = fps >= 50 ? "good" : fps >= 30 ? "ok" : "bad";

  return (
    <div
      className="ui"
      onDragEnter={onDragEnter}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <input ref={inputRef} type="file" accept={ACCEPTED} hidden onChange={onPick} />
      <input ref={importRef} type="file" accept=".zip,application/zip" hidden onChange={onImportPick} />
      {ready && <Fps onValue={setFps} />}

      <header className={"bar" + (playing ? " compact" : "")}>
        <div className="brand">
          <span className="logo">PS2</span>
          <span className="brand-text">Web</span>
        </div>
        {playing && <div className="title" title={gameName ?? ""}>{gameName}</div>}
        <div className="spacer" />
        {playing && settings.showFps && (
          <span className={"pill fps " + fpsClass} title="Bilder pro Sekunde">{fps} FPS</span>
        )}
        {gamepad.connected && <span className="pill pad" title={gamepad.name}>🎮 Controller</span>}
        {playing && ready && PlayModule.persistActive && (
          <span className="pill pad" title="Spielstände werden automatisch in diesem Browser gespeichert">💾 Autospeichern</span>
        )}
        {playing && vmControlAvailable() && (
          <>
            <button className="btn ghost" onClick={togglePause} title="Pause (P)">{paused ? "▶ Weiter" : "⏸ Pause"}</button>
            <button className="btn ghost" onClick={cycleSpeed} title="Tempo wechseln (Tab halten = Vorlauf)">⏩ {speedLabel(speed)}</button>
          </>
        )}
        {ready && (
          <button className="btn ghost" onClick={() => setPanel(panel === "states" ? null : "states")}>💾 Spielstände</button>
        )}
        <button className="btn" onClick={() => inputRef.current?.click()} disabled={!ready}>
          {playing ? "Anderes Spiel" : "Spiel laden"}
        </button>
        <button className="btn ghost" onClick={() => setPanel(panel === "controls" ? null : "controls")}>Steuerung</button>
        <button className="btn ghost" onClick={() => setPanel(panel === "settings" ? null : "settings")}>Einstellungen</button>
        <button className="btn ghost" onClick={toggleFullscreen}>{fullscreen ? "Vollbild beenden" : "Vollbild"}</button>
      </header>

      {!playing && (
        <main className="hero">
          <div className="card">
            <h1>PlayStation 2 <span>im Browser</span></h1>
            <p className="lead">
              Zieh eine Spieleabbild-Datei hierher oder wähle sie aus. Alles läuft lokal bei dir, es wird nichts hochgeladen.
            </p>
            <button className="big" onClick={() => inputRef.current?.click()} disabled={!ready}>
              {ready ? "ISO auswählen" : "Emulator lädt …"}
            </button>
            <p className="formats">Unterstützt: ISO, CSO, CHD, ISZ, BIN, ELF · kein BIOS nötig</p>
            {loadFailed && <p className="error">{state.value}</p>}
            <p className="hint">Nutze Chrome, Edge oder Firefox am Desktop. Verwende nur Abbilder eigener Discs.</p>
          </div>
        </main>
      )}

      {playing && paused && (
        <div className="pause-overlay" onClick={togglePause}>
          <div className="pause-box">
            ⏸ Pausiert
            <small>Antippen oder P drücken zum Fortsetzen</small>
          </div>
        </div>
      )}

      {playing && fps > 0 && fps < 30 && settings.showFps && (
        <div className="toast">Wenig Bilder pro Sekunde. Probiere Einstellungen → Emulations-Last niedriger, schließe andere Tabs und nutze Chrome oder Edge.</div>
      )}
      {error && <div className="toast" onClick={() => setError(null)}>{error}</div>}

      {panel === "states" && (
        <aside className="panel" role="dialog" aria-label="Spielstände">
          <div className="panel-head">
            <h2>Spielstände</h2>
            <button className="x" onClick={() => setPanel(null)} aria-label="Schließen">×</button>
          </div>
          {playing && vmControlAvailable() ? (
            <>
              {Array.from({ length: SLOT_COUNT }, (_, i) => i + 1).map((slot) => {
                const key = gameKeyRef.current;
                const info = key ? slotInfo(key, slot) : { exists: false, time: null, size: 0 };
                return (
                  <div className="slot" key={slot}>
                    <div>
                      <strong>Slot {slot}</strong>
                      <small>{info.exists && info.time ? info.time.toLocaleString("de-DE") + " · " + Math.round(info.size / 1048576) + " MB" : "leer"}</small>
                    </div>
                    <div className="slot-actions">
                      <button className="btn ghost" disabled={busy} onClick={() => doSave(slot)}>Speichern</button>
                      <button className="btn ghost" disabled={busy || !info.exists} onClick={() => doLoad(slot)}>Laden</button>
                    </div>
                  </div>
                );
              })}
              <p className="note">Savestates speichern den genauen Zustand des Spiels, auch mitten im Level. Schnell: F5 speichert, F9 lädt Slot 1. {ready && PlayModule.persistActive ? "Sie bleiben in diesem Browser erhalten." : "Dauerhaftes Speichern ist gerade nicht aktiv: Sie gehen beim Neuladen verloren."}</p>
            </>
          ) : (
            <p className="note">Savestates gibt es, sobald ein Spiel läuft (und der Emulator damit gebaut wurde).</p>
          )}
          <h3 className="sub">Memory Card</h3>
          <div className="slot-actions wide">
            <button className="btn ghost" onClick={doExport} disabled={!ready}>Exportieren (ZIP)</button>
            <button className="btn ghost" onClick={() => importRef.current?.click()} disabled={!ready}>Importieren …</button>
          </div>
          <p className="note">Sichert die normalen Spielstände (Speichern im Spiel) als Datei oder spielt sie wieder ein, zum Beispiel nach dem Löschen der Browserdaten oder auf einem anderen Gerät. Am besten vor dem Start eines Spiels importieren, ein laufendes Spiel merkt es sonst eventuell nicht.</p>
        </aside>
      )}

      {panel === "controls" && (
        <aside className="panel" role="dialog" aria-label="Steuerung">
          <div className="panel-head">
            <h2>Steuerung</h2>
            <button className="x" onClick={() => setPanel(null)} aria-label="Schließen">×</button>
          </div>
          <table>
            <tbody>
              {CONTROLS.map(([a, b]) => (
                <tr key={a}><td>{a}</td><td><kbd>{b}</kbd></td></tr>
              ))}
            </tbody>
          </table>
          <p className="note">Ein angeschlossenes Gamepad (Xbox/PlayStation) wird automatisch erkannt. Tipp: Vor dem Start einmal eine Taste am Controller drücken.</p>
        </aside>
      )}

      {panel === "settings" && (
        <aside className="panel" role="dialog" aria-label="Einstellungen">
          <div className="panel-head">
            <h2>Einstellungen</h2>
            <button className="x" onClick={() => setPanel(null)} aria-label="Schließen">×</button>
          </div>
          <label className="row">
            <span>Bildformat</span>
            <select
              value={settings.aspect}
              onChange={(e) => setSettings({ ...settings, aspect: e.target.value as Settings["aspect"] })}
            >
              <option value="4:3">4:3 (Original)</option>
              <option value="16:9">16:9 (gestreckt)</option>
            </select>
          </label>
          <label className="row">
            <span>Bildqualität</span>
            <select
              value={settings.quality}
              onChange={(e: ChangeEvent<HTMLSelectElement>) => setSettings({ ...settings, quality: e.target.value as Settings["quality"] })}
            >
              <option value="standard">Standard</option>
              <option value="soft">Weich (glatte Texturen)</option>
              <option value="high">Hoch (2× Auflösung)</option>
            </select>
          </label>
          <p className="note">
            „Weich“ glättet Texturen und kostet kaum Leistung. „Hoch“ rechnet die Grafik mit doppelter Auflösung, das sieht deutlich schärfer aus, braucht aber eine starke Grafikkarte und kann die FPS senken.
          </p>
          {needsReload && (
            <button className="btn" onClick={() => window.location.reload()}>Seite neu laden, damit „Hoch“ wirkt</button>
          )}
          <label className="row">
            <span>Emulations-Last</span>
            <select
              value={settings.eeScale}
              onChange={(e: ChangeEvent<HTMLSelectElement>) => setSettings({ ...settings, eeScale: Number(e.target.value) })}
            >
              <option value={100}>100 % (original)</option>
              <option value={85}>85 %</option>
              <option value={70}>70 %</option>
              <option value={50}>50 % (sehr sparsam)</option>
            </select>
          </label>
          <p className="note">
            Wenn die FPS unter 60 liegen: Weniger Prozent bedeuten weniger Rechenaufwand pro Bild und damit mehr Tempo. Der Preis: Das Spiel selbst bekommt weniger CPU-Leistung und kann in belebten Szenen mit weniger eigenen Bildern laufen. Manche Spiele reagieren empfindlich oder hängen. Erst 85 % probieren.
          </p>
          <label className="row">
            <span>Touch-Steuerung</span>
            <select
              value={settings.touchControls}
              onChange={(e: ChangeEvent<HTMLSelectElement>) => setSettings({ ...settings, touchControls: e.target.value as Settings["touchControls"] })}
            >
              <option value="auto">Automatisch (Touch-Geräte)</option>
              <option value="on">Immer an</option>
              <option value="off">Aus</option>
            </select>
          </label>
          <label className="row">
            <span>Bild glätten</span>
            <input
              type="checkbox"
              checked={settings.smooth}
              onChange={(e) => setSettings({ ...settings, smooth: e.target.checked })}
            />
          </label>
          <label className="row col">
            <span>Wackel-Ausgleich: {settings.fieldShift === 0 ? "aus" : settings.fieldShift + " px"}</span>
            <input
              type="range"
              min={-4}
              max={4}
              step={1}
              value={settings.fieldShift}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setSettings({ ...settings, fieldShift: Number(e.target.value) })}
            />
          </label>
          <p className="note">Gegen das schnelle Auf-und-ab-Wackeln (z. B. GTA San Andreas). Verschiebt jedes zweite Bild um die gewählten Pixel. Probiere während das Spiel läuft -2, -1, 1 und 2 aus. Der richtige Wert macht das Bild ruhig, der falsche verstärkt das Wackeln.</p>
          <button className="btn ghost" onClick={recordDiagnostics}>Diagnose aufzeichnen</button>
          <p className="note">Schreibt die Anzeigedaten von 120 Bildern in die Browser-Konsole (F12 → Konsole). Kopiere die Zeilen „FLIP #…“ und schick sie mir, falls das Wackeln bleibt.</p>
          <label className="row col">
            <span>Ton-Puffer: {settings.audioBuffer === 1 ? "aus" : "ca. " + settings.audioBuffer * 100 + " ms"}</span>
            <input
              type="range"
              min={1}
              max={8}
              step={1}
              value={settings.audioBuffer}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setSettings({ ...settings, audioBuffer: Number(e.target.value) })}
            />
          </label>
          <p className="note">Gegen Ruckeln und Knacken beim Ton. Höher = stabiler, aber der Ton kommt später. Bei Ruckeln erhöhen, bei Spielen mit Takt oder Rhythmus eher niedrig lassen. Wirkt ab dem nächsten Neustart des Tons (Spiel kurz pausieren oder neu laden). Bleibt der Ton trotzdem unruhig, schau auf die FPS-Anzeige: Unter 60 ist die Emulation selbst zu langsam, das kann der Puffer nicht beheben.</p>
          <label className="row">
            <span>Beim Tab-Wechsel pausieren</span>
            <input
              type="checkbox"
              checked={settings.autoPause}
              onChange={(e) => setSettings({ ...settings, autoPause: e.target.checked })}
            />
          </label>
          <label className="row">
            <span>FPS anzeigen</span>
            <input
              type="checkbox"
              checked={settings.showFps}
              onChange={(e) => setSettings({ ...settings, showFps: e.target.checked })}
            />
          </label>
          <p className="note">
            {ready && PlayModule.persistActive
              ? "Spielstände (Memory Card) werden automatisch alle paar Sekunden in diesem Browser gespeichert. Speichere im Spiel wie gewohnt und warte danach kurz, bevor du den Tab schließt. Löschst du die Browserdaten, sind sie weg."
              : "Dauerhaftes Speichern ist in diesem Browser gerade nicht aktiv. Spielstände gehen beim Neuladen verloren."}
          </p>
          {ready && PlayModule.persistActive && (
            <button className="btn ghost" onClick={() => { saveNow(); }}>Jetzt sichern</button>
          )}
          <button className="btn ghost" onClick={() => setSettings(defaultSettings)}>Zurücksetzen</button>
        </aside>
      )}

      {showTouch && <TouchControls onMenu={() => wakeRef.current()} />}

      {dragging && (
        <div className="drop">
          <div className="drop-box">Datei hier ablegen</div>
        </div>
      )}
    </div>
  );
}

export default App;
