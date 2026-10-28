# Decisions

Why each dependency and convention was chosen. All versions are pinned exact
(`save-exact=true`) so hackathon installs are reproducible.

## Toolchain

- **pnpm 12.15.0** (`packageManager`): workspace support with isolated
  `node_modules`, so each package resolves exactly what it declares.
- **Node >= 22.6** (`engines`): runs TypeScript sources directly via type
  stripping, which the server dev script relies on.
- **TypeScript 5.9.3**: latest of the stable 5.x line. 7.x exists but is a new
  major; 5.9 keeps the Vite/Vitest ecosystem risk-free for a scaffold.
- **Vitest 5.0.5**: one runner for all three packages plus a root workspace
  file, so `pnpm test` covers everything in one command.

## Web (`apps/web`)

- **vite 8.3.5 + @vitejs/plugin-react 6.1.2**: standard React dev server and
  build; proxies `/api` to the server so no CORS layer is needed.
- **react 19.3.1 + react-dom 19.3.1**: UI for the camera page.
- **three 0.186.1**: installed for the upcoming 3D rendering step; not imported
  yet, so no `@types/three` until first use.
- **@mediapipe/tasks-vision 1.1.1**: installed for the upcoming tracking step;
  not imported yet.
- **@types/react 19.3.0, @types/react-dom 19.3.0**: typecheck the JSX sources.

## Server (`apps/server`)

- **hono 4.13.14**: small router with `app.request()` test calls (no network in
  tests) and a 404 handler.
- **@hono/node-server 2.1.5**: production serving plus `getConnInfo` for the
  per-IP rate limiter (with an `x-forwarded-for` first hop).
- **openai 7.45.0**: used against `https://api.meta.ai/v1` via `baseURL`,
  calling the Responses API with structured output. SDK retries are disabled
  (`maxRetries: 0`) because the wrapper implements its own 429-only retry with
  exponential backoff and jitter.
- **zod 4.6.7**: validates the ping-model response and converts it to JSON
  Schema with the built-in `toJSONSchema` (no extra converter dependency).
- **@types/node 26.6.5**: Node API types for the server.

## Shared (`packages/shared`)

- **zod 4.6.7** (same pin as the server): single source of truth for
  `LookSpec`, `WearableSpec`, `EditCommand`, and `CritiqueReport`, with JSON
  Schema export from the same definitions.

## Root

- **concurrently 10.0.6**: runs web + server together in `pnpm dev` with named,
  colored output.

## Deliberately omitted

- `tsx` / `ts-node`: Node strips types natively, so the server needs no loader.
- `@hono/zod-validator`: one `safeParse` call needs no middleware wrapper.
- `zod-to-json-schema`: Zod 4 converts natively.
- `jsdom` / testing-library: web tests assert module exports and source
  invariants without rendering; DOM checks stay manual via `pnpm dev`.
- `ajv`: Zod is the validator; JSON Schemas are exports, not a second truth.
- CORS middleware: dev traffic goes through the Vite `/api` proxy.
- Analytics and remote fonts: the network policy allows only the model API and
  fonts, and the scaffold uses system fonts, so the client makes zero network
  calls.

## Conventions

- Explicit `.ts` / `.tsx` relative imports: required by Node type stripping and
  understood by Vite, Vitest, and `tsc`.
- `@look-studio/shared` resolves to TypeScript sources: web and server consume
  it with no build ordering; `build` still emits `dist/` as a compile check.
- Per-package `tsconfig.build.json` files switch to `NodeNext` with
  `rewriteRelativeImportExtensions` so emitted servers import `.js`.
- In-memory rate limiter and spend ledger: correct for a single-process
  hackathon server; multi-instance deploys need a shared store.
- `MODEL_API_KEY` lives in the server environment only; a web smoke test fails
  if the string ever appears in client sources.
- P0: added empty @look-studio/core (package files, workspace/vitest registration, recursive typecheck); agent-written.
- P1: added shared ports (rate-limiter, cache, job-queue, retry-policy, budget-tracker, pose-filter), in-memory server adapters, container.ts injection; agent-written.
- P1-followup: server depends on @look-studio/shared (workspace:*), package-root type imports; agent-written.
- P2: hardened model client (typed ModelError, injected RetryPolicy/signal, structured logging, json/image helpers, fake-fetch suite); agent-written.
- P3: added look/edit/fit-check/wearable routes with injected fake services, body cap, spend/rate guards, SSE job events; agent-written.
- P4: added web camera device picker, permission states, sample-video fallback, tested camera helpers; agent-written.
- Phase A: real Muse Spark look/edit services (look-draft.ts, edit-draft.ts, muse-services.ts, services.ts, http.ts, routes/look.ts, routes/edit.ts, container.ts, index.ts; tests drafts.test.ts, muse-services.test.ts); agent-written.
- Phase B: Y2K desktop UI (App.tsx, components/Window, BuddyChat, ModelMonitor, Splash, CameraPreview restyle, styles.css; studio/api-client, studio-state, look-edits, photo, use-studio; removed PlaceholderPanel; tests studio.test.ts, smoke.test.ts; .claude/launch.json); agent-written.
