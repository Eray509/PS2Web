// Savestates, Pause und Tempo. Die Funktionen im Emulator stammen aus scripts/apply-vmcontrol-patch.py.
// Wichtig: Nie auf den Emulator-Thread warten. Es werden nur Aufträge geschickt und der Zustand abgefragt.

import { PlayModule, DATA_DIR, saveNow } from "./PlayModule";

export const SLOT_COUNT = 3;
const POLL_MS = 50;
const TIMEOUT_MS = 120000;

export function vmControlAvailable(): boolean {
    return !!PlayModule && typeof PlayModule.pauseVm === "function" && typeof PlayModule.startSaveState === "function";
}

export function pauseGame(): void {
    if (vmControlAvailable()) {
        PlayModule.pauseVm();
    }
}

export function resumeGame(): void {
    if (vmControlAvailable()) {
        PlayModule.resumeVm();
    }
}

// 100 = normal, 200, 300, 1000 = so schnell wie möglich.
export function setSpeed(percent: number): void {
    if (vmControlAvailable()) {
        PlayModule.setSpeed(percent);
    }
}

// Dateiname aus Spielname und Größe, damit zwei verschiedene Spiele nie denselben Spielstand teilen.
export function makeGameKey(file: File): string {
    const safe = file.name.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 80);
    return `${safe}.${file.size}`;
}

function stateDir(): string {
    return `${DATA_DIR}/states`;
}

function statePath(key: string, slot: number): string {
    return `${stateDir()}/${key}.slot${slot}.zip`;
}

export type SlotInfo = { exists: boolean; time: Date | null; size: number };

export function slotInfo(key: string, slot: number): SlotInfo {
    try {
        const stat = PlayModule.FS.stat(statePath(key, slot));
        return { exists: true, time: new Date(stat.mtime), size: stat.size };
    } catch (e) {
        return { exists: false, time: null, size: 0 };
    }
}

function waitForOperation(): Promise<boolean> {
    return new Promise((resolve) => {
        const started = Date.now();
        const tick = () => {
            const status = PlayModule.pollStateOperation();
            if (status === 2) {
                resolve(true);
            } else if (status === 3 || status === 0) {
                resolve(false);
            } else if (Date.now() - started > TIMEOUT_MS) {
                resolve(false);
            } else {
                window.setTimeout(tick, POLL_MS);
            }
        };
        window.setTimeout(tick, POLL_MS);
    });
}

function tryRemove(path: string): void {
    try {
        PlayModule.FS.unlink(path);
    } catch (e) {
        // war nicht vorhanden
    }
}

export async function saveState(key: string, slot: number): Promise<boolean> {
    if (!vmControlAvailable()) {
        return false;
    }
    const FS = PlayModule.FS;
    FS.mkdirTree(stateDir());
    const target = statePath(key, slot);
    const temp = target + ".tmp";
    tryRemove(temp);
    // Erst in eine Hilfsdatei schreiben: Bricht etwas ab, bleibt der alte Spielstand erhalten.
    if (!PlayModule.startSaveState(temp)) {
        return false;
    }
    const ok = await waitForOperation();
    if (!ok) {
        tryRemove(temp);
        return false;
    }
    tryRemove(target);
    FS.rename(temp, target);
    await saveNow();
    return true;
}

export async function loadState(key: string, slot: number): Promise<boolean> {
    if (!vmControlAvailable()) {
        return false;
    }
    const path = statePath(key, slot);
    if (!slotInfo(key, slot).exists) {
        return false;
    }
    if (!PlayModule.startLoadState(path)) {
        return false;
    }
    return waitForOperation();
}
