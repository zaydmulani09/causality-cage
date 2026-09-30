# Tried on a real bug: react-redux-realworld-example-app #187

**Result with `causality-cage@0.1.2` (the default, failure-signature matching): cage returned the full chain behind
the documented cause, a stale JWT in localStorage AND the API rejecting the two requests that token triggers, in 19
experiments and 25.1 s.** With `--loose-oracle` (any failure counts, the only behavior before 0.1.2) it named the
stale `localStorage jwt` alone, in 10 experiments and 16.9 s. Setup of the 2018 app took 3 min 24 s. Run on
2026-09-29, Windows 11, Node 24.14, Chromium 148.

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
never issued, standing in for "a token from another backend"), [`same-error.ts`](real-world/same-error.ts) (an oracle
that only accepts the issue's error, used in the earlier runs below), [`serve.mjs`](real-world/serve.mjs).

Recording (published `causality-cage@0.1.0`; the sessions are the same for every run below):

```text
> cage record flow.ts --base-url http://127.0.0.1:4100 --out good.json --label good --fail-on-uncaught
recorded 2 API exchanges → good.json
oracle: PASS
> cage record flow.ts --base-url http://127.0.0.1:4100 --state stale-token.json --out bad.json --label bad --fail-on-uncaught
recorded 3 API exchanges → bad.json
oracle: FAIL (uncaught: Cannot read properties of undefined (reading 'tags'))
```

The bad session made `GET /api/user` (401), `GET /api/tags` (200), `GET /api/articles/feed` (401). The good session
made `GET /api/tags` (200), `GET /api/articles` (200). Same error as the issue, in V8's current wording ("Cannot read
properties of undefined (reading 'tags')").

## Raw output, causality-cage 0.1.2

Both runs used the packed 0.1.2 tarball (`npm pack` of `dist-npm/`, installed into a clean folder).

Default (failure-signature matching):

```text
> cage explain --flow flow.ts --fail-on-uncaught --bad bad.json --good good.json --out strict.cage --no-open
EXPLAINED  The failure ("uncaught: TypeError: Cannot read properties of undefined (reading 'tags')") happens only when GET https://api.realworld.show/api/user gets its recorded response AND GET https://api.realworld.show/api/articles/feed?limit=10&offset=0 gets its recorded response AND localStorage jwt is "redacted-1d89dff6dd". Removing any one of them prevents it. Timing differences do not matter. (19 experiments.)
  set 1 (AND): presence GET https://api.realworld.show/api/user  +  presence GET https://api.realworld.show/api/articles/feed?limit=10&offset=0  +  storage localStorage jwt
  failure signature: uncaught: TypeError: Cannot read properties of undefined (reading 'tags')
  gate: all-observed failed 5/5, all-neutral failed 0/5; mode deterministic; 4 factors; 19/500 experiments; 25.1 s
  warning: Without presence GET https://api.realworld.show/api/user the page still fails, but with a different failure than the bad session's.
  warning: Without presence GET https://api.realworld.show/api/articles/feed?limit=10&offset=0 the page still fails, but with a different failure than the bad session's.
  bundle strict.cage, report strict.html
exit 0, wall 27 s
```

`--loose-oracle` (any uncaught error counts):

```text
> cage explain --flow flow.ts --fail-on-uncaught --loose-oracle --bad bad.json --good good.json --out loose.cage --no-open
EXPLAINED  The failure ("uncaught: TypeError: Cannot read properties of undefined (reading 'tags')") happens when localStorage jwt is "redacted-e93af39605". Restoring the passing value prevents it. Timing differences do not matter. (10 experiments.)
  set 1 (SINGLE): storage localStorage jwt
  failure signature: not checked (--loose-oracle: any failure counts)
  gate: all-observed failed 5/5, all-neutral failed 0/5; mode deterministic; 4 factors; 10/500 experiments; 16.9 s
  bundle loose.cage, report loose.html
exit 0, wall 18 s
```

The 4 factors were: `storage localStorage jwt`, `presence GET /api/user`, `presence GET /api/articles/feed`, and
`delay GET /api/tags` (irrelevant, correctly dropped).

## Did it find the documented cause?

Yes. The default run and the loose run both point at the stale token; they differ in how much of the mechanism they
report, and the difference is exactly what failure-signature matching was added for.

- **Default (0.1.2):** with only the jwt at its failing value, the two requests that only the failing run made are aborted instead of answered with 401, and the page throws `(reading 'body')`, not `(reading 'tags')`. That no longer counts as reproducing the bug; it is a `DIFFERENT_FAILURE`. So cage keeps looking and reports what the original crash actually needs: the stale token AND the server rejecting both `/user` and `/feed`. The token alone does nothing without a backend that rejects it. The two warnings say that removing either presence factor still breaks the page, only differently.
- **`--loose-oracle`:** any uncaught error counts, so the `(reading 'body')` crash counts too, and the minimal set is `{localStorage jwt}`. This is what 0.1.0 and 0.1.1 always did.
- Leave-one-out verification held in both runs. Neither bundle contains any part of the token (checked all 12 files of each).

## History: runs before signature matching

Before 0.1.2 the same case gave `{localStorage jwt}` with `--fail-on-uncaught` (10 experiments, 14.9 s), and the full
chain only with the hand-written [`same-error.ts`](real-world/same-error.ts) oracle (19 experiments, 19.8 s). That
gap is why 0.1.2 makes signature matching the default.

## Tool bugs this case exposed, fixed generally

1. **Redaction leak.** The verdict sentence quoted factor values truncated to 40 characters, and a truncated secret slipped past the final sweep, so the first 40 characters of the JWT reached `result.json` and `report.html` in `causality-cage@0.1.0`. Fixed by rebuilding the sentence from the redacted factors, with a regression test that fails on the old code. 0.1.0 on npm still has this bug until a newer version is published.
2. **Wording.** The sentence said a presence factor "is requested"; the request happens either way, and the factor decides whether the recorded response is delivered. Now "gets its recorded response" / "fails at the network level".
3. **No notion of "the same failure".** A minimal configuration could fail with a different error and still count. 0.1.2 adds failure signatures (see [docs/limits.md](../docs/limits.md)).

## Time

| Step | Time |
|---|---|
| clone + checkout | 11 s |
| npm install | 71 s |
| production build | 2 min 2 s |
| record good + bad | 9 s |
| cage explain 0.1.2, default | 25.1 s (27 s wall) |
| cage explain 0.1.2, `--loose-oracle` | 16.9 s (18 s wall) |
