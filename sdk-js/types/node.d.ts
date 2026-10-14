// Type definitions for aittrain-sdk/node (Node.js extensions)

export * from "./index.d";

import { AITTrainClient, SubmitJobOptions, DownloadAndWaitOptions } from "./index.d";

export interface ZipEntry {
  path: string;
  data: Buffer | string | Uint8Array;
}

export function zipFiles(
  entries: ZipEntry[] | Record<string, Buffer | string> | Map<string, Buffer | string>
): Buffer;

export function zipDirectory(
  dir: string,
  opts?: { ignore?: string[]; prefix?: string }
): Buffer;

export function extractZip(zipBuf: Buffer, destDir: string): string[];

export function fileFromPath(filePath: string): { name: string; blob: Blob };
export function filesFromPaths(paths: string[]): Array<{ name: string; blob: Blob }>;
export function blobToBuffer(blob: Blob): Promise<Buffer>;
export function saveBlobToFile(blob: Blob, destPath: string): Promise<string>;

export interface SubmitFromPathsOptions {
  entrypoint?: string;
  files?: string[];
  projectZipPath?: string;
  projectDir?: string;
  env?: Record<string, string>;
  signal?: AbortSignal;
}

export interface DownloadToFileOptions {
  extract?: boolean;
  wait?: boolean;
  pollInterval?: number;
  keepZip?: boolean;
  signal?: AbortSignal;
}

export class NodeAITTrainClient extends AITTrainClient {
  submitJobFromPaths(opts?: SubmitFromPathsOptions): Promise<import("./index.d").SubmitResult>;
  downloadToFile(
    jobId: string,
    dest?: string,
    opts?: DownloadToFileOptions
  ): Promise<string>;
}

export function createNodeClient(opts?: import("./index.d").ClientOptions): NodeAITTrainClient;

export default NodeAITTrainClient;
