"""
Command-line interface sederhana untuk AITTrain SDK.

Penggunaan:
    aittrain submit --entrypoint train.py --files train.py data.csv
    aittrain logs <job_id>
    aittrain status <job_id>
    aittrain download <job_id> --dest ./results
"""

from __future__ import annotations

import argparse
import os
import sys

from .client import TrainerClient


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="aittrain", description="AITTrain CLI")
    p.add_argument("--api-key", default=os.environ.get("AITTRAIN_API_KEY"))
    p.add_argument("--base-url", default="https://ai-train.axn.cc.cd")
    sub = p.add_subparsers(dest="command", required=True)

    sp = sub.add_parser("submit", help="Kirim job training")
    sp.add_argument("--entrypoint", default="train.py")
    sp.add_argument("--files", nargs="+", required=True, help="File-file untuk diupload")
    sp.add_argument("--project-zip", default=None)
    sp.add_argument("--env", nargs="*", default=[], help="KEY=VALUE pairs")

    sub.add_parser("logs", help="Stream log real-time").add_argument("job_id")
    sub.add_parser("status", help="Cek status job").add_argument("job_id")

    dp = sub.add_parser("download", help="Unduh & ekstrak hasil")
    dp.add_argument("job_id")
    dp.add_argument("--dest", default=".")
    dp.add_argument("--no-extract", action="store_true")
    return p


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    client = TrainerClient(api_key=args.api_key, base_url=args.base_url)

    if args.command == "submit":
        env = dict(pair.split("=", 1) for pair in args.env) if args.env else None
        job_id = client.submit_job(
            entrypoint=args.entrypoint,
            files=args.files,
            project_zip=args.project_zip,
            env=env,
        )
        print(f"Job submitted: {job_id}")
        print(f"  Pantau log : aittrain logs {job_id}")
        print(f"  Unduh hasil: aittrain download {job_id}")

    elif args.command == "logs":
        final = client.stream_logs(args.job_id)
        print(f"\nJob selesai: {final.get('status')} (exit_code={final.get('exit_code')})")

    elif args.command == "status":
        st = client.get_status(args.job_id)
        for k, v in st.items():
            print(f"  {k}: {v}")

    elif args.command == "download":
        path = client.download_result(
            args.job_id, dest_dir=args.dest, extract=not args.no_extract
        )
        print(f"Hasil tersimpan di: {path}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
