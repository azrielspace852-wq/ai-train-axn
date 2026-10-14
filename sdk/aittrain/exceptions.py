"""Exception khusus untuk AITTrain SDK."""


class AITTrainError(Exception):
    """Base exception untuk semua error SDK."""


class AuthenticationError(AITTrainError):
    """API key tidak valid / tidak disediakan (HTTP 401)."""


class JobNotFoundError(AITTrainError):
    """Job ID tidak dikenal oleh server (HTTP 404)."""


class ArtifactNotFoundError(AITTrainError):
    """Artefak .zip belum tersedia (training belum selesai / output kosong)."""


class ServerDrainingError(AITTrainError):
    """Server sedang handoff dan menolak job baru (HTTP 503). Coba lagi sebentar."""


class InvalidPayloadError(AITTrainError):
    """Payload / file yang dikirim tidak valid (HTTP 400)."""


def raise_for_status(resp) -> None:
    """Konversi HTTP error response menjadi exception SDK yang sesuai."""
    if resp.status_code < 400:
        return
    mapping = {
        401: AuthenticationError,
        404: JobNotFoundError,
        503: ServerDrainingError,
        400: InvalidPayloadError,
    }
    exc_cls = mapping.get(resp.status_code, AITTrainError)
    try:
        detail = resp.json().get("detail", resp.text[:200])
    except Exception:  # noqa: BLE001
        detail = resp.text[:200]
    raise exc_cls(f"HTTP {resp.status_code}: {detail}")
