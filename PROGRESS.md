# PROGRESS

Current: DONE (M0-M8 gates passed). Nothing pushed.

## Skills
- /caveman ultra + /ponytail ultra loaded (found, both).
- Conflict: ponytail ultra = YAGNI extremist vs spec-mandated scope → spec scope wins (sec 17 rule). Ponytail applied inside each feature (stdlib first, no speculative abstractions).
- Conflict: caveman says commits/code normal; spec says caveman in commits → commits terse conventional. Public docs (README, docs/*) = terse but grammatical: launch readability is a README gate.

## Milestones
| M | Status | Gate evidence |
|---|---|---|
| M0 scaffold | PASS | clean clone: pnpm install + pnpm check green (4 tests); cage doctor all ok (chromium 148) |
| M1 capture/replay | PASS | B1 bad: verify 20 runs → FAIL 20/20, 1 seqHash; good: PASS 20/20, 1 seqHash. ~0.25 s/run |
| M2 factors | PASS | B1 (2 factors): all-obs FAIL 10/10, all-neutral PASS 10/10. B5: 42 factors (40 noise + cart.currency + presence POST /api/order), all-obs FAIL 10/10, all-neutral PASS 10/10, 1 seqHash each. Unit: duplicate URLs, query order, missing exchanges, null vs missing |
| M3 search | PASS | cage bench --only B1,B2,B5: exact 3/3 at concurrency 1, 2, 4 (same sets). Experiments c1/c2/c4: B1 11/11/11, B2 16/16/16, B5 17/19/19 (<=60). Unit: ddmin 1-minimality + memo/width invariance over 600 random monotone/non-monotone oracles |
| M4 stats/structure | PASS | full cage bench: 10/10 (B0-B8 + demo). B3 threshold 822 ms (band 600-900; earlier runs 848-871 with an 800 ms app timer, now 750 ms). B4 order, B6 OR both sets, B8 unexplained (2 experiments), B0 no failure. B7 statistical mode: 10/10 repeated runs after fixes below |
| M5 bundle/redact/repro | PASS | unit: round trip (write/read zip deepEqual), 9 planted secrets (JWT, token, email, card, cookie, storage key, URL param, console error, sentence) absent from every zipped file, type/null/consistency preserved, schema file == regenerated from types.ts, malformed files rejected with paths. Integration tests/integration/export.spec.ts: real B1 bundle round trip; exported spec exits non-zero on BUG=B1 ("the failure still reproduces"), 0 on BUG=none. cage repro: minimal set FAIL, --set all=neutral PASS |
| M6 report | PASS | tests/integration/report.spec.ts on a real demo-scenario bundle (6/6): file:// with non-file requests aborted → 0 network requests; clicking/Enter on factors matches embedded truth table (FAIL → NO FAILURE → FAIL); 375 px: scrollWidth <= clientWidth, vertical graph shown; WCAG contrast >= 4.5 for fg/muted/fail/pass/warn/accent pairs and >= 7 body text, light + dark; ?demo=1 autoplay. Visual check via headless screenshots light/dark/phone |
| M7 single-session | PASS | cage bench --only B1,B5 --synthesize-good: 2/2 exact (B1 27 experiments/75 factors, B5 22/76). CLI prints EXPERIMENTAL banner; report + result carry singleSession + warning. Full single-session bench 5/10, failures analysed in docs/limits.md |
| M8 bench/docs | PASS | fresh clone (git clone . tmp): pnpm install + pnpm check (31 unit tests) + pnpm bench → 10/10 exact, exit 0, pasted verbatim in README. B5 19 experiments at c=4 (<=60). Replay consistent on every non-flaky row. Median time per replay run 0.60 s (<3 s); B1 explain 4.8 s (<3 min). pnpm test:integration 7/7. pnpm test:selfcheck 4/4 on seeds 7, 11, 3. scripts/check-links.mjs: 14/14 README links resolve. demo.ps1 and demo.sh run end to end. README quickstart (B2) re-run: explained, exit 0 |

## Deviations
- No CLI bundler (tsx runtime). See docs/decisions.md.
- Shop API on node:http, not Express.
- Replay matches by key+nth; request-body hash recorded but not required to match (POST bodies legitimately differ across configs).
- Flow throwing = FAIL (app broke the flow). Oracle throwing / experiment timeout = ERROR.
- --allow-unmatched URLs go to the live network (not 599).
- Order factors need a >=25 ms arrival gap in both sessions (filters jitter between fast concurrent requests).
- Header allowlist: content-type, cache-control, content-language, etag, expires, last-modified, vary, plus x-* minus known volatile (x-request-id, x-trace*, ...).
- Presence factors only for exchanges in the bad session alone (neutral = abort). Exchanges only in the good session are served when requested, never factors: the failing run stopped before them, so their absence is a consequence (first B1 run found a spurious "POST /api/order absent" cause; fixed).
- Parallel ddmin: candidates tested in fixed-order windows of width=concurrency, first FAIL in order wins → same result for any concurrency; wider windows may spend more experiments.
- OR structure: after a minimal set S is found, test (all − S); if it still fails, HDD again on the rest (max 4 sets).
- verify gained --good (+ --set f=observed|neutral, all=neutral) so a chosen configuration can be replayed.

- Gate in flaky zone: SPRT continues from the gate runs (cumulative), not a fresh test. UNRESOLVED all-neutral gate / leave-one-out = treated as not failing + warning (spec: UNRESOLVED counts as PASS for reduction).
- Deterministic mode verification disagreement → rerun search in statistical mode once.
- B7 plant fix: flake rolled inside a useState initializer got re-rolled by React error retry (effective ~50%, logged as React #520). Now one roll per page load = true 30%.
- Bench harness re-records (max 5) until bad fails with the case signature (badReason) and good passes, as a developer would. With a 30% flake, 30% of raw recordings are otherwise not the bug under study.
- B3 app timer 750 ms (spec says ~800 ms): replay/render overhead puts the measured flip at ~800-870 ms; at 800 ms it sat at the band edge (848-871).
- Added demo scenario (BUG=demo) for the section 1 recording: tax_id null AND prices > ~700 ms → AND graph + latency curve. Extra bench row.

- Secret-named query params are dropped from exchange keys (like volatile params) so redacted bundles still replay; a differing token param is therefore never a factor.
- Flow/oracle sources go into the bundle verbatim (not redacted); documented.
- explain: --out defaults to result.cage, report written as <name>.html beside it, opened by default only in an interactive terminal (--no-open).

- Report: two SVG graph layouts (wide + stacked for phones) switched by CSS; tables keep a min width and scroll inside their own box on phones (page itself never scrolls sideways). CSP meta blocks all network.
- Latency panel marker reads the nearest measured grid point (no interpolation claimed).

- Single-session: requests the failing run never made go live by default (no recording exists); warned + documented; --allow-unmatched restricts. null → "" type default.

## Open issues
- selfcheck seed 11 once stopped at the gate (2 experiments) while a heavy tsc run shared the CPU; 3 later runs of the same seed passed 4/4. Suspect experiment timeouts under CPU contention (latency factors are wall-clock). Not reproduced.
- B7-style flakes (rate inside the SPRT indifference zone) can still yield a wrong extra OR-set; seen in single-session mode (docs/limits.md).
- Not published to npm; no bundling yet (tsx runtime).
- CI workflow written, not enabled or pushed.
