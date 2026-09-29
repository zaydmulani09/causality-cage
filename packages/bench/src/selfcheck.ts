// Self-validation: take a real passing session, inject synthetic faults (mutated response leaves) with a known
// hidden cause, let a synthetic oracle fail exactly when that cause is served, and check cage finds it.
import type { Browser } from 'playwright';
import { explain, loadFlow, recordSession, type Exchange, type Json, type OracleFn, type RecordedRequest, type Session } from '@causality-cage/core';
import { FLOW } from './index.ts';
import { startShop } from './shop.ts';

interface Leaf {
  ex: number;
  path: (string | number)[];
  label: string;
  value: Json;
}

function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function leaves(v: Json, path: (string | number)[] = [], out: { path: (string | number)[]; value: Json }[] = []) {
  if (Array.isArray(v)) v.forEach((x, i) => leaves(x, [...path, i], out));
  else if (v !== null && typeof v === 'object') for (const [k, x] of Object.entries(v)) leaves(x, [...path, k], out);
  else out.push({ path, value: v });
  return out;
}

const mutate = (v: Json): Json => (typeof v === 'string' ? `${v}-mut` : typeof v === 'number' ? v + 7 : typeof v === 'boolean' ? !v : 'was-null');
const label = (e: Exchange, p: (string | number)[]) => `body ${e.key}${e.nth ? `#${e.nth}` : ''} ${p.map((s, i) => (typeof s === 'number' ? `[${s}]` : i ? `.${s}` : s)).join('')}`;

function setAt(root: Json, path: (string | number)[], v: Json) {
  let n = root as Record<string | number, Json>;
  for (const p of path.slice(0, -1)) n = n[p] as Record<string | number, Json>;
  n[path[path.length - 1]!] = v;
}

function getAt(root: Json, path: (string | number)[]): Json | undefined {
  let n: Json | undefined = root;
  for (const p of path) n = n !== null && typeof n === 'object' ? (n as Record<string | number, Json>)[p] : undefined;
  return n;
}

/** fails iff some hidden set has all its mutated values served */
function oracleFor(sets: Leaf[][], good: Session): OracleFn {
  return async ({ requests }) => {
    const served = (l: Leaf) => {
      const e = good.exchanges[l.ex]!;
      const hits = requests.filter((r: RecordedRequest) => r.key === e.key);
      const r = hits[e.nth];
      if (!r) return false;
      try {
        return JSON.stringify(getAt(JSON.parse(r.body) as Json, l.path)) === JSON.stringify(l.value);
      } catch {
        return false;
      }
    };
    const hit = sets.find((s) => s.every(served));
    return hit ? { failed: true, reason: `synthetic fault: ${hit.map((l) => l.label).join(' + ')}` } : { failed: false };
  };
}

export interface SelfcheckCase {
  name: string;
  mutations: number;
  shape: number[];
}

export const SELFCHECK_CASES: SelfcheckCase[] = [
  { name: 'single leaf among 30 mutations', mutations: 30, shape: [1] },
  { name: 'AND of 2 leaves among 30', mutations: 30, shape: [2] },
  { name: 'OR of 2 single leaves among 30', mutations: 30, shape: [1, 1] },
  { name: 'AND of 3 leaves among 60', mutations: 60, shape: [3] },
];

export interface SelfcheckRun {
  name: string;
  expected: string[][];
  got: string[][];
  match: boolean;
  experiments: number;
  verdict: string;
  reason: string;
}

export async function selfcheck(browser: Browser, seed = 7): Promise<SelfcheckRun[]> {
  const r = rng(seed);
  const flow = await loadFlow(FLOW);
  const shop = await startShop('none', 'good');
  try {
    const good = await recordSession({ browser, baseURL: shop.url, flow, oracle: null, label: 'good' });
    const all: Leaf[] = good.exchanges.flatMap((e, ex) => {
      try {
        return leaves(JSON.parse(e.body) as Json).map((l) => ({ ex, path: l.path, label: label(e, l.path), value: mutate(l.value) }));
      } catch {
        return [];
      }
    });
    const runs: SelfcheckRun[] = [];
    for (const c of SELFCHECK_CASES) {
      const pool = [...all].sort(() => r() - 0.5).slice(0, c.mutations);
      const bad: Session = JSON.parse(JSON.stringify(good)) as Session;
      bad.label = 'bad (synthetic)';
      for (const l of pool) {
        const e = bad.exchanges[l.ex]!;
        const body = JSON.parse(e.body) as Json;
        setAt(body, l.path, l.value);
        e.body = JSON.stringify(body);
      }
      let i = 0;
      const sets = c.shape.map((n) => pool.slice(i, (i += n)));
      const out = await explain({ browser, baseURL: shop.url, flow, oracle: oracleFor(sets, good), bad, good });
      const name = new Map(out.factors.map((f) => [f.id, f.label]));
      const norm = (xs: string[][]) => xs.map((s) => [...s].sort()).sort((a, b) => a.join().localeCompare(b.join()));
      const expected = norm(sets.map((s) => s.map((l) => l.label)));
      const got = norm(out.result.minimalSets.map((s) => s.map((id) => name.get(id)!)));
      runs.push({ name: c.name, expected, got, match: out.result.verdict === 'explained' && JSON.stringify(expected) === JSON.stringify(got), experiments: out.result.budget.used, verdict: out.result.verdict, reason: out.result.reason });
    }
    return runs;
  } finally {
    await shop.stop();
  }
}
