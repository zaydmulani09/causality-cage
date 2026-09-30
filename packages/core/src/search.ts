// Delta debugging (Zeller & Hildebrandt 2002, ddmin) and hierarchical DD (Misherghi & Su 2006). Pure: I/O lives in `test`.
import type { Decision, FactorNode } from './types.ts';

export type Outcome = Decision;
export type TestFn<T> = (subset: T[]) => Promise<Outcome>;

/** n near-equal contiguous chunks. */
export function split<T>(c: T[], n: number): T[][] {
  const out: T[][] = [];
  let start = 0;
  for (let i = 0; i < n; i++) {
    const end = start + Math.floor((c.length - start) / (n - i));
    out.push(c.slice(start, end));
    start = end;
  }
  return out;
}

/**
 * Tests candidates in order, `width` at a time, and returns the first that FAILs.
 * Decisions depend only on candidate order, never on completion order, so the result
 * is identical for any width (a wider window may spend extra experiments).
 */
async function firstFail<T>(cands: T[][], test: TestFn<T>, width: number): Promise<T[] | null> {
  for (let i = 0; i < cands.length; i += width) {
    const chunk = cands.slice(i, i + width);
    const res = await Promise.all(chunk.map((c) => test(c)));
    const j = res.indexOf('FAIL');
    if (j >= 0) return chunk[j]!;
  }
  return null;
}

/**
 * ddmin with complement testing. Precondition: test(items) FAILs and test([]) does not.
 * Returns a 1-minimal failing subset: removing any single element no longer FAILs.
 * Anything that is not FAIL (PASS, ERROR, UNRESOLVED, DIFFERENT_FAILURE) counts as "does not fail".
 */
export async function ddmin<T>(items: T[], test: TestFn<T>, width = 1): Promise<T[]> {
  let c = items;
  let n = 2;
  while (c.length >= 2) {
    n = Math.min(n, c.length);
    const subsets = split(c, n);
    let next = await firstFail(subsets, test, width);
    if (next) {
      c = next;
      n = 2;
      continue;
    }
    if (n > 2) {
      const comps = subsets.map((s) => c.filter((x) => !s.includes(x)));
      next = await firstFail(comps, test, width);
      if (next) {
        c = next;
        n = Math.max(n - 1, 2);
        continue;
      }
    }
    if (n >= c.length) break;
    n = Math.min(c.length, 2 * n);
  }
  return c;
}

export function leafIds(n: FactorNode): string[] {
  return n.factor ? [n.factor] : (n.children ?? []).flatMap(leafIds);
}

/** HDD: ddmin over the top level, expand only what was kept, repeat down to leaves. Returns factor ids. */
export async function hdd(root: FactorNode, test: TestFn<string>, width = 1): Promise<string[]> {
  let frontier = root.children ?? [root];
  for (;;) {
    const kept = await ddmin(frontier, (nodes) => test(nodes.flatMap(leafIds)), width);
    if (kept.every((n) => !n.children)) return kept.flatMap(leafIds);
    frontier = kept.flatMap((n) => n.children ?? [n]);
  }
}

/** Copy of the tree restricted to `keep` leaves; empty branches dropped, single-child chains collapsed. */
export function pruneTree(n: FactorNode, keep: Set<string>): FactorNode | null {
  if (n.factor) return keep.has(n.factor) ? n : null;
  const children = (n.children ?? []).map((c) => pruneTree(c, keep)).filter((c): c is FactorNode => !!c);
  if (!children.length) return null;
  if (children.length === 1 && n.id !== 'root') return children[0]!;
  return { ...n, children };
}
