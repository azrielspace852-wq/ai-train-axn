# aittrain-sdk

Python SDK untuk platform AITTrain — kirim kode training, pantau log real-time, unduh hasil.

## Instalasi

```bash
pip install ./sdk          # dari source
# atau setelah publish: pip install aittrain-sdk
```

## Quick Start

```python
from aittrain import TrainerClient

client = TrainerClient(api_key="...")  # atau env AITTRAIN_API_KEY

# 1. Kirim job (bebas framework, bebas format)
job_id = client.submit_job(
    entrypoint="train.py",
    files=["train.py", "dataset.csv", "config.json"],
    env={"BATCH_SIZE": "32"},
)

# 2. Pantau log real-time (loss, epoch, ema langsung tampil di terminal)
final = client.stream_logs(job_id)

# 3. Unduh & ekstrak hasil (.zip)
out_dir = client.download_result(job_id, dest_dir="./results")
```

## CLI

```bash
export AITTRAIN_API_KEY=...
aittrain submit --entrypoint train.py --files train.py data.csv
aittrain logs <job_id>
aittrain status <job_id>
aittrain download <job_id> --dest ./out
```

## Modul

| Modul | Isi |
|---|---|
| `aittrain.client.TrainerClient` | Klien utama: autentikasi, `submit_job`, `get_status`, `wait_until_finished` |
| `aittrain.stream.LogStreamer` | SSE log streaming real-time |
| `aittrain.download.ResultDownloader` | Unduh `.zip` + ekstrak otomatis (anti path-traversal) |
| `aittrain.exceptions` | Exception semantik: `AuthenticationError`, `JobNotFoundError`, `ArtifactNotFoundError`, `ServerDrainingError` |

## Kontrak dengan skrip training Anda

Satu-satunya kewajiban: **tulis semua hasil ke `$AITT_OUTPUT_DIR`**. Isi direktori itu yang di-zip server dan dikirim ke Anda. Print metrik ke `stdout` (dengan `flush=True`) untuk telemetri real-time.
