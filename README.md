# Look Studio

Hackathon scaffold: virtual try-on studio. Structure, config, and smoke tests
only — no features are implemented yet.

## Stack

TypeScript everywhere in a pnpm workspace:

- `apps/web` — Vite + React client (camera preview + placeholder panel).
- `apps/server` — Node + Hono API (health, model smoke route, limits).
- `packages/shared` — Zod schemas with JSON Schema export.

See `SCAFFOLD_PLAN.md` for the exact folder layout and `docs/decisions.md` for
why each dependency was chosen.

## Quickstart

Requires Node >= 22.6 and pnpm.

```sh
pnpm install
cp .env.example .env   # fill in values; never commit .env
pnpm dev               # web on http://localhost:5173, server on :3001
```

## Scripts

| Command          | What it does                              |
| ---------------- | ----------------------------------------- |
| `pnpm dev`       | Web + server together (concurrently)      |
| `pnpm build`     | Recursive build of every package          |
| `pnpm test`      | Vitest over the workspace projects        |
| `pnpm typecheck` | `tsc --noEmit` at root + every package    |
| `pnpm eval`      | Placeholder eval runner (exits 0)         |

## Smoke test

```sh
curl localhost:3001/health
curl -X POST localhost:3001/api/ping-model   # needs MODEL_API_KEY + MODEL_NAME
```

## Network policy

The server calls only `https://api.meta.ai/v1`. The client makes no network
calls of its own (system fonts, no analytics). Vite proxies `/api` to the
server during development.
