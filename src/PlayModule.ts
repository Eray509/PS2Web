import Play from "./Play";
import DiscImageDevice from "./DiscImageDevice";
import { loadSettings } from "./settings";

export let PlayModule : any = null;

let module_overrides = {
    locateFile: function(path : string) {
        const baseURL = window.location.origin + window.location.pathname.substring(0, window.location.pathname.lastIndexOf( "/" ));
        return baseURL + '/' + path;
    },
    mainScriptUrlOrBlob: "",
};

// Der Emulator legt Memory Cards, Einstellungen und Spielstände unter $HOME/.local/share/Play Data Files ab.
// Emscripten setzt HOME standardmässig auf /home/web_user. Dieses Verzeichnis binden wir an IndexedDB an.
export const DATA_DIR = "/home/web_user/.local/share/Play Data Files";
const AUTOSAVE_INTERVAL_MS = 8000;

function syncFs(populate: boolean): Promise<boolean> {
    return new Promise((resolve) => {
        try {
            PlayModule.FS.syncfs(populate, (error: any) => {
                if (error) {
                    console.warn("Speichern fehlgeschlagen:", error);
                }
                resolve(!error);
            });
        } catch (e) {
            console.warn("Speichern nicht möglich:", e);
            resolve(false);
        }
    });
}

let syncRunning = false;

export async function saveNow(): Promise<void> {
    if (!PlayModule || !PlayModule.persistActive || syncRunning) {
        return;
    }
    syncRunning = true;
    try {
        await syncFs(false);
    } finally {
        syncRunning = false;
    }
}

// Stellt gespeicherte Daten wieder her und hängt das Verzeichnis an die Browser-Datenbank an.
async function mountPersistentStorage(): Promise<boolean> {
    try {
        const FS = PlayModule.FS;
        const idbfs = FS.filesystems && FS.filesystems.IDBFS;
        if (!idbfs) {
            console.warn("IDBFS fehlt: Dieser Emulator-Build kann nicht dauerhaft speichern.");
            return false;
        }
        FS.mkdirTree(DATA_DIR);
        FS.mount(idbfs, {}, DATA_DIR);
        // Vorhandene Spielstände aus der Browser-Datenbank laden.
        return await syncFs(true);
    } catch (e) {
        console.warn("Dauerhafter Speicher konnte nicht eingerichtet werden:", e);
        return false;
    }
}

function startAutosave() {
    window.setInterval(() => { saveNow(); }, AUTOSAVE_INTERVAL_MS);
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") {
            saveNow();
        }
    });
    window.addEventListener("pagehide", () => { saveNow(); });
    // Bittet den Browser, die Daten nicht von selbst zu löschen, wenn der Speicher knapp wird.
    try {
        if (navigator.storage && navigator.storage.persist) {
            navigator.storage.persist().catch(() => undefined);
        }
    } catch (e) {
        // ignorieren
    }
}

export let initPlayModule = async function() {
    module_overrides.mainScriptUrlOrBlob = module_overrides.locateFile('Play.js');
    PlayModule = await Play(module_overrides);
    PlayModule.FS.mkdir("/work");

    // Muss vor dem Start des Emulators passieren, damit er seine Ordner im dauerhaften Speicher anlegt.
    const mounted = await mountPersistentStorage();

    PlayModule.discImageDevice = new DiscImageDevice(PlayModule);
    // Bildqualität: Die Auflösung muss vor dem Start des Emulators feststehen (Canvas und Grafik-Teil müssen zusammenpassen).
    if (typeof PlayModule.setRenderScale === "function") {
        const settings = loadSettings();
        const scale = settings.quality === "high" ? 2 : 1;
        PlayModule.setRenderScale(scale);
        PlayModule.setBilinear(settings.quality !== "standard");
        const canvas = document.getElementById("outputCanvas") as HTMLCanvasElement | null;
        if (canvas) {
            canvas.width = 640 * scale;
            canvas.height = 480 * scale;
        }
    }
    PlayModule.ccall("initVm", "", [], []);

    // Prüfen, ob der Emulator seine Ordner wirklich dort angelegt hat (sonst stimmt der Pfad nicht).
    let active = false;
    if (mounted) {
        try {
            active = PlayModule.FS.analyzePath(DATA_DIR + "/vfs/mc0").exists;
        } catch (e) {
            active = false;
        }
        if (!active) {
            console.warn("Memory-Card-Ordner nicht unter " + DATA_DIR + " gefunden. Autospeichern ist aus.");
        }
    }
    PlayModule.persistActive = active;
    if (active) {
        await syncFs(false);
        startAutosave();
    }
};
