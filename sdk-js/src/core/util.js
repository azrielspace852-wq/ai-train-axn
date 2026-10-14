/**
 * Utilitas runtime-agnostic (browser + Node 18+).
 * Tidak boleh mengimpor node:* di sini.
 */

/**
 * Gabungkan beberapa AbortSignal menjadi satu. Jika salah satu abort,
 * sinyal hasil juga abort. Fallback jika AbortSignal.any belum tersedia.
 */
export function anySignal(...signals) {
  const valid = signals.filter(Boolean);
  if (valid.length === 0) return undefined;
  if (valid.length === 1) return valid[0];
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.any === "function") {
    return AbortSignal.any(valid);
  }
  const ctrl = new AbortController();
  for (const s of valid) {
    if (s.aborted) {
      ctrl.abort(s.reason);
      break;
    }
    s.addEventListener("abort", () => ctrl.abort(s.reason), { once: true });
  }
  return ctrl.signal;
}

export function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    if (signal) {
      if (signal.aborted) {
        clearTimeout(t);
        reject(signal.reason);
        return;
      }
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(t);
          reject(signal.reason);
        },
        { once: true }
      );
    }
  });
}

/**
 * Normalisasi input file ke { name, blob }.
 * Menerima:
 *   - File / Blob yang punya properti .name
 *   - { name, blob }
 *   - { name, data } di mana data = string | Uint8Array | ArrayBuffer | Buffer
 *   - { name, path } (hanya Node — ditangani di ekstensi node, bukan di sini)
 */
export function normalizeFile(input) {
  if (!input) throw new Error("File input tidak boleh kosong");
  // Sudah berupa Blob/File dengan nama
  if (typeof Blob !== "undefined" && input instanceof Blob) {
    const name = input.name || "upload.bin";
    return { name, blob: input };
  }
  if (typeof input === "string") {
    throw new Error(
      "Path string tidak didukung di core (gunakan ekstensi Node: fileFromPath). " +
        "Berikan objek { name, blob } atau { name, data }."
    );
  }
  const { name, blob, data } = input;
  if (!name) throw new Error("Setiap file harus punya properti 'name' (nama file di server).");
  if (blob instanceof Blob) return { name, blob };
  if (data !== undefined && data !== null) {
    const buf =
      typeof data === "string"
        ? new TextEncoder().encode(data)
        : data instanceof ArrayBuffer
        ? new Uint8Array(data)
        : data; // Uint8Array / Buffer
    return { name, blob: new Blob([buf]) };
  }
  throw new Error(
    `File '${name}' tidak memiliki blob/data. Gunakan { name, blob } atau { name, data }.`
  );
}

/** Deteksi lingkungan Node (untuk fallback env var). */
export function getEnvVar(name) {
  if (typeof process !== "undefined" && process.env && typeof process.env[name] === "string") {
    return process.env[name];
  }
  return undefined;
}
