// Experiment runner: config → browser runs → decision. Memoized, budgeted, bounded concurrency.
import type { Browser } from 'playwright';
import { applyConfig, configKey } from './compose.ts';
import type { Pair } from './factors.ts';
import type { FlowFn, OracleFn } from './oracle.ts';
import { makeReplayer } from './replay.ts';
import { runFlow } from './run.ts';
import { decideFixed, failureSignature } from './signature.ts';
import { SPRT, sprt } from './stats.ts';
import type { Configuration, Decision, ExperimentRecord, Factor, Phase, Session } from './types.ts';

export interface LabOptions {
  browser: Browser;
  baseURL: string;
  flow: FlowFn;
  oracle: OracleFn;
  bad: Session;
  good: Session;
  pairs: Pair[];
  factors: Factor[];
  concurrency: number;
  budget: number;
  timeoutMs: number;
  allowUnmatched: string[];
  apiGlobs: string[];
  freezeRandom: boolean;
  freezeTime: boolean;
  /** any failure counts (no signature matching) */
  looseOracle?: boolean;
  onRecord?: (r: ExperimentRecord) => void;
}

export class BudgetExhausted extends Error {
  constructor(limit: number) {
    super(`experiment budget of ${limit} exhausted`);
  }
}

interface RunResult {
  outcome: 'FAIL' | 'PASS' | 'ERROR' | 'DIFFERENT_FAILURE';
  /** normalized failure signature of a failing run */
  signature?: string;
  seqHash: string;
  reason?: string;
}

export interface TestOptions {
  /** run exactly this many times (deterministic mode) and never memoize */
  runs?: number;
  fresh?: boolean;
  /** statistical mode: runs already made for this config; the SPRT continues from them */
  prior?: { runs: number; fails: number };
}

export class Lab {
  mode: 'deterministic' | 'statistical' = 'deterministic';
  /** target failure signature; null = every failure counts (before it is known, or with looseOracle) */
  signature: string | null = null;
  /** first raw oracle reason seen per failure signature */
  readonly examples = new Map<string, string>();
  readonly records: ExperimentRecord[] = [];
  /** smallest search config that FAILed so far (best-so-far on budget exhaustion) */
  bestFail: string[] | null = null;
  private memo = new Map<string, Promise<ExperimentRecord>>();
  private started = 0;
  private pending = new Set<Promise<unknown>>();
  private active = 0;
  private queue: (() => void)[] = [];

  constructor(private o: LabOptions) {}

  resetMemo() {
    this.memo.clear();
  }

  /** record an already-established decision (the gate) so search does not re-run it */
  seed(cfg: Configuration, decision: Decision) {
    const { bits, key } = configKey(this.o.factors, cfg);
    this.memo.set(key, Promise.resolve({ n: -1, phase: 'gate', key, bits, runs: 0, fails: 0, errors: 0, decision, wallMs: 0, seqHashes: [] }));
  }

  /** wait for in-flight experiments (after a budget abort) */
  async settle() {
    while (this.pending.size) await Promise.allSettled([...this.pending]);
  }

  private async slot<T>(fn: () => Promise<T>): Promise<T> {
    while (this.active >= this.o.concurrency) await new Promise<void>((r) => this.queue.push(r));
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.queue.shift()?.();
    }
  }

  private runOnce(cfg: Configuration): Promise<RunResult> {
    return this.slot(async () => {
      const o = this.o;
      const applied = applyConfig(o.bad, o.good, o.pairs, o.factors, cfg);
      const r = makeReplayer(applied.plan, o.allowUnmatched);
      const out = await runFlow({
        browser: o.browser,
        baseURL: o.baseURL,
        env: applied.env,
        storage: applied.storage,
        flow: o.flow,
        oracle: o.oracle,
        apiGlobs: o.apiGlobs,
        onApi: r.onApi,
        timeoutMs: o.timeoutMs,
        freezeRandom: o.freezeRandom,
        freezeTime: o.freezeTime,
      });
      if (out.infraError) return { outcome: 'ERROR', seqHash: out.seqHash, reason: out.infraError };
      if (r.unmatched.length) return { outcome: 'ERROR', seqHash: out.seqHash, reason: `unmatched request ${r.unmatched[0]} (use --allow-unmatched)` };
      if (!out.failed) return { outcome: 'PASS', seqHash: out.seqHash };
      const signature = failureSignature(out.reason ?? '');
      if (!this.examples.has(signature)) this.examples.set(signature, out.reason ?? '');
      const matches = this.o.looseOracle || this.signature === null || signature === this.signature;
      return { outcome: matches ? 'FAIL' : 'DIFFERENT_FAILURE', seqHash: out.seqHash, signature, ...(out.reason ? { reason: out.reason } : {}) };
    });
  }

  test(cfg: Configuration, phase: Phase, opts: TestOptions = {}): Promise<ExperimentRecord> {
    const { bits, key } = configKey(this.o.factors, cfg);
    const memoize = !opts.runs && !opts.fresh;
    if (memoize) {
      const hit = this.memo.get(key);
      if (hit) return hit;
    }
    if (this.started >= this.o.budget) return Promise.reject(new BudgetExhausted(this.o.budget));
    const n = this.started++;
    const p = this.execute(n, cfg, phase, bits, key, opts);
    if (memoize) this.memo.set(key, p);
    this.pending.add(p);
    void p.finally(() => this.pending.delete(p)).catch(() => {});
    return p;
  }

  private async execute(n: number, cfg: Configuration, phase: Phase, bits: string, key: string, opts: TestOptions): Promise<ExperimentRecord> {
    const t0 = Date.now();
    const results: RunResult[] = [];
    const tally = () => {
      const errors = results.filter((r) => r.outcome === 'ERROR').length;
      const fails = results.filter((r) => r.outcome === 'FAIL').length;
      const different = results.filter((r) => r.outcome === 'DIFFERENT_FAILURE').length;
      return { errors, fails, different, valid: results.length - errors };
    };
    const prior = opts.prior ?? { runs: 0, fails: 0 };
    let decision: Decision;
    if (opts.runs) {
      results.push(...(await Promise.all(Array.from({ length: opts.runs }, () => this.runOnce(cfg)))));
      decision = decideFixed({ runs: results.length, ...tally() });
    } else if (this.mode === 'deterministic') {
      results.push(await this.runOnce(cfg));
      decision = results[0]!.outcome;
    } else {
      decision = 'UNRESOLVED';
      while (results.length < SPRT.maxRuns) {
        results.push(await this.runOnce(cfg));
        const { errors, fails, different, valid } = tally();
        if (errors >= 3) {
          decision = 'ERROR';
          break;
        }
        // different failures are censored runs: they do not enter the test
        const d = sprt(fails + prior.fails, valid - different + prior.runs);
        if (d !== 'CONTINUE') {
          decision = d;
          break;
        }
      }
      // mostly a different failure: say so rather than PASS/UNRESOLVED
      const t = tally();
      if (decision !== 'FAIL' && decision !== 'ERROR' && t.different * 2 > t.valid) decision = 'DIFFERENT_FAILURE';
    }
    const { errors, fails, different } = tally();
    const failureSignatures: Record<string, number> = {};
    for (const r of results) if (r.signature) failureSignatures[r.signature] = (failureSignatures[r.signature] ?? 0) + 1;
    const reason = results.find((r) => r.outcome !== 'PASS' && r.reason)?.reason;
    const rec: ExperimentRecord = {
      n,
      phase,
      key,
      bits,
      ...(cfg.overrides && Object.keys(cfg.overrides).length ? { overrides: cfg.overrides } : {}),
      runs: results.length,
      fails,
      errors,
      ...(different ? { different } : {}),
      ...(Object.keys(failureSignatures).length ? { failureSignatures } : {}),
      decision,
      wallMs: Date.now() - t0,
      seqHashes: [...new Set(results.map((r) => r.seqHash))],
      ...(reason ? { reason } : {}),
    };
    this.records.push(rec);
    if (decision === 'FAIL' && phase === 'search' && !cfg.overrides && (!this.bestFail || cfg.on.length < this.bestFail.length)) this.bestFail = [...cfg.on];
    this.o.onRecord?.(rec);
    return rec;
  }
}
