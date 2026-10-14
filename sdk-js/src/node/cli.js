/**
 * CLI untuk AITTrain JavaScript SDK.
 * (Shebang ditambahkan saat build oleh esbuild banner.)
 *
 *   aittrain-js submit --entrypoint train.py --files train.py data.csv [--project-dir ./src] [--env KEY=VAL ...]
 *   aittrain-js logs <job_id>
 *   aittrain-js status <job_id>
 *   aittrain-js list [--limit 50]
 *   aittrain-js cancel <job_id>
 *   aittrain-js download <job_id> --dest ./results [--no-extract] [--keep-zip]
 *
 * API key: --api-key atau env AITTRAIN_API_KEY.
 * Base URL: --base-url atau env AITTRAIN_BASE_URL (default https://ai-train.axn.cc.cd).
 */

import process from "node:process";
import { pathToFileURL } from "node:url";
import { NodeAITTrainClient, DEFAULT_BASE_URL } from "./index.js";

function usage() {
  console.log(`AITTrain JS SDK CLI
Penggunaan:
  aittrain-js submit --entrypoint <file> --files <f1> [f2...] [--project-dir <dir>|--project-zip <zip>] [--env K=V ...]
  aittrain-js logs <job_id>
  aittrain-js status <job_id>
  aittrain-js list [--limit N]
  aittrain-js cancel <job_id>
  aittrain-js download <job_id> [--dest DIR] [--no-extract] [--keep-zip]
Opsi global: --api-key <key> --base-url <url> --timeout <ms>`);
}

function parseArgs(argv) {
  const opts = { _: [], env: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--api-key") opts.apiKey = argv[++i];
    else if (a === "--base-url") opts.baseUrl = argv[++i];
    else if (a === "--timeout") opts.timeout = Number(argv[++i]);
    else if (a === "--entrypoint") opts.entrypoint = argv[++i];
    else if (a === "--files") {
      opts.files = [];
      while (i + 1 < argv.length && !argv[i + 1].startsWith("--")) opts.files.push(argv[++i]);
    } else if (a === "--project-dir") opts.projectDir = argv[++i];
    else if (a === "--project-zip") opts.projectZipPath = argv[++i];
    else if (a === "--env") {
      while (i + 1 < argv.length && !argv[i + 1].startsWith("--")) opts.env.push(argv[++i]);
    } else if (a === "--dest") opts.dest = argv[++i];
    else if (a === "--limit") opts.limit = Number(argv[++i]);
    else if (a === "--no-extract") opts.extract = false;
    else if (a === "--keep-zip") opts.keepZip = true;
    else if (a === "--help" || a === "-h") opts.help = true;
    else opts._.push(a);
  }
  return opts;
}

function parseEnvPairs(pairs) {
  const out = {};
  for (const p of pairs || []) {
    const idx = p.indexOf("=");
    if (idx < 0) {
      console.error(`Env pair tidak valid (butuh KEY=VALUE): ${p}`);
      process.exit(2);
    }
    out[p.slice(0, idx)] = p.slice(idx + 1);
  }
  return out;
}

export async function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  if (opts.help || opts._.length === 0) {
    usage();
    process.exit(opts.help ? 0 : 1);
  }
  const [command, ...positional] = opts._;
  const client = new NodeAITTrainClient({
    apiKey: opts.apiKey,
    baseUrl: opts.baseUrl || process.env.AITTRAIN_BASE_URL || DEFAULT_BASE_URL,
    timeout: opts.timeout,
  });

  try {
    switch (command) {
      case "submit": {
        if (!opts.files && !opts.projectDir && !opts.projectZipPath) {
          console.error("submit membutuhkan --files, --project-dir, atau --project-zip.");
          process.exit(2);
        }
        const res = await client.submitJobFromPaths({
          entrypoint: opts.entrypoint || "train.py",
          files: opts.files || [],
          projectDir: opts.projectDir,
          projectZipPath: opts.projectZipPath,
          env: parseEnvPairs(opts.env),
        });
        console.log(`Job submitted: ${res.job_id}`);
        console.log(`  Pantau log : aittrain-js logs ${res.job_id}`);
        console.log(`  Unduh hasil: aittrain-js download ${res.job_id}`);
        break;
      }
      case "logs": {
        const jobId = positional[0];
        if (!jobId) { console.error("logs membutuhkan <job_id>"); process.exit(2); }
        const final = await client.streamLogs(jobId, { onLine: (l) => process.stdout.write(l) });
        console.log(`\nJob selesai: ${final.status} (exit_code=${final.exit_code})`);
        if (final.error) console.log(`  error: ${final.error}`);
        break;
      }
      case "status": {
        const jobId = positional[0];
        if (!jobId) { console.error("status membutuhkan <job_id>"); process.exit(2); }
        const st = await client.getStatus(jobId);
        for (const [k, v] of Object.entries(st)) console.log(`  ${k}: ${v}`);
        break;
      }
      case "list": {
        const { jobs } = await client.listJobs({ limit: opts.limit || 100 });
        console.log(`Total jobs: ${jobs.length}`);
        for (const j of jobs) {
          console.log(`  ${j.job_id}  ${j.status.padEnd(10)} ${j.entrypoint}  artifact_ready=${j.artifact_ready}`);
        }
        break;
      }
      case "cancel": {
        const jobId = positional[0];
        if (!jobId) { console.error("cancel membutuhkan <job_id>"); process.exit(2); }
        const res = await client.cancelJob(jobId);
        console.log(JSON.stringify(res, null, 2));
        break;
      }
      case "download": {
        const jobId = positional[0];
        if (!jobId) { console.error("download membutuhkan <job_id>"); process.exit(2); }
        const out = await client.downloadToFile(jobId, opts.dest || ".", {
          extract: opts.extract !== false,
          keepZip: Boolean(opts.keepZip),
        });
        console.log(`Hasil tersimpan di: ${out}`);
        break;
      }
      default:
        console.error(`Perintah tidak dikenal: ${command}`);
        usage();
        process.exit(1);
    }
  } catch (err) {
    console.error(`[aittrain-js] ${err.name || "Error"}: ${err.message}`);
    process.exit(1);
  }
}

// Jalankan hanya jika dieksekusi langsung (bukan di-import saat test).
// Dual-mode: ESM source pakai import.meta.url; CJS bundle pakai require.main.
const isMain = (() => {
  try {
    if (import.meta && import.meta.url) {
      return import.meta.url === pathToFileURL(process.argv[1]).href;
    }
  } catch {
    /* ESM meta tidak tersedia (CJS bundle) */
  }
  try {
    return require.main === module;
  } catch {
    return false;
  }
})();
if (isMain) main();
