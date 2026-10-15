"""
Contoh SKRIP TRAINING PENGGUNA (yang di-upload ke server).

PENTING: Server AITTrain tidak peduli isi skrip ini — bisa PyTorch,
JAX, HuggingFace, scikit-learn, atau apa pun. Server hanya:
  - menjalankan `python <entrypoint>`
  - menangkap stdout/stderr untuk telemetri
  - meng-zip isi $AITT_OUTPUT_DIR setelah selesai

KONTRAK WAJIB (satu-satunya):
  Tulis semua hasil (checkpoint, model final, metrik) ke direktori
  $AITT_OUTPUT_DIR (atau os.environ["AITT_OUTPUT_DIR"]).
  Isi direktori itulah yang akan di-zip dan dikirim ke pengguna.

Untuk telemetri yang bagus, cukup print() metrik secara berkala —
SDK akan menampilkannya real-time di terminal pengguna.
"""

import json
import os
import time

OUTPUT_DIR = os.environ["AITT_OUTPUT_DIR"]
BATCH_SIZE = int(os.environ.get("BATCH_SIZE", "32"))
EPOCHS = int(os.environ.get("EPOCHS", "5"))


def main():
    print(f"[train] Mulai training. output_dir={OUTPUT_DIR}")
    print(f"[train] batch_size={BATCH_SIZE} epochs={EPOCHS}")

    losses = []
    for epoch in range(1, EPOCHS + 1):
        # --- Logika training pengguna (bebas framework) ---
        loss = 1.0 / epoch  # dummy; ganti dengan loop training nyata
        ema = sum(losses[-10:]) / max(len(losses[-10:]), 1) if losses else loss
        losses.append(loss)

        # Print metrik -> tertangkap server -> tampil real-time di SDK
        print(f"epoch={epoch} loss={loss:.4f} ema={ema:.4f}", flush=True)
        time.sleep(1)  # simulasi komputasi

    # --- Simpan hasil ke OUTPUT_DIR (wajib agar ter-zip) ---
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    with open(os.path.join(OUTPUT_DIR, "metrics.json"), "w") as f:
        json.dump({"final_loss": losses[-1], "losses": losses}, f, indent=2)

    # Contoh: simpan "model" (dummy). Ganti dengan torch.save / safetensors / dll.
    with open(os.path.join(OUTPUT_DIR, "model_final.txt"), "w") as f:
        f.write("ini adalah artefak model hasil training\n")

    print(f"[train] Selesai. Artefak ditulis ke {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
