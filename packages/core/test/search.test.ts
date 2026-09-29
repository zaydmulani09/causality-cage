import { describe, expect, it } from 'vitest';
import { ddmin, hdd, pruneTree, split, type Outcome } from '../src/search.ts';
import type { FactorNode } from '../src/types.ts';

// Deterministic PRNG so property runs are reproducible.
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Pred = (s: Set<number>) => boolean;

/** Monotone DNF: fails iff some hidden set is fully present. */
function monotone(r: () => number, n: number): { pred: Pred; sets: number[][] } {
  const sets = Array.from({ length: 1 + Math.floor(r() * 3) }, () => {
    const size = 1 + Math.floor(r() * 3);
    return [...new Set(Array.from({ length: size }, () => Math.floor(r() * n)))];
  });
  return { sets, pred: (s) => sets.some((h) => h.every((x) => s.has(x))) };
}

/** Non-monotone: monotone core, but a random "healer" element suppresses failure (except in the full set). */
function nonMonotone(r: () => number, n: number): Pred {
  const { pred } = monotone(r, n);
  const healer = Math.floor(r() * n);
  return (s) => pred(s) && (!s.has(healer) || s.size === n);
}

async function check(items: number[], pred: Pred, width: number, memo: boolean) {
  const cache = new Map<string, Outcome>();
  let calls = 0;
  const test = async (sub: number[]): Promise<Outcome> => {
    const k = [...sub].sort((a, b) => a - b).join(',');
    if (memo && cache.has(k)) return cache.get(k)!;
    calls++;
    const o: Outcome = pred(new Set(sub)) ? 'FAIL' : 'PASS';
    cache.set(k, o);
    return o;
  };
  const out = await ddmin(items, test, width);
  return { out, calls };
}

describe('split', () => {
  it('covers the input in order', () => {
    expect(split([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4, 5]]);
    expect(split([1, 2, 3], 3)).toEqual([[1], [2], [3]]);
  });
});

describe('ddmin properties', () => {
  for (const kind of ['monotone', 'non-monotone'] as const) {
    it(`${kind}: output fails, is 1-minimal, independent of memo and width`, async () => {
      const r = rng(kind === 'monotone' ? 1 : 2);
      for (let trial = 0; trial < 300; trial++) {
        const n = 2 + Math.floor(r() * 30);
        const items = Array.from({ length: n }, (_, i) => i);
        const pred = kind === 'monotone' ? monotone(r, n).pred : nonMonotone(r, n);
        if (!pred(new Set(items)) || pred(new Set())) continue;
        const base = await check(items, pred, 1, false);
        expect(pred(new Set(base.out))).toBe(true);
        for (const x of base.out) expect(pred(new Set(base.out.filter((y) => y !== x)))).toBe(false);
        for (const w of [1, 2, 4]) {
          const m = await check(items, pred, w, true);
          expect(m.out).toEqual(base.out);
          if (w === 1) expect(m.calls).toBeLessThanOrEqual(base.calls);
        }
      }
    });
  }

  it('finds a single hidden element among many', async () => {
    const { out } = await check(Array.from({ length: 64 }, (_, i) => i), (s) => s.has(37), 1, true);
    expect(out).toEqual([37]);
  });
});

describe('hdd', () => {
  const tree: FactorNode = {
    id: 'root',
    label: 'root',
    children: [
      { id: 'g1', label: 'g1', children: Array.from({ length: 10 }, (_, i) => ({ id: `a${i}`, label: '', factor: `a${i}` })) },
      { id: 'g2', label: 'g2', children: [{ id: 'g2s', label: 's', children: Array.from({ length: 20 }, (_, i) => ({ id: `b${i}`, label: '', factor: `b${i}` })) }, { id: 'c', label: '', factor: 'c' }] },
      { id: 'd', label: '', factor: 'd' },
    ],
  };

  it('finds an AND across groups with few tests', async () => {
    let calls = 0;
    const seen = new Set<string>();
    const out = await hdd(tree, async (ids) => {
      const k = [...ids].sort().join();
      if (!seen.has(k)) calls++;
      seen.add(k);
      return ids.includes('a3') && ids.includes('b17') ? 'FAIL' : 'PASS';
    });
    expect(out.sort()).toEqual(['a3', 'b17']);
    expect(calls).toBeLessThanOrEqual(48); // regression guard: measured 48
  });

  it('prunes to remaining leaves', () => {
    const p = pruneTree(tree, new Set(['b1', 'd']))!;
    expect(p.children!.map((c) => c.id)).toEqual(['b1', 'd']);
  });
});
