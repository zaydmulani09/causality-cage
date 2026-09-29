# PROGRESS

Current: M6 report.

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
| M6 report | todo | |
| M7 single-session | todo | |
| M8 bench/docs | todo | |

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

## Open issues
- none
