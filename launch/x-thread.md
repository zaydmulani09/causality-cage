# X thread draft (not posted)

**1/** (attach launch/demo.gif)

I kept losing afternoons to bugs that only happen with one specific combination of API data, timing and local state. So I built a tool that replays the failing session and flips those conditions until it finds the smallest set that still breaks.

**2/**

You give it a failing run and a passing run. It replays the flow in Chromium, switches response fields, latency, response order, localStorage, cookies and environment between the two, and uses delta debugging to shrink the set. Then it re-checks the answer by removing each piece.

**3/**

Tried it on a real closed issue in the RealWorld React app (#187): a crash reading 'tags' of undefined that the reporter traced to a stale token in localStorage. cage named localStorage jwt as the cause in 10 experiments, 14.9 s.

**4/**

The honest caveat from that run: its minimal config failed with a slightly different error, because the tool does not compare failure signatures. With an oracle that only accepts the exact error, it returned the full chain instead: stale token AND the API rejecting two requests. Written up with raw output.

**5/**

It also says "unexplained" when the cause is outside what it models (server state, websockets, static assets) instead of making something up. Every report has a scope box that says exactly what the claim covers.

**6/**

Local only, no LLM, one offline HTML report, and it can export a Playwright test that fails until the bug is fixed. MIT.

npm install -g causality-cage
github.com/zaydmulani09/causality-cage
