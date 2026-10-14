"""
AITTrain SDK — klien Python untuk platform training AI agnostik.

Pengguna cukup:
    from aittrain import TrainerClient

    client = TrainerClient(api_key="...")
    job_id = client.submit_job(entrypoint="train.py", files=["train.py", "data.csv"])
    client.stream_logs(job_id)              # tampilkan log real-time di terminal
    client.download_result(job_id, "./out") # unduh & ekstrak hasil
"""

from .client import TrainerClient
from .exceptions import (
    AITTrainError,
    AuthenticationError,
    JobNotFoundError,
    ArtifactNotFoundError,
    ServerDrainingError,
)
from .stream import LogStreamer
from .download import ResultDownloader

__version__ = "1.0.0"
__all__ = [
    "TrainerClient",
    "LogStreamer",
    "ResultDownloader",
    "AITTrainError",
    "AuthenticationError",
    "JobNotFoundError",
    "ArtifactNotFoundError",
    "ServerDrainingError",
]
