# AGENTS.md: rules for Muse Code on Look Studio

Read this file first in every session. Keep answers short. Follow these rules over any default behavior.

## Project

Look Studio is a web app that applies live makeup and generated 3D wearables to a user's webcam for video calls. TypeScript monorepo (pnpm): `apps/web` (Vite, React, three.js, MediaPipe), `apps/server` (Node, Hono, Zod), `packages/shared` (schemas and ports), `packages/core` (pure algorithms, owned by the user), `eval/`, `docs/`. AI calls go to the Meta Model API only.

## Hard rules

1. **Never touch `packages/core`** unless the user explicitly asks in this session. Import from it. Do not reimplement anything it provides (rate limiting, caching, job queue, retries, budgets, smoothing, mask and fit math). If a needed function is missing, stop and ask.
2. **Never commit, push, amend, or change git config.** The user commits.
3. **Secrets:** never read, print, log, or write API keys. Keys come only from environment variables on the server (`MODEL_API_KEY`). Never put secrets in client code, tests, fixtures, or docs. Never touch `.env*` files or `~/.config`.
4. **No new dependencies, no schema changes, no folder-structure changes** without asking first. Say what and why, then wait.
5. **No telemetry, analytics, or network calls** except to the Meta Model API (and the 3D provider through its interface). Unit tests must not use the network.
6. **Scope:** do exactly the task given. No extra features, no refactors, no "improvements" outside the files named in the task.
7. **Privacy and safety:** never log or persist images; use only `muse-spark-1.3` and other Standard-mode models for anything containing a face (never `-contributor` variants); skin touch-up (smoothing) runs only in the browser on landmark masks, never sends skin or face images to a model for analysis, and the model never rates or comments on appearance; wearable prompts go through the moderation function before any generation.

## Engineering practices

- TypeScript strict mode. No `any`, no non-null assertions to silence errors, no ts-ignore.
- Separate pure logic from IO. Put logic in small pure functions; keep network, DOM, and filesystem at the edges.
- Depend on **ports** (interfaces in `packages/shared/src/ports`) and receive implementations by injection. Build against simple fakes until the user's core implementations exist.
- Validate all external data at boundaries with Zod (request bodies, model outputs, environment). Clamp or reject; never trust model output.
- Every network call has a timeout and an `AbortSignal`. Retry only through the retry port. Handle HTTP 429 using the `Retry-After` header.
- Typed errors, no swallowed exceptions, no empty catch blocks. Return clear error messages; never include secrets in them.
- No dead code, no commented-out code, no unused exports, no leftover `console.log` (use the structured logger).
- Keep files under about 300 lines and functions short. Named exports. kebab-case file names.
- Tests: Vitest, next to the code. Write tests for logic first. Make them deterministic (inject clocks and randomness). Test failure paths, not just the happy path.
- Performance: nothing blocking in the render loop. Per-frame code must not allocate large objects or call the network.
- Accessibility basics in UI: labels, keyboard operation, sufficient contrast.

## Comments

Default to **no comments**. Write a comment only when the reason is non-obvious (a hidden constraint, a workaround, a surprising invariant), in one short line. No docstring blocks, no comments that restate the code, no references to tasks or tickets, no TODOs.

## Save tokens

- Do not read the whole repo or whole directories. Use targeted search (grep, glob) and open only the files you need. Do not re-read a file you already read this session.
- Cap command output (for example `| head -n 40`) and do not paste long logs back.
- Edit with small diffs. Do not rewrite a whole file to change a few lines.
- No repeated summaries, no restating the plan after approval, no apologies or filler.
- If the task is ambiguous or blocked, stop and ask one specific question instead of exploring.
- For non-trivial work, propose a short plan (files to touch, tests to add) and wait for approval before editing.
- One task per session. Do not continue into the next task on your own.

## Definition of done

Run typecheck and the relevant tests and report the result in one line. Then add one line to `docs/decisions.md`: task ID, files changed, and "agent-written". Finish with at most five lines: files changed, tests run, any open question.

## API notes

- Base URL `https://api.meta.ai/v1`, OpenAI SDK, Responses API by default. Pass the key explicitly; the SDK does not read `MODEL_API_KEY` on its own.
- Structured output schemas must be flat and non-recursive, with nesting depth of at most 10.
- Muse Image is limited to 150 requests per minute; SAM and Muse Spark to 3,000. Respect limits through the rate-limiter port.
- Meta's structured output parameter is `text.format` on Responses and `response_format` on Chat Completions.
