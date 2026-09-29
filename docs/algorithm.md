# Algorithm

cage answers one question: which of the differences between a failing and a passing browser session are
needed for the failure? It never guesses from the diff; every claim is backed by replays.

## 1. Factors

`extractFactors` (`packages/core/src/factors.ts`) aligns API exchanges of the two sessions by
`METHOD normalized-url #occurrence` and turns every difference into a **factor** with two values, `observed`
(failing session) and `neutral` (passing session):

| Kind | Source of the difference |
|---|---|
| `body` | one JSON leaf (missing key, `null` and a value are three distinct states; arrays of different length are one leaf; non-JSON bodies are one raw factor) |
| `status` | response status |
| `header` | allow-listed response header |
| `delay` | latency, when the two differ by more than 150 ms and 1.5x |
| `order` | two overlapping requests whose arrival order flipped (gap >= 25 ms in both sessions) |
| `presence` | a request only the failing run made (off = aborted) |
| `storage`, `cookie` | initial localStorage/sessionStorage keys and cookies |
| `env` | viewport, locale, timezone, user agent |

A **configuration** is the set of factors at their observed value; the rest are neutral. All observed is the
failing session, none observed is the passing one. `applyConfig` (`compose.ts`) turns a configuration into what
the browser gets: each response starts from the passing body and gets the observed leaves overlaid, delays are
real sleeps in the Node route handler, order factors hold a response until the other was delivered, storage is
seeded before the app loads. Unrecorded requests fail closed (HTTP 599, experiment = ERROR).

Factors also form a **tree**: endpoint (or storage / cookies / env / timing) → JSON sub-path → leaf, with
single-child chains collapsed.

## 2. Determinism gate

All observed and none observed are each replayed 5 times.

- All observed must fail in at least 80 % of runs, otherwise `untrustworthy-oracle` (the bug does not reproduce under replay).
- None observed must fail in at most 20 %; if it fails in at least 80 %, the verdict is `unexplained`: the failure persists with every modeled factor at its passing value, so its cause is outside what cage models.
- Perfect agreement (5/5 and 0/5) selects **deterministic mode**: one run per experiment.
- Anything else selects **statistical mode**; rates in the middle band are extended with the SPRT below, continuing from the gate's own runs.

## 3. Search: ddmin and hierarchical delta debugging

`ddmin` (Zeller and Hildebrandt 2002) finds a subset of factors that still fails and is **1-minimal**:
removing any single element makes it stop failing. It splits the current failing set into n chunks, tests each
chunk, then each complement; a failing chunk becomes the new set (n = 2), a failing complement too (n = n - 1);
if neither fails, n doubles, until n equals the set size. Any outcome other than FAIL (PASS, ERROR, UNRESOLVED)
counts as "does not fail".

HDD (Misherghi and Su 2006) runs ddmin over the top of the factor tree first (whole endpoints, storage, cookies,
env, timing), then expands only the kept nodes and runs ddmin again, down to leaves. With one relevant field among
40 irrelevant ones spread over three endpoints (bench bug B5), the search spends most tests on whole endpoints.

Engineering details:

- **Memoization.** Every outcome is cached by the configuration's bitset (plus overrides). Identical configurations are never run twice. The cache is `experiments.jsonl` in the bundle.
- **Parallelism without nondeterminism.** Candidates are tested in fixed-order windows of `--concurrency`; the first failing candidate *in order* wins, never the first to finish. Results are identical for any concurrency; wider windows may spend extra experiments (bench: B5 used 17 experiments at concurrency 1, 19 at 2 and 4).
- **OR structure.** After a minimal set S is found, cage tests "everything except S". If that still fails, there is another cause, and HDD runs again on the remaining factors (up to 4 sets).
- **Budget.** `--budget` caps experiments (default 500). On exhaustion the verdict is `partial` and the result is the smallest failing configuration seen, marked unverified.

### Non-monotonicity

ddmin guarantees 1-minimality, not a global minimum. Real apps are not monotone: adding a factor can heal a
failure (a fallback that only kicks in when two fields are both present, a timeout that masks a race). The unit
tests check 1-minimality and memo/width invariance over 600 random monotone and non-monotone predicates
(`packages/core/test/search.test.ts`), and the report's scope box states the caveat.

## 4. Statistical mode

Each experiment repeats until Wald's sequential probability ratio test decides between fail rate 0.2 (H0) and
0.8 (H1) with α = β = 0.05: the log-likelihood ratio moves ±ln 4 per run, and the test stops at ±ln 19, i.e. a
net lead of three fails or three passes. After 12 runs without a decision the outcome is UNRESOLVED, which the
search treats as "does not fail" and the report flags. A background flake rate between 0.2 and 0.8 lies inside
the test's indifference zone, so individual decisions can be wrong; see [limits.md](limits.md#flakiness).

## 5. After the search

- **Verification.** Each minimal set S and every S minus one factor are replayed again (3 runs in deterministic mode, a fresh SPRT in statistical mode). S must fail; each leave-one-out must not. If deterministic verification disagrees, the search reruns once in statistical mode. A set that still fails verification yields `partial`.
- **Truth table.** If the union of the sets has at most 5 factors, all 2^k subsets are run (cached). The minimal failing rows give the final sets and the structure: SINGLE, AND (only the full set fails), OR (several single-factor sets), or OTHER (anything else, including non-monotone tables). The report's causal graph looks outcomes up in this table.
- **Variant probes.** Each factor in a set is replaced by other value classes (missing key, null, empty string, 0, false, [], {}, wrong type; absent or empty for storage, cookies, headers) to show whether `null` specifically matters or any falsy value does.
- **Latency threshold.** For each delay factor in a set: binary search between neutral and observed latency to within 20 ms, then a 10-point grid from 0 to 1.5x the larger latency, 3 runs per point. The report plots this curve.

## 6. Verdicts

| Verdict | Meaning | Exit code |
|---|---|---|
| `explained` | minimal set(s) found and verified | 0 |
| `partial` | budget exhausted, or verification did not hold | 2 |
| `unexplained` | failure persists with all modeled factors neutral: cause outside the model | 3 |
| `untrustworthy-oracle` | failing session does not fail under replay, replay itself errors, or the oracle is too flaky | 4 |

The sentence at the top of the report is filled from a template. No language model is involved anywhere.

## References

- Andreas Zeller and Ralf Hildebrandt. Simplifying and Isolating Failure-Inducing Input. IEEE Transactions on Software Engineering 28(2), 183-200, 2002. [doi:10.1109/32.988498](https://doi.org/10.1109/32.988498)
- Ghassan Misherghi and Zhendong Su. HDD: Hierarchical Delta Debugging. ICSE 2006, 142-151. doi:10.1145/1134285.1134307 ([dblp record](https://dblp.org/rec/conf/icse/Misherghi06.html))
- Abraham Wald. Sequential Tests of Statistical Hypotheses. Annals of Mathematical Statistics 16(2), 117-186, 1945. [doi:10.1214/aoms/1177731118](https://doi.org/10.1214/aoms/1177731118)
