/**
 * Entry point khusus Node.js.
 *
 *   import { NodeAITTrainClient } from "aittrain-sdk/node";
 *   // atau: const { NodeAITTrainClient } = require("aittrain-sdk/node");
 *
 * Menambah kemampuan: baca file dari path, zip direktori in-memory,
 * simpan unduhan ke disk, ekstrak .zip hasil training, dan CLI.
 */

import fs from "node:fs";
import path from "node:path";
import { AITTrainClient } from "../core/client.js";
import { ArtifactNotFoundError, JobCancelledError, TimeoutError } from "../core/exceptions.js";
import { fileFromPath, filesFromPaths, saveBlobToFile, blobToBuffer } from "./fsutil.js";
import { zipFiles, zipDirectory } from "./zip.js";
import { extractZip } from "./unzip.js";

// Re-export semua simbol inti + util node.
export * from "../index.js";
export { fileFromPath, filesFromPaths, saveBlobToFile, blobToBuffer, zipFiles, zipDirectory, extractZip };

export class NodeAITTrainClient extends AITTrainClient {
  /**
   * Submit job dengan path file di disk (tidak perlu baca manual).
   * @param {Object} opts
   * @param {string} [opts.entrypoint="train.py"]
   * @param {string[]} [opts.files=[]] — path file individual.
   * @param {string} [opts.projectZipPath] — path ke file .zip yang sudah jadi.
   * @param {string} [opts.projectDir] — path direktori; akan di-zip in-memory lalu dikirim sebagai project_zip.
   * @param {Record<string,string>} [opts.env={}]
   * @param {AbortSignal} [opts.signal]
   * @returns {Promise<{job_id:string, status:string, entrypoint:string}>}
   */
  async submitJobFromPaths({
    entrypoint = "train.py",
    files = [],
    projectZipPath,
    projectDir,
    env = {},
    signal,
  } = {}) {
    const uploads = filesFromPaths(files);
    let projectZip = null;
    if (projectZipPath) {
      projectZip = fileFromPath(projectZipPath);
    } else if (projectDir) {
      const buf = zipDirectory(projectDir, { prefix: "" });
      projectZip = { name: "project.zip", blob: new Blob([buf]) };
    }
    return this.submitJob({ entrypoint, files: uploads, projectZip, env, signal });
  }

  /**
   * Unduh artefak .zip dan simpan ke disk. Jika extract=true, isi zip
   * diekstrak ke subdirektori <job_id>/ dan file zip dihapus (kecuali keepZip).
   * @param {string} jobId
   * @param {string} dest — direktori tujuan (file zip atau folder ekstrak dibuat di dalamnya).
   * @param {Object} [opts]
   * @param {boolean} [opts.extract=true]
   * @param {boolean} [opts.wait=true] — poll sampai artefak siap.
   * @param {number} [opts.pollInterval=10000] — ms.
   * @param {boolean} [opts.keepZip=false] — jangan hapus zip setelah ekstrak.
   * @param {AbortSignal} [opts.signal]
   * @returns {Promise<string>} path direktori hasil ekstrak, atau path file zip.
   */
  async downloadToFile(jobId, dest = ".", { extract = true, wait = true, pollInterval = 10_000, keepZip = false, signal } = {}) {
    const destAbs = path.resolve(dest);
    fs.mkdirSync(destAbs, { recursive: true });
    const zipPath = path.join(destAbs, `${jobId}.zip`);

    const blob = wait
      ? await this.downloadAndWait(jobId, { pollInterval, signal })
      : await this.downloadArtifact(jobId, { signal });

    await saveBlobToFile(blob, zipPath);

    if (!extract) return zipPath;

    const extractDir = path.join(destAbs, jobId);
    fs.mkdirSync(extractDir, { recursive: true });
    const buf = fs.readFileSync(zipPath);
    extractZip(buf, extractDir);
    if (!keepZip) fs.unlinkSync(zipPath);
    return extractDir;
  }
}

/** Factory singkat. @param {Object} opts @returns {NodeAITTrainClient} */
export function createNodeClient(opts = {}) {
  return new NodeAITTrainClient(opts);
}

export default NodeAITTrainClient;
