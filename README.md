# Look Studio

Look Studio puts live makeup and accessories on your webcam image for video
calls. Describe a vibe ("golden crown + warm glow") or attach a reference photo,
and Meta's Muse Spark designs a look: a palette, four makeup layers (lips,
blush, eyeshadow, brows), and wearables. The browser tracks your face and
renders the look onto the output canvas in real time. Follow-up messages such
as "move the crown higher" become small, validated edits.

**Live demo:** https://lookstudio-3fe3d.web.app (Chrome, with a webcam; a local
video file works too via **Sample video**).

## What works today

- **Face tracking:** MediaPipe Face Landmarker (478 landmarks, head pose) on the
  GPU, with an FPS and confidence readout. A pose-filter hook is in place for
  smoothing; no filter is plugged in yet.
- **Rendering:** a three.js scene in video-pixel space with a head-anchored
  placeholder crown, a mirror toggle, and a 30 fps output loop.
- **Makeup:** landmark-region polygons composited with blend modes and
  feathering, driven by the `makeup` block of a `LookSpec`.
- **Skin touch-up and foundation:** a soft-focus pass and a coverage tint
  (sheer to full, with a dewy option) on the face skin, leaving eyes, brows,
  and lips sharp. The model picks levels from the request or the photo's
  makeup; the foundation shade is sampled from the user's own face.
- **Grooming:** painted stubble, mustache, goatee, boxed and full beards with
  length, density, colour, and salt-and-pepper grey; tidy or fuller brows; and
  a subtle stubble cover in the user's own shade. Facial hair can be added,
  not removed.
- **Chat:** looks stream from `POST /api/look/stream` (server-sent events);
  edits go through `POST /api/edit`. Occasion chips, a subtle-to-bold vibe
  dial, a consent step before a reference photo is sent, undo and redo
  (buttons and Ctrl/Cmd+Z), and a **Plain camera** toggle.
- **Wearable jobs:** generating, fitting, passed, or failed chips driven by
  `POST /api/wearable` and its event stream. The server uses a fake job
  service until a 3D provider is connected.
- **Favorites:** saved in the browser (IndexedDB) with rename, duplicate,
  delete, and JSON export and import. Thumbnails are drawn from the look's
  colours, never from the camera.
- **Model monitor:** every model call with model name, latency, tokens, and
  request id.

Not built yet: real 3D wearable generation, SAM segmentation, the agent loops
(Look Director, Fit Critic), and the core algorithms in `packages/core`. See
[Known limits](#known-limits).

## Architecture

```text
Browser (apps/web)
  camera or sample video
    -> MediaPipe Face Landmarker -> HeadState (landmarks + pose, reused buffers)
    -> makeup painter (2D canvas) -> three.js scene (backdrop + head anchor) -> output canvas
  chat, favorites (IndexedDB), undo stack, model monitor
        |
        |  same origin: /api/**
        v
Firebase Hosting (static web)  --rewrite /api/**-->  Cloud Run: apps/server (Hono)
                                                       per-IP rate limit, daily spend cap,
                                                       body cap, Zod validation
                                                         |
                                                         v
                                               Meta Model API (Responses API)
                                               muse-spark-1.3, structured output
```

Packages:

| Path | Role |
| --- | --- |
| `apps/web` | Vite + React client: tracking, rendering, chat, favorites |
| `apps/server` | Node + Hono API: look, edit, fit-check, and wearable routes; model client |
| `packages/shared` | Zod schemas (`LookSpec`, `EditCommand`, `WearableSpec`, ...) and ports |
| `packages/core` | Hand-written algorithms (cache, masks, fit, limits); not implemented yet |
| `eval` | Eval runner: run folders, CSV, and summaries for a pluggable harness |

The server depends on ports (rate limiter, retry policy, budget tracker, job
queue, pose filter) and runs on simple in-memory implementations until the
`packages/core` versions land.

## Privacy and safety

- Camera frames never leave the browser. Only a reference photo the user
  explicitly attaches, after a consent step, is sent to Muse Spark.
- No images are logged or stored. Favorites keep look data only.
- Only Standard-mode Meta models are used for anything that may contain a face.
- Prompts tell the model never to comment on faces or skin. Skin touch-up runs
  only in the browser from face landmarks; no frame or skin data goes to a model.
- Skin tone is never changed. The model has no skin-colour field, the
  foundation shade comes only from the user's camera, and requests to change
  skin tone or look like another race are refused before any model call.
- Avatar descriptions go through a Muse Spark moderation check before any image
  is drawn. Meshy only ever receives a Muse-drawn concept the server itself
  generated, never the user's photo or camera; concepts live in memory for 30
  minutes and the Meshy tasks are deleted once the model is downloaded.
- API keys live only on the server (`MODEL_API_KEY`, `MESHY_API_KEY`). They are
  never in the client bundle.

## Run it locally

Requires Node 24 (Node >= 22.6 works for the server) and pnpm 12.

```sh
pnpm install
cp .env.example .env   # set MODEL_API_KEY; never commit .env
pnpm dev               # web on http://localhost:5173, API on :3001
```

Without `MODEL_API_KEY` the server answers with offline fakes, so the UI still
works.

Server settings (environment variables):

| Variable | Default | Purpose |
| --- | --- | --- |
| `MODEL_API_KEY` | required for live calls | Meta Model API key |
| `PORT` | 3001 | API port |
| `DAILY_SPEND_CAP_USD` | 5 | Estimated model spend per day before requests are refused |
| `CLIENT_DAILY_SPEND_CAP_USD` | 2 | Estimated model spend per client IP per day |
| `TRUSTED_PROXY_HOPS` | 0 | Proxies that append to `X-Forwarded-For`; at 0 the header is ignored |
| `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_MS` | 60 / 60000 | Requests per IP per window |
| `MODEL_TIMEOUT_MS` | 30000 | Per-call model timeout |
| `MODEL_MAX_RETRIES` | 3 | Retries on HTTP 429, honoring `Retry-After` |
| `LOOK_REASONING_EFFORT` | low | `minimal`, `low`, `medium`, or `high` for look calls |
| `BODY_MAX_BYTES` | 5000000 | Request body cap |
| `MESHY_API_KEY` | unset | Meshy key; avatars use offline fakes without it (or without `MODEL_API_KEY`) |
| `MESHY_COST_USD` | 0.7 | Estimated cost of one rigged avatar, counted against the spend cap |
| `AVATAR_DAILY_LIMIT` | 3 | Avatars per IP per day |
| `IMAGE_TIMEOUT_MS` / `MESHY_TIMEOUT_MS` | 120000 / 30000 | Per-call timeouts for Muse Image and Meshy |

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | Web and server together |
| `pnpm build` | Build every package |
| `pnpm typecheck` | `tsc --noEmit` for the root, `eval`, and every package |
| `pnpm test` | Vitest across web, server, shared, core, and eval |
| `pnpm e2e` | Playwright on a production build with a fake camera |
| `pnpm eval --harness <file.ts> --cases <cases.json>` | Run an eval harness (see `eval/README.md`) |

## Deploy

Pushes to `main` run `.github/workflows/deploy.yml`: build and boot-check the
API image, deploy it to Cloud Run (one instance, key from Secret Manager), deploy
the web build to Firebase Hosting, then smoke-check `/` and `/api/health`.
GitHub authenticates to Google Cloud with Workload Identity Federation, so no
keys are stored in the repository. Pull requests get a Hosting preview channel.

## Known limits

- Hosting buffers server-sent events, so a streamed look arrives all at once
  when served through the public URL.
- Requests forwarded by Hosting time out after 60 s.
- The in-memory spend cap and rate limits reset when Cloud Run scales to zero.
- Per-IP limits use the first `X-Forwarded-For` entry, which a client can spoof.
- The crown is a procedural placeholder with no occlusion behind the head.
- Wearable jobs and fit checks use fake services; real generation is not
  connected yet.
- Measured results (fit, edit accuracy, latency, cost): TBD, pending the eval
  harness.

## Network policy

The server calls `https://api.meta.ai/v1` and, for avatars, the Meshy API at
`https://api.meshy.ai` (including downloading the finished model). The browser calls the Look
Studio API and downloads the MediaPipe face model from Google storage; the
MediaPipe WebAssembly files ship with the app. It sends no analytics or
telemetry.

See [CONTRIBUTIONS.md](CONTRIBUTIONS.md) for what was built during the event
and which third-party libraries and services are used.
