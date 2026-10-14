"""
AITTrain — Agnostic AI Training Execution Server (FastAPI)

Filosofi: server ini TIDAK PERNAH memvalidasi, membatasi, atau memahami
arsitektur model / framework / format dataset pengguna. Server hanya:
  1. Menerima file mentah (kode .py, config, dataset, model opsional)
  2. Menjalankan entrypoint pengguna sebagai subprocess
  3. Menangkap stdout/stderr secara real-time dan menyiarkannya via SSE
  4. Meng-zip direktori output setelah selesai untuk diunduh klien

Seluruh logika training adalah tanggung jawab pengguna.
"""

from __future__ import annotations

import asyncio
import json
import os
import shutil
import subprocess
import sys
import time
import uuid
import zipfile
from collections import deque
from enum import Enum
from pathlib import Path
from typing import Deque, Dict, List, Optional, Set

import uvicorn
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import FileResponse, StreamingResponse

# ---------------------------------------------------------------------------
# Konfigurasi (semua dari environment variable — tidak ada secret di kode)
# ---------------------------------------------------------------------------
API_KEY = os.environ.get("AITTRAIN_API_KEY", "")
WORKSPACE_ROOT = Path(os.environ.get("AITTRAIN_WORKSPACE", "/workspace"))
MAX_CONCURRENT_JOBS = int(os.environ.get("AITTRAIN_MAX_JOBS", "1"))
MAX_LOG_BUFFER = int(os.environ.get("AITTRAIN_LOG_BUFFER", "20000"))
SERVER_PORT = int(os.environ.get("AITTRAIN_PORT", "8000"))
PYTHON_BIN = os.environ.get("AITTRAIN_PYTHON", sys.executable)

WORKSPACE_ROOT.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="AITTrain Agnostic Training Server", version="1.0.0")

# Flag drain: saat True (menjelang handoff), server menolak job baru.
draining = False


# ---------------------------------------------------------------------------
# Model Job
# ---------------------------------------------------------------------------
class JobStatus(str, Enum):
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class Job:
    """Merepresentasikan satu job training beserta state-nya."""

    def __init__(self, job_id: str, entrypoint: str, env: Dict[str, str]):
        self.job_id = job_id
        self.entrypoint = entrypoint
        self.env = env
        self.status = JobStatus.QUEUED
        self.workdir = WORKSPACE_ROOT / job_id
        self.output_dir = self.workdir / "output"
        self.log_buffer: Deque[str] = deque(maxlen=MAX_LOG_BUFFER)
        self.subscribers: Set[asyncio.Queue] = set()
        self.created_at = time.time()
        self.started_at: Optional[float] = None
        self.finished_at: Optional[float] = None
        self.exit_code: Optional[int] = None
        self.error: Optional[str] = None
        self.process: Optional[asyncio.subprocess.Process] = None
        self.artifact_path: Optional[Path] = None

    def to_dict(self) -> dict:
        return {
            "job_id": self.job_id,
            "status": self.status.value,
            "entrypoint": self.entrypoint,
            "created_at": self.created_at,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "exit_code": self.exit_code,
            "error": self.error,
            "artifact_ready": self.artifact_path is not None
            and self.artifact_path.exists(),
        }


jobs: Dict[str, Job] = {}
job_queue: asyncio.Queue = asyncio.Queue()


# ---------------------------------------------------------------------------
# Autentikasi
# ---------------------------------------------------------------------------
async def verify_api_key(x_api_key: str = Header(..., alias="X-API-Key")) -> str:
    if API_KEY and x_api_key != API_KEY:
        raise HTTPException(status_code=401, detail="Invalid or missing API key")
    return x_api_key


# ---------------------------------------------------------------------------
# Log broadcast
# ---------------------------------------------------------------------------
async def push_log(job: Job, line: str) -> None:
    """Simpan log ke buffer dan broadcast ke semua subscriber SSE."""
    job.log_buffer.append(line)
    dead = []
    for q in job.subscribers:
        try:
            q.put_nowait(line)
        except asyncio.QueueFull:
            # Subscriber lambat — skip, bukan blok worker.
            pass
    # Bersihkan subscriber yang sudah ditutup (ditandai None di queue-nya)
    for q in dead:
        job.subscribers.discard(q)


# ---------------------------------------------------------------------------
# Worker: eksekusi subprocess pengguna
# ---------------------------------------------------------------------------
async def run_training(job: Job) -> None:
    """Jalankan skrip training pengguna, stream stdout, lalu zip output."""
    entry_path = job.workdir / job.entrypoint
    if not entry_path.exists():
        raise FileNotFoundError(
            f"Entrypoint '{job.entrypoint}' tidak ditemukan. "
            f"Pastikan file di-upload dan nama entrypoint benar."
        )

    job.output_dir.mkdir(parents=True, exist_ok=True)

    # Env untuk skrip pengguna: beri tahu lokasi output (tanpa memaksakan format)
    proc_env = os.environ.copy()
    proc_env.update(job.env)
    proc_env["AITT_JOB_ID"] = job.job_id
    proc_env["AITT_OUTPUT_DIR"] = str(job.output_dir)

    await push_log(job, f"[server] Memulai eksekusi: {job.entrypoint}\n")
    await push_log(job, f"[server] Workdir: {job.workdir}\n")
    await push_log(job, f"[server] Output dir: {job.output_dir}\n")
    await push_log(job, "[server] Mulai output subprocess ---------------------------------\n")

    proc = await asyncio.create_subprocess_exec(
        PYTHON_BIN,
        "-u",  # unbuffered agar log real-time
        str(entry_path),
        cwd=str(job.workdir),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
        env=proc_env,
    )
    job.process = proc

    # Baca stdout line-by-line secara asinkron
    assert proc.stdout is not None
    while True:
        try:
            line_bytes = await proc.stdout.readline()
        except ValueError:
            break
        if not line_bytes:
            break
        line = line_bytes.decode("utf-8", errors="replace")
        await push_log(job, line)

    await proc.wait()
    job.exit_code = proc.returncode
    await push_log(
        job,
        f"\n[server] Subprocess selesai dengan exit code: {job.exit_code}\n",
    )

    # Kemas hasil: zip seluruh isi output dir (termasuk jika partial)
    artifact = job.workdir / f"{job.job_id}.zip"
    if any(job.output_dir.iterdir()):
        await push_log(job, "[server] Mengemas output menjadi .zip ...\n")
        shutil.make_archive(str(artifact.with_suffix("")), "zip", str(job.output_dir))
        job.artifact_path = artifact
        await push_log(job, f"[server] Artefak siap: {artifact.name}\n")
    else:
        await push_log(
            job,
            "[server] PERINGATAN: output dir kosong — tidak ada artefak untuk diunduh. "
            "Pastikan skrip Anda menulis hasil ke $AITT_OUTPUT_DIR.\n",
        )

    if job.exit_code != 0:
        raise RuntimeError(f"Training script exited with code {job.exit_code}")


async def job_worker(worker_id: int) -> None:
    """Loop worker yang mengambil job dari queue satu per satu."""
    while True:
        job_id = await job_queue.get()
        job = jobs[job_id]
        job.status = JobStatus.RUNNING
        job.started_at = time.time()
        try:
            await run_training(job)
            job.status = JobStatus.COMPLETED
        except Exception as exc:  # noqa: BLE001
            job.status = JobStatus.FAILED
            job.error = str(exc)
            await push_log(job, f"[server] ERROR: {exc}\n")
        finally:
            job.finished_at = time.time()
            # Sinyal selesai ke semua subscriber
            for q in list(job.subscribers):
                try:
                    q.put_nowait(None)
                except asyncio.QueueFull:
                    pass
            job_queue.task_done()


@app.on_event("startup")
async def startup() -> None:
    for i in range(MAX_CONCURRENT_JOBS):
        asyncio.create_task(job_worker(i))


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@app.get("/healthz")
async def healthz() -> dict:
    return {"status": "ok", "draining": draining, "queued": job_queue.qsize()}


@app.post("/train", dependencies=[Depends(verify_api_key)])
async def submit_train(
    entrypoint: str = Form("train.py"),
    env_json: str = Form("{}"),
    project_zip: Optional[UploadFile] = File(None),
    files: List[UploadFile] = File(default=[]),
) -> dict:
    """
    Terima payload training.

    - entrypoint: nama file .py utama (default train.py), relatif terhadap workdir.
    - env_json: JSON dict env var tambahan untuk skrip pengguna.
    - project_zip: (opsional) zip berisi seluruh project; diekstrak ke workdir.
    - files: file-file individual (kode, config, dataset, model) disimpan apa adanya.
    """
    global draining
    if draining:
        raise HTTPException(
            status_code=503,
            detail="Server sedang dalam proses handoff, coba lagi beberapa saat.",
        )

    try:
        extra_env = json.loads(env_json)
        if not isinstance(extra_env, dict):
            raise ValueError("env_json harus berupa JSON object")
        extra_env = {str(k): str(v) for k, v in extra_env.items()}
    except (json.JSONDecodeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=f"env_json invalid: {exc}")

    job_id = uuid.uuid4().hex[:12]
    job = Job(job_id=job_id, entrypoint=entrypoint, env=extra_env)
    jobs[job_id] = job
    job.workdir.mkdir(parents=True, exist_ok=True)

    # 1. Ekstrak project zip jika ada
    if project_zip is not None and project_zip.filename:
        zip_dest = job.workdir / "_project.zip"
        with open(zip_dest, "wb") as f:
            shutil.copyfileobj(project_zip.file, f)
        try:
            with zipfile.ZipFile(zip_dest) as zf:
                # Cegah path traversal
                for member in zf.namelist():
                    if member.startswith("/") or ".." in Path(member).parts:
                        raise HTTPException(400, f"Path tidak aman di zip: {member}")
                zf.extractall(job.workdir)
        except zipfile.BadZipFile:
            raise HTTPException(400, "project_zip bukan file zip valid")
        finally:
            zip_dest.unlink(missing_ok=True)

    # 2. Simpan file individual (nama file dipertahankan)
    for uf in files:
        if not uf.filename:
            continue
        # Izinkan subpath tapi cegah traversal
        safe_name = Path(uf.filename).name
        dest = job.workdir / safe_name
        dest.parent.mkdir(parents=True, exist_ok=True)
        with open(dest, "wb") as f:
            shutil.copyfileobj(uf.file, f)

    await job_queue.put(job_id)
    return {"job_id": job_id, "status": "queued", "entrypoint": entrypoint}


@app.get("/jobs/{job_id}/status", dependencies=[Depends(verify_api_key)])
async def job_status(job_id: str) -> dict:
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Job tidak ditemukan")
    return job.to_dict()


@app.get("/jobs/{job_id}/logs", dependencies=[Depends(verify_api_key)])
async def stream_logs(job_id: str) -> StreamingResponse:
    """SSE stream: replay buffer lalu kirim log real-time sampai job selesai."""
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Job tidak ditemukan")

    async def event_generator():
        # Kirim buffered logs dulu
        for line in list(job.log_buffer):
            yield f"data: {json.dumps({'line': line})}\n\n"

        # Jika job sudah selesai sebelum subscribe, kirim event end.
        if job.finished_at is not None:
            yield f"event: end\ndata: {json.dumps(job.to_dict())}\n\n"
            return

        q: asyncio.Queue = asyncio.Queue(maxsize=10000)
        job.subscribers.add(q)
        try:
            while True:
                item = await q.get()
                if item is None:
                    yield f"event: end\ndata: {json.dumps(job.to_dict())}\n\n"
                    return
                yield f"data: {json.dumps({'line': item})}\n\n"
        finally:
            job.subscribers.discard(q)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/jobs/{job_id}/download", dependencies=[Depends(verify_api_key)])
async def download_artifact(job_id: str) -> FileResponse:
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Job tidak ditemukan")
    if not job.artifact_path or not job.artifact_path.exists():
        raise HTTPException(
            404, "Artefak belum tersedia (training belum selesai atau output kosong)."
        )
    return FileResponse(
        path=str(job.artifact_path),
        media_type="application/zip",
        filename=f"{job_id}.zip",
    )


@app.post("/admin/drain", dependencies=[Depends(verify_api_key)])
async def set_drain(enable: bool = Form(True)) -> dict:
    """Dipanggil runner.py saat handoff: berhenti terima job baru."""
    global draining
    draining = enable
    return {"draining": draining}


def main() -> None:
    uvicorn.run(
        "server:app",
        host="127.0.0.1",
        port=SERVER_PORT,
        log_level="info",
        access_log=False,
    )


if __name__ == "__main__":
    main()
