# Changelog

## 2026-10-15 — AXION AI-Lab API/SDK update

### Fixed
- Memperbaiki potensi error browser `Failed to execute 'fetch' on 'Window': Illegal invocation` dengan mengikat native `fetch` ke `globalThis`.
- Streaming SSE kini memakai implementasi `fetch` yang sama dengan klien, termasuk `fetchImpl` kustom untuk testing/proxy.
- Server kini menerima URL publik ber-prefix `/api/` dan memetakan request ke route internal yang ada; endpoint lama tanpa prefix tetap kompatibel.
- Konfigurasi CORS tetap mendukung preflight lintas-origin, header `X-API-Key`/`Authorization`/`Content-Type`, serta origin yang dapat diatur melalui `AITTRAIN_CORS_ORIGINS`.

### Changed
- Default base URL Python SDK, Python CLI, dan JavaScript SDK diubah menjadi `https://ai-train.axn.cc.cd/api/`.
- Dokumentasi dan contoh SDK diperbarui untuk URL baru.
- Versi paket JavaScript dinaikkan ke `1.3.0`.\n- File distribusi yang tersedia diperbarui pada default endpoint dan pola binding `fetch` yang cocok. Bundle penuh perlu dibangun ulang sebelum publish karena dependensi `esbuild` tidak tersedia di lingkungan kerja.
- Ditambahkan `TASK-CHECKLIST.md` untuk melacak seluruh butir prompt.

### Batasan yang perlu diketahui
- Backend saat ini mengeksekusi entrypoint Python melalui subprocess (`AITTRAIN_PYTHON -u <entrypoint>`). Data/model/tokenizer/dataset tidak diinterpretasi atau dibatasi oleh server, tetapi entrypoint executable non-Python belum didukung.
- Validasi live terhadap server Cloudflare dan deployment produksi tidak dapat dilakukan hanya dari workspace lokal. Pengujian produksi CORS, DNS/proxy, dan API key masih perlu dilakukan setelah deploy.
