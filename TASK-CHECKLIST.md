# Task Checklist — AXION AI-Lab update

## Section 1 — Server/CORS/API
- [x] Audit browser/serverless request path and fetch invocation.
- [x] Bind native `fetch` to `globalThis` to prevent browser `Illegal invocation`.
- [x] Pass the configured/injected fetch implementation to SSE streaming.
- [x] Preserve CORS middleware with wildcard/configurable origins, methods, and headers for preflight.
- [x] Add `/api/` URL-prefix normalization while retaining legacy route compatibility.
- [ ] Verify live production CORS/preflight against Cloudflare deployment (requires deployed server access).

## Section 1.2 — Environments
- [x] Keep shared JS core runtime-neutral for Node/browser.
- [x] Keep Node filesystem/ZIP functionality isolated in Node entry point.
- [x] Keep Python CLI using the same configurable API base URL.
- [ ] End-to-end live test against production credentials/server (not available in this workspace).

## Section 2 — Endpoint
- [x] Set Python SDK, Python CLI, JavaScript SDK defaults to `https://ai-train.axn.cc.cd/api/`.
- [x] Update examples and SDK documentation to the new API base URL.
- [x] Add server compatibility mapping for `/api/...`.

## Section 3 — Pure executor
- [x] Preserve opaque upload handling for arbitrary user files/datasets/configs/tokenizers/model artifacts.
- [x] Preserve user-defined environment variables and user-owned training script.
- [x] Preserve `$AITT_OUTPUT_DIR` artifact packaging and stdout/stderr telemetry.
- [x] Keep final artifacts as ZIP of all files written to the output directory.
- [ ] Arbitrary non-Python executable entrypoints are not implemented; current runner contract executes Python scripts. This remains an explicit limitation rather than silently claiming universal executable support.

## Section 4 — SDKs/docs
- [x] Update Python SDK and CLI default endpoint.
- [x] Update JavaScript SDK endpoint and browser fetch handling.
- [x] Update SSE stream to use the same fetch implementation.
- [x] Update generated distribution endpoint defaults and fetch binding where the generated code pattern matched.\n- [ ] Full bundle regeneration could not run because the `esbuild` dependency could not be installed in this environment; run `npm ci && npm run build` before publishing.
- [x] Add this checklist and CHANGELOG.
- [x] Run syntax/build/unit smoke checks where available.
