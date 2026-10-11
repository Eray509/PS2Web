// Gamepad-Unterstützung: Der Emulator kennt nur Tastatur-Eingaben (siehe InputProviderEmscripten.cpp).
// Wir übersetzen deshalb Gamepad-Eingaben in Tastaturereignisse auf dem Canvas.
//
// Die Abfrage läuft nur, solange ein Controller angeschlossen ist. Ohne Controller kostet sie nichts.

const BUTTON_TO_KEY: Record<number, string> = {
    0: "KeyZ", // Kreuz (A)
    1: "KeyX", // Kreis (B)
    2: "KeyA", // Quadrat (X)
    3: "KeyS", // Dreieck (Y)
    4: "Key1", // L1
    5: "Key8", // R1
    6: "Key2", // L2
    7: "Key9", // R2
    8: "Backspace", // Select
    9: "Enter", // Start
    10: "Key3", // L3
    11: "Key0", // R3
    12: "ArrowUp",
    13: "ArrowDown",
    14: "ArrowLeft",
    15: "ArrowRight",
};

const BUTTON_INDEXES = Object.keys(BUTTON_TO_KEY).map(Number);
const DEADZONE = 0.35;

// Achse -> (negative Taste, positive Taste)
const AXES: Array<[number, string, string]> = [
    [0, "KeyF", "KeyH"], // linker Stick X
    [1, "KeyT", "KeyG"], // linker Stick Y
    [2, "KeyJ", "KeyL"], // rechter Stick X
    [3, "KeyI", "KeyK"], // rechter Stick Y
];

export type GamepadStatus = { connected: boolean; name: string };

export function startGamepad(
    canvas: HTMLCanvasElement,
    onStatus: (status: GamepadStatus) => void
): () => void {
    const down = new Set<string>();
    let raf = 0;
    let lastConnected = false;
    let lastName = "";

    const send = (code: string, pressed: boolean) => {
        if (pressed === down.has(code)) {
            return;
        }
        if (pressed) {
            down.add(code);
        } else {
            down.delete(code);
        }
        canvas.dispatchEvent(
            new KeyboardEvent(pressed ? "keydown" : "keyup", { code, key: code, bubbles: true, cancelable: true })
        );
    };

    // Liefert true, solange ein Controller da ist.
    const tick = (): boolean => {
        const pads = navigator.getGamepads ? Array.from(navigator.getGamepads()) : [];
        const pad = pads.find((p) => p && p.connected) || null;
        const connected = pad !== null;
        const name = pad ? pad.id : "";
        if (connected !== lastConnected || name !== lastName) {
            lastConnected = connected;
            lastName = name;
            onStatus({ connected, name });
        }
        if (pad) {
            for (const index of BUTTON_INDEXES) {
                const button = pad.buttons[index];
                send(BUTTON_TO_KEY[index], !!button && button.pressed);
            }
            for (const [axis, negative, positive] of AXES) {
                const value = pad.axes[axis] || 0;
                send(negative, value < -DEADZONE);
                send(positive, value > DEADZONE);
            }
        } else if (down.size > 0) {
            Array.from(down).forEach((code) => send(code, false));
        }
        return connected;
    };

    const loop = () => {
        raf = tick() ? requestAnimationFrame(loop) : 0;
    };

    const start = () => {
        if (raf === 0) {
            raf = requestAnimationFrame(loop);
        }
    };

    // Browser melden einen Controller erst nach der ersten Tastendrückung daran.
    window.addEventListener("gamepadconnected", start);
    window.addEventListener("gamepaddisconnected", start);
    start();

    return () => {
        window.removeEventListener("gamepadconnected", start);
        window.removeEventListener("gamepaddisconnected", start);
        if (raf !== 0) {
            cancelAnimationFrame(raf);
            raf = 0;
        }
        Array.from(down).forEach((code) => send(code, false));
    };
}
