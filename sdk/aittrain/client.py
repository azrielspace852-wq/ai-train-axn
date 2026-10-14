"""
Klien utama AITTrain.

TrainerClient menangani autentikasi (X-API-Key), submit job multipart,
cek status, dan menyediakan akses ke streamer log + downloader hasil.
"""

from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Union

import requests

from .exceptions import ArtifactNotFoundError, raise_for_status
from .stream import LogStreamer
from .download import ResultDownloader

PathLike = Union[str, Path]

DEFAULT_BASE_URL = "https://ai.train.axn.cc.cd"


class TrainerClient:
    """
    Klien untuk berinteraksi dengan server AITTrain.

    Args:
        api_key: API key untuk otentikasi. Jika None, dibaca dari env
                 AITTRAIN_API_KEY.
        base_url: URL endpoint server (default domain Cloudflare Tunnel).
        timeout: timeout request dalam detik.
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: str = DEFAULT_BASE_URL,
        timeout: float = 60.0,
    ):
        self.api_key = api_key or os.environ.get("AITTRAIN_API_KEY", "")
        if not self.api_key:
            raise ValueError(
                "API key wajib disediakan atau lewat env AITTRAIN_API_KEY"
            )
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.session = requests.Session()
        self.session.headers.update({"X-API-Key": self.api_key})

        self.streamer = LogStreamer(self)
        self.downloader = ResultDownloader(self)

    # ------------------------------------------------------------------
    # Submit job
    # ------------------------------------------------------------------
    def submit_job(
        self,
        entrypoint: str = "train.py",
        files: Optional[Iterable[PathLike]] = None,
        project_zip: Optional[PathLike] = None,
        env: Optional[Dict[str, str]] = None,
    ) -> str:
        """
        Kirim job training ke server.

        Args:
            entrypoint: nama file .py utama (relatif terhadap workdir server).
            files: daftar path file individual (kode, config, dataset, model).
            project_zip: (opsional) path ke zip berisi seluruh project.
            env: (opsional) dict env var yang akan di-pass ke skrip pengguna.

        Returns:
            job_id (str) — identifier untuk streaming & download.
        """
        url = f"{self.base_url}/train"
        data = {
            "entrypoint": entrypoint,
            "env_json": json.dumps(env or {}),
        }

        uploads: List[tuple] = []
        # File individual
        for f in files or []:
            p = Path(f)
            if not p.exists():
                raise FileNotFoundError(f"File tidak ditemukan: {p}")
            uploads.append(("files", (p.name, open(p, "rb"), "application/octet-stream")))

        # Project zip (opsional)
        if project_zip:
            pz = Path(project_zip)
            if not pz.exists():
                raise FileNotFoundError(f"Project zip tidak ditemukan: {pz}")
            uploads.append(
                ("project_zip", (pz.name, open(pz, "rb"), "application/zip"))
            )

        try:
            resp = self.session.post(
                url, data=data, files=uploads or None, timeout=self.timeout
            )
        finally:
            for _, (_, fh, _) in uploads:
                fh.close()

        raise_for_status(resp)
        return resp.json()["job_id"]

    # ------------------------------------------------------------------
    # Status & kontrol
    # ------------------------------------------------------------------
    def get_status(self, job_id: str) -> dict:
        """Ambil status job (queued/running/completed/failed)."""
        resp = self.session.get(
            f"{self.base_url}/jobs/{job_id}/status", timeout=self.timeout
        )
        raise_for_status(resp)
        return resp.json()

    def wait_until_finished(
        self, job_id: str, poll_interval: float = 5.0, max_wait: Optional[float] = None
    ) -> dict:
        """Poll status sampai job selesai (completed/failed). Return status akhir."""
        start = time.time()
        while True:
            st = self.get_status(job_id)
            if st["status"] in ("completed", "failed", "cancelled"):
                return st
            if max_wait and (time.time() - start) > max_wait:
                raise TimeoutError(f"Job {job_id} belum selesai dalam {max_wait}s")
            time.sleep(poll_interval)

    def is_artifact_ready(self, job_id: str) -> bool:
        return self.get_status(job_id).get("artifact_ready", False)

    # ------------------------------------------------------------------
    # Streaming & download (delegasi ke modul terpisah)
    # ------------------------------------------------------------------
    def stream_logs(self, job_id: str, callback=None) -> dict:
        """Stream log real-time ke terminal (atau lewat callback). Return status akhir."""
        return self.streamer.stream(job_id, callback=callback)

    def download_result(
        self,
        job_id: str,
        dest_dir: PathLike = ".",
        extract: bool = True,
        wait: bool = True,
        poll_interval: float = 10.0,
    ) -> Path:
        """
        Unduh artefak .zip dan (opsional) ekstrak.

        Jika wait=True, poll sampai artefak tersedia. Return path direktori
        hasil ekstrak (atau path file zip jika extract=False).
        """
        if wait:
            while not self.is_artifact_ready(job_id):
                st = self.get_status(job_id)
                if st["status"] == "failed":
                    raise ArtifactNotFoundError(
                        f"Job {job_id} gagal; tidak ada artefak. Error: {st.get('error')}"
                    )
                time.sleep(poll_interval)
        return self.downloader.download(job_id, dest_dir=dest_dir, extract=extract)

    def close(self) -> None:
        self.session.close()

    def __enter__(self) -> "TrainerClient":
        return self

    def __exit__(self, *exc) -> None:
        self.close()
