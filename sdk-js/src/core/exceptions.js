/**
 * Exception khusus untuk AITTrain JavaScript SDK.
 * Semua error yang dilempar SDK adalah turunan dari AITTrainError.
 */

export class AITTrainError extends Error {
  constructor(message, { cause, status } = {}) {
    super(message);
    this.name = "AITTrainError";
    if (cause) this.cause = cause;
    if (status) this.status = status;
  }
}

/** API key tidak valid / tidak disediakan (HTTP 401). */
export class AuthenticationError extends AITTrainError {
  constructor(message, opts) {
    super(message, opts);
    this.name = "AuthenticationError";
    this.status = 401;
  }
}

/** Job ID tidak dikenal oleh server (HTTP 404 pada /status, /logs, /download). */
export class JobNotFoundError extends AITTrainError {
  constructor(message, opts) {
    super(message, opts);
    this.name = "JobNotFoundError";
    this.status = 404;
  }
}

/** Artefak .zip belum tersedia (training belum selesai / output kosong). */
export class ArtifactNotFoundError extends AITTrainError {
  constructor(message, opts) {
    super(message, opts);
    this.name = "ArtifactNotFoundError";
    this.status = 404;
  }
}

/** Server sedang handoff dan menolak job baru (HTTP 503). Coba lagi sebentar. */
export class ServerDrainingError extends AITTrainError {
  constructor(message, opts) {
    super(message, opts);
    this.name = "ServerDrainingError";
    this.status = 503;
  }
}

/** Payload / file yang dikirim tidak valid (HTTP 400). */
export class InvalidPayloadError extends AITTrainError {
  constructor(message, opts) {
    super(message, opts);
    this.name = "InvalidPayloadError";
    this.status = 400;
  }
}

/** Job dibatalkan (status cancelled). */
export class JobCancelledError extends AITTrainError {
  constructor(message, opts) {
    super(message, opts);
    this.name = "JobCancelledError";
  }
}

/** Timeout menunggu job selesai / artefak siap. */
export class TimeoutError extends AITTrainError {
  constructor(message, opts) {
    super(message, opts);
    this.name = "TimeoutError";
  }
}

const STATUS_MAP = {
  401: AuthenticationError,
  404: JobNotFoundError,
  503: ServerDrainingError,
  400: InvalidPayloadError,
};

/**
 * Konversi HTTP error response menjadi exception SDK yang sesuai.
 * Untuk endpoint /download, 404 dipetakan ke ArtifactNotFoundError oleh pemanggil.
 */
export async function raiseForStatus(resp, { notFoundClass = JobNotFoundError } = {}) {
  if (resp.ok) return;
  let detail = "";
  try {
    const j = await resp.json();
    detail = (j && (j.detail || j.message)) || JSON.stringify(j);
  } catch {
    try {
      detail = (await resp.text()).slice(0, 200);
    } catch {
      detail = resp.statusText || "";
    }
  }
  const Cls = resp.status === 404 ? notFoundClass : STATUS_MAP[resp.status] || AITTrainError;
  throw new Cls(`HTTP ${resp.status}: ${detail}`, { cause: resp, status: resp.status });
}
