// Factor extraction: align two sessions, diff everything that can differ, build the HDD tree. Pure.
import { ABSENT, type Exchange, type Factor, type FactorNode, type FactorValue, type Json, type Session } from './types.ts';
import { target as targetOf } from './replay.ts';

export interface Pair {
  target: string;
  key: string;
  nth: number;
  bad?: Exchange;
  good?: Exchange;
}

export interface ExtractOptions {
  maxFactors?: number;
  delayMinMs?: number;
  delayRatio?: number;
  /** arrival-order flips closer than this (in either session) are treated as noise */
  orderMinGapMs?: number;
}

export const HEADER_ALLOW = ['content-type', 'cache-control', 'content-language', 'etag', 'expires', 'last-modified', 'vary'];
const HEADER_DENY = /^x-(request-id|response-time|powered-by|trace|amzn|cache|served-by|runtime)/i;
export const headerAllowed = (h: string) => HEADER_ALLOW.includes(h) || (h.startsWith('x-') && !HEADER_DENY.test(h));

export const isAbsent = (v: unknown): v is typeof ABSENT => typeof v === 'object' && v !== null && (v as { $absent?: boolean }).$absent === true;

export function align(bad: Session, good: Session): Pair[] {
  const pairs = new Map<string, Pair>();
  for (const e of bad.exchanges) pairs.set(targetOf(e.key, e.nth), { target: targetOf(e.key, e.nth), key: e.key, nth: e.nth, bad: e });
  for (const e of good.exchanges) {
    const t = targetOf(e.key, e.nth);
    const p = pairs.get(t);
    if (p) p.good = e;
    else pairs.set(t, { target: t, key: e.key, nth: e.nth, good: e });
  }
  return [...pairs.values()];
}

export function parseJson(e: Exchange): Json | undefined {
  if (e.bodyEncoding !== 'utf8') return undefined;
  try {
    return JSON.parse(e.body) as Json;
  } catch {
    return undefined;
  }
}

const isObj = (v: unknown): v is Record<string, Json> => typeof v === 'object' && v !== null && !Array.isArray(v) && !isAbsent(v);

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  if (isObj(a) && isObj(b)) {
    const ka = Object.keys(a);
    return ka.length === Object.keys(b).length && ka.every((k) => k in b && deepEqual(a[k], b[k]));
  }
  return isAbsent(a) && isAbsent(b);
}

export interface Leaf {
  path: (string | number)[];
  observed: FactorValue;
  neutral: FactorValue;
}

/** Leaf-by-leaf diff. Missing key (ABSENT) and null are distinct. Arrays of different length are one leaf. */
export function diffJson(observed: FactorValue, neutral: FactorValue, maxDepth = Infinity, path: (string | number)[] = [], out: Leaf[] = []): Leaf[] {
  if (deepEqual(observed, neutral)) return out;
  if (path.length < maxDepth && isObj(observed) && isObj(neutral)) {
    const keys = [...new Set([...Object.keys(neutral), ...Object.keys(observed)])].sort();
    const [o, n] = [observed as Record<string, Json>, neutral as Record<string, Json>];
    for (const k of keys) diffJson(k in o ? o[k]! : ABSENT, k in n ? n[k]! : ABSENT, maxDepth, [...path, k], out);
    return out;
  }
  if (path.length < maxDepth && Array.isArray(observed) && Array.isArray(neutral) && observed.length === neutral.length) {
    observed.forEach((v, i) => diffJson(v, neutral[i]!, maxDepth, [...path, i], out));
    return out;
  }
  out.push({ path, observed, neutral });
  return out;
}

export const pathString = (p: (string | number)[]) =>
  p.length ? p.map((s, i) => (typeof s === 'number' ? `[${s}]` : i ? `.${s}` : s)).join('') : '(body)';

export const shortTarget = (t: string) => (t.endsWith('#0') ? t.slice(0, -2) : t);

type Draft = Omit<Factor, 'id'> & { group: string; sub: string[] };

function draftFactors(bad: Session, good: Session, pairs: Pair[], o: Required<ExtractOptions>, maxDepth: number): Draft[] {
  const d: Draft[] = [];
  for (const p of pairs) {
    const t = shortTarget(p.target);
    const sub = p.nth > 0 ? [p.target] : [];
    // Only-in-good exchanges are not factors: the failing run never got that far (a consequence, not a condition).
    // They are served as recorded if the app asks for them.
    if (!p.bad || !p.good) {
      if (p.bad) d.push({ kind: 'presence', label: `presence ${t}`, target: p.target, observed: !!p.bad, neutral: !!p.good, group: p.key, sub });
      continue;
    }
    const { bad: b, good: g } = p;
    if (b.status !== g.status) d.push({ kind: 'status', label: `status ${t}`, target: p.target, observed: b.status, neutral: g.status, group: p.key, sub });
    const hs = [...new Set([...Object.keys(b.headers), ...Object.keys(g.headers)])].filter(headerAllowed).sort();
    for (const h of hs) {
      if (b.headers[h] === g.headers[h]) continue;
      d.push({ kind: 'header', label: `header ${t} ${h}`, target: p.target, path: [h], observed: b.headers[h] ?? ABSENT, neutral: g.headers[h] ?? ABSENT, group: p.key, sub });
    }
    const bj = parseJson(b);
    const gj = parseJson(g);
    if (bj !== undefined && gj !== undefined) {
      for (const leaf of diffJson(bj, gj, maxDepth)) {
        d.push({ kind: 'body', label: `body ${t} ${pathString(leaf.path)}`, target: p.target, path: leaf.path, observed: leaf.observed, neutral: leaf.neutral, group: p.key, sub: [...sub, ...leaf.path.slice(0, -1).map(String)] });
      }
    } else if (b.body !== g.body || b.bodyEncoding !== g.bodyEncoding) {
      d.push({ kind: 'body', label: `body ${t} (raw)`, target: p.target, observed: b.body, neutral: g.body, group: p.key, sub });
    }
    const [hi, lo] = [Math.max(b.latencyMs, g.latencyMs), Math.min(b.latencyMs, g.latencyMs)];
    if (hi - lo > o.delayMinMs && hi > lo * o.delayRatio) {
      d.push({ kind: 'delay', label: `delay ${t}`, target: p.target, observed: b.latencyMs, neutral: g.latencyMs, group: 'timing', sub: [] });
    }
  }
  // order: concurrent in both sessions, arrival order flipped, gap above noise in both
  const both = pairs.filter((p) => p.bad && p.good);
  const overlap = (x: Exchange, y: Exchange) => x.startMs < y.endMs && y.startMs < x.endMs;
  for (let i = 0; i < both.length; i++) {
    for (let j = i + 1; j < both.length; j++) {
      const [P, Q] = [both[i]!, both[j]!];
      if (!overlap(P.bad!, Q.bad!) || !overlap(P.good!, Q.good!)) continue;
      const gb = Q.bad!.endMs - P.bad!.endMs;
      const gg = Q.good!.endMs - P.good!.endMs;
      if (Math.sign(gb) === Math.sign(gg) || Math.abs(gb) < o.orderMinGapMs || Math.abs(gg) < o.orderMinGapMs) continue;
      const [first, second] = gb > 0 ? [P.target, Q.target] : [Q.target, P.target];
      d.push({ kind: 'order', label: `order ${shortTarget(first)} before ${shortTarget(second)}`, target: first, target2: second, observed: [first, second], neutral: [second, first], group: 'timing', sub: [] });
    }
  }
  for (const area of ['localStorage', 'sessionStorage'] as const) {
    const [bs, gs] = [bad.storageStart[area], good.storageStart[area]];
    for (const k of [...new Set([...Object.keys(bs), ...Object.keys(gs)])].sort()) {
      if (bs[k] === gs[k]) continue;
      d.push({ kind: 'storage', label: `storage ${area} ${k}`, area, path: [k], observed: bs[k] ?? ABSENT, neutral: gs[k] ?? ABSENT, group: 'storage', sub: [] });
    }
  }
  const bc = new Map(bad.storageStart.cookies.map((c) => [c.name, c.value]));
  const gc = new Map(good.storageStart.cookies.map((c) => [c.name, c.value]));
  for (const k of [...new Set([...bc.keys(), ...gc.keys()])].sort()) {
    if (bc.get(k) === gc.get(k)) continue;
    d.push({ kind: 'cookie', label: `cookie ${k}`, path: [k], observed: bc.get(k) ?? ABSENT, neutral: gc.get(k) ?? ABSENT, group: 'cookies', sub: [] });
  }
  for (const k of ['viewport', 'locale', 'timezoneId', 'userAgent'] as const) {
    if (deepEqual(bad.env[k], good.env[k])) continue;
    d.push({ kind: 'env', label: `env ${k}`, path: [k], observed: bad.env[k] as Json, neutral: good.env[k] as Json, group: 'env', sub: [] });
  }
  return d;
}

export interface Extracted {
  pairs: Pair[];
  factors: Factor[];
  tree: FactorNode;
  warnings: string[];
}

export function extractFactors(bad: Session, good: Session, opts: ExtractOptions = {}): Extracted {
  const o: Required<ExtractOptions> = { maxFactors: 2000, delayMinMs: 150, delayRatio: 1.5, orderMinGapMs: 25, ...opts };
  const pairs = align(bad, good);
  const warnings: string[] = [];
  let drafts = draftFactors(bad, good, pairs, o, Infinity);
  for (const depth of [8, 5, 3, 2, 1, 0]) {
    if (drafts.length <= o.maxFactors) break;
    warnings.push(`${drafts.length} factors exceed --max-factors ${o.maxFactors}; diffing JSON bodies only to depth ${depth}`);
    drafts = draftFactors(bad, good, pairs, o, depth);
  }
  const factors: Factor[] = drafts.map(({ group: _g, sub: _s, ...f }, i) => ({ id: `f${i}`, ...f }));
  return { pairs, factors, tree: buildTree(drafts), warnings };
}

/** root → group → sub-path levels → leaf; single-child chains collapsed. */
function buildTree(drafts: Draft[]): FactorNode {
  const root: FactorNode = { id: 'root', label: 'all factors', children: [] };
  const find = (parent: FactorNode, label: string) => {
    let n = parent.children!.find((c) => c.label === label && c.children);
    if (!n) {
      n = { id: `${parent.id}/${parent.children!.length}`, label, children: [] };
      parent.children!.push(n);
    }
    return n;
  };
  drafts.forEach((f, i) => {
    let node = find(root, f.group);
    for (const s of f.sub) node = find(node, s);
    node.children!.push({ id: `f${i}`, label: f.label, factor: `f${i}` });
  });
  const collapse = (n: FactorNode): FactorNode => {
    if (!n.children) return n;
    n.children = n.children.map(collapse);
    return n.children.length === 1 && n.id !== 'root' ? n.children[0]! : n;
  };
  return collapse(root);
}

export function leavesOf(n: FactorNode): string[] {
  return n.factor ? [n.factor] : (n.children ?? []).flatMap(leavesOf);
}
