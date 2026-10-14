# aittrain-sdk (JavaScript)

SDK JavaScript **tanpa dependensi runtime** untuk platform [AITTrain](../README.md) — kirim kode training, pantau log real-time (SSE), unduh artefak. Satu kode dasar berjalan di **Node.js 18+** dan **browser modern** (dipanggil langsung dari file `.js`, tanpa Node.js, tanpa server/backend).

> Filosofi platform: *zero model constraints*. Server hanya mengeksekusi entrypoint Anda, menangkap stdout untuk telemetri, dan meng-zip `$AITT_OUTPUT_DIR`. SDK tidak peduli framework apa yang Anda pakai.

---

## Tiga Cara Pakai

| Lingkungan | Entry point | File |
|---|---|---|
| **Node.js** (backend/script) | `aittrain-sdk/node` → `NodeAITTrainClient` | `dist/node.cjs` / `src/node/index.js` |
| **CLI** | `aittrain-js` | `dist/cli.cjs` (executable) |
| **Web / JS langsung tanpa server** | `aittrain-sdk/browser` → `AITTrainClient` + `saveBlob` | **`dist/aittrain.browser.js`** (ESM) atau `dist/aittrain.min.js` (IIFE) |

Domain default server: **`https://ai-train.axn.cc.cd`**.

---

## Instalasi

```bash
npm install aittrain-sdk          # (setelah dipublish) — atau dari source: npm install ./sdk-js
```

```js
// ESM (browser / Node)
import { AITTrainClient } from "aittrain-sdk";
// Node dengan helper filesystem / zip / ekstrak:
import { NodeAITTrainClient } from "aittrain-sdk/node";
// Browser dengan helper saveBlob:
import { AITTrainClient, saveBlob } from "aittrain-sdk/browser";
// CommonJS:
const { AITTrainClient } = require("aittrain-sdk");
const { NodeAITTrainClient } = require("aittrain-sdk/node");
```

**Persyaratan:** Node ≥ 18 (global `fetch`, `FormData`, `Blob`, `ReadableStream`). Browser: Chrome/Edge/Firefox/Safari modern.

---

## Quick Start — Browser (dipanggil dari file `.js` langsung, TANPA server/backend)

**Cara utama (ESM, tanpa build step):** salin `dist/aittrain.browser.js` ke proyek web Anda, lalu import di file `.js` Anda:

```js
// app.js — kode web Anda. Muat dari HTML dengan: <script type="module" src="app.js"></script>
import { AITTrainClient, saveBlob } from "./aittrain.browser.js";

const client = new AITTrainClient({ apiKey: "...", baseUrl: "https://ai-train.axn.cc.cd" });

// files = FileList dari <input type="file" multiple> (diterima langsung SDK)
const job = await client.submitJob({
  entrypoint: "train.py",
  files: Array.from(inputEl.files),
  env: { BATCH_SIZE: "32" },
});

// Stream log real-time ke elemen <pre>
await client.streamLogs(job.job_id, { onLine: (line) => (preEl.textContent += line) });

// Unduh artefak & trigger "Save As" browser
const blob = await client.downloadAndWait(job.job_id);
saveBlob(blob, job.job_id + ".zip");
```

**Alternatif (IIFE, tanpa import):**
```html
<script src="dist/aittrain.min.js"></script>
<script>
  const client = new AITTrain.AITTrainClient({ apiKey: "...", baseUrl: "https://ai-train.axn.cc.cd" });
  // ... API sama persis: client.submitJob(), client.streamLogs(), AITTrain.saveBlob()
</script>
```

Contoh kode web lengkap: [`examples/browser/app.js`](examples/browser/app.js) (logika SDK murni di `.js`); [`examples/browser/index.html`](examples/browser/index.html) hanya loader UI.

---

## Quick Start — Node.js

```js
import { NodeAITTrainClient } from "aittrain-sdk/node";

const client = new NodeAITTrainClient({
  // apiKey diambil otomatis dari env AITTRAIN_API_KEY jika tidak diisi
  baseUrl: "https://ai-train.axn.cc.cd",
});

// 1. Submit — upload file dari disk, atau zip direktori project in-memory
const job = await client.submitJobFromPaths({
  entrypoint: "train.py",
  files: ["train.py", "dataset.csv", "config.json"],
  // atau: projectDir: "./my-project",   <- otomatis di-zip & dikirim sebagai project_zip
  env: { BATCH_SIZE: "32", EPOCHS: "10" },
});

// 2. Stream log real-time (resolve saat job selesai)
const final = await client.streamLogs(job.job_id, { onLine: (l) => process.stdout.write(l) });

// 3. Unduh & ekstrak artefak .zip (otomatis tunggu sampai siap)
if (final.status === "completed") {
  const outDir = await client.downloadToFile(job.job_id, "./results", { extract: true });
}
```

---

## CLI

```bash
npm link        # atau: node dist/cli.cjs
export AITTRAIN_API_KEY=...

aittrain-js submit --entrypoint train.py --files train.py data.csv --env BATCH_SIZE=32
aittrain-js submit --project-dir ./my-project --entrypoint train.py
aittrain-js logs <job_id>
aittrain-js status <job_id>
aittrain-js list --limit 20
aittrain-js cancel <job_id>
aittrain-js download <job_id> --dest ./results
```

---

## API Reference

### `new AITTrainClient({ apiKey?, baseUrl?, timeout?, fetchImpl? })`
- `apiKey` — wajib, atau dari env `AITTRAIN_API_KEY` (Node).
- `baseUrl` — default `https://ai-train.axn.cc.cd`.
- `timeout` — ms (default 60000; upload/download otomatis dinaikkan).

| Method | Return | Deskripsi |
|---|---|---|
| `health()` | `{status, draining, queued}` | Health check (publik). |
| `submitJob({entrypoint, files, projectZip, env, signal?})` | `{job_id, status, entrypoint}` | Kirim job. `files` = array `File` / `{name, blob}` / `{name, data}`. |
| `getStatus(jobId)` | `JobStatusInfo` | Status: queued/running/completed/failed/cancelled. |
| `listJobs({limit?})` | `{count, jobs}` | List job terbaru. |
| `cancelJob(jobId)` | `{job_id, status, cancelled}` | Batalkan job. |
| `waitUntilFinished(jobId, {pollInterval?, timeout?, signal?})` | `JobStatusInfo` | Poll sampai selesai. |
| `streamLogs(jobId, {onLine?, onEnd?, signal?})` | `JobStatusInfo` | Stream log SSE real-time via fetch (bukan EventSource — mendukung header auth). |
| `downloadArtifact(jobId, {signal?})` | `Blob` | Unduh zip sebagai Blob. |
| `downloadAndWait(jobId, {pollInterval?, timeout?, signal?})` | `Blob` | Tunggu artefak siap lalu unduh. |
| `isArtifactReady(jobId)` | `boolean` | Cek kesiapan artefak. |

`JobStatusInfo`: `{job_id, status, entrypoint, created_at, started_at, finished_at, exit_code, error, queue_position, artifact_ready}`.

### Node extensions (`aittrain-sdk/node`) — `NodeAITTrainClient`
- `submitJobFromPaths({entrypoint, files: string[], projectZipPath?, projectDir?, env})` — baca file dari disk; `projectDir` di-zip in-memory (store-only, CRC32).
- `downloadToFile(jobId, dest, {extract=true, wait=true, keepZip=false, pollInterval})` — simpan ke disk & ekstrak (DEFLATE via `node:zlib`, proteksi path-traversal).
- Standalone: `zipFiles(entries)`, `zipDirectory(dir, {ignore, prefix})`, `extractZip(buf, dest)`, `fileFromPath(p)`, `saveBlobToFile(blob, p)`.

### Browser helper (`aittrain-sdk/browser`)
- `saveBlob(blob, filename)` — trigger unduhan via object URL.
- `downloadAndSave(client, jobId, filename?)`.

### Errors
Semua turunan `AITTrainError`: `AuthenticationError` (401), `JobNotFoundError` (404), `ArtifactNotFoundError` (404 download), `ServerDrainingError` (503 — handoff, retry), `InvalidPayloadError` (400), `JobCancelledError`, `TimeoutError`.

---

## Isi `dist/` (bundle siap pakai)

| File | Format | Untuk |
|---|---|---|
| `aittrain.browser.js` | ESM | **SDK browser utama** — import di file `.js` web Anda |
| `aittrain.min.js` | IIFE (minified) | `<script src>` lama, global `AITTrain` |
| `aittrain.mjs` | ESM | core (Node/browser, tanpa saveBlob) |
| `aittrain.cjs` | CommonJS | `require()` Node |
| `node.cjs` | CommonJS | `require("aittrain-sdk/node")` |
| `cli.cjs` | executable | CLI `aittrain-js` |
| `*.d.ts` | TypeScript | definisi tipe |

---

## Catatan Arsitektur (mengapa SDK browser bisa jalan)
1. **CORS** diaktifkan server (`AITTRAIN_CORS_ORIGINS`, default `*`).
2. **Autentikasi multi-sumber**: header `X-API-Key`, query `?api_key=`, atau `Authorization: Bearer`. Query param berguna untuk tautan unduhan langsung / fallback `EventSource`.
3. **SSE via `fetch` + ReadableStream**, bukan `EventSource` — karena `EventSource` browser tidak mendukung header custom (tidak bisa kirim `X-API-Key`). Satu implementasi parser SSE berjalan seragam di browser dan Node.
4. Endpoint: `GET /jobs` (list) dan `POST /jobs/{id}/cancel`.

## Build dari source
```bash
cd sdk-js
npm install        # hanya esbuild (devDependency)
npm run build      # hasil di dist/
```

## Contoh
- [`examples/node/train_and_monitor.mjs`](examples/node/train_and_monitor.mjs) — alur end-to-end Node.
- [`examples/browser/app.js`](examples/browser/app.js) — **pemakaian SDK dari file `.js` web** (tanpa server/backend).
- [`examples/browser/index.html`](examples/browser/index.html) — loader UI demo.
- [`examples/node/user_training_script.py`](examples/node/user_training_script.py) — contoh skrip training yang di-upload (kontrak: tulis hasil ke `$AITT_OUTPUT_DIR`).
