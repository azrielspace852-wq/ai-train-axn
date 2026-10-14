// Type definitions for aittrain-sdk/browser (browser helper + core re-export)

export * from "./index.d";

/** Simpan Blob ke file di browser (memicu unduhan). */
export function saveBlob(blob: Blob, filename: string): void;

/** Unduh artefak job lalu simpan ke file di browser. */
export function downloadAndSave(
  client: import("./index.d").AITTrainClient,
  jobId: string,
  filename?: string
): Promise<void>;
