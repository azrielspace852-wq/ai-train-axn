"""
Streaming log real-time via Server-Sent Events (SSE).

Membaca endpoint /jobs/{id}/logs, mem-parsing event SSE, dan mencetak
setiap baris ke stdout (atau memanggil callback pengguna). Saat event
`end` diterima, return dict status akhir job.
"""

from __future__ import annotations

import json
from typing import Callable, Optional

import requests

from .exceptions import raise_for_status


class LogStreamer:
    def __init__(self, client):
        self.client = client

    def stream(
        self,
        job_id: str,
        callback: Optional[Callable[[str], None]] = None,
    ) -> dict:
        """
        Buka koneksi SSE dan tampilkan log sampai job selesai.

        Args:
            job_id: identifier job.
            callback: fungsi yang menerima string baris log. Jika None,
                      log dicetak ke stdout (tanpa buffering).

        Returns:
            dict status akhir job (dari event `end`).
        """
        url = f"{self.client.base_url}/jobs/{job_id}/logs"
        final_status = {"job_id": job_id, "status": "unknown"}

        with self.client.session.get(
            url,
            stream=True,
            headers={"Accept": "text/event-stream"},
            timeout=(5, None),  # connect timeout singkat, read infinite
        ) as resp:
            raise_for_status(resp)

            event_type = "message"
            for raw_line in resp.iter_lines(decode_unicode=True):
                if raw_line is None:
                    continue
                line = raw_line.strip()

                if line.startswith("event:"):
                    event_type = line[6:].strip()
                    continue

                if line.startswith("data:"):
                    payload = line[5:].strip()
                    if event_type == "end":
                        try:
                            final_status = json.loads(payload)
                        except json.JSONDecodeError:
                            pass
                        return final_status
                    if event_type == "error":
                        raise RuntimeError(f"SSE error: {payload}")

                    # event default "message": payload = {"line": "..."}
                    try:
                        data = json.loads(payload)
                        text = data.get("line", payload)
                    except json.JSONDecodeError:
                        text = payload

                    if callback:
                        callback(text)
                    else:
                        print(text, end="", flush=True)

                if line == "":
                    # Akhir satu event SSE — reset event type
                    event_type = "message"

        return final_status
