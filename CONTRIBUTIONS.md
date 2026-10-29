# Contributions

What was built for the event, who built it, and what comes from third parties.
This list comes from the git history; anything we could not confirm is marked
TBD.

## Before the event

- UI mockups and planning notes (task list, prompt plan, demo script) were
  prepared before the event.
- Event start date: TBD.

## Built during the event

The first commit is dated 2026-10-27. All application code so far was written
by AI coding agents working under the team's direction, with every change
reviewed by the team through pull requests. The hand-written algorithms planned
for `packages/core` are not implemented yet.

| Area | What was built | First commit |
| --- | --- | --- |
| Scaffold | pnpm workspace, web and server apps, shared Zod schemas, model smoke route, limits, tests | 2026-10-27 |
| Ports and server routes | Ports for rate limiting, caching, job queue, retries, budget, pose filter; look, edit, fit-check, and wearable routes with fakes; hardened model client | 2026-10-27 |
| Camera and studio UI | Camera device picker, permission states, sample-video fallback; Muse Spark look and edit services; desktop-style UI | 2026-10-28 |
| Face tracking | MediaPipe Face Landmarker loop with FPS and confidence readout | 2026-10-28 |
| 3D scene | three.js scene with a head-anchored placeholder crown and mirror toggle | 2026-10-28 |
| Makeup | Landmark-region makeup compositor driven by `LookSpec.makeup` | 2026-10-28 |
| CI and tests | GitHub Actions (typecheck, unit tests, build) and Playwright end-to-end tests | 2026-10-28 |
| Deploy | Firebase Hosting and Cloud Run pipeline with Workload Identity Federation | 2026-10-28 |
| Chat | Streamed looks over server-sent events, consent step for photos, wearable job states, occasion chips and vibe dial, plain-camera toggle | 2026-10-28 |
| Latency | Lower reasoning effort for look calls (`LOOK_REASONING_EFFORT`) | 2026-10-28 |
| Undo and redo | Bounded command stack with exact restores | 2026-10-28 |
| Favorites | IndexedDB library with export and import | 2026-10-28 |
| Eval runner | `pnpm eval` runner with run folders, CSV, and summaries | 2026-10-28 |

Not yet built: the `packages/core` algorithms, the agent loops (Look Director,
Fit Critic, Edit Interpreter), the eval harness and its metrics, real 3D
wearable generation, and SAM segmentation.

## Third-party services

| Service | Use |
| --- | --- |
| Meta Model API (`muse-spark-1.3`) | Look design and edit commands (structured output) |
| Google MediaPipe Face Landmarker model | Face landmarks and head pose, downloaded by the browser |
| Firebase Hosting | Static web hosting and `/api` rewrite |
| Google Cloud Run, Artifact Registry, Secret Manager | API hosting, container images, API key storage |
| GitHub Actions | CI, previews, and deploys |

## Third-party libraries

Versions are pinned exactly in the package manifests.

| Library | Version | Used in |
| --- | --- | --- |
| react, react-dom | 19.3.1 | web |
| vite | 8.3.5 | web |
| @vitejs/plugin-react | 6.1.2 | web |
| three | 0.186.1 | web |
| @mediapipe/tasks-vision | 1.1.1 | web |
| hono | 4.13.14 | server |
| @hono/node-server | 2.1.5 | server |
| openai (SDK, pointed at the Meta Model API) | 7.45.0 | server |
| zod | 4.6.7 | server, shared |
| typescript | 5.9.3 | all |
| vitest | 5.0.5 | all |
| @playwright/test | 1.64.1 | web end-to-end tests |
| concurrently | 10.0.6 | root dev script |
| @types/node, @types/react, @types/react-dom | 26.6.5, 19.3.0, 19.3.0 | types |
| firebase-tools | 15.34.1 | deploy workflow (run with npx) |
| GitHub Actions: checkout, setup-node, upload-artifact, pnpm/action-setup, google-github-actions auth and setup-gcloud | v4 / v2 | CI and deploy |
| node:24-slim | Docker base image | API container |

## Results

Fit, edit accuracy, latency, and cost measurements: TBD, pending the eval
harness.
