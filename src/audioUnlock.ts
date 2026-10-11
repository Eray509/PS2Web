// Browser starten AudioContexts stumm (suspended), bis der Nutzer etwas anklickt.
// Der Emulator legt seinen Kontext beim Start an, also merken wir uns alle Instanzen
// und aktivieren sie bei der ersten Nutzeraktion (z. B. beim Laden einer ISO).

const contexts: AudioContext[] = [];

export function installAudioUnlock(): void {
    const w = window as any;
    const Original = w.AudioContext || w.webkitAudioContext;
    if (!Original || (Original as any).__ps2webPatched) {
        return;
    }
    const Patched: any = function (this: any, ...args: any[]) {
        const ctx = new Original(...args);
        contexts.push(ctx);
        return ctx;
    };
    Patched.prototype = Original.prototype;
    Patched.__ps2webPatched = true;
    w.AudioContext = Patched;
    if (w.webkitAudioContext) {
        w.webkitAudioContext = Patched;
    }
}

export function resumeAudio(): void {
    for (const ctx of contexts) {
        if (ctx.state === "suspended") {
            ctx.resume().catch(() => undefined);
        }
    }
}
