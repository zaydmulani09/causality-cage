# PROGRESS

Current: M2 factors.

## Skills
- /caveman ultra + /ponytail ultra loaded (found, both).
- Conflict: ponytail ultra = YAGNI extremist vs spec-mandated scope → spec scope wins (sec 17 rule). Ponytail applied inside each feature (stdlib first, no speculative abstractions).
- Conflict: caveman says commits/code normal; spec says caveman in commits → commits terse conventional. Public docs (README, docs/*) = terse but grammatical: launch readability is a README gate.

## Milestones
| M | Status | Gate evidence |
|---|---|---|
| M0 scaffold | PASS | clean clone: pnpm install + pnpm check green (4 tests); cage doctor all ok (chromium 148) |
| M1 capture/replay | PASS | B1 bad: verify 20 runs → FAIL 20/20, 1 seqHash; good: PASS 20/20, 1 seqHash. ~0.25 s/run |
| M2 factors | todo | |
| M3 search | todo | |
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

## Open issues
- none
