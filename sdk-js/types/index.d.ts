// Type definitions for aittrain-sdk (core — browser + Node 18+)
// Project: AITTrain agnostic AI training runner

export const DEFAULT_BASE_URL: string;
export const SDK_VERSION: string;

export type JobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface JobStatusInfo {
  job_id: string;
  status: JobStatus;
  entrypoint: string;
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
  exit_code: number | null;
  error: string | null;
  queue_position: number | null;
  artifact_ready: boolean;
}

export interface HealthInfo {
  status: string;
  draining: boolean;
  queued: number;
}

export interface SubmitResult {
  job_id: string;
  status: string;
  entrypoint: string;
}

export interface CancelResult {
  job_id: string;
  status: string;
  cancelled: boolean;
  detail?: string;
}

export interface FileInput {
  name: string;
  blob?: Blob;
  data?: string | Uint8Array | ArrayBuffer;
}

export interface SubmitJobOptions {
  entrypoint?: string;
  files?: Array<File | FileInput>;
  projectZip?: File | FileInput | Blob;
  env?: Record<string, string>;
  signal?: AbortSignal;
}

export interface StreamLogsOptions {
  onLine?: (line: string) => void;
  onEnd?: (final: JobStatusInfo) => void;
  signal?: AbortSignal;
}

export interface WaitOptions {
  pollInterval?: number;
  timeout?: number;
  signal?: AbortSignal;
}

export interface DownloadOptions {
  signal?: AbortSignal;
}

export interface DownloadAndWaitOptions extends WaitOptions {}

export interface ClientOptions {
  apiKey?: string;
  baseUrl?: string;
  timeout?: number;
  fetchImpl?: typeof fetch;
}

export class AITTrainClient {
  constructor(opts?: ClientOptions);
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly timeout: number;

  health(): Promise<HealthInfo>;
  submitJob(opts?: SubmitJobOptions): Promise<SubmitResult>;
  getStatus(jobId: string): Promise<JobStatusInfo>;
  listJobs(opts?: { limit?: number }): Promise<{ count: number; jobs: JobStatusInfo[] }>;
  cancelJob(jobId: string): Promise<CancelResult>;
  isArtifactReady(jobId: string): Promise<boolean>;
  waitUntilFinished(jobId: string, opts?: WaitOptions): Promise<JobStatusInfo>;
  streamLogs(jobId: string, opts?: StreamLogsOptions): Promise<JobStatusInfo>;
  downloadArtifact(jobId: string, opts?: DownloadOptions): Promise<Blob>;
  downloadAndWait(jobId: string, opts?: DownloadAndWaitOptions): Promise<Blob>;
}

export default AITTrainClient;

// --- Exceptions ---
export class AITTrainError extends Error {
  status?: number;
  cause?: unknown;
}
export class AuthenticationError extends AITTrainError {}
export class JobNotFoundError extends AITTrainError {}
export class ArtifactNotFoundError extends AITTrainError {}
export class ServerDrainingError extends AITTrainError {}
export class InvalidPayloadError extends AITTrainError {}
export class JobCancelledError extends AITTrainError {}
export class TimeoutError extends AITTrainError {}

export function raiseForStatus(
  resp: Response,
  opts?: { notFoundClass?: typeof AITTrainError }
): Promise<void>;

// --- SSE ---
export interface SSEEvent {
  event: string;
  data: string;
}
export function streamSSE(
  url: string,
  opts: {
    headers?: Record<string, string>;
    signal?: AbortSignal;
    onEvent: (evt: SSEEvent) => void;
  }
): Promise<void>;

// --- Util ---
export function normalizeFile(input: File | FileInput | Blob): { name: string; blob: Blob };
export function anySignal(...signals: Array<AbortSignal | undefined | null>): AbortSignal | undefined;
export function sleep(ms: number, signal?: AbortSignal): Promise<void>;
