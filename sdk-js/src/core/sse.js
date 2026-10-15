/**
 * Parser SSE (Server-Sent Events) di atas fetch + ReadableStream.
 *
 * Kenapa tidak pakai EventSource bawaan browser?
 *   1. EventSource TIDAK mendukung header custom (X-API-Key), sehingga
 *      tidak bisa autentikasi ke server AITTrain.
 *   2. fetch + ReadableStream bekerja SERAGAM di browser modern DAN
 *      Node.js 18+ (global fetch), sehingga satu implementasi untuk dua
 *      lingkungan.
 *
 * Format SSE dari server AITTrain:
 *   data: {"line": "..."}\n\n           -> event "message"
 *   event: end\n
 *   data: {<status job akhir>}\n\n       -> event "end"
 */

import { raiseForStatus } from "./exceptions.js";

/**
 * Stream SSE dari url.
 * @param {string} url
 * @param {object} opts
 * @param {Record<string,string>} [opts.headers]
 * @param {AbortSignal} [opts.signal]
 * @param {(evt:{event:string,data:string})=>void} opts.onEvent — dipanggil per event SSE yang lengkap.
 * @returns {Promise<void>} resolve saat stream ditutup server.
 */
export async function streamSSE(url, { headers = {}, signal, onEvent, fetchImpl } = {}) {
  if (typeof onEvent !== "function") {
    throw new Error("streamSSE membutuhkan callback onEvent(event, data)");
  }
  const requestFetch = fetchImpl || (typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : undefined);
  if (!requestFetch) throw new Error("Lingkungan tidak menyediakan fetch.");
  const resp = await requestFetch(url, {
    headers: { Accept: "text/event-stream", ...headers },
    signal,
    // cache: no-store agar buffer replay tidak ter-cache
    cache: "no-store",
  });
  await raiseForStatus(resp);

  if (!resp.body || typeof resp.body.getReader !== "function") {
    throw new Error("Response body tidak bisa di-stream (lingkungan tidak mendukung ReadableStream).");
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buf = "";
  let eventType = "message";
  let dataBuf = [];

  const dispatch = () => {
    // SSE spec: jika tidak ada baris data, event tidak didispatch.
    if (dataBuf.length === 0) {
      eventType = "message";
      return;
    }
    const data = dataBuf.join("\n");
    try {
      onEvent({ event: eventType, data });
    } catch (e) {
      // Error di callback pengguna tidak boleh memutus stream.
      // eslint-disable-next-line no-console
      console.error("[aittrain] error di callback onEvent:", e);
    }
    eventType = "message";
    dataBuf = [];
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n")) >= 0) {
        let line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        if (line.endsWith("\r")) line = line.slice(0, -1);

        if (line === "") {
          dispatch();
          continue;
        }
        if (line.startsWith(":")) continue; // komentar / keep-alive
        if (line.startsWith("event:")) {
          eventType = line.slice(6).trim();
          continue;
        }
        if (line.startsWith("data:")) {
          // SPEC: satu spasi setelah "data:" diabaikan
          let payload = line.slice(5);
          if (payload.startsWith(" ")) payload = payload.slice(1);
          dataBuf.push(payload);
          continue;
        }
        // baris "id:" / "retry:" / lain — abaikan
      }
    }
    // EOF tanpa trailing newline — dispatch sisa jika ada.
    if (dataBuf.length > 0) dispatch();
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* ignore */
    }
  }
}
