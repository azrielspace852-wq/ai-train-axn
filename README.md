# AITTrain — Platform AI Training Mandiri (Agnostic Runner)
Platform training AI mandiri berbasis **GitHub Actions (24/7 via handoff) + Cloudflare Tunnel + FastAPI + Python SDK + JavaScript SDK (Node.js & browser)**.
> **Filosofi: Zero Model Constraints.** Server *tidak pernah* membatasi, memvalidasi, atau memahami arsitektur model, framework, tokenizer, atau format dataset. Server hanyalah **eksekutor agnostik**: terima kode mentah → jalankan sebagai subprocess → tangkap stdout untuk telemetri → zip hasil → kirim ke pengguna.
---
## Arsitektur
```
[ Pengguna / aittrain-sdk (Python | JS Node | JS Browser) ]
        │  HTTPS (X-API-Key / ?api_key= / Bearer)
        ▼
[ ai-train.axn.cc.cd ]  ← Cloudflare Named Tunnel (multi-connector) + CORS enabled
        │
        ▼
[ GitHub Actions Runner ]
   ├─ cloudflared (connector tunnel)
   ├─ FastAPI server (server.py)
   │    ├─ POST /train               : terima kode/dataset/model (multipart)
   │    ├─ GET  /jobs                : list job
   │    ├─ GET  /jobs/{id}/status    : status job
   │    ├─ GET  /jobs/{id}/logs      : SSE stream log real-time
   │    ├─ GET  /jobs/{id}/download  : unduh artefak .zip
   │    └─ POST /jobs/{id}/cancel    : batalkan job
   └─ runner.py (watchdog handoff 24/7)
        └─ pada ~5h40m → trigger workflow baru → overlap connector → graceful shutdown
```
---
## Struktur Repository
```
aittrain-platform/
├── .github/workflows/runner.yml   # Workflow GitHub Actions (24/7 + handoff)
├── server/
│   ├── server.py                  # FastAPI: queue, subprocess, SSE, zip, CORS, cancel
│   ├── runner.py                  # Bootstrap + watchdog handoff 24/7
│   ├── requirements.txt
│   └── config.yml.example         # Template CONFIG_YML (jangan commit nilai asli)
├── sdk/                           # Python SDK
│   ├── pyproject.toml
│   ├── aittrain/
│   │   ├── __init__.py
│   │   ├── client.py              # TrainerClient (submit, status)
│   │   ├── stream.py              # LogStreamer (SSE real-time)
│   │   ├── download.py            # ResultDownloader (zip + extract)
│   │   ├── exceptions.py
│   │   └── cli.py                 # `aittrain` command line
│   └── examples/
│       ├── train_and_monitor.py        # Contoh alur SDK end-to-end
│       └── user_training_script.py     # Contoh skrip training pengguna
├── sdk-js/                        # JavaScript SDK (Node + browser, zero-dependency)
│   ├── package.json
│   ├── src/
│   │   ├── core/                  # inti runtime-agnostic (fetch + SSE parser + exceptions)
│   │   ├── node/                  # ekstensi Node: fs, zip in-memory, unzip, CLI
│   │   └── browser/               # helper browser (saveBlob)
│   ├── dist/                      # bundle: .mjs / .cjs / .min.js (IIFE) / *.d.ts
│   └── examples/
│       ├── node/train_and_monitor.mjs
│       └── browser/index.html     # demo UI (buka langsung di browser, tanpa server)
└── README.md
```
---
## Setup Sekali (One-Time Setup)
### 1. Buat Cloudflare Named Tunnel
```bash
cloudflared tunnel login
cloudflared tunnel create aittrain          # menghasilkan UUID + file <uuid>.json
cloudflared tunnel route dns aittrain ai-train.axn.cc.cd
```
Catat: **UUID tunnel** dan isi file **`<uuid>.json`** (credentials).
### 2. Siapkan GitHub Secrets
Semua nilai sensitif disimpan di **GitHub → Settings → Secrets and variables → Actions**. **TIDAK PERNAH di-print, di-log, atau di-commit.**
| Secret | Isi | Cara buat |
|---|---|---|
| `GH_PAT` | Personal Access Token (scope: `repo`, `workflow`) — untuk trigger handoff | github.com/settings/tokens |
| `CERT_PEM` | Isi `~/.cloudflared/cert.pem`, di-**base64** | `base64 -w0 ~/.cloudflared/cert.pem` |
| `UUID_TUNNEL` | UUID tunnel (plain, tanpa base64) | dari `cloudflared tunnel list` |
| `UUID_JSON` | Isi file `<tunnel-uuid>.json`, di-**base64** | `base64 -w0 ~/.cloudflared/<uuid>.json` |
| `CONFIG_YML` | Isi `config.yml` (lihat `server/config.yml.example`), di-**base64** | `base64 -w0 config.yml` |
| `AITTRAIN_API_KEY` | Kunci rahasia untuk otentikasi SDK ↔ server | `openssl rand -hex 32` |
> ⚠️ `runner.py` hanya **menulis** secret ke file di runner (mode `0600`) dan **tidak pernah mencetaknya**. `runner.yml` juga memakai `set +x` agar tidak bocor ke log.
### 3. Isi `CONFIG_YML`
Salin `server/config.yml.example`, isi UUID tunnel, lalu encode base64 dan simpan sebagai secret `CONFIG_YML`.
### 4. Jalankan pertama kali
Trigger manual: **Actions → AITTrain 24/7 Runner → Run workflow**. Setelah itu sistem akan **self-sustain** via handoff otomatis.
---
## Cara Kerja Handoff 24/7 (Zero Downtime)
1. Batas job GitHub Actions = **6 jam**.
2. `runner.py` memantau waktu mulai. Pada **5 jam 40 menit**, memanggil GitHub REST API (`POST /actions/workflows/runner.yml/dispatches`) menggunakan `GH_PAT`.
3. Job **baru** mulai, menjalankan `cloudflared tunnel run` dengan **tunnel UUID yang sama** → Cloudflare mendaftarkan **connector kedua** (multi-connector load-balancing).
4. Setelah **overlap ~4 menit** (connector baru siap), job lama: `POST /admin/drain` (berhenti terima job baru) → tunggu job berjalan selesai (maks 15 menit) → `terminate()` server & cloudflared → exit 0.
5. Traffic otomatis pindah ke connector baru. **Tidak ada downtime.**
> Catatan: job training yang berjalan saat handoff akan diakhiri. **Skrip training pengguna wajib melakukan checkpoint berkala** dan resumable — ini bagian dari tanggung jawab pengguna (zero constraints).
---
## Kontrak Pengguna (Satu-satunya)
Skrip training pengguna **wajib** menulis semua hasil (checkpoint, model final, metrik) ke direktori:
```bash
$AITT_OUTPUT_DIR    # diset server = /workspace/<job_id>/output
```
Isi direktori itulah yang di-zip dan dikirim. Selain itu: **bebas total** (framework, format, struktur apa pun). Print metrik ke stdout untuk telemetri real-time.
---
## Penggunaan SDK (Ringkas)
**Python:**
```bash
pip install ./sdk
export AITTRAIN_API_KEY=...
aittrain submit --entrypoint train.py --files train.py data.csv config.json
aittrain logs <job_id>
aittrain download <job_id> --dest ./results
```
**JavaScript (Node / browser):**
```bash
npm install ./sdk-js
export AITTRAIN_API_KEY=...
aittrain-js submit --entrypoint train.py --files train.py data.csv
aittrain-js logs <job_id>
aittrain-js download <job_id> --dest ./results
```
Browser tanpa Node.js/server: buka `sdk-js/examples/browser/index.html` (memakai bundle IIFE `dist/aittrain.min.js`, global `AITTrain`).
Lihat `sdk/README.md`, `sdk-js/README.md`, dan `sdk-js/examples/` untuk detail.
---
## Endpoint API
Auth menerima **tiga sumber** (agar SDK browser / `EventSource` bisa autentikasi): header `X-API-Key`, query `?api_key=`, atau `Authorization: Bearer <key>`.
| Method | Path | Deskripsi | Auth |
|---|---|---|---|
| `POST` | `/train` | Submit job (multipart: `entrypoint`, `env_json`, `files[]`, `project_zip`) | ya |
| `GET` | `/jobs` | List job (terbaru dulu, `?limit=N`) | ya |
| `GET` | `/jobs/{id}/status` | Status job | ya |
| `GET` | `/jobs/{id}/logs` | SSE stream log (`data:` baris, `event: end` saat selesai) | ya |
| `GET` | `/jobs/{id}/download` | Unduh artefak `.zip` | ya |
| `POST` | `/jobs/{id}/cancel` | Batalkan job (queued→cancelled; running→SIGKILL) | ya |
| `POST` | `/admin/drain` | Mode drain (dipakai runner saat handoff) | ya |
| `GET` | `/healthz` | Health check (`{status, draining, queued}`) | publik |

> **CORS** diaktifkan untuk SDK browser. Atur origin via env `AITTRAIN_CORS_ORIGINS` (koma-separated, default `*`).
---
## Keamanan & Catatan Operasional
- Server menjalankan **kode arbitrer** pengguna — ini by design. Jalankan di runner terisolasi (GitHub Actions sudah ephemeral).
- API key wajib; tanpa `AITTRAIN_API_KEY` di env, endpoint `/train` dll. terbuka (hanya untuk development lokal).
- Upload zip divalidasi anti **path traversal**.
- Log buffer dibatasi (`AITTRAIN_LOG_BUFFER`, default 20.000 baris) agar tidak memory-bloat.
- Concurrency default = 1 job (`AITTRAIN_MAX_JOBS`); naikkan jika runner punya resource cukup.
- Untuk SDK browser: API key dikirim dari klien (browser). Ini setara dengan memaparkan key ke pengguna akhir — **hanya gunakan browser SDK di lingkungan terpercaya**, atau lewat proxy backend Anda sendiri.
