# Look Studio — Scaffold Plan

Scope: structure, config, and smoke tests only. No features are implemented.

Stack: TypeScript everywhere. pnpm workspace with `apps/web` (Vite, React,
three.js, MediaPipe Tasks Vision), `apps/server` (Node, Hono, Zod), and
`packages/shared` (Zod schemas and JSON Schema export).

## Exact folder layout

The repository contains exactly these files (excluding `.git`, `node_modules`,
`dist`, `coverage`, and the generated `pnpm-lock.yaml`):

```text
.
├── SCAFFOLD_PLAN.md
├── README.md
├── package.json
├── pnpm-workspace.yaml
├── .npmrc
├── tsconfig.base.json
├── tsconfig.json
├── vitest.config.ts
├── .env.example
├── .gitignore
├── docs/
│   └── decisions.md
├── eval/
│   ├── README.md
│   └── run.mjs
├── apps/
│   ├── web/
│   │   ├── README.md
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── vite.config.ts
│   │   ├── index.html
│   │   ├── src/
│   │   │   ├── main.tsx
│   │   │   ├── App.tsx
│   │   │   ├── styles.css
│   │   │   ├── vite-env.d.ts
│   │   │   └── components/
│   │   │       ├── CameraPreview.tsx
│   │   │       └── PlaceholderPanel.tsx
│   │   └── test/
│   │       └── smoke.test.ts
│   └── server/
│       ├── README.md
│       ├── package.json
│       ├── tsconfig.json
│       ├── tsconfig.build.json
│       ├── src/
│       │   ├── index.ts
│       │   ├── app.ts
│       │   ├── env.ts
│       │   ├── lib/
│       │   │   ├── model-client.ts
│       │   │   ├── rate-limit.ts
│       │   │   └── spend-cap.ts
│       │   └── routes/
│       │       ├── health.ts
│       │       └── ping-model.ts
│       └── test/
│           ├── health.test.ts
│           ├── limits.test.ts
│           └── model-client.test.ts
└── packages/
    ├── core/
    │   ├── README.md
    │   ├── package.json
    │   ├── tsconfig.json
    │   ├── tsconfig.build.json
    │   ├── src/
    │   │   └── index.ts
    │   └── test/
    │       └── smoke.test.ts
    └── shared/
        ├── README.md
        ├── package.json
        ├── tsconfig.json
        ├── tsconfig.build.json
        ├── src/
        │   ├── index.ts
        │   ├── json-schema.ts
        │   └── schemas/
        │       ├── look-spec.ts
        │       ├── wearable-spec.ts
        │       ├── edit-command.ts
        │       └── critique-report.ts
        └── test/
            ├── schemas.test.ts
            └── fixtures/
                ├── valid-look-spec.json
                ├── valid-wearable-spec.json
                ├── valid-edit-command.json
                ├── valid-critique-report.json
                ├── invalid-look-spec.json
                ├── invalid-wearable-spec.json
                ├── invalid-edit-command.json
                └── invalid-critique-report.json
```

## Scripts

Root (`package.json`):

- `dev` — runs web and server together via concurrently.
- `build` — recursive build of every package.
- `test` — Vitest over the workspace projects.
- `typecheck` — `tsc --noEmit` at root plus every package.
- `eval` — placeholder (`node eval/run.mjs`, exits 0).

Each app/package repeats the scripts it supports (`dev` where runnable,
`build`, `test`, `typecheck`).

## Conventions

- All versions are pinned exact (`save-exact=true`); see `docs/decisions.md`.
- Relative imports use explicit `.ts` / `.tsx` extensions (Node type stripping).
- `MODEL_API_KEY` is read from the environment by the server only and is never
  bundled into the client (guarded by a web smoke test).
- Shared schemas are flat and non-recursive (JSON Schema depth 10 or less).
- Only network calls: server to `https://api.meta.ai/v1`, plus fonts (the
  scaffold uses system fonts, so it makes zero font calls). No analytics.

## Verification

1. `pnpm install`
2. `pnpm typecheck`
3. `pnpm test`
4. `pnpm build`
5. `pnpm dev`, then open the printed web URL and `curl` the health route.
