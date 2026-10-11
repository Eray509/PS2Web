import { useRef, useState, PointerEvent as ReactPointerEvent } from "react";

// Bildschirm-Steuerung für Touch-Geräte (iPad usw.).
// Die Eingaben gehen als Tastaturereignisse an das Canvas, genau wie beim Gamepad (siehe gamepad.ts).

const pressed = new Set<string>();

function setKey(code: string, down: boolean) {
    if (pressed.has(code) === down) {
        return;
    }
    if (down) {
        pressed.add(code);
    } else {
        pressed.delete(code);
    }
    const canvas = document.getElementById("outputCanvas");
    if (canvas) {
        canvas.dispatchEvent(
            new KeyboardEvent(down ? "keydown" : "keyup", { code, key: code, bubbles: true, cancelable: true })
        );
    }
}

type PointerEv = ReactPointerEvent<HTMLElement>;

function Btn({ code, label, className }: { code: string; label: string; className: string }) {
    const [active, setActive] = useState(false);
    const down = (e: PointerEv) => {
        e.preventDefault();
        try {
            e.currentTarget.setPointerCapture(e.pointerId);
        } catch (err) {
            // ignorieren
        }
        setKey(code, true);
        setActive(true);
    };
    const up = () => {
        setKey(code, false);
        setActive(false);
    };
    return (
        <div
            className={"t-btn " + className + (active ? " on" : "")}
            onPointerDown={down}
            onPointerUp={up}
            onPointerCancel={up}
            onLostPointerCapture={up}
        >
            {label}
        </div>
    );
}

type Dirs = { left: string; right: string; up: string; down: string };

// Stick und Steuerkreuz: Ein Finger zieht in eine Richtung, daraus werden bis zu zwei Tasten (Diagonale).
function Stick({ keys, variant, label }: { keys: Dirs; variant: "stick" | "dpad"; label?: string }) {
    const baseRef = useRef<HTMLDivElement>(null);
    const pointerId = useRef<number | null>(null);
    const [thumb, setThumb] = useState({ x: 0, y: 0 });
    const [dirs, setDirs] = useState({ left: false, right: false, up: false, down: false });
    const threshold = variant === "stick" ? 0.35 : 0.3;

    const apply = (dx: number, dy: number) => {
        const next = { left: dx < -threshold, right: dx > threshold, up: dy < -threshold, down: dy > threshold };
        setKey(keys.left, next.left);
        setKey(keys.right, next.right);
        setKey(keys.up, next.up);
        setKey(keys.down, next.down);
        setDirs(next);
    };

    const update = (e: PointerEv) => {
        const base = baseRef.current;
        if (!base) {
            return;
        }
        const rect = base.getBoundingClientRect();
        const radius = rect.width / 2;
        let dx = (e.clientX - (rect.left + radius)) / radius;
        let dy = (e.clientY - (rect.top + radius)) / radius;
        const length = Math.sqrt(dx * dx + dy * dy);
        if (length > 1) {
            dx /= length;
            dy /= length;
        }
        setThumb({ x: dx * radius * 0.55, y: dy * radius * 0.55 });
        apply(dx, dy);
    };

    const down = (e: PointerEv) => {
        e.preventDefault();
        if (pointerId.current !== null) {
            return;
        }
        pointerId.current = e.pointerId;
        try {
            e.currentTarget.setPointerCapture(e.pointerId);
        } catch (err) {
            // ignorieren
        }
        update(e);
    };
    const move = (e: PointerEv) => {
        if (pointerId.current === e.pointerId) {
            update(e);
        }
    };
    const end = (e: PointerEv) => {
        if (pointerId.current !== null && pointerId.current !== e.pointerId) {
            return;
        }
        pointerId.current = null;
        setThumb({ x: 0, y: 0 });
        apply(0, 0);
    };

    return (
        <div
            ref={baseRef}
            className={"t-" + variant}
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
            onLostPointerCapture={end}
        >
            {variant === "dpad" ? (
                <>
                    <span className={"arr up" + (dirs.up ? " on" : "")}>▲</span>
                    <span className={"arr down" + (dirs.down ? " on" : "")}>▼</span>
                    <span className={"arr left" + (dirs.left ? " on" : "")}>◀</span>
                    <span className={"arr right" + (dirs.right ? " on" : "")}>▶</span>
                </>
            ) : (
                <>
                    <div className="t-thumb" style={{ transform: `translate(${thumb.x}px, ${thumb.y}px)` }}>
                        {label}
                    </div>
                </>
            )}
        </div>
    );
}

export default function TouchControls({ onMenu }: { onMenu: () => void }) {
    return (
        <div
            className="touch-layer"
            onContextMenu={(e) => e.preventDefault()}
        >
            <div className="t-shoulders t-sh-left">
                <Btn code="Key2" label="L2" className="pill-btn" />
                <Btn code="Key1" label="L1" className="pill-btn" />
            </div>
            <div className="t-shoulders t-sh-right">
                <Btn code="Key8" label="R1" className="pill-btn" />
                <Btn code="Key9" label="R2" className="pill-btn" />
            </div>

            <div className="t-menu" onPointerDown={(e) => { e.preventDefault(); onMenu(); }}>☰</div>

            <div className="t-pos t-dpad-pos">
                <Stick variant="dpad" keys={{ left: "ArrowLeft", right: "ArrowRight", up: "ArrowUp", down: "ArrowDown" }} />
            </div>
            <div className="t-pos t-lstick-pos">
                <Stick variant="stick" label="L" keys={{ left: "KeyF", right: "KeyH", up: "KeyT", down: "KeyG" }} />
            </div>

            <div className="t-pos t-rstick-pos">
                <Stick variant="stick" label="R" keys={{ left: "KeyJ", right: "KeyL", up: "KeyI", down: "KeyK" }} />
            </div>
            <div className="t-pos t-face-pos">
                <Btn code="KeyS" label="△" className="face tri" />
                <Btn code="KeyA" label="□" className="face sqr" />
                <Btn code="KeyX" label="○" className="face cir" />
                <Btn code="KeyZ" label="✕" className="face crs" />
            </div>

            <div className="t-center">
                <Btn code="Backspace" label="Select" className="pill-btn small" />
                <Btn code="Enter" label="Start" className="pill-btn small" />
            </div>
        </div>
    );
}
