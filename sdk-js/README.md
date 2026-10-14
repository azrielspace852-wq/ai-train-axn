# aittrain-sdk (JavaScript)

SDK JavaScript **tanpa dependensi runtime** untuk platform [AITTrain](../README.md) — kirim kode training, pantau log real-time (SSE), unduh artefak. Satu kode dasar berjalan di **Node.js 18+** dan **browser modern** (tanpa Node.js, tanpa server).

> Filosofi platform: *zero model constraints*. Server hanya mengeksekusi entrypoint Anda, menangkap stdout untuk telemetri, dan meng-zip `$AITT_OUTPUT_DIR`. SDK tidak peduli framework apa yang Anda pakai.

---

## Instalasi

```bash
npm install aittrain-sdk          # (setelah dipublish) — atau dari source: npm install ./sdk-js
```

Atau pakai langsung tanpa build tool:

```html
<!-- Browser: bundle IIFE, global `AITTrain` -->
<script src="node_modules/aittrain-sdk/dist/aittrain.min.js"></script>
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

## Quick Start — Node.js

```js
import { NodeAITTrainClient } from "aittrain-sdk/node";

const client = new NodeAITTrainClient({
  // apiKey diambil otomatis dari env AITTRAIN_API_KEY jika tidak diisi
  baseUrl: "https://ai.train.axn.cc.cd",
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

## Quick Start — Browser (tanpa Node.js / tanpa server)

```html
<script src="dist/aittrain.min.js"></script>
<script>
  const client = new AITTrain.AITTrainClient({ apiKey: "...", baseUrl: "https://ai.train.axn.cc.cd" });

  // files = FileList dari <input type="file" multiple>
  const job = await client.submitJob({
    entrypoint: "train.py",
    files: Array.from(inputEl.files),
    env: { BATCH_SIZE: "32" },
  });

  await client.streamLogs(job.job_id, { onLine: (line) => (preEl.textContent += line) });

  const blob = await client.downloadAndWait(job.job_id);
  AITTrain.saveBlob(blob, job.job_id + ".zip"); // trigger unduhan browser
</script>
```

Demo lengkap: [`examples/browser/index.html`](examples/browser/index.html) (buka langsung di browser).

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
- `baseUrl` — default `https://ai.train.axn.cc.cd`.
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

## Catatan Arsitektur (mengapa SDK browser bisa jalan)

1. **CORS** diaktifkan server (`AITTRAIN_CORS_ORIGINS`, default `*`).
2. **Autentikasi multi-sumber**: header `X-API-Key`, query `?api_key=`, atau `Authorization: Bearer`. Query param berguna untuk tautan unduhan langsung / fallback `EventSource`.
3. **SSE via `fetch` + ReadableStream**, bukan `EventSource` — karena `EventSource` browser tidak mendukung header custom (tidak bisa kirim `X-API-Key`). Satu implementasi parser SSE berjalan seragam di browser dan Node.
4. Endpoint baru: `GET /jobs` (list) dan `POST /jobs/{id}/cancel` (melengkapi status `CANCELLED` yang sebelumnya tidak pernah tercapai).

## Build dari source

```bash
cd sdk-js
npm install        # hanya esbuild (devDependency)
npm run build      # hasil di dist/ : .mjs, .cjs, .min.js (IIFE), node.cjs, cli.cjs, *.d.ts
npm test           # integration test (butuh server lokal berjalan)
```

## Contoh
- [`examples/node/train_and_monitor.mjs`](examples/node/train_and_monitor.mjs) — alur end-to-end Node.
- [`examples/browser/index.html`](examples/browser/index.html) — demo UI browser (submit, stream log, download, list, cancel).
- [`examples/node/user_training_script.py`](examples/node/user_training_script.py) — contoh skrip training yang di-upload (kontrak: tulis hasil ke `$AITT_OUTPUT_DIR`).
