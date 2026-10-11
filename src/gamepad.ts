// Gamepad-Unterstützung: Der Emulator kennt nur Tastatur-Eingaben (siehe InputProviderEmscripten.cpp).
// Wir übersetzen deshalb Gamepad-Eingaben in Tastaturereignisse auf dem Canvas.

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

    const tick = () => {
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
            Object.keys(BUTTON_TO_KEY).forEach((key) => {
                const index = Number(key);
                const button = pad.buttons[index];
                send(BUTTON_TO_KEY[index], !!button && button.pressed);
            });
            AXES.forEach(([axis, negative, positive]) => {
                const value = pad.axes[axis] || 0;
                send(negative, value < -DEADZONE);
                send(positive, value > DEADZONE);
            });
        } else if (down.size > 0) {
            Array.from(down).forEach((code) => send(code, false));
        }
        raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
        cancelAnimationFrame(raf);
        Array.from(down).forEach((code) => send(code, false));
    };
}
