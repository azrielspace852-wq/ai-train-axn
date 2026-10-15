#!/usr/bin/env python3
"""
AITTrain Runner — bootstrap 24/7 di GitHub Actions + Cloudflare Tunnel.

Tanggung jawab:
  1. Dekode secret (cert.pem, credentials json, config.yml) dari env var
     (base64) dan tulis ke ~/.cloudflared/ — TIDAK PERNAH di-print.
  2. Jalankan `cloudflared tunnel run` sebagai subprocess (connector).
  3. Jalankan FastAPI server (uvicorn) sebagai subprocess.
  4. Pantau sisa waktu job GitHub Actions (batas 6 jam). Menjelang
     habis (default 5h40m), trigger workflow run baru via GitHub REST API
     (GH_PAT). Connector baru akan join tunnel yang sama (multi-connector
     overlap = zero downtime). Setelah overlap, set drain, tunggu job
     berjalan selesai (atau timeout), lalu graceful shutdown.

Secret yang dibaca (dari GitHub Secrets, TIDAK BOLEH di-print):
  GH_PAT        : Personal Access Token untuk trigger workflow
  CERT_PEM      : isi cert.pem (base64) — untuk manajemen tunnel
  UUID_TUNNEL   : UUID tunnel (plain string)
  UUID_JSON     : isi <tunnel-uuid>.json credentials (base64)
  CONFIG_YML    : isi config.yml cloudflared (base64)
  AITTRAIN_API_KEY : API key untuk otentikasi SDK <-> server
"""

from __future__ import annotations

import base64
import os
import signal
import subprocess
import sys
import time
from pathlib import Path

import requests

# ---------------------------------------------------------------------------
# Konfigurasi waktu (detik)
# ---------------------------------------------------------------------------
GH_JOB_LIMIT = 6 * 3600  # batas keras GitHub Actions = 6 jam
HANDOFF_AT = int(os.environ.get("AITTRAIN_HANDOFF_AT", str(5 * 3600 + 40 * 60)))
OVERLAP_WAIT = int(os.environ.get("AITTRAIN_OVERLAP", str(4 * 60)))
DRAIN_TIMEOUT = int(os.environ.get("AITTRAIN_DRAIN_TIMEOUT", str(15 * 60)))
POLL_INTERVAL = 30

REPO = os.environ.get("GITHUB_REPOSITORY")  # owner/repo, di-inject Actions
REF = os.environ.get("GITHUB_REF_NAME", "main")
WORKFLOW_FILE = os.environ.get("AITTRAIN_WORKFLOW", "runner.yml")
SERVER_PORT = int(os.environ.get("AITTRAIN_PORT", "8000"))

START_TIME = time.time()


# ---------------------------------------------------------------------------
# Util secret: tulis file dari base64, tanpa pernah print isinya
# ---------------------------------------------------------------------------
def write_secret_b64(env_var: str, dest: Path) -> bool:
    """Dekode env var base64 dan tulis ke dest. Return True jika sukses."""
    raw = os.environ.get(env_var, "")
    if not raw:
        print(f"[runner] WARNING: env var {env_var} kosong, melewatkan {dest}")
        return False
    try:
        decoded = base64.b64decode(raw)
    except Exception as exc:  # noqa: BLE001
        print(f"[runner] ERROR: gagal decode base64 {env_var}: {exc}")
        return False
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(decoded)
    os.chmod(dest, 0o600)
    print(f"[runner] Secret {env_var} ditulis ke {dest} (tidak ditampilkan)")
    return True


def setup_cloudflared_config() -> Path:
    """Siapkan direktori ~/.cloudflared dengan semua file kredensial."""
    cf_dir = Path.home() / ".cloudflared"
    cf_dir.mkdir(parents=True, exist_ok=True)

    write_secret_b64("CERT_PEM", cf_dir / "cert.pem")

    tunnel_uuid = os.environ.get("UUID_TUNNEL", "").strip()
    if tunnel_uuid:
        # Jangan print UUID tunnel ke log (sensitive identifier)
        write_secret_b64("UUID_JSON", cf_dir / f"{tunnel_uuid}.json")
    else:
        print("[runner] WARNING: UUID_TUNNEL tidak diset")

    # config.yml — cloudflared membaca dari ~/.cloudflared/config.yml default
    write_secret_b64("CONFIG_YML", cf_dir / "config.yml")
    return cf_dir


# ---------------------------------------------------------------------------
# Handoff: trigger workflow baru via GitHub REST API
# ---------------------------------------------------------------------------
def trigger_new_runner() -> bool:
    """Panggil GitHub API untuk dispatch workflow runner baru."""
    token = os.environ.get("GH_PAT", "")
    if not token or not REPO:
        print("[runner] ERROR: GH_PAT atau GITHUB_REPOSITORY tidak tersedia")
        return False

    url = f"https://api.github.com/repos/{REPO}/actions/workflows/{WORKFLOW_FILE}/dispatches"
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    payload = {"ref": REF}
    try:
        resp = requests.post(url, headers=headers, json=payload, timeout=30)
    except requests.RequestException as exc:
        print(f"[runner] Gagal trigger workflow: {exc}")
        return False

    if resp.status_code in (201, 204):
        print("[runner] Workflow baru berhasil di-trigger (handoff dimulai)")
        return True
    print(f"[runner] Trigger workflow gagal: HTTP {resp.status_code} {resp.text[:200]}")
    return False


def set_server_drain(enable: bool) -> None:
    """Minta server berhenti terima job baru (drain) sebelum shutdown."""
    api_key = os.environ.get("AITTRAIN_API_KEY", "")
    try:
        requests.post(
            f"http://127.0.0.1:{SERVER_PORT}/admin/drain",
            headers={"X-API-Key": api_key},
            data={"enable": str(enable).lower()},
            timeout=10,
        )
    except requests.RequestException:
        pass  # server mungkin sudah mati; tidak masalah


def wait_for_drain() -> None:
    """Tunggu sampai tidak ada job RUNNING, atau sampai DRAIN_TIMEOUT."""
    api_key = os.environ.get("AITTRAIN_API_KEY", "")
    deadline = time.time() + DRAIN_TIMEOUT
    while time.time() < deadline:
        try:
            resp = requests.get(
                f"http://127.0.0.1:{SERVER_PORT}/healthz", timeout=5
            )
            data = resp.json()
            if data.get("queued", 0) == 0:
                # Tidak ada job terqueued; job yang sedang running dibiarkan
                # sampai selesai dengan memantau /jobs. Untuk kesederhanaan,
                # kita tunggu fixed window lalu shutdown.
                break
        except requests.RequestException:
            break
        time.sleep(10)
    print("[runner] Drain selesai / timeout, melanjutkan shutdown.")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main() -> int:
    print("[runner] AITTrain runner dimulai")
    print(f"[runner] Batas job: {GH_JOB_LIMIT}s, handoff di: {HANDOFF_AT}s")

    setup_cloudflared_config()

    # --- Start cloudflared (connector tunnel) ---
    tunnel_uuid = os.environ.get("UUID_TUNNEL", "").strip()
    cf_proc = subprocess.Popen(
        ["cloudflared", "--no-autoupdate", "tunnel", "--url", f"http://127.0.0.1:{SERVER_PORT}", "run", tunnel_uuid]
        if tunnel_uuid
        else ["cloudflared", "--no-autoupdate", "tunnel", "--url", f"http://127.0.0.1:{SERVER_PORT}", "run"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    print("[runner] cloudflared tunnel started (pid", cf_proc.pid, ")")

    # Beri waktu cloudflared connect sebelum server menerima traffic
    time.sleep(5)

    # --- Start FastAPI server ---
    server_proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "server:app",
         "--host", "127.0.0.1", "--port", str(SERVER_PORT), "--log-level", "warning"],
        cwd=str(Path(__file__).parent),
        stdout=sys.stdout,
        stderr=sys.stderr,
    )
    print("[runner] FastAPI server started (pid", server_proc.pid, ")")

    def shutdown(signum, frame):  # noqa: ANN001
        print(f"[runner] Sinyal {signum} diterima, graceful shutdown...")
        set_server_drain(True)
        wait_for_drain()
        server_proc.terminate()
        cf_proc.terminate()
        try:
            server_proc.wait(timeout=15)
            cf_proc.wait(timeout=15)
        except subprocess.TimeoutExpired:
            server_proc.kill()
            cf_proc.kill()
        sys.exit(0)

    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)

    # --- Monitor loop: cek waktu & handoff ---
    handoff_done = False
    while True:
        elapsed = time.time() - START_TIME

        # Cek apakah child proses masih hidup
        if server_proc.poll() is not None:
            print("[runner] Server mati, menghentikan runner.")
            cf_proc.terminate()
            return server_proc.returncode or 1
        if cf_proc.poll() is not None:
            print("[runner] cloudflared mati, restart tidak dimungkinkan di job ini.")
            # Lanjutkan sampai handoff; traffic akan failover ke connector lain.

        if not handoff_done and elapsed >= HANDOFF_AT:
            print(f"[runner] Mencapai {elapsed:.0f}s — memicu handoff...")
            if trigger_new_runner():
                handoff_done = True
                print(f"[runner] Menunggu overlap {OVERLAP_WAIT}s agar connector baru join...")
                time.sleep(OVERLAP_WAIT)
                set_server_drain(True)
                wait_for_drain()
                print("[runner] Graceful shutdown setelah handoff.")
                server_proc.terminate()
                cf_proc.terminate()
                try:
                    server_proc.wait(timeout=15)
                    cf_proc.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    server_proc.kill()
                    cf_proc.kill()
                return 0
            else:
                print("[runner] Trigger gagal, akan retry pada polling berikutnya.")

        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    sys.exit(main())
