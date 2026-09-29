# Causality Cage

**`cage` replays a failing browser session with its conditions flipped one group at a time and reports the minimal set of conditions (API fields, latency, response order, storage, cookies, environment) that actually causes the failure, with a verified, plain-English claim.**

```text
> cage explain --flow flows/checkout.ts --oracle oracles/no-crash.ts --bad sessions/bad.json --good sessions/good.json
EXPLAINED  The failure ("Something went wrong: Cannot read properties of null (reading 'slice')") happens only when
GET /api/cart returns customer.tax_id = null AND GET /api/prices takes longer than ~774 ms.
Removing any one of them prevents it. (31 experiments.)
```

## The 10 second demo

`scripts/demo.ps1` (or `scripts/demo.sh`) records a failing and a passing checkout from the example shop, then runs
`cage explain`. A live line shows experiments as they finish (red dots fail, green dots pass). It prints the verdict
and opens the report: two factor nodes joined by AND into a red FAILURE node. Click `customer.tax_id` to set it to its
passing value and FAILURE turns green, because the report looks the outcome up in the truth table it measured. A
latency panel shows the failure rate against `/api/prices` latency, with the flip point marked. `report.html?demo=1`
plays the toggles on a one second cadence for screen recording.

## Install

From source (Node 20.16+, pnpm). PowerShell:

```powershell
git clone <this repository> causality-cage
cd causality-cage
pnpm install
pnpm exec playwright install chromium
node packages/cli/bin/cage.mjs doctor
```

bash is the same. `packages/cli` is the `causality-cage` package; its `cage` bin runs the TypeScript sources through
tsx, so there is no build step. Below, `cage` means `node packages/cli/bin/cage.mjs` (or `pnpm cage`).

## Quickstart with the example shop

`examples/shop` is a small React checkout with planted bugs, selected by `BUG`. Its mock API has a failing and a
passing `SCENARIO`. PowerShell:

```powershell
pnpm shop:build
# terminal 1: the app as it is when the bug happens
$env:BUG = 'B2'; $env:SCENARIO = 'bad'; $env:PORT = '5173'; node examples/shop/server.mjs
# terminal 2: the same app with passing data
$env:BUG = 'B2'; $env:SCENARIO = 'good'; $env:PORT = '5174'; node examples/shop/server.mjs
# terminal 3
cage record examples/flows/checkout.ts --base-url http://127.0.0.1:5173 --state examples/shop/states/b2-bad.json --out bad.json --oracle examples/oracles/no-crash.ts
cage record examples/flows/checkout.ts --base-url http://127.0.0.1:5174 --state examples/shop/states/b2-good.json --out good.json --label good --oracle examples/oracles/no-crash.ts
cage explain --flow examples/flows/checkout.ts --oracle examples/oracles/no-crash.ts --bad bad.json --good good.json --out result.cage
```

You write two small modules for your own app:

- a **flow**: `export default async function flow({ page, baseURL })` that drives the app with Playwright ([example](examples/flows/checkout.ts));
- an **oracle**: `export default async function oracle({ page, consoleErrors, pageErrors, requests })` returning `{ failed, reason }` ([example](examples/oracles/no-crash.ts)), or built-in flags: `--fail-on-uncaught`, `--fail-on-console <regex>`, `--fail-on-text-missing <text>`, `--fail-on-selector-missing <css>`.

Then:

| Command | What it does |
|---|---|
| `cage doctor` | checks Node, Playwright, Chromium |
| `cage record <flow> --base-url <url> --out s.json [--state init.json]` | records fetch/xhr exchanges, initial storage and environment |
| `cage verify <flow> --session s.json --runs 20` | replays a session N times; reports outcome and request-sequence consistency |
| `cage explain --flow f --bad b.json --good g.json` | the search; writes `result.cage` and `result.html` |
| `cage report result.cage` | regenerates the HTML report |
| `cage repro result.cage [--set f3=neutral]` | replays the minimal failing configuration |
| `cage export-test result.cage --out repro` | standalone Playwright test (fails until the bug is fixed; `--expect broken` inverts) |
| `cage bench`, `cage selfcheck` | the measurements below |

Exit codes: 0 explained, 2 partial, 3 unexplained, 4 untrustworthy oracle, 1 tool error.

## How it works

1. **Diff.** Align the two sessions' API exchanges and turn every difference into a factor: a JSON leaf, status, header, latency, arrival order of concurrent responses, storage key, cookie, or environment setting.
2. **Gate.** Replay "all failing values" and "all passing values" 5 times each. The first must fail, the second must pass, or cage stops and says which gate failed. In-between rates switch every experiment to a sequential probability ratio test.
3. **Search.** Hierarchical delta debugging: whole endpoints first, then sub-objects, then fields. Every configuration is replayed in a fresh browser context with real delays and response ordering. Results are memoized and independent of concurrency.
4. **Prove.** Re-run the minimal set and every leave-one-out; build the truth table (AND, OR, or other); probe other values (is it `null`, or any falsy value?); measure the latency flip point and a failure-rate curve.

Details and citations: [docs/algorithm.md](docs/algorithm.md). Bundle layout and redaction: [docs/bundle-format.md](docs/bundle-format.md).

## Scope of the claim

**Read this before trusting a result.** A reported set is necessary and sufficient **only within the modeled
factors**, under the recorded flow and oracle, at the measured repeat rates. It is 1-minimal (remove any one factor
and the failure stops), not guaranteed globally smallest, and real apps can be non-monotone. Not modeled: server-side
state not visible in API responses, static assets and third-party scripts (served live), WebSockets, IndexedDB,
service workers, multi-tab flows, non-Chromium browsers. When the cause is out there, cage says `unexplained` rather
than naming a factor; bench bug B8 checks exactly that. Every report carries this box with the run's gate rates and
budget. More: [docs/limits.md](docs/limits.md).

## What this is not

- Not a session recorder. Recording is the input; the product is the search and the verified claim.
- Not a test generator. It exports one regression test for the bug it explained.
- Not a visual regression tool, not a hosted service. Everything runs locally; nothing is sent anywhere except to the app you point it at. No telemetry, no accounts, no LLM calls.
- Not magic for flaky apps: see [limits.md](docs/limits.md#flakiness).

## Related tools

What each tool's own documentation says, checked 2026-09-29. Blank means the docs page did not say, not that the
tool cannot.

| Tool | Records | Replays recorded network responses | Looks for the cause | Runs |
|---|---|---|---|---|
| [Playwright HAR replay](https://playwright.dev/docs/mock) | network to a HAR file | yes; "matches URL and HTTP method strictly", POST payloads strictly, else aborts | | locally, in your tests |
| [Playwright Trace Viewer](https://playwright.dev/docs/trace-viewer) | DOM snapshots per action, screenshots, network requests, console logs | | | locally |
| [Meticulous](https://www.meticulous.ai/) | user interactions via a script tag in dev/staging/preview | yes, "saving and replaying the original recorded responses" | detects visual changes a PR introduces | hosted (app.meticulous.ai) |
| [Replay QA](https://docs.replay.io/) | "a deterministic runtime recording" of test runs | | "trace the symptom back to its root cause", pointing at the responsible code | a service |
| **cage** | fetch/xhr exchanges, storage, cookies, environment | yes, recombined per factor, with controlled latency and order | minimal set of conditions by replay experiments, verified leave-one-out | locally, CLI |

cage is complementary: it answers *which inputs* make the app fail, not *which line of code* is wrong.

## Measured: `pnpm bench`

BENCH_PLACEHOLDER

## Development

```powershell
pnpm check              # lint + typecheck + unit tests
pnpm test:integration   # browser tests: exported-test gate, report gate
pnpm test:selfcheck     # synthetic faults with known causes
pnpm bench              # planted bugs B0-B8 + demo
```

Progress log and gate evidence: [PROGRESS.md](PROGRESS.md). Dependency and design decisions: [docs/decisions.md](docs/decisions.md).

## License

MIT, see [LICENSE](LICENSE).
