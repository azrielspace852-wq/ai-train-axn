#!/usr/bin/env node
/**
 * Build script: bundle SDK dengan esbuild.
 *   dist/aittrain.mjs   — ESM (browser + Node import)
 *   dist/aittrain.cjs   — CommonJS (Node require)
 *   dist/aittrain.min.js — IIFE minified (global AITTrain, untuk <script src>)
 *   dist/node.cjs       — CommonJS entry khusus Node (fs/zip/unzip)
 *   dist/cli.cjs        — CLI executable (dengan shebang)
 *   dist/*.d.ts         — definisi tipe TypeScript (disalin dari types/)
 */
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
fs.mkdirSync(dist, { recursive: true });

const common = {
  bundle: true,
  sourcemap: true,
  target: ["es2020", "node18"],
  logLevel: "info",
};

// Core — platform netral
await build({
  ...common,
  entryPoints: [path.join(root, "src/index.js")],
  outfile: path.join(dist, "aittrain.mjs"),
  format: "esm",
  platform: "neutral",
  mainFields: ["module", "main"],
});
await build({
  ...common,
  entryPoints: [path.join(root, "src/index.js")],
  outfile: path.join(dist, "aittrain.cjs"),
  format: "cjs",
  platform: "neutral",
});
// Browser SDK — inti + helper saveBlob (tanpa API Node).
//   dist/aittrain.browser.js — ESM unminified: SDK utama untuk dipanggil
//                              langsung dari file .js di kode web (tanpa
//                              server/backend, tanpa build step).
//   dist/aittrain.min.js     — IIFE minified: untuk <script src> (global AITTrain).
await build({
  ...common,
  entryPoints: [path.join(root, "src/browser/index.js")],
  outfile: path.join(dist, "aittrain.browser.js"),
  format: "esm",
  platform: "browser",
});
await build({
  ...common,
  entryPoints: [path.join(root, "src/browser/index.js")],
  outfile: path.join(dist, "aittrain.min.js"),
  format: "iife",
  globalName: "AITTrain",
  platform: "browser",
  minify: true,
});

// Node entry + CLI
await build({
  ...common,
  entryPoints: [path.join(root, "src/node/index.js")],
  outfile: path.join(dist, "node.cjs"),
  format: "cjs",
  platform: "node",
  external: ["node:*"],
});
await build({
  ...common,
  entryPoints: [path.join(root, "src/node/cli.js")],
  outfile: path.join(dist, "cli.cjs"),
  format: "cjs",
  platform: "node",
  external: ["node:*"],
  banner: { js: "#!/usr/bin/env node\n" },
});
fs.chmodSync(path.join(dist, "cli.cjs"), 0o755);

// Salin .d.ts
for (const f of ["index.d.ts", "node.d.ts", "browser.d.ts"]) {
  fs.copyFileSync(path.join(root, "types", f), path.join(dist, f));
}

console.log("Build selesai →", dist);
