/**
 * app.js — Contoh pemakaian AITTrain SDK LANGSUNG dari kode web (file .js),
 * TANPA server backend, TANPA Node.js, TANPA build step.
 *
 * Cara pakai di proyek web Anda:
 *   1. Salin `dist/aittrain.browser.js` ke folder proyek web Anda.
 *   2. Di file .js Anda (mis. app.js ini), import SDK:
 *        import { AITTrainClient, saveBlob } from "./aittrain.browser.js";
 *   3. Panggil server seperti biasa: submitJob, streamLogs, downloadAndWait.
 *   4. Muat app.js dari HTML dengan: <script type="module" src="app.js"></script>
 *
 * SDK ini memanggil server AITTrain (https://ai-train.axn.cc.cd) langsung
 * dari browser via fetch + CORS (server sudah mengaktifkan CORS). API key
 * dikirim dari browser — hanya pakai di lingkungan terpercaya.
 */

// === IMPORT SDK (tanpa server, tanpa backend) ===
import { AITTrainClient, saveBlob } from "../../dist/aittrain.browser.js";

let client = null;
let currentJobId = null;
let streaming = false;

const $ = (id) => document.getElementById(id);

function makeClient() {
  if (client) return client;
  const apiKey = $("apiKey").value.trim();
  const baseUrl = $("baseUrl").value.trim();
  if (!apiKey) throw new Error("API Key wajib diisi.");
  client = new AITTrainClient({ apiKey, baseUrl });
  return client;
}

function setMsg(id, text, ok) {
  const el = $(id);
  el.textContent = text;
  el.style.color = ok ? "#34d399" : ok === false ? "#f87171" : "#94a3b8";
}

function setStatusBadge(status) {
  const el = $("statusBadge");
  el.textContent = status || "-";
  el.className = "badge " + (status || "");
}

// --- 1. Health check ---
window.checkHealth = async () => {
  try {
    const h = await makeClient().health();
    setMsg("healthMsg", `ok — draining=${h.draining}, queued=${h.queued}`, true);
  } catch (e) { setMsg("healthMsg", "gagal: " + e.message, false); }
};

// --- 2. Submit job ---
window.submitJob = async () => {
  try {
    const c = makeClient();
    const entrypoint = $("entrypoint").value.trim() || "train.py";
    const files = Array.from($("files").files); // FileList -> diterima langsung SDK
    if (files.length === 0) { alert("Pilih minimal satu file training."); return; }
    let env = {};
    try { env = JSON.parse($("envJson").value || "{}"); }
    catch { alert("Env JSON tidak valid."); return; }

    setMsg("submitMsg", "mengupload...", null);
    const res = await c.submitJob({ entrypoint, files, env });
    currentJobId = res.job_id;
    $("jobId").textContent = currentJobId;
    setStatusBadge(res.status);
    setMsg("submitMsg", `job ${currentJobId} submitted`, true);
    $("logs").textContent = "";
    $("downloadBtn").disabled = true;
  } catch (e) { setMsg("submitMsg", "gagal: " + e.message, false); }
};

// --- 3. Status ---
window.refreshStatus = async () => {
  if (!currentJobId) return;
  try {
    const st = await makeClient().getStatus(currentJobId);
    setStatusBadge(st.status);
    $("statusDetail").textContent =
      `exit_code=${st.exit_code} artifact_ready=${st.artifact_ready} queue_pos=${st.queue_position ?? "-"}` +
      (st.error ? " | error: " + st.error : "");
    if (st.artifact_ready) $("downloadBtn").disabled = false;
  } catch (e) { $("statusDetail").textContent = e.message; }
};

// --- 4. Stream log real-time (SSE via fetch, bukan EventSource) ---
window.streamLogs = async () => {
  if (!currentJobId || streaming) return;
  streaming = true;
  const pre = $("logs");
  pre.textContent = "";
  try {
    const final = await makeClient().streamLogs(currentJobId, {
      onLine: (line) => { pre.textContent += line; pre.scrollTop = pre.scrollHeight; },
    });
    setStatusBadge(final.status);
    setMsg("downloadMsg", `selesai: ${final.status}`, final.status === "completed");
    if (final.artifact_ready) $("downloadBtn").disabled = false;
  } catch (e) {
    pre.textContent += "\n[stream error] " + e.message;
  } finally { streaming = false; }
};

// --- 5. Cancel ---
window.cancelJob = async () => {
  if (!currentJobId || !confirm("Batalkan job " + currentJobId + "?")) return;
  try {
    const res = await makeClient().cancelJob(currentJobId);
    $("statusDetail").textContent = JSON.stringify(res);
    refreshStatus();
  } catch (e) { alert(e.message); }
};

// --- 6. Download artefak (Blob -> saveBlob trigger unduhan browser) ---
window.downloadArtifact = async () => {
  if (!currentJobId) return;
  const btn = $("downloadBtn");
  btn.disabled = true;
  setMsg("downloadMsg", "mengunduh (menunggu artefak siap)...", null);
  try {
    const blob = await makeClient().downloadAndWait(currentJobId);
    saveBlob(blob, currentJobId + ".zip");
    setMsg("downloadMsg", "unduhan dimulai: " + currentJobId + ".zip", true);
  } catch (e) { setMsg("downloadMsg", "gagal: " + e.message, false); }
  btn.disabled = false;
};

// --- 7. List jobs ---
window.listJobs = async () => {
  try {
    const { jobs } = await makeClient().listJobs({ limit: 20 });
    const div = $("jobsList");
    if (!jobs.length) { div.textContent = "tidak ada job."; return; }
    div.innerHTML = "<table><tr><th>job_id</th><th>status</th><th>entrypoint</th><th></th></tr>" +
      jobs.map((j) => `<tr><td><code>${j.job_id}</code></td><td>${j.status}</td><td>${j.entrypoint}</td>` +
        `<td><button class="secondary" onclick="loadJob('${j.job_id}')">pilih</button></td></tr>`).join("") +
      "</table>";
  } catch (e) { $("jobsList").textContent = "gagal: " + e.message; }
};

window.loadJob = (id) => {
  currentJobId = id;
  $("jobId").textContent = id;
  $("logs").textContent = "";
  refreshStatus();
};
