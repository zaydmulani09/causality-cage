// The pipeline: extract → determinism gate → HDD search (repeated for OR) → verify → truth table → variants → delay curves.
import type { Browser } from 'playwright';
import { deepEqual, extractFactors, type Extracted } from './factors.ts';
import { BudgetExhausted, Lab } from './lab.ts';
import type { FlowFn, OracleFn } from './oracle.ts';
import { hdd, pruneTree } from './search.ts';
import { sentence } from './sentence.ts';
import { ABSENT, type DelayCurve, type ExperimentRecord, type Factor, type FactorValue, type Result, type Session, type Structure, type TruthRow, type VariantProbe, type VerificationRow } from './types.ts';

export interface ExplainOptions {
  browser: Browser;
  baseURL: string;
  flow: FlowFn;
  oracle: OracleFn;
  bad: Session;
  good: Session;
  concurrency?: number;
  budget?: number;
  timeoutMs?: number;
  gateRuns?: number;
  allowUnmatched?: string[];
  apiGlobs?: string[];
  freezeRandom?: boolean;
  freezeTime?: boolean;
  maxFactors?: number;
  singleSession?: boolean;
  onRecord?: (r: ExperimentRecord) => void;
  onPhase?: (msg: string) => void;
}

export interface Explained extends Extracted {
  result: Result;
  experiments: ExperimentRecord[];
}

const MAX_SETS = 4;
const TABLE_MAX = 5;
const VERIFY_RUNS = 3;
const GRID_POINTS = 10;
const GRID_RUNS = 3;

const rate = (r: { runs: number; fails: number; errors: number }) => r.fails / Math.max(1, r.runs - r.errors);

export async function explain(o: ExplainOptions): Promise<Explained> {
  const t0 = Date.now();
  const ex = extractFactors(o.bad, o.good, o.maxFactors ? { maxFactors: o.maxFactors } : {});
  const { factors } = ex;
  const byId = new Map(factors.map((f) => [f.id, f]));
  const order = (ids: string[]) => [...ids].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
  const budget = o.budget ?? 500;
  const concurrency = o.concurrency ?? 4;
  const lab = new Lab({
    browser: o.browser,
    baseURL: o.baseURL,
    flow: o.flow,
    oracle: o.oracle,
    bad: o.bad,
    good: o.good,
    pairs: ex.pairs,
    factors,
    concurrency,
    budget,
    timeoutMs: o.timeoutMs ?? 20_000,
    allowUnmatched: o.allowUnmatched ?? [],
    apiGlobs: o.apiGlobs ?? [],
    freezeRandom: !!o.freezeRandom,
    freezeTime: !!o.freezeTime,
    ...(o.onRecord ? { onRecord: o.onRecord } : {}),
  });
  const phase = (m: string) => o.onPhase?.(m);
  const all = factors.map((f) => f.id);
  const r: Result = {
    verdict: 'partial',
    reason: '',
    sentence: '',
    mode: 'deterministic',
    singleSession: !!o.singleSession,
    gate: { allTrue: { runs: 0, fails: 0 }, allFalse: { runs: 0, fails: 0 } },
    factorCount: factors.length,
    minimalSets: [],
    structure: null,
    truthTable: null,
    verification: [],
    variants: [],
    delayCurves: [],
    budget: { used: 0, limit: budget },
    wallMs: 0,
    warnings: [...ex.warnings],
  };
  let failReason = '';

  const finish = async (): Promise<Explained> => {
    await lab.settle();
    r.budget.used = lab.records.length;
    r.wallMs = Date.now() - t0;
    r.sentence = sentence(r, factors, failReason);
    return { ...ex, result: r, experiments: [...lab.records].sort((a, b) => a.n - b.n) };
  };

  try {
    // 1. determinism gate
    phase('determinism gate');
    const k = o.gateRuns ?? 5;
    let [T, F] = await Promise.all([lab.test({ on: all }, 'gate', { runs: k }), lab.test({ on: [] }, 'gate', { runs: k })]);
    failReason = T.reason ?? '';
    const tally = (...rs: ExperimentRecord[]) => ({ runs: rs.reduce((s, x) => s + x.runs - x.errors, 0), fails: rs.reduce((s, x) => s + x.fails, 0) });
    let flaky = T.fails !== T.runs - T.errors || F.fails !== 0;
    const zone = (x: ExperimentRecord) => (x.errors * 2 > x.runs ? 'ERROR' : rate(x) >= 0.8 ? 'FAIL' : rate(x) <= 0.2 ? 'PASS' : 'MID');
    let tz = zone(T);
    let fz = zone(F);
    if (tz === 'MID' || fz === 'MID') {
      phase('flaky gate: extending with SPRT');
      lab.mode = 'statistical';
      flaky = true;
      const prior = (x: ExperimentRecord) => ({ prior: { runs: x.runs - x.errors, fails: x.fails }, fresh: true });
      if (tz === 'MID') {
        const T2 = await lab.test({ on: all }, 'gate', prior(T));
        tz = T2.decision;
        T = { ...T, runs: T.runs + T2.runs, fails: T.fails + T2.fails, errors: T.errors + T2.errors };
      }
      if (fz === 'MID') {
        const F2 = await lab.test({ on: [] }, 'gate', prior(F));
        fz = F2.decision;
        F = { ...F, runs: F.runs + F2.runs, fails: F.fails + F2.fails, errors: F.errors + F2.errors };
      }
    }
    r.gate = { allTrue: tally(T), allFalse: tally(F) };
    const pct = (g: { runs: number; fails: number }) => `${g.fails}/${g.runs}`;
    if (tz === 'ERROR' || fz === 'ERROR') {
      r.verdict = 'untrustworthy-oracle';
      r.reason = `Replay itself errored (${(tz === 'ERROR' ? T : F).reason ?? 'unknown'}). Fix the replay setup before searching.`;
      return finish();
    }
    if (tz !== 'FAIL') {
      r.verdict = 'untrustworthy-oracle';
      r.reason = `The failing session does not reproduce under replay: all-observed failed ${pct(r.gate.allTrue)} runs (gate needs >= 80%).`;
      return finish();
    }
    if (fz === 'FAIL') {
      r.verdict = 'unexplained';
      r.reason = o.singleSession
        ? `Synthesis failed: the synthesized passing configuration still fails (${pct(r.gate.allFalse)} runs), so single-session mode cannot isolate a cause.`
        : `The failure persists with all ${factors.length} modeled factors at their passing values (${pct(r.gate.allFalse)} runs fail): the cause lies outside what was modeled.`;
      return finish();
    }
    if (fz === 'UNRESOLVED') {
      // SPRT could not separate the all-neutral rate from 0.2 vs 0.8: treated as PASS (conservative for reduction), flagged.
      r.warnings.push(`All-neutral gate undecided after ${r.gate.allFalse.runs} runs (${pct(r.gate.allFalse)} fail); treated as passing. Background flakiness is high.`);
    }
    if (!factors.length) {
      r.verdict = 'unexplained';
      r.reason = 'The two sessions do not differ in any modeled factor.';
      return finish();
    }
    if (flaky) lab.mode = 'statistical';
    r.mode = lab.mode;
    const seedGate = () => {
      lab.seed({ on: all }, 'FAIL');
      lab.seed({ on: [] }, 'PASS');
    };
    seedGate();

    // 2. search, 3. verification (re-run once in statistical mode if deterministic results do not hold up)
    let sets: string[][] = [];
    const search = async () => {
      sets = [];
      let remaining = all;
      for (;;) {
        phase(`search for minimal set ${sets.length + 1}`);
        const tree = pruneTree(ex.tree, new Set(remaining))!;
        const S = order(await hdd(tree, async (ids) => (await lab.test({ on: ids }, 'search')).decision, concurrency));
        sets.push(S);
        remaining = remaining.filter((id) => !S.includes(id));
        if (sets.length >= MAX_SETS || !remaining.length) break;
        if ((await lab.test({ on: remaining }, 'search')).decision !== 'FAIL') break;
      }
    };
    const verify = async () => {
      phase('verifying necessity and sufficiency');
      const rows = await Promise.all(
        sets.flatMap((S) =>
          [null, ...S].map(async (removed): Promise<VerificationRow> => {
            const on = removed ? S.filter((x) => x !== removed) : S;
            const rec = await lab.test({ on }, 'verify', lab.mode === 'deterministic' ? { runs: VERIFY_RUNS } : { fresh: true });
            // UNRESOLVED counts as "does not fail" (spec: conservative), flagged below; deterministic runs must agree 3/3
            const noFail = lab.mode === 'statistical' ? rec.decision === 'PASS' || rec.decision === 'UNRESOLVED' : rec.decision === 'PASS';
            return { set: S, removed, runs: rec.runs - rec.errors, fails: rec.fails, ok: removed ? noFail : rec.decision === 'FAIL' };
          }),
        ),
      );
      return rows;
    };
    await search();
    r.minimalSets = sets;
    r.verification = await verify();
    if (r.verification.some((v) => !v.ok) && lab.mode === 'deterministic') {
      r.warnings.push('Deterministic verification disagreed with the search (flaky outcomes); re-ran the search in statistical mode.');
      lab.mode = 'statistical';
      r.mode = 'statistical';
      lab.resetMemo();
      seedGate();
      await search();
      r.minimalSets = sets;
      r.verification = await verify();
    }
    const verified = r.verification.every((v) => v.ok);
    const undecided = r.verification.filter((v) => v.removed && v.fails > 0 && v.fails < v.runs && v.ok);
    if (lab.mode === 'statistical' && undecided.length) r.warnings.push(`${undecided.length} leave-one-out check(s) were undecided by SPRT (mixed outcomes) and counted as not failing.`);

    // 4. truth table over the union of found sets
    const U = order([...new Set(sets.flat())]);
    if (U.length <= TABLE_MAX) {
      phase('truth table');
      const masks = Array.from({ length: 1 << U.length }, (_, m) => m);
      const rows = await Promise.all(
        masks.map(async (m): Promise<TruthRow> => {
          const on = U.filter((_, i) => m & (1 << i));
          const rec = await lab.test({ on }, 'table');
          return { on, decision: rec.decision, runs: rec.runs - rec.errors, fails: rec.fails };
        }),
      );
      r.truthTable = { factors: U, rows };
      const { structure, mins } = classify(U, rows);
      r.structure = structure;
      if (mins.length) r.minimalSets = mins.map(order);
    }

    // 5. variant probes, 6. delay thresholds
    phase('probing value variants');
    const setOf = (id: string) => r.minimalSets.find((s) => s.includes(id)) ?? U;
    r.variants = (
      await Promise.all(
        U.flatMap((id) =>
          variantsFor(byId.get(id)!).map(async ([cls, value]): Promise<VariantProbe> => {
            const rec = await lab.test({ on: setOf(id), overrides: { [id]: value } }, 'variant');
            return { factor: id, cls, value, decision: rec.decision };
          }),
        ),
      )
    ).flat();
    for (const id of U.filter((x) => byId.get(x)!.kind === 'delay')) {
      phase(`latency threshold for ${byId.get(id)!.label}`);
      r.delayCurves.push(await delayCurve(lab, byId.get(id)!, setOf(id)));
    }

    r.verdict = verified ? 'explained' : 'partial';
    r.reason = verified ? 'Minimal set found and verified by leave-one-out replays.' : 'Minimal set found but leave-one-out verification did not hold up; treat it as a lead, not a proof.';
    return finish();
  } catch (e) {
    if (!(e instanceof BudgetExhausted)) {
      await lab.settle();
      throw e;
    }
    r.verdict = 'partial';
    r.reason = `Budget exhausted after ${budget} experiments. Result is the best candidate so far, NOT verified.`;
    if (!r.minimalSets.length && lab.bestFail) r.minimalSets = [order(lab.bestFail)];
    r.mode = lab.mode;
    return finish();
  }
}

/** Minimal failing rows of the truth table and the interaction structure they imply. */
export function classify(U: string[], rows: TruthRow[]): { structure: Structure; mins: string[][] } {
  const fails = rows.filter((x) => x.decision === 'FAIL').map((x) => x.on);
  const sub = (a: string[], b: string[]) => a.every((x) => b.includes(x));
  const mins = fails.filter((f) => !fails.some((g) => g.length < f.length && sub(g, f))).sort((a, b) => a.length - b.length);
  const monotoneDnf = rows.every((x) => (x.decision === 'FAIL') === mins.some((m) => sub(m, x.on)));
  let structure: Structure = 'OTHER';
  if (monotoneDnf && mins.length === 1) structure = mins[0]!.length === 1 ? 'SINGLE' : mins[0]!.length === U.length ? 'AND' : 'OTHER';
  else if (monotoneDnf && mins.length > 1 && mins.every((m) => m.length === 1)) structure = 'OR';
  return { structure, mins };
}

export function variantsFor(f: Factor): [string, FactorValue][] {
  let cands: [string, FactorValue][] = [];
  if (f.kind === 'body' && f.path) {
    const wrong: FactorValue = typeof f.observed === 'string' ? 12345 : typeof f.observed === 'number' ? '0' : 'x';
    cands = [['missing key', ABSENT], ['null', null], ['empty string', ''], ['zero', 0], ['false', false], ['empty array', []], ['empty object', {}], ['wrong type', wrong]];
  } else if (f.kind === 'storage' || f.kind === 'cookie' || f.kind === 'header') {
    cands = [['absent', ABSENT], ['empty string', '']];
  } else if (f.kind === 'status') {
    cands = [['200', 200], ['404', 404], ['500', 500]];
  }
  return cands.filter(([, v]) => !deepEqual(v, f.observed) && !deepEqual(v, f.neutral));
}

async function delayCurve(lab: Lab, f: Factor, S: string[]): Promise<DelayCurve> {
  const at = (ms: number, opts: { runs?: number } = {}) => lab.test({ on: S, overrides: { [f.id]: ms } }, 'delay', opts);
  const neutralMs = f.neutral as number;
  const observedMs = f.observed as number;
  let [pass, fail] = [neutralMs, observedMs];
  for (let i = 0; i < 8 && Math.abs(fail - pass) > 20; i++) {
    const mid = Math.round((pass + fail) / 2);
    if ((await at(mid)).decision === 'FAIL') fail = mid;
    else pass = mid;
  }
  const top = Math.max(neutralMs, observedMs) * 1.5;
  const grid = await Promise.all(
    Array.from({ length: GRID_POINTS }, async (_, i) => {
      const ms = Math.round((top * i) / (GRID_POINTS - 1));
      const rec = await at(ms, { runs: GRID_RUNS });
      return { ms, runs: rec.runs - rec.errors, fails: rec.fails };
    }),
  );
  return { factor: f.id, neutralMs, observedMs, thresholdMs: Math.round((pass + fail) / 2), grid };
}
