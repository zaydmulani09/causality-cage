# Limits

What cage v1 does not do, and where its answers stop being trustworthy.

## Not modeled (out of scope for v1)

A cause in any of these shows up as `unexplained`, never as an invented factor:

- **Server-side state** not visible in API responses (feature flags evaluated on the server, database rows, sessions). Bench bug B8 plants exactly this and cage reports `unexplained`.
- **Static assets and third-party scripts.** Only `fetch`/`xhr` requests are recorded and replayed (or whatever `--api <glob>` selects). HTML, JS, CSS, images and `/runtime-config.js`-style scripts come live from `--base-url`.
- **WebSockets, WebRTC, Server-Sent Events.**
- **IndexedDB, Cache Storage.** Only localStorage, sessionStorage and cookies are storage factors.
- **Service workers.** Blocked in every context (`serviceWorkers: 'block'`) so routing sees every request.
- **iframes from other origins** with their own auth, **multi-tab flows**, **non-Chromium browsers**, **mobile**.
- **Offline / network-failure patterns** as an environment factor. (Presence factors abort a request that only the failing run made; nothing else simulates network loss.)

## What a result means

- A minimal set is **1-minimal** (Zeller's ddmin): removing any one factor stops the failure. It is not guaranteed to be the globally smallest set. Behavior can be non-monotone: adding a factor can heal a failure. See [algorithm.md](algorithm.md).
- The claim holds only **under the recorded flow and oracle** and **at the measured repeat rates**. The report's scope box prints the gate rates and budget.
- `partial` means the budget ran out: the set is the smallest failing configuration seen, **not verified**.
- Exchanges that appear only in the passing session are served when requested but are never factors: the failing run stopped before them, so their absence is a consequence, not a condition.
- Request matching is by method, normalized URL and occurrence number. Request bodies are hashed and recorded but do not have to match (POST bodies legitimately change with the configuration). Secret-named query params are not part of the key, so a differing token param is never a factor.
- Header factors cover an allow list (`content-type`, `cache-control`, `content-language`, `etag`, `expires`, `last-modified`, `vary`, and `x-*` minus known volatile ones like `x-request-id`).
- Order factors need a gap of at least 25 ms in both sessions; faster flips are treated as jitter.

## Timing

- **Latency is real wall-clock time**: a 1200 ms delay factor sleeps 1200 ms in the Node route handler. Races need generous margins; a flip threshold is only as precise as the event loop and the page's own timers. On the bench, the B3 flip (a 750 ms app timer) is measured at 820-870 ms because interception, JSON parsing and React rendering add time.
- `order` factors hold a response until the other one was delivered, plus a 60 ms gap.
- `--freeze-time` installs Playwright's clock at a fixed start time. Page timers then run on virtual time while delay factors still sleep in real time; do not combine it with latency questions.
- `--freeze-random` seeds `Math.random`. It removes randomness the bug may depend on (B7's flake disappears with it).

## Flakiness

- The determinism gate runs all-observed and all-neutral 5 times each. Rates outside [≥ 80 %, ≤ 20 %] that are not clearly wrong switch to statistical mode: each experiment repeats until an SPRT (0.2 vs 0.8, α = β = 0.05, max 12 runs) decides.
- A background flake rate between 0.2 and 0.8 sits inside the SPRT's indifference zone. With the 30 % flake of bench bug B7 a single SPRT decision is wrong a few percent of the time. cage re-verifies the final set (leave-one-out) and reruns the search in statistical mode when deterministic verification disagrees, but a wrong extra OR-set can still survive. UNRESOLVED outcomes count as "does not fail" and are flagged in warnings.
- Recording itself can hit a flake. Record again until the failing session shows the failure you are chasing and the passing one passes (the bench harness does this, max 5 tries).

## Single-session mode (`--synthesize-good`, experimental)

Neutral values are synthesized from the failing session alone: body leaves become the most common non-null value at that path in other exchanges of the same endpoint, else a type default (`""`, `0`, `false`; `null` becomes `""`); latency becomes the endpoint's minimum; storage and cookies become absent; the environment becomes Chromium defaults. Requests the failing run never made (it crashed first) have no recording, so in this mode they go to the live app unless `--allow-unmatched` restricts them. That can mean real side effects (the bench's POST /api/order reaches the mock server).

Measured on the bench (`pnpm cage bench --synthesize-good`, 2026-09-29):

| Bug | Result | Why |
|---|---|---|
| B1 null field | solved (27 experiments) | null → `""` is a passing value |
| B2 AND with storage | solved (61) | storage absent → default assignment |
| B5 one field among 40 | solved (22) | `""` currency falls back to USD in the app |
| B8 server state | `unexplained` (correct) | |
| B0 control | no failure (correct) | |
| B3 latency | `unexplained` | each endpoint is called once, so the minimum latency is the observed one: no delay factor exists |
| B4 ordering | `unexplained` | one session has one arrival order: no order factor exists |
| B6 cookie OR header | `unexplained` | headers are not synthesized, so `x-region: eu` stays in the "passing" configuration and it still fails |
| B7 flake | wrong: extra set `{currency}` | 75 synthesized factors mean many more SPRT decisions at a 30 % flake rate; one false FAIL survived verification |
| demo AND with latency | only `{customer.tax_id}` | the latency half of the AND is not a factor (see B3); the answer is correct only with prices held slow |

It also fails whenever the app cannot run on empty strings and zeros (the synthesized all-neutral configuration then fails, and cage reports `unexplained` with "synthesis failed"). Record a passing session when you can.

## Redaction

See [bundle-format.md](bundle-format.md#redaction-default-on). The flow and oracle source files are stored verbatim, and base64 (binary) bodies are not scanned.
