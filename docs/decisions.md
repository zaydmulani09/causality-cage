# Decisions

## Name

`npm view causality-cage name` → 404 on 2026-09-29: name free. CLI package = `causality-cage`, bin = `cage`. Internal packages scoped `@causality-cage/*`, private.

## Dependencies

| Dep | Where | Why |
|---|---|---|
| playwright 1.60.0 | core, cli | browser automation + request routing. Pinned to match installed Chromium 1223. |
| @playwright/test 1.60.0 | dev | integration tests; also what exported regression tests run on. |
| tsx | core, cli | load user flow/oracle `.ts` files at runtime; also runs the CLI sources (no build step). |
| fflate | core | zip read/write for `.cage` bundles. Small, zero-dep. |
| typescript, @types/node | dev | strict typecheck. |
| vitest | dev | unit tests. |
| eslint, @eslint/js, typescript-eslint | dev | lint. |
| react, react-dom | examples/shop | demo app per spec. |
| vite, @vitejs/plugin-react | examples/shop (dev) | build demo app once to static files. |

## Choices

- **No bundler for the CLI.** `bin/cage.mjs` registers tsx and imports TS sources. Spec suggested esbuild/tsup; skipped — one fewer build step, add bundling when publishing to npm.
- **Arg parsing = `node:util` parseArgs.** No commander/yargs.
- **Shop mock API = `node:http`**, not Express. Few routes + static files; stdlib covers it.
- **Report client JS = plain JS with `// @ts-check`**, typechecked by tsc (`checkJs`), inlined as text. No transpile step.
