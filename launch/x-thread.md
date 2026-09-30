# X thread draft (not posted)

**1/** (attach launch/demo.gif)

I kept losing afternoons to bugs that only happen with one specific combination of API data, timing and local state. So I built a tool that replays the failing session and flips those conditions until it finds the smallest set that still breaks.

**2/**

You give it a failing run and a passing run. It replays the flow in Chromium, switches response fields, latency, response order, localStorage, cookies and environment between the two, and uses delta debugging to shrink the set. Then it re-checks the answer by removing each piece.

**3/**

Tried it on a real closed issue in the RealWorld React app (#187): a crash reading 'tags' of undefined that the reporter traced to a stale token in localStorage. cage came back with the whole chain in 19 experiments, 25.1 s: stale token AND the API rejecting the two requests it triggers.

**4/**

That answer exists because the first version got it slightly wrong: it said "the token" alone, since its minimal config crashed with a different error and any crash counted. Now it fingerprints the original failure and a different crash is reported as a different failure. Written up with raw output.

**5/**

It also says "unexplained" when the cause is outside what it models (server state, websockets, static assets) instead of making something up. Every report has a scope box that says exactly what the claim covers.

**6/**

Local only, no LLM, one offline HTML report, and it can export a Playwright test that fails until the bug is fixed. MIT.

npm install -g causality-cage
github.com/zaydmulani09/causality-cage
