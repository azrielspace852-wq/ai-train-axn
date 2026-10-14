"""
Contoh penggunaan AITTrain SDK end-to-end.

Alur:
  1. Submit job (upload kode training + dataset)
  2. Stream log real-time ke terminal
  3. Setelah selesai, unduh & ekstrak artefak .zip

Jalankan:
    AITTRAIN_API_KEY=kunci_anda python train_and_monitor.py
"""

from aittrain import TrainerClient

FILES_TO_UPLOAD = [
    "user_training_script.py",   # kode training pengguna (apa pun framework-nya)
    "config.json",               # config pengguna (format bebas)
    "dataset.csv",               # dataset pengguna (format bebas)
]


def main():
    with TrainerClient() as client:
        # 1. Submit
        job_id = client.submit_job(
            entrypoint="user_training_script.py",
            files=FILES_TO_UPLOAD,
            env={"BATCH_SIZE": "32", "EPOCHS": "10"},
        )
        print(f"[+] Job submitted: {job_id}")

        # 2. Stream log real-time (blokir sampai selesai)
        final_status = client.stream_logs(job_id)
        print(f"\n[+] Status akhir: {final_status['status']}")

        # 3. Unduh hasil (otomatis tunggu artefak siap)
        if final_status["status"] == "completed":
            out_dir = client.download_result(job_id, dest_dir="./results")
            print(f"[+] Hasil training diekstrak ke: {out_dir}")
        else:
            print("[!] Training gagal, tidak ada artefak untuk diunduh.")


if __name__ == "__main__":
    main()
