# PROGRESS

Current: M4 stats/structure.

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
| M4 stats/structure | todo | |
| M5 bundle/redact/repro | todo | |
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

## Open issues
- none
