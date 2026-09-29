# Show HN draft (not posted)

**Title** (74 chars):

Show HN: Causality Cage, find the minimal cause of a browser bug by replay

**URL:** https://github.com/zaydmulani09/causality-cage

**First comment:**

I built this for the bugs where you have a failing run and a passing run and the diff between them is huge: response fields, timings, storage keys. cage replays the flow in Chromium with those differences switched on and off (hierarchical delta debugging over API response fields, latency, response order, localStorage, cookies and environment) and reports the smallest set that still fails, then checks it by leave-one-out replays.

The part I care most about is what it does not claim. A result is necessary and sufficient only within the factors it models, under your flow and your oracle, at the measured repeat rates. It is 1-minimal, not guaranteed globally smallest. It does not model server-side state, WebSockets, IndexedDB or static assets, and when the cause is out there it says "unexplained" instead of naming something. That scope box is printed in every report and cannot be hidden.

I tried it on one real closed issue: gothinkster/react-redux-realworld-example-app#187, where the RealWorld React frontend crashed with "Cannot read property 'tags' of undefined" and the reporter traced it to a stale token left in localStorage. On the issue's commit, with a token the API never issued in localStorage, cage named `localStorage jwt` as the single cause in 10 experiments (14.9 s). One caveat I wrote up: in that minimal configuration the page failed with a slightly different error, because cage does not compare failure signatures. With an oracle that only accepts the issue's exact error, it returned the full chain instead (the stale token AND the API rejecting two requests), 19 experiments, 19.8 s. That run also found two bugs in cage itself, one of them a redaction leak where a truncated secret could slip into the report. Both are fixed, and the write-up has the raw output: https://github.com/zaydmulani09/causality-cage/blob/main/launch/real-world.md

On a planted-bug benchmark (null field, AND of two conditions, a latency race, response ordering, an OR, a flaky oracle, a server-side cause that should come back "unexplained", and a no-bug control) it matched ground truth on 10 of 10 rows. The latency race flip point was measured at 790 ms against a 600 to 900 ms expected band. The benchmark app is mine, so treat that as a self-check, not evidence it works on your app.

Everything runs locally, no service and no LLM calls; the verdict sentence is a template. It writes a single offline HTML report and can export a standalone Playwright test that fails until the bug is fixed.

`npm install -g causality-cage`, MIT. I would really like to hear about bugs where it gives a wrong or useless answer.
