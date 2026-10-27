# @look-studio/web

Look Studio client stub: a page with a camera preview (with the permission
flow) and a placeholder look panel. No tracking yet.

## Run

```sh
pnpm --filter @look-studio/web dev   # http://localhost:5173
```

Or `pnpm dev` from the repo root to run web + server together. `/api` is
proxied to the server (default `http://localhost:3001`).

## Scripts

- `dev` — Vite dev server.
- `build` — typecheck, then `vite build`.
- `preview` — serve the production build locally.
- `test` — Vitest smoke tests (component exports, no `MODEL_API_KEY` in
  client sources, shared-schema round trip).
- `typecheck` — `tsc --noEmit`.

## Notes

- `three` and `@mediapipe/tasks-vision` are installed for the next step but not
  imported yet.
- The client makes no network calls: system fonts, data-URI favicon, no
  analytics. Model calls happen server-side only.
