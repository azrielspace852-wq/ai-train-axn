/**
 * Ekstraktor ZIP minimal — murni Node (node:zlib untuk DEFLATE, node:fs
 * untuk tulis file). Tanpa dependensi eksternal.
 *
 * Mendukung method 0 (store) dan 8 (deflate) — dua metode yang dipakai
 * oleh `shutil.make_archive` (Python) di server AITTrain.
 * Dilengkapi proteksi path-traversal.
 */

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;

function findEocd(buf) {
  // EOCD minimal 22 byte; comment maks 64KB. Cari dari belakang.
  const maxComment = 0xffff;
  const start = Math.max(0, buf.length - (22 + maxComment));
  for (let i = buf.length - 22; i >= start; i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) return i;
  }
  throw new Error("Bukan file ZIP valid (EOCD tidak ditemukan).");
}

/**
 * Ekstrak buffer ZIP ke direktori tujuan.
 * @param {Buffer} zipBuf
 * @param {string} destDir
 * @returns {string[]} daftar path file yang diekstrak (absolut).
 */
export function extractZip(zipBuf, destDir) {
  const dest = path.resolve(destDir);
  fs.mkdirSync(dest, { recursive: true });
  const destRoot = dest + path.sep;

  const eocd = findEocd(zipBuf);
  const totalEntries = zipBuf.readUInt16LE(eocd + 10);
  const cdOffset = zipBuf.readUInt32LE(eocd + 16);

  const extracted = [];
  let pos = cdOffset;
  for (let n = 0; n < totalEntries; n++) {
    if (zipBuf.readUInt32LE(pos) !== SIG_CENTRAL) {
      throw new Error("Central directory ZIP rusak pada entry #" + n);
    }
    const method = zipBuf.readUInt16LE(pos + 10);
    const compSize = zipBuf.readUInt32LE(pos + 20);
    const uncompSize = zipBuf.readUInt32LE(pos + 24);
    const nameLen = zipBuf.readUInt16LE(pos + 28);
    const extraLen = zipBuf.readUInt16LE(pos + 30);
    const commentLen = zipBuf.readUInt16LE(pos + 32);
    const localOffset = zipBuf.readUInt32LE(pos + 42);
    const name = zipBuf.toString("utf8", pos + 46, pos + 46 + nameLen);
    pos += 46 + nameLen + extraLen + commentLen;

    // Cari data: baca local header untuk tahu panjang extra field-nya.
    const localNameLen = zipBuf.readUInt16LE(localOffset + 26);
    const localExtraLen = zipBuf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const compData = zipBuf.subarray(dataStart, dataStart + compSize);

    let content;
    if (method === 0) {
      content = Buffer.from(compData);
    } else if (method === 8) {
      content = zlib.inflateRawSync(compData);
    } else {
      throw new Error(`Metode kompresi ZIP ${method} tidak didukung (hanya store/deflate).`);
    }

    // Proteksi path-traversal: resolve harus di dalam destRoot.
    const outPath = path.resolve(dest, name);
    if (outPath !== dest && !outPath.startsWith(destRoot)) {
      throw new Error(`Path tidak aman dalam zip (path traversal): ${name}`);
    }

    if (name.endsWith("/")) {
      fs.mkdirSync(outPath, { recursive: true });
      continue;
    }
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, content);
    extracted.push(outPath);
  }
  return extracted;
}
