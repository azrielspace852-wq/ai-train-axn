/**
 * Helper khusus browser. Re-export semua simbol inti + saveBlob untuk
 * memicu unduhan file dari Blob via object URL + anchor click.
 */
export * from "../index.js";

/**
 * Simpan Blob ke file di browser (memicu dialog "Save As" / unduhan otomatis).
 * @param {Blob} blob
 * @param {string} filename
 */
export function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || "download.bin";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Bebaskan object URL setelah navigasi unduhan dimulai.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Unduh artefak job lalu langsung simpan ke file di browser.
 * @param {import("../core/client.js").AITTrainClient} client
 * @param {string} jobId
 * @param {string} [filename] — default <job_id>.zip
 */
export async function downloadAndSave(client, jobId, filename) {
  const blob = await client.downloadAndWait(jobId);
  saveBlob(blob, filename || `${jobId}.zip`);
}
