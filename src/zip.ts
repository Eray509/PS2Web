// Minimaler ZIP-Leser und -Schreiber für den Export und Import der Memory Card.
// Geschrieben wird ohne Kompression ("stored"), gelesen werden "stored" und "deflate"
// (Letzteres über den Browser-Dekompressor, falls vorhanden).

export type ZipEntry = { path: string; data: Uint8Array };

const MAX_TOTAL_BYTES = 256 * 1024 * 1024;

const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) {
            c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        }
        table[n] = c >>> 0;
    }
    return table;
})();

export function crc32(data: Uint8Array): number {
    let crc = 0xffffffff;
    for (let i = 0; i < data.length; i++) {
        crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date: Date): { time: number; day: number } {
    const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
    const day = (Math.max(date.getFullYear() - 1980, 0) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
    return { time, day };
}

export function createZip(entries: ZipEntry[]): Blob {
    if (entries.length > 65000) {
        throw new Error("Zu viele Dateien für den Export.");
    }
    const encoder = new TextEncoder();
    const { time, day } = dosDateTime(new Date());
    const parts: any[] = []; // Uint8Array-Teile fuer den Blob
    const central: Uint8Array[] = [];
    let offset = 0;

    for (const entry of entries) {
        const name = encoder.encode(entry.path);
        const crc = crc32(entry.data);
        const size = entry.data.length;

        const local = new DataView(new ArrayBuffer(30));
        local.setUint32(0, 0x04034b50, true);
        local.setUint16(4, 20, true); // benötigte Version
        local.setUint16(6, 0x0800, true); // Namen als UTF-8
        local.setUint16(8, 0, true); // gespeichert, nicht komprimiert
        local.setUint16(10, time, true);
        local.setUint16(12, day, true);
        local.setUint32(14, crc, true);
        local.setUint32(18, size, true);
        local.setUint32(22, size, true);
        local.setUint16(26, name.length, true);
        local.setUint16(28, 0, true);
        parts.push(new Uint8Array(local.buffer), name, entry.data as BlobPart);

        const header = new DataView(new ArrayBuffer(46));
        header.setUint32(0, 0x02014b50, true);
        header.setUint16(4, 20, true);
        header.setUint16(6, 20, true);
        header.setUint16(8, 0x0800, true);
        header.setUint16(10, 0, true);
        header.setUint16(12, time, true);
        header.setUint16(14, day, true);
        header.setUint32(16, crc, true);
        header.setUint32(20, size, true);
        header.setUint32(24, size, true);
        header.setUint16(28, name.length, true);
        header.setUint16(30, 0, true);
        header.setUint16(32, 0, true);
        header.setUint16(34, 0, true);
        header.setUint16(36, 0, true);
        header.setUint32(38, 0, true);
        header.setUint32(42, offset, true);
        const centralEntry = new Uint8Array(46 + name.length);
        centralEntry.set(new Uint8Array(header.buffer), 0);
        centralEntry.set(name, 46);
        central.push(centralEntry);

        offset += 30 + name.length + size;
    }

    let centralSize = 0;
    for (const item of central) {
        parts.push(item);
        centralSize += item.length;
    }
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(4, 0, true);
    end.setUint16(6, 0, true);
    end.setUint16(8, entries.length, true);
    end.setUint16(10, entries.length, true);
    end.setUint32(12, centralSize, true);
    end.setUint32(16, offset, true);
    end.setUint16(20, 0, true);
    parts.push(new Uint8Array(end.buffer));
    return new Blob(parts, { type: "application/zip" });
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
    const Decompressor = (window as any).DecompressionStream;
    if (!Decompressor) {
        throw new Error("Dieser Browser kann komprimierte ZIP-Dateien nicht entpacken.");
    }
    const stream = new Blob([data as BlobPart]).stream().pipeThrough(new Decompressor("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function readZip(buffer: ArrayBuffer): Promise<ZipEntry[]> {
    const bytes = new Uint8Array(buffer);
    const view = new DataView(buffer);
    const decoder = new TextDecoder("utf-8");

    // Ende des Verzeichnisses suchen (steht in den letzten 64 KiB).
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
        if (view.getUint32(i, true) === 0x06054b50) {
            eocd = i;
            break;
        }
    }
    if (eocd < 0) {
        throw new Error("Das ist keine gültige ZIP-Datei.");
    }
    const count = view.getUint16(eocd + 10, true);
    let pos = view.getUint32(eocd + 16, true);

    const result: ZipEntry[] = [];
    let total = 0;
    for (let n = 0; n < count; n++) {
        if (pos + 46 > bytes.length || view.getUint32(pos, true) !== 0x02014b50) {
            throw new Error("ZIP-Verzeichnis ist beschädigt.");
        }
        const flags = view.getUint16(pos + 8, true);
        const method = view.getUint16(pos + 10, true);
        const crc = view.getUint32(pos + 16, true);
        const compressedSize = view.getUint32(pos + 20, true);
        const size = view.getUint32(pos + 24, true);
        const nameLength = view.getUint16(pos + 28, true);
        const extraLength = view.getUint16(pos + 30, true);
        const commentLength = view.getUint16(pos + 32, true);
        const localOffset = view.getUint32(pos + 42, true);
        const name = decoder.decode(bytes.subarray(pos + 46, pos + 46 + nameLength));
        pos += 46 + nameLength + extraLength + commentLength;

        if (name.endsWith("/")) {
            continue; // Ordner werden beim Schreiben angelegt
        }
        if (flags & 1) {
            throw new Error("Verschlüsselte ZIP-Dateien werden nicht unterstützt.");
        }
        total += size;
        if (total > MAX_TOTAL_BYTES) {
            throw new Error("Die ZIP-Datei ist zu groß.");
        }
        if (localOffset + 30 > bytes.length || view.getUint32(localOffset, true) !== 0x04034b50) {
            throw new Error("ZIP-Datei ist beschädigt.");
        }
        const dataStart = localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
        const raw = bytes.subarray(dataStart, dataStart + compressedSize);
        let data: Uint8Array;
        if (method === 0) {
            data = raw;
        } else if (method === 8) {
            data = await inflateRaw(raw);
        } else {
            throw new Error("Nicht unterstütztes ZIP-Verfahren.");
        }
        if (data.length !== size || crc32(data) !== crc) {
            throw new Error(`Prüfsumme stimmt nicht: ${name}`);
        }
        result.push({ path: name, data });
    }
    return result;
}
