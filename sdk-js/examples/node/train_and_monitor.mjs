/**
 * Contoh end-to-end AITTrain JavaScript SDK (Node.js).
 *
 * Alur:
 *   1. Submit job (upload kode training + dataset, atau zip direktori project)
 *   2. Stream log real-time ke terminal
 *   3. Setelah selesai, unduh & ekstrak artefak .zip
 *
 * Jalankan:
 *   AITTRAIN_API_KEY=kunci_anda node train_and_monitor.mjs
 *
 * Atau untuk development lokal (server berjalan di localhost:8000 tanpa API key):
 *   AITTRAIN_API_KEY=dev AITTRAIN_BASE_URL=http://127.0.0.1:8000 node train_and_monitor.mjs
 */

import { NodeAITTrainClient, DEFAULT_BASE_URL } from "aittrain-sdk/node";
// Jika belum npm install, impor dari source:
// import { NodeAITTrainClient } from "../src/node/index.js";

const baseUrl = process.env.AITTRAIN_BASE_URL || DEFAULT_BASE_URL;

const client = new NodeAITTrainClient({
  // apiKey diambil otomatis dari env AITTRAIN_API_KEY
  baseUrl,
});

async function main() {
  // --- Opsi A: upload file individual ---
  const job = await client.submitJobFromPaths({
    entrypoint: "user_training_script.py",
    files: ["user_training_script.py", "config.json", "dataset.csv"],
    env: { BATCH_SIZE: "32", EPOCHS: "10" },
  });

  // --- Opsi B: zip seluruh direktori project in-memory lalu upload ---
  // const job = await client.submitJobFromPaths({
  //   entrypoint: "train.py",
  //   projectDir: "./my-training-project",   // otomatis di-zip
  //   env: { BATCH_SIZE: "32" },
  // });

  console.log(`[+] Job submitted: ${job.job_id}`);

  // --- Stream log real-time (resolve saat job selesai) ---
  const final = await client.streamLogs(job.job_id, {
    onLine: (line) => process.stdout.write(line),
  });
  console.log(`\n[+] Status akhir: ${final.status} (exit_code=${final.exit_code})`);

  // --- Unduh hasil (otomatis tunggu artefak siap, lalu ekstrak) ---
  if (final.status === "completed") {
    const outDir = await client.downloadToFile(job.job_id, "./results", { extract: true });
    console.log(`[+] Hasil training diekstrak ke: ${outDir}`);
  } else {
    console.log("[!] Training tidak completed, tidak ada artefak.");
  }
}

main().catch((err) => {
  console.error(`[!] ${err.name}: ${err.message}`);
  process.exit(1);
});
