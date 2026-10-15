/**
 * Klien utama AITTrain (JavaScript).
 *
 * Runtime-agnostic: bekerja di browser modern DAN Node.js 18+
 * (mengandalkan global fetch, FormData, Blob, TextDecoder — semua standar web).
 *
 * Untuk kemudahan di Node (baca file dari disk, zip direktori, ekstrak hasil,
 * CLI), gunakan sub-path `aittrain-sdk/node`.
 * Untuk browser, cukup impor dari `aittrain-sdk` (atau bundle IIFE global AITTrain).
 */

import {
  AITTrainError,
  ArtifactNotFoundError,
  JobCancelledError,
  TimeoutError,
  raiseForStatus,
} from "./exceptions.js";
import { streamSSE } from "./sse.js";
import { anySignal, getEnvVar, normalizeFile, sleep } from "./util.js";

export const DEFAULT_BASE_URL = "https://ai-train.axn.cc.cd/api/";
export const SDK_VERSION = "1.3.0";

const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);

/**
 * @typedef {Object} JobStatusInfo
 * @property {string} job_id
 * @property {"queued"|"running"|"completed"|"failed"|"cancelled"} status
 * @property {string} entrypoint
 * @property {number} created_at
 * @property {number|null} started_at
 * @property {number|null} finished_at
 * @property {number|null} exit_code
 * @property {string|null} error
 * @property {number|null} queue_position
 * @property {boolean} artifact_ready
 */

export class AITTrainClient {
  /**
   * @param {Object} opts
   * @param {string} [opts.apiKey] — API key. Jika tidak diisi, dibaca dari env AITTRAIN_API_KEY (Node).
   * @param {string} [opts.baseUrl] — URL server (default domain Cloudflare Tunnel).
   * @param {number} [opts.timeout] — timeout request dalam ms (default 60000). Upload besar otomatis dinaikkan.
   * @param {typeof fetch} [opts.fetchImpl] — override fetch (untuk testing / proxy).
   */
  constructor({ apiKey, baseUrl = DEFAULT_BASE_URL, timeout = 60_000, fetchImpl } = {}) {
    this.apiKey = apiKey || getEnvVar("AITTRAIN_API_KEY") || "";
    if (!this.apiKey) {
      throw new AITTrainError(
        "API key wajib disediakan (opsi apiKey) atau lewat env AITTRAIN_API_KEY."
      );
    }
    this.baseUrl = String(baseUrl).replace(/\/+$/, "");
    this.timeout = timeout;
    this._fetch = fetchImpl || (typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : undefined);
    if (!this._fetch) {
      throw new AITTrainError(
        "Lingkungan tidak menyediakan fetch global. Gunakan Node >= 18 atau browser modern, " +
          "atau berikan fetchImpl."
      );
    }
  }

  // ------------------------------------------------------------------
  // Internal HTTP helper
  // ------------------------------------------------------------------
  _headers(extra = {}) {
    return { "X-API-Key": this.apiKey, ...extra };
  }

  async _req(path, { method = "GET", body, headers = {}, signal, timeout } = {}) {
    const ctrl = new AbortController();
    const ms = timeout ?? this.timeout;
    const timer = setTimeout(() => ctrl.abort(new TimeoutError(`Request timeout setelah ${ms}ms`)), ms);
    try {
      const resp = await this._fetch(this.baseUrl + path, {
        method,
        body,
        headers: this._headers(headers),
        signal: anySignal(signal, ctrl.signal),
      });
      return resp;
    } catch (err) {
      if (err instanceof TimeoutError) throw err;
      if (err && err.name === "AbortError") {
        if (ctrl.signal.aborted) throw new TimeoutError(`Request timeout setelah ${ms}ms`);
        throw err;
      }
      throw new AITTrainError(`Gagal menghubungi server: ${err && err.message ? err.message : err}`, {
        cause: err,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  // ------------------------------------------------------------------
  // Health
  // ------------------------------------------------------------------
  /** @returns {Promise<{status:string, draining:boolean, queued:number}>} */
  async health() {
    // /healthz publik — tidak butuh header, tapi kirim saja tidak masalah.
    const r = await this._req("/healthz", { headers: {} });
    await raiseForStatus(r);
    return r.json();
  }

  // ------------------------------------------------------------------
  // Submit job
  // ------------------------------------------------------------------
  /**
   * Kirim job training ke server.
   * @param {Object} opts
   * @param {string} [opts.entrypoint="train.py"] — nama file entrypoint (relatif terhadap workdir).
   * @param {Array} [opts.files=[]] — file individual. Tiap item: File | {name, blob} | {name, data}.
   * @param {Object|File|Blob} [opts.projectZip] — (opsional) zip seluruh project. Bentuk sama seperti file.
   * @param {Record<string,string>} [opts.env={}] — env var tambahan untuk skrip pengguna.
   * @param {AbortSignal} [opts.signal]
   * @returns {Promise<{job_id:string, status:string, entrypoint:string}>}
   */
  async submitJob({ entrypoint = "train.py", files = [], projectZip = null, env = {}, signal } = {}) {
    const fd = new FormData();
    fd.set("entrypoint", String(entrypoint));
    fd.set("env_json", JSON.stringify(env || {}));

    for (const f of files) {
      const { name, blob } = normalizeFile(f);
      fd.append("files", blob, name);
    }
    if (projectZip) {
      const { name, blob } = normalizeFile(projectZip);
      fd.set("project_zip", blob, name || "project.zip");
    }

    // Upload bisa besar — timeout minimal 10 menit.
    const r = await this._req("/train", {
      method: "POST",
      body: fd,
      headers: {}, // JANGAN set Content-Type manual; browser/fetch harus isi boundary multipart.
      signal,
      timeout: Math.max(this.timeout, 10 * 60_000),
    });
    await raiseForStatus(r);
    return r.json();
  }

  // ------------------------------------------------------------------
  // Status & kontrol
  // ------------------------------------------------------------------
  /** @param {string} jobId @returns {Promise<JobStatusInfo>} */
  async getStatus(jobId) {
    const r = await this._req(`/jobs/${encodeURIComponent(jobId)}/status`);
    await raiseForStatus(r);
    return r.json();
  }

  /**
   * List semua job (terbaru dulu).
   * @param {Object} [opts]
   * @param {number} [opts.limit=100]
   * @returns {Promise<{count:number, jobs:JobStatusInfo[]}>}
   */
  async listJobs({ limit = 100 } = {}) {
    const r = await this._req(`/jobs?limit=${Number(limit) || 100}`);
    await raiseForStatus(r);
    return r.json();
  }

  /**
   * Batalkan job (queued → langsung cancelled; running → di-kill server).
   * @param {string} jobId
   * @returns {Promise<{job_id:string, status:string, cancelled:boolean, detail?:string}>}
   */
  async cancelJob(jobId) {
    const r = await this._req(`/jobs/${encodeURIComponent(jobId)}/cancel`, { method: "POST" });
    await raiseForStatus(r);
    return r.json();
  }

  /** @param {string} jobId @returns {Promise<boolean>} */
  async isArtifactReady(jobId) {
    const st = await this.getStatus(jobId);
    return Boolean(st.artifact_ready);
  }

  /**
   * Poll status sampai job mencapai status terminal (completed/failed/cancelled).
   * @param {string} jobId
   * @param {Object} [opts]
   * @param {number} [opts.pollInterval=5000] — ms.
   * @param {number} [opts.timeout] — maksimal menunggu (ms). Default: tanpa batas.
   * @param {AbortSignal} [opts.signal]
   * @returns {Promise<JobStatusInfo>} status akhir.
   */
  async waitUntilFinished(jobId, { pollInterval = 5000, timeout, signal } = {}) {
    const deadline = timeout ? Date.now() + timeout : null;
    for (;;) {
      const st = await this.getStatus(jobId);
      if (TERMINAL_STATUSES.has(st.status)) return st;
      if (deadline && Date.now() > deadline) {
        throw new TimeoutError(`Job ${jobId} belum selesai dalam ${timeout}ms`);
      }
      await sleep(pollInterval, signal);
    }
  }

  // ------------------------------------------------------------------
  // Streaming log (SSE via fetch)
  // ------------------------------------------------------------------
  /**
   * Stream log real-time sampai job selesai.
   * @param {string} jobId
   * @param {Object} [opts]
   * @param {(line:string)=>void} [opts.onLine] — dipanggil per baris log (termasuk baris buffered).
   * @param {(final:JobStatusInfo)=>void} [opts.onEnd] — dipanggil saat event `end` diterima.
   * @param {AbortSignal} [opts.signal] — untuk menghentikan stream (job di server tetap berjalan).
   * @returns {Promise<JobStatusInfo>} status akhir job (dari event `end`).
   */
  async streamLogs(jobId, { onLine, onEnd, signal } = {}) {
    const url = `${this.baseUrl}/jobs/${encodeURIComponent(jobId)}/logs`;
    let finalStatus = { job_id: jobId, status: "unknown" };
    let ended = false;

    await streamSSE(url, {
      headers: this._headers({ Accept: "text/event-stream" }),
      fetchImpl: this._fetch,
      signal,
      onEvent: ({ event, data }) => {
        if (event === "end") {
          ended = true;
          try {
            finalStatus = JSON.parse(data);
          } catch {
            /* biarkan default */
          }
          if (typeof onEnd === "function") onEnd(finalStatus);
          return;
        }
        // event default "message": payload = {"line": "..."}
        let text = data;
        try {
          const parsed = JSON.parse(data);
          if (parsed && typeof parsed.line === "string") text = parsed.line;
        } catch {
          /* data mentah */
        }
        if (typeof onLine === "function") onLine(text);
        else if (typeof console !== "undefined" && console.log) {
          // Default: cetak ke console tanpa trailing newline tambahan.
          process.stdout ? process.stdout.write(text) : console.log(text);
        }
      },
    });

    // Jika stream terputus sebelum event `end` (mis. koneksi drop), poll status akhir.
    if (!ended) {
      try {
        finalStatus = await this.getStatus(jobId);
      } catch {
        /* abaikan */
      }
    }
    return finalStatus;
  }

  // ------------------------------------------------------------------
  // Download artefak
  // ------------------------------------------------------------------
  /**
   * Unduh artefak .zip sebagai Blob.
   * Di browser: gunakan saveBlob() (sub-path browser) atau buat object URL sendiri.
   * Di Node: gunakan downloadToFile() (sub-path node) untuk simpan ke disk + ekstrak.
   * @param {string} jobId
   * @param {Object} [opts]
   * @param {AbortSignal} [opts.signal]
   * @returns {Promise<Blob>}
   */
  async downloadArtifact(jobId, { signal } = {}) {
    const r = await this._req(`/jobs/${encodeURIComponent(jobId)}/download`, {
      signal,
      timeout: Math.max(this.timeout, 5 * 60_000),
    });
    if (r.status === 404) {
      let detail = "";
      try {
        detail = (await r.json()).detail;
      } catch {
        /* ignore */
      }
      throw new ArtifactNotFoundError(
        `Artefak untuk job ${jobId} belum tersedia. ${detail}`.trim()
      );
    }
    await raiseForStatus(r, { notFoundClass: ArtifactNotFoundError });
    return r.blob();
  }

  /**
   * Tunggu sampai artefak siap, lalu unduh sebagai Blob.
   * @param {string} jobId
   * @param {Object} [opts]
   * @param {number} [opts.pollInterval=10000] — ms.
   * @param {number} [opts.timeout] — maks menunggu (ms).
   * @param {AbortSignal} [opts.signal]
   * @returns {Promise<Blob>}
   */
  async downloadAndWait(jobId, { pollInterval = 10_000, timeout, signal } = {}) {
    const deadline = timeout ? Date.now() + timeout : null;
    for (;;) {
      const st = await this.getStatus(jobId);
      if (st.artifact_ready) break;
      if (st.status === "failed") {
        throw new ArtifactNotFoundError(
          `Job ${jobId} gagal; tidak ada artefak. Error: ${st.error || "-"}`
        );
      }
      if (st.status === "cancelled") {
        throw new JobCancelledError(`Job ${jobId} dibatalkan; tidak ada artefak.`);
      }
      if (deadline && Date.now() > deadline) {
        throw new TimeoutError(`Artefak job ${jobId} tidak siap dalam ${timeout}ms`);
      }
      await sleep(pollInterval, signal);
    }
    return this.downloadArtifact(jobId, { signal });
  }
}

export default AITTrainClient;
