export type Settings = {
    aspect: "4:3" | "16:9";
    smooth: boolean;
    showFps: boolean;
    fieldShift: number; // -4..4 Pixel, 0 = aus
    audioBuffer: number; // 1..8 Tonstücke (je ca. 100 ms), 1 = wie vorher
    touchControls: "auto" | "on" | "off";
    autoPause: boolean; // beim Tab-Wechsel pausieren
};

const KEY = "ps2web.settings.v1";

export const defaultSettings: Settings = { aspect: "4:3", smooth: true, showFps: true, fieldShift: 0, audioBuffer: 3, touchControls: "auto", autoPause: true };

export function loadSettings(): Settings {
    try {
        const raw = window.localStorage.getItem(KEY);
        if (raw) {
            return { ...defaultSettings, ...JSON.parse(raw) };
        }
    } catch (e) {
        // localStorage kann blockiert sein, dann gelten die Standardwerte.
    }
    return defaultSettings;
}

export function saveSettings(settings: Settings): void {
    try {
        window.localStorage.setItem(KEY, JSON.stringify(settings));
    } catch (e) {
        // ignorieren
    }
}
