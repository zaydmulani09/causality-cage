# Decisions

## Name

`npm view causality-cage name` → 404 on 2026-09-29: name free. CLI package = `causality-cage`, bin = `cage`. Internal packages scoped `@causality-cage/*`, private.

## Dependencies

| Dep | Where | Why |
|---|---|---|
| playwright 1.60.0 | core, cli | browser automation + request routing. Pinned to match installed Chromium 1223. |
| @playwright/test 1.60.0 | dev | integration tests; also what exported regression tests run on. |
| tsx | core, cli, dev | load user flow/oracle `.ts` files at runtime; runs the CLI sources (no build step) and dev scripts. |
| fflate | core | zip read/write for `.cage` bundles. Small, zero-dep. |
| typescript, @types/node | dev | strict typecheck; the compiler API also generates the bundle JSON schema from types.ts (scripts/gen-schema.ts). |
| vitest | dev | unit tests. |
| eslint, @eslint/js, typescript-eslint | dev | lint. |
| react, react-dom | examples/shop | demo app per spec. |
| vite, @vitejs/plugin-react | examples/shop (dev) | build demo app once to static files. |

## Choices

- **No bundler for the CLI.** `bin/cage.mjs` registers tsx and imports TS sources. Spec suggested esbuild/tsup; skipped: one fewer build step, add bundling when publishing to npm.
- **Arg parsing = `node:util` parseArgs.** No commander/yargs.
- **Shop mock API = `node:http`**, not Express. Few routes + static files; stdlib covers it.
- **Report client JS = plain JS with `// @ts-check`**, typechecked by tsc (`checkJs`), inlined as text. No transpile step.
- **Bundle schema = generated JSON Schema + ~50-line validator** (packages/core/src/schema.ts) for the subset the generator emits. No ajv.
- **Masks are HMAC-SHA256 with a random per-bundle key** (never stored): consistent within a bundle, unlinkable across bundles, not reversible by brute force of short values.
- **Parallel search = fixed-order windows**: deterministic results for any --concurrency.
- **Single-session mode sends unrecorded requests live** by default (nothing else can answer them). Warned in output and docs.
- **Demo scenario (BUG=demo)** added beyond B0-B8 so the section 1 recording has an AND with a latency factor.
- **Integration tests use Playwright Test** as a runner (tests/integration) and drive cage through its library API.
- **Link check = scripts/check-links.mjs** (Node fetch). doi.org → ACM answers 403 to scripts, so the HDD citation links dblp instead.
