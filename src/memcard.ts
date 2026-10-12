// Memory Card exportieren und importieren.
//
// Play! legt die Memory Cards als normale Ordner ab (pro Spiel ein Ordner mit den Spielstand-Dateien):
//   <DATA_DIR>/vfs/mc0/...   und   <DATA_DIR>/vfs/mc1/...
// Der Export packt beide in eine ZIP-Datei, der Import schreibt sie zurück.

import { PlayModule, DATA_DIR, saveNow } from "./PlayModule";
import { createZip, readZip, ZipEntry } from "./zip";

const CARDS = ["mc0", "mc1"];

function collect(FS: any, dir: string, relative: string, out: ZipEntry[]): void {
    let names: string[] = [];
    try {
        names = FS.readdir(dir);
    } catch (e) {
        return;
    }
    for (const name of names) {
        if (name === "." || name === "..") {
            continue;
        }
        const full = dir + "/" + name;
        const rel = relative + "/" + name;
        const stat = FS.stat(full);
        if (FS.isDir(stat.mode)) {
            collect(FS, full, rel, out);
        } else {
            out.push({ path: rel, data: FS.readFile(full) });
        }
    }
}

// Liefert die ZIP-Datei oder null, wenn keine Spielstände vorhanden sind.
export function exportMemoryCards(): Blob | null {
    const FS = PlayModule.FS;
    const entries: ZipEntry[] = [];
    for (const card of CARDS) {
        collect(FS, `${DATA_DIR}/vfs/${card}`, card, entries);
    }
    if (entries.length === 0) {
        return null;
    }
    return createZip(entries);
}

// Prüft einen Pfad aus der ZIP-Datei. Erlaubt sind nur Dateien unter mc0/ und mc1/ ohne "..".
function safeTarget(path: string): string | null {
    const parts = path.replace(/\\/g, "/").split("/").filter((p) => p.length > 0);
    if (parts.length < 2 || !CARDS.includes(parts[0])) {
        return null;
    }
    for (const part of parts) {
        if (part === "." || part === ".." || part.indexOf("\0") >= 0) {
            return null;
        }
    }
    return `${DATA_DIR}/vfs/${parts.join("/")}`;
}

export async function importMemoryCards(file: File): Promise<{ written: number; skipped: number }> {
    const FS = PlayModule.FS;
    const entries = await readZip(await file.arrayBuffer());
    let written = 0;
    let skipped = 0;
    for (const entry of entries) {
        const target = safeTarget(entry.path);
        if (!target) {
            skipped++;
            continue;
        }
        FS.mkdirTree(target.substring(0, target.lastIndexOf("/")));
        FS.writeFile(target, entry.data);
        written++;
    }
    await saveNow();
    return { written, skipped };
}

export function downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(() => URL.revokeObjectURL(url), 10000);
}
