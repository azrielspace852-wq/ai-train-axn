"""
Pengunduhan artefak hasil training (.zip) dan ekstraksi otomatis.
"""

from __future__ import annotations

import zipfile
from pathlib import Path
from typing import Union

from .exceptions import ArtifactNotFoundError, raise_for_status

PathLike = Union[str, Path]


class ResultDownloader:
    def __init__(self, client):
        self.client = client

    def download(
        self,
        job_id: str,
        dest_dir: PathLike = ".",
        extract: bool = True,
        chunk_size: int = 1024 * 1024,
    ) -> Path:
        """
        Unduh file .zip hasil training.

        Args:
            job_id: identifier job.
            dest_dir: direktori tujuan.
            extract: jika True, ekstrak zip ke subdirektori <job_id>/ dan
                     return path direktori tersebut. Jika False, return
                     path file .zip.
            chunk_size: ukuran chunk download.

        Returns:
            Path ke file zip atau direktori hasil ekstrak.
        """
        dest = Path(dest_dir)
        dest.mkdir(parents=True, exist_ok=True)
        zip_path = dest / f"{job_id}.zip"

        url = f"{self.client.base_url}/jobs/{job_id}/download"
        with self.client.session.get(url, stream=True, timeout=(5, 300)) as resp:
            if resp.status_code == 404:
                raise ArtifactNotFoundError(
                    f"Artefak untuk job {job_id} belum tersedia. "
                    "Pastikan training selesai dan skrip menulis ke $AITT_OUTPUT_DIR."
                )
            raise_for_status(resp)

            total = int(resp.headers.get("Content-Length", 0))
            downloaded = 0
            with open(zip_path, "wb") as f:
                for chunk in resp.iter_content(chunk_size=chunk_size):
                    if not chunk:
                        continue
                    f.write(chunk)
                    downloaded += len(chunk)
                    if total:
                        pct = downloaded * 100 // total
                        print(f"\r[download] {pct}% ({downloaded}/{total} bytes)", end="", flush=True)
            if total:
                print()

        if not extract:
            return zip_path

        extract_dir = dest / job_id
        extract_dir.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(zip_path) as zf:
            # Validasi anti path-traversal
            for member in zf.namelist():
                member_path = (extract_dir / member).resolve()
                if not str(member_path).startswith(str(extract_dir.resolve())):
                    raise RuntimeError(f"Path tidak aman dalam zip: {member}")
            zf.extractall(extract_dir)

        # Hapus zip setelah ekstrak sukses untuk hemat ruang
        zip_path.unlink()
        return extract_dir
