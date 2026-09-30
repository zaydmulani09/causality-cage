# Show HN draft (not posted)

**Title** (74 chars):

Show HN: Causality Cage, find the minimal cause of a browser bug by replay

**URL:** https://github.com/zaydmulani09/causality-cage

**First comment:**

I built this for the bugs where you have a failing run and a passing run and the diff between them is huge: response fields, timings, storage keys. cage replays the flow in Chromium with those differences switched on and off (hierarchical delta debugging over API response fields, latency, response order, localStorage, cookies and environment) and reports the smallest set that still fails, then checks it by leave-one-out replays.

The part I care most about is what it does not claim. A result is necessary and sufficient only within the factors it models, under your flow and your oracle, at the measured repeat rates. It is 1-minimal, not guaranteed globally smallest. It does not model server-side state, WebSockets, IndexedDB or static assets, and when the cause is out there it says "unexplained" instead of naming something. That scope box is printed in every report and cannot be hidden.

I tried it on one real closed issue: gothinkster/react-redux-realworld-example-app#187, where the RealWorld React frontend crashed with "Cannot read property 'tags' of undefined" and the reporter traced it to a stale token left in localStorage. On the issue's commit, with a token the API never issued in localStorage, cage returned the full chain in 19 experiments (25.1 s): the stale token AND the API rejecting the two requests that token triggers. The first version of cage said "the token" alone, because its minimal configuration crashed with a slightly different error and cage counted any crash. That case is why it now fingerprints the original failure and only counts runs that fail the same way (`--loose-oracle` restores the old behavior, which still names the token alone in 10 experiments). The same case also exposed a redaction leak where a truncated secret could slip into the report. Both are fixed, and the write-up has the raw output: https://github.com/zaydmulani09/causality-cage/blob/main/launch/real-world.md

On a planted-bug benchmark (null field, AND of two conditions, a latency race, response ordering, an OR, a flaky oracle, a server-side cause that should come back "unexplained", and a no-bug control) it matched ground truth on 10 of 10 rows, with one row (the OR case, whose two causes crash with different messages) run with `--loose-oracle`. The latency race flip point was measured at 808 ms against a 600 to 900 ms expected band. The benchmark app is mine, so treat that as a self-check, not evidence it works on your app.

Everything runs locally, no service and no LLM calls; the verdict sentence is a template. It writes a single offline HTML report and can export a standalone Playwright test that fails until the bug is fixed.

`npm install -g causality-cage`, MIT. I would really like to hear about bugs where it gives a wrong or useless answer.
