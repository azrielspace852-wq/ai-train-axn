/**
 * Penulis ZIP in-memory (metode STORE / tanpa kompresi) — murni JS,
 * tanpa dependensi. Cukup untuk mengemas project source code agar bisa
 * di-upload sebagai `project_zip` (server hanya mengekstrak, kompresi
 * tidak penting untuk ukuran source).
 *
 * Format: ZIP versi 2.0, method 0 (store), CRC32 diisi. Kompatibel dengan
 * Python zipfile / unix unzip / browser decompression-stream.
 */

import { crc32 } from "./crc32.js";
import fs from "node:fs";
import path from "node:path";

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;

/**
 * @typedef {Object} ZipEntry
 * @property {string} path — path dalam zip (gunakan '/', jangan diawali '/')
 * @property {Buffer|string|Uint8Array} data
 */

/**
 * Buat buffer ZIP dari daftar entry.
 * @param {ZipEntry[]|Record<string,Buffer|string>|Map<string,Buffer|string>} entries
 * @returns {Buffer}
 */
export function zipFiles(entries) {
  let list;
  if (entries instanceof Map) {
    list = [...entries.entries()].map(([p, data]) => ({ path: p, data }));
  } else if (Array.isArray(entries)) {
    list = entries;
  } else {
    list = Object.entries(entries).map(([p, data]) => ({ path: p, data }));
  }

  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const entry of list) {
    const name = entry.path.replace(/\\/g, "/").replace(/^\/+/, "");
    if (!name) continue;
    const data = Buffer.isBuffer(entry.data)
      ? entry.data
      : Buffer.from(entry.data, typeof entry.data === "string" ? "utf8" : undefined);
    const crc = crc32(data);
    const nameBuf = Buffer.from(name, "utf8");

    // Local file header (30 byte + nama + data)
    const local = Buffer.alloc(30);
    local.writeUInt32LE(SIG_LOCAL, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(0, 8); // method = store
    local.writeUInt16LE(0, 10); // mod time
    local.writeUInt16LE(0x21, 12); // mod date (dummy, valid DOS date)
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18); // compressed size
    local.writeUInt32LE(data.length, 22); // uncompressed size
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra len
    locals.push(local, nameBuf, data);

    // Central directory header (46 byte + nama)
    const central = Buffer.alloc(46);
    central.writeUInt32LE(SIG_CENTRAL, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0, 8); // flags
    central.writeUInt16LE(0, 10); // method
    central.writeUInt16LE(0, 12); // mod time
    central.writeUInt16LE(0x21, 14); // mod date
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30); // extra len
    central.writeUInt16LE(0, 32); // comment len
    central.writeUInt16LE(0, 34); // disk number start
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(0, 38); // external attrs
    central.writeUInt32LE(offset, 42); // offset local header
    centrals.push(central, nameBuf);

    offset += local.length + nameBuf.length + data.length;
  }

  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(SIG_EOCD, 0);
  eocd.writeUInt16LE(0, 4); // disk number
  eocd.writeUInt16LE(0, 6); // disk with cd
  eocd.writeUInt16LE(list.length, 8); // entries this disk
  eocd.writeUInt16LE(list.length, 10); // total entries
  eocd.writeUInt32LE(centralBuf.length, 12); // cd size
  eocd.writeUInt32LE(offset, 16); // cd offset
  eocd.writeUInt16LE(0, 20); // comment len

  return Buffer.concat([...locals, centralBuf, eocd]);
}

const DEFAULT_IGNORE = new Set(["node_modules", ".git", ".DS_Store", "__pycache__", ".venv", "venv"]);

/**
 * Rekursif membaca direktori dan mengemasnya menjadi buffer ZIP.
 * @param {string} dir — path direktori sumber.
 * @param {Object} [opts]
 * @param {string[]} [opts.ignore] — nama direktori/file yang diabaikan (cocokkan basename).
 * @param {string} [opts.prefix] — prefix path di dalam zip (mis. "myproject/").
 * @returns {Buffer}
 */
export function zipDirectory(dir, { ignore, prefix = "" } = {}) {
  const ignoreSet = new Set(ignore ? [...DEFAULT_IGNORE, ...ignore] : DEFAULT_IGNORE);
  const root = path.resolve(dir);
  const entries = [];
  const seen = new Set();

  const walk = (absDir, relPrefix) => {
    const real = fs.realpathSync(absDir);
    if (seen.has(real)) return; // cegah loop symlink
    seen.add(real);
    for (const ent of fs.readdirSync(absDir, { withFileTypes: true })) {
      if (ignoreSet.has(ent.name)) continue;
      const abs = path.join(absDir, ent.name);
      const rel = relPrefix ? `${relPrefix}/${ent.name}` : ent.name;
      if (ent.isDirectory()) {
        walk(abs, rel);
      } else if (ent.isFile()) {
        entries.push({ path: rel, data: fs.readFileSync(abs) });
      }
      // symlink & lain diabaikan (hindari path traversal / loop)
    }
  };
  walk(root, "");

  const pre = prefix ? prefix.replace(/\/+$/, "") + "/" : "";
  return zipFiles(entries.map((e) => ({ path: pre + e.path, data: e.data })));
}
