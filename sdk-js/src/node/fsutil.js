/**
 * Helper filesystem untuk Node — jembatan antara path di disk dan
 * { name, blob } yang dipakai core client.
 */

import fs from "node:fs";
import path from "node:path";
import { Buffer } from "node:buffer";

/**
 * Baca file dari disk menjadi bentuk { name, blob } yang diterima submitJob.
 * @param {string} filePath
 * @returns {{name:string, blob:Blob}}
 */
export function fileFromPath(filePath) {
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) throw new Error(`File tidak ditemukan: ${filePath}`);
  const data = fs.readFileSync(abs);
  return { name: path.basename(abs), blob: new Blob([data]) };
}

/** @param {string[]} paths @returns {Array<{name:string, blob:Blob}>} */
export function filesFromPaths(paths) {
  return paths.map(fileFromPath);
}

/** @param {Blob} blob @returns {Promise<Buffer>} */
export async function blobToBuffer(blob) {
  return Buffer.from(await blob.arrayBuffer());
}

/**
 * Simpan Blob ke file di disk.
 * @param {Blob} blob
 * @param {string} destPath
 * @returns {Promise<string>} path absolut file.
 */
export async function saveBlobToFile(blob, destPath) {
  const abs = path.resolve(destPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, await blobToBuffer(blob));
  return abs;
}
