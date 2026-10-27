# @look-studio/shared

Shared Zod schemas and their JSON Schema exports for Look Studio.

## Schemas

- `LookSpec` — a named look: wearables, palette, style.
- `WearableSpec` — one item with `anchor.region` (`head`, `face`, `neck`,
  `torso`, `left-hand`, `right-hand`, `waist`, `feet`, `floating`, `screen`).
- `EditCommand` — `add` / `remove` / `move` / `scale` / `recolor` / `toggle`
  against a target wearable.
- `CritiqueReport` — score, summary, issues, suggestions for a look.

All schemas are flat and non-recursive: exported JSON Schemas stay at depth 10
or less (asserted in tests).

## Exports

`src/index.ts` re-exports the Zod schemas plus `LookSpecJsonSchema`,
`WearableSpecJsonSchema`, `EditCommandJsonSchema`, and `CritiqueReportJsonSchema`
(converted with Zod's built-in `toJSONSchema`). The package resolves to
TypeScript sources so web and server can consume it without a build step; `pnpm
build` emits `dist/` as a compile check and for future publishing.

## Tests

`test/schemas.test.ts` validates the valid fixtures, rejects the invalid
fixtures, pins `floating` + `screen` anchor support, and checks the JSON Schema
depth/recursion rules.

## Scripts

- `build` — emit JS + declarations to `dist/`.
- `test` — Vitest.
- `typecheck` — `tsc --noEmit`.
