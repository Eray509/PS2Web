// Liefert dem Emulator die Daten der ISO-Datei.
//
// Der Emulator-Thread ruft read() pro Sektor-Anfrage auf und wartet danach per Polling auf isDone().
// Die Originalversion hat dafür jedes Mal einen asynchronen Blob-Zugriff gestartet, das heisst
// bei jedem Lesezugriff ein Warten auf den Browser. Diese Version hält grosse Blöcke im Speicher
// (LRU-Cache) und lädt bei sequentiellem Lesen die nächsten Blöcke im Voraus. Trifft ein Zugriff
// den Cache, ist er sofort fertig.

const BLOCK_SIZE = 1024 * 1024; // 1 MiB
const MAX_CACHED_BLOCKS = 96; // ca. 96 MiB
const READ_AHEAD_BLOCKS = 3;

export default class DiscDevice {
    module: any;
    doneFlag: boolean;
    file: File | null;

    private cache: Map<number, Uint8Array>;
    private pending: Map<number, Promise<Uint8Array>>;
    private generation: number;

    constructor(module: any) {
        this.module = module;
        this.doneFlag = false;
        this.file = null;
        this.cache = new Map();
        this.pending = new Map();
        this.generation = 0;
    }

    private touch(index: number, data: Uint8Array) {
        // Map behält die Einfügereihenfolge, neu einfügen = zuletzt benutzt.
        this.cache.delete(index);
        this.cache.set(index, data);
        while (this.cache.size > MAX_CACHED_BLOCKS) {
            const oldest = this.cache.keys().next().value as number;
            this.cache.delete(oldest);
        }
    }

    private loadBlock(index: number): Promise<Uint8Array> {
        const cached = this.cache.get(index);
        if (cached) {
            this.touch(index, cached);
            return Promise.resolve(cached);
        }
        const running = this.pending.get(index);
        if (running) {
            return running;
        }
        const file = this.file;
        if (!file) {
            return Promise.reject(new Error("No file set."));
        }
        const generation = this.generation;
        const start = index * BLOCK_SIZE;
        const promise = file
            .slice(start, Math.min(start + BLOCK_SIZE, file.size))
            .arrayBuffer()
            .then((buffer: ArrayBuffer) => {
                const data = new Uint8Array(buffer);
                if (generation === this.generation) {
                    this.touch(index, data);
                }
                return data;
            })
            .finally(() => {
                this.pending.delete(index);
            });
        this.pending.set(index, promise);
        return promise;
    }

    private copyOut(dstPtr: number, offset: number, size: number): void {
        const heap: Uint8Array = this.module.HEAPU8;
        let written = 0;
        while (written < size) {
            const position = offset + written;
            const index = Math.floor(position / BLOCK_SIZE);
            const block = this.cache.get(index);
            if (!block) {
                break; // Ende der Datei
            }
            const inBlock = position - index * BLOCK_SIZE;
            const count = Math.min(block.length - inBlock, size - written);
            if (count <= 0) {
                break;
            }
            heap.set(block.subarray(inBlock, inBlock + count), dstPtr + written);
            written += count;
        }
    }

    read(dstPtr: number, offset: number, size: number) {
        if (!this.file) {
            throw new Error("No file set.");
        }
        this.doneFlag = false;
        const first = Math.floor(offset / BLOCK_SIZE);
        const last = Math.floor((offset + Math.max(size, 1) - 1) / BLOCK_SIZE);
        const maxIndex = Math.floor((this.file.size - 1) / BLOCK_SIZE);

        const missing: Promise<Uint8Array>[] = [];
        for (let index = first; index <= last && index <= maxIndex; ++index) {
            if (this.cache.has(index)) {
                this.touch(index, this.cache.get(index)!);
            } else {
                missing.push(this.loadBlock(index));
            }
        }

        // Nächste Blöcke schon einmal anfordern, während der Emulator weiterläuft.
        for (let ahead = 1; ahead <= READ_AHEAD_BLOCKS; ++ahead) {
            const index = last + ahead;
            if (index <= maxIndex && !this.cache.has(index) && !this.pending.has(index)) {
                this.loadBlock(index).catch(() => undefined);
            }
        }

        if (missing.length === 0) {
            this.copyOut(dstPtr, offset, size);
            this.doneFlag = true;
            return;
        }
        const generation = this.generation;
        Promise.all(missing).then(() => {
            if (generation !== this.generation) {
                return;
            }
            this.copyOut(dstPtr, offset, size);
            this.doneFlag = true;
        });
    }

    getFileSize() {
        if (!this.file) {
            throw new Error("No file set.");
        }
        return this.file.size;
    }

    isDone() {
        return this.doneFlag;
    }

    setFile(file: File) {
        this.generation++;
        this.cache.clear();
        this.pending.clear();
        this.file = file;
        this.doneFlag = false;
    }
}
