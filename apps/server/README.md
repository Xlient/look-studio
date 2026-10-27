# @look-studio/server

Look Studio API stub: health routes, a model smoke route, a per-IP rate
limiter, and a daily spend cap.

## Run

```sh
pnpm --filter @look-studio/server dev   # http://localhost:3001 (watches src)
```

Or `pnpm dev` from the repo root. Production: `pnpm build && pnpm start`.

## Environment

Copy the root `.env.example` to `.env`. `MODEL_API_KEY` is read from the
environment only and never leaves the server. `MODEL_NAME` selects the model
for structured-output calls. See `.env.example` for the full list (limits,
timeouts, retries).

## Routes

- `GET /health` and `GET /api/health` — liveness, no key needed.
- `GET` / `POST /api/ping-model` — one small structured-output call; returns
  latency, token usage, and request id. Needs `MODEL_API_KEY` + `MODEL_NAME`
  (503 without them). Returns 429 when the spend cap is exceeded or the
  upstream model API rate-limits after retries.

## Limits

- Per-IP fixed-window rate limiter on all routes (429 + `Retry-After`).
- Daily estimated-spend cap (UTC day) on model routes (429).
- Both are in-memory and single-process; a multi-instance deploy needs a shared
  store.

## Model client

`src/lib/model-client.ts` calls `https://api.meta.ai/v1` through the OpenAI
SDK Responses API with per-attempt timeouts, retries on HTTP 429 only
(exponential backoff with jitter), and one JSON log line per call (latency,
tokens, request id). Prompts and images are never logged.

## Scripts

- `dev` — `node --watch src/index.ts` (native type stripping, no loader).
- `build` — emit to `dist/`.
- `start` — run the built server.
- `test` — Vitest (health, limits, model-client backoff/env; no network).
- `typecheck` — `tsc --noEmit`.
