import './App.css';
import { ChangeEvent, DragEvent, useCallback, useEffect, useRef, useState } from 'react';
import { PlayModule } from './PlayModule';
import { useAppDispatch, useAppSelector, bootFile } from "./Actions";
import { resumeAudio } from './audioUnlock';
import { startGamepad, GamepadStatus } from './gamepad';
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
];

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
  const [panel, setPanel] = useState<null | "controls" | "settings">(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
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

  // Flimmer-Glättung an den Emulator weitergeben (nur vorhanden, wenn er mit dem Patch gebaut wurde).
  useEffect(() => {
    if (PlayModule && typeof PlayModule.setDeinterlace === "function") {
      PlayModule.setDeinterlace(settings.deinterlace / 100);
    }
  }, [settings.deinterlace, ready]);

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

  const start = useCallback(
    (file: File) => {
      if (!ready) {
        return;
      }
      setError(null);
      resumeAudio();
      setGameName(file.name.replace(/\.[^.]+$/, ""));
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

  const toggleFullscreen = () => {
    const app = document.getElementById("app");
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => undefined);
    } else if (app && app.requestFullscreen) {
      app.requestFullscreen().then(focusCanvas).catch(() => setError("Vollbild wird vom Browser blockiert."));
    }
  };

  const playing = gameName !== null && !loadFailed;
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

      {playing && fps > 0 && fps < 30 && settings.showFps && (
        <div className="toast">Wenig Bilder pro Sekunde. Schließe andere Tabs und nutze Chrome oder Edge.</div>
      )}
      {error && <div className="toast" onClick={() => setError(null)}>{error}</div>}

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
            <span>Bild glätten</span>
            <input
              type="checkbox"
              checked={settings.smooth}
              onChange={(e) => setSettings({ ...settings, smooth: e.target.checked })}
            />
          </label>
          <label className="row col">
            <span>Flimmer-Glättung: {settings.deinterlace === 0 ? "aus" : settings.deinterlace + " %"}</span>
            <input
              type="range"
              min={0}
              max={80}
              step={5}
              value={settings.deinterlace}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setSettings({ ...settings, deinterlace: Number(e.target.value) })}
            />
          </label>
          <p className="note">Gegen das schnelle Auf-und-ab-Wackeln (z. B. GTA San Andreas). Höher = ruhiger, aber leichtes Nachziehen bei Bewegung. Wirkt nur bei Spielen mit Interlace-Ausgabe.</p>
          <label className="row">
            <span>FPS anzeigen</span>
            <input
              type="checkbox"
              checked={settings.showFps}
              onChange={(e) => setSettings({ ...settings, showFps: e.target.checked })}
            />
          </label>
          <button className="btn ghost" onClick={() => setSettings(defaultSettings)}>Zurücksetzen</button>
        </aside>
      )}

      {dragging && (
        <div className="drop">
          <div className="drop-box">Datei hier ablegen</div>
        </div>
      )}
    </div>
  );
}

export default App;
