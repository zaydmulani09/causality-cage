import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Browser } from 'playwright';
import { buildOracle, explain, loadFlow, recordSession, type Explained, type InitialState, type OracleSpec, type Result, type Session } from '@causality-cage/core';
import { REPO, startShop } from './shop.ts';

export { REPO, startShop } from './shop.ts';

export interface Case {
  id: string;
  bug?: string;
  tests: string;
  defect: string;
  oracle: OracleSpec;
  states?: { bad?: InitialState; good?: InitialState };
  /** the recorded bad session must fail with a reason matching this (default: any failure) */
  badReason?: string;
  /** run explain with --loose-oracle (the case defines the failure as any crash) */
  looseOracle?: boolean;
  expect: { verdict: Result['verdict']; sets?: string[][]; thresholdMs?: [number, number]; noFailure?: boolean; maxExperiments?: number };
}

export const FLOW = join(REPO, 'examples/flows/checkout.ts');

export function loadCases(): Case[] {
  const cases = JSON.parse(readFileSync(new URL('../ground-truth.json', import.meta.url), 'utf8')) as Case[];
  for (const c of cases) if (c.oracle.file) c.oracle = { ...c.oracle, file: join(REPO, c.oracle.file) };
  return cases;
}

export interface Recorded {
  bad: Session;
  good: Session;
}

const RECORD_TRIES = 5;

/**
 * Record the case's bad and good sessions from fresh shop servers, re-recording (like a developer would)
 * until the bad session shows the failure under study and the good one passes. B0 has no failure: one try.
 */
export async function recordCase(c: Case, browser: Browser): Promise<Recorded> {
  const flow = await loadFlow(FLOW);
  const oracle = await buildOracle(c.oracle);
  const bug = c.bug ?? c.id;
  const wanted = (scenario: 'bad' | 'good', s: Session) =>
    scenario === 'good' ? !s.oracle?.failed : !!s.oracle?.failed && (!c.badReason || new RegExp(c.badReason).test(s.oracle.reason ?? ''));
  const rec = async (scenario: 'bad' | 'good') => {
    const shop = await startShop(bug, scenario);
    try {
      let s: Session | undefined;
      for (let i = 0; i < RECORD_TRIES; i++) {
        s = await recordSession({ browser, baseURL: shop.url, flow, oracle, label: scenario, ...(c.states?.[scenario] ? { state: c.states[scenario] } : {}) });
        if (wanted(scenario, s) || c.expect.noFailure) break;
      }
      return s!;
    } finally {
      await shop.stop();
    }
  };
  return { bad: await rec('bad'), good: await rec('good') };
}

export interface CaseRun {
  c: Case;
  out: Explained;
  recorded: Recorded;
  match: boolean;
  got: string;
  expected: string;
}

export interface BenchOptions {
  concurrency?: number;
  budget?: number;
  synthesize?: (bad: Session) => Session;
  onPhase?: (msg: string) => void;
}

/** Record, then explain against a live shop in the bad scenario (the server state at the time of the bug). */
export async function runCase(c: Case, browser: Browser, o: BenchOptions = {}): Promise<CaseRun> {
  const recorded = await recordCase(c, browser);
  const shop = await startShop(c.bug ?? c.id, 'bad');
  try {
    const out = await explain({
      browser,
      baseURL: shop.url,
      flow: await loadFlow(FLOW),
      oracle: await buildOracle(c.oracle),
      bad: recorded.bad,
      good: o.synthesize ? o.synthesize(recorded.bad) : recorded.good,
      singleSession: !!o.synthesize,
      looseOracle: !!c.looseOracle,
      concurrency: o.concurrency ?? 4,
      budget: o.budget ?? 500,
      ...(o.onPhase ? { onPhase: o.onPhase } : {}),
    });
    return { c, out, recorded, ...score(c, out) };
  } finally {
    await shop.stop();
  }
}

const norm = (sets: string[][]) => sets.map((s) => [...s].sort()).sort((a, b) => a.join().localeCompare(b.join()));
const fmtSets = (sets: string[][]) => sets.map((s) => `{${s.join(' + ')}}`).join(' OR ');

export function score(c: Case, out: Explained): { match: boolean; got: string; expected: string } {
  const r = out.result;
  const label = new Map(out.factors.map((f) => [f.id, f.label]));
  const got = norm(r.minimalSets.map((s) => s.map((id) => label.get(id) ?? id)));
  let match = r.verdict === c.expect.verdict;
  if (c.expect.sets) match &&= JSON.stringify(got) === JSON.stringify(norm(c.expect.sets));
  const thresholds = r.delayCurves.map((d) => d.thresholdMs ?? NaN);
  if (c.expect.thresholdMs) {
    const [lo, hi] = c.expect.thresholdMs;
    match &&= thresholds.length > 0 && thresholds.every((t) => t >= lo && t <= hi);
  }
  if (c.expect.noFailure) match &&= r.gate.allTrue.fails === 0;
  if (c.expect.maxExperiments) match &&= r.budget.used <= c.expect.maxExperiments;
  const th = thresholds.length ? ` @ ${thresholds.map((t) => `${t} ms`).join(', ')}` : '';
  const expTh = c.expect.thresholdMs ? ` @ ${c.expect.thresholdMs[0]}-${c.expect.thresholdMs[1]} ms` : '';
  const gotText = got.length && r.verdict !== 'unexplained' && r.verdict !== 'untrustworthy-oracle' ? `${fmtSets(got)}${th}` : r.verdict === 'untrustworthy-oracle' && r.gate.allTrue.fails === 0 ? 'no failure' : r.verdict;
  const expText = c.expect.sets ? `${fmtSets(norm(c.expect.sets))}${expTh}` : c.expect.noFailure ? 'no failure' : c.expect.verdict;
  return { match, got: gotText, expected: expText };
}

/** Gate replays (all-observed and all-neutral, 5 runs each): same outcome and same request sequence every run. */
export function replayConsistent(x: CaseRun): boolean {
  const gate = x.out.experiments.filter((e) => e.phase === 'gate').slice(0, 2);
  return gate.every((e) => (e.fails === 0 || e.fails === e.runs) && e.errors === 0 && e.seqHashes.length === 1);
}

export function medianExperimentMs(runs: CaseRun[]): number {
  const t = runs.flatMap((x) => x.out.experiments.map((e) => e.wallMs / e.runs)).sort((a, b) => a - b);
  return t.length ? t[Math.floor(t.length / 2)]! : 0;
}

export function table(runs: CaseRun[]): string {
  const rows = runs.map((x) => [x.c.id, x.c.tests, x.expected, x.got, x.match ? 'yes' : 'NO', String(x.out.result.budget.used), `${(x.out.result.wallMs / 1000).toFixed(1)} s`, replayConsistent(x) ? 'yes' : 'no']);
  const head = ['Bug', 'Tests', 'Expected', 'Got', 'Match', 'Experiments', 'Wall time', 'Replay consistent'];
  const esc = (s: string) => s.replace(/\|/g, '\\|');
  return [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.map(esc).join(' | ')} |`)].join('\n');
}
export { selfcheck, SELFCHECK_CASES, type SelfcheckRun } from './selfcheck.ts';
