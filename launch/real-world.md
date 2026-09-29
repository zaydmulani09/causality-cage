# Tried on a real bug: react-redux-realworld-example-app #187

**Result: cage found the documented cause (a stale JWT in localStorage) in 10 experiments and 14.9 s. With an
oracle that only counts the exact error from the issue, it returned the full chain (stale JWT AND the two rejected
requests) in 19 experiments and 19.8 s.** Setup of the 2018 app took 3 min 24 s. Run on 2026-09-29, Windows 11,
Node 24.14, Chromium 148.

## The project and the bug

- Project: [gothinkster/react-redux-realworld-example-app](https://github.com/gothinkster/react-redux-realworld-example-app), the React + Redux frontend of the RealWorld ("Conduit") example.
- Issue: [#187 "Unhandled Rejection (TypeError): Cannot read property 'tags' of undefined when trying to run with local Node Express backend"](https://github.com/gothinkster/react-redux-realworld-example-app/issues/187), closed 2021-03-26.
- Commit the reporter used: [`9186292`](https://github.com/gothinkster/react-redux-realworld-example-app/tree/9186292054dc37567e707602a15a0884d6bdae35).
- Documented cause, from the reporter's own closing comment: they had used other RealWorld backends and "didn't clear the browser local storage". After clearing storage, it worked. The frontend reads a token from `localStorage.jwt`; with a token it loads the personal feed and the current user, and the backend rejects a token it did not issue.

The crash site in the code at that commit: `src/components/Home/index.js` picks `agent.Articles.feed` when a token
exists and loads `Promise.all([agent.Tags.getAll(), articlesPromise()])`; when that rejects,
`src/reducers/articleList.js:53` reads `action.payload[0].tags` from an error object.

## What I ran

Exactly one change to the app: `API_ROOT` in `src/agent.js` points at the live RealWorld API, because the
original host (`conduit.productionready.io`) no longer serves the API. The reporter changed the same line to point at
their local backend.

```bash
git clone https://github.com/gothinkster/react-redux-realworld-example-app app
cd app
git checkout 9186292054dc37567e707602a15a0884d6bdae35
# src/agent.js: const API_ROOT = 'https://api.realworld.show/api';
npm install --no-audit --no-fund --legacy-peer-deps           # 71 s
NODE_OPTIONS=--openssl-legacy-provider npx react-scripts build  # 2 min (webpack 3 on Node 24 needs the legacy provider)
cd ..
node serve.mjs    # static server for app/build on http://127.0.0.1:4100
```

The inputs are in [real-world/](real-world/): [`flow.ts`](real-world/flow.ts) (open the home page, wait for the
network to go idle), [`stale-token.json`](real-world/stale-token.json) (initial state with a JWT-shaped token this API
never issued, standing in for "a token from another backend"), [`same-error.ts`](real-world/same-error.ts) (the strict
oracle), [`serve.mjs`](real-world/serve.mjs).

Recording used the published `causality-cage@0.1.0`; the explain runs below used the repository at the commits that fix the two bugs described further down:

```text
> cage record flow.ts --base-url http://127.0.0.1:4100 --out good.json --label good --fail-on-uncaught
recorded 2 API exchanges → good.json
oracle: PASS
> cage record flow.ts --base-url http://127.0.0.1:4100 --state stale-token.json --out bad.json --label bad --fail-on-uncaught
recorded 3 API exchanges → bad.json
oracle: FAIL (uncaught: Cannot read properties of undefined (reading 'tags'))
```

The bad session made `GET /api/user` (401), `GET /api/tags` (200), `GET /api/articles/feed` (401). The good session
made `GET /api/tags` (200), `GET /api/articles` (200). Same error as the issue, in V8's current wording ("Cannot read properties of undefined (reading 'tags')").

## Raw output

Run 1, any uncaught error counts as the failure:

```text
> cage explain --flow flow.ts --fail-on-uncaught --bad bad.json --good good.json --out result.cage --no-open
EXPLAINED  The failure ("uncaught: Cannot read properties of undefined (reading 'tags')") happens when localStorage jwt is "redacted-b40532944e". Restoring the passing value prevents it. Timing differences do not matter. (10 experiments.)
  set 1 (SINGLE): storage localStorage jwt
  gate: all-observed failed 5/5, all-neutral failed 0/5; mode deterministic; 4 factors; 10/500 experiments; 14.9 s
  bundle result.cage, report result.html
exit 0, wall 17 s
```

Run 2, only the error from the issue counts (`same-error.ts`):

```text
> cage explain --flow flow.ts --oracle same-error.ts --bad bad.json --good good.json --out result-same.cage --no-open
EXPLAINED  The failure ("Cannot read properties of undefined (reading 'tags')") happens only when GET https://api.realworld.show/api/user gets its recorded response AND GET https://api.realworld.show/api/articles/feed?limit=10&offset=0 gets its recorded response AND localStorage jwt is "redacted-d045174b02". Removing any one of them prevents it. Timing differences do not matter. (19 experiments.)
  set 1 (AND): presence GET https://api.realworld.show/api/user  +  presence GET https://api.realworld.show/api/articles/feed?limit=10&offset=0  +  storage localStorage jwt
  gate: all-observed failed 5/5, all-neutral failed 0/5; mode deterministic; 4 factors; 19/500 experiments; 19.8 s
  bundle result-same.cage, report result-same.html
exit 0, wall 20 s
```

The 4 factors were: `storage localStorage jwt`, `presence GET /api/user`, `presence GET /api/articles/feed`, and
`delay GET /api/tags` (110 ms vs 580 ms, irrelevant, correctly dropped).

## Did it find the documented cause?

Yes, with one caveat worth reading.

- Run 1 names the stale `localStorage.jwt` as the single cause, which is what the reporter found. Leave-one-out verification held (3/3 fail with it, 0/3 without it).
- The caveat: in run 1's minimal configuration (only the jwt at its failing value), the two requests that only the failing run made are aborted rather than answered with 401, and the page throws `(reading 'body')` instead of `(reading 'tags')`. The oracle accepted any uncaught error, so this counted as the same failure. cage does not compare failure signatures; an oracle has to.
- Run 2 uses an oracle that only accepts the issue's exact error. Then cage reports that the original crash needs the stale token AND the server rejecting both `/user` and `/feed`. That is the real mechanism: the token alone does nothing without a backend that rejects it.

## Two tool bugs this run exposed, fixed generally

1. **Redaction leak.** The verdict sentence quotes factor values truncated to 40 characters. A truncated secret was not caught by the final sweep, so the first 40 characters of the JWT reached `result.json` and `report.html` in `causality-cage@0.1.0`. Fixed by rebuilding the sentence from the redacted factors (commit "fix: rebuild verdict sentence from redacted factors", with a regression test that fails on the old code). The rerun bundle was checked: none of its 12 files contains any part of the token. The published 0.1.0 still has this bug until a new version is published.
2. **Wording.** The sentence said a presence factor "is requested"; the request happens either way, and the factor decides whether the recorded response is delivered. Now "gets its recorded response" / "fails at the network level".

The benchmark was re-run after both fixes (see README).

## Time

| Step | Time |
|---|---|
| clone + checkout | 11 s |
| npm install | 71 s |
| production build | 2 min 2 s |
| record good + bad | 9 s |
| cage explain, run 1 | 14.9 s (17 s wall) |
| cage explain, run 2 | 19.8 s (20 s wall) |
