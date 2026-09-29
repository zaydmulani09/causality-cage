// Single-session mode (experimental): build a "passing" session from the failing one. Pure.
// delay → min latency seen for that endpoint; body leaf → most common non-null value at that path in other
// exchanges of the same endpoint, else a type default ("" / 0 / false; null → ""); storage and cookies → absent;
// env → Chromium defaults. Arrays and objects keep their shape; only scalar leaves are replaced.
import { parseJson } from './factors.ts';
import { DEFAULT_ENV, EMPTY_STORAGE } from './run.ts';
import type { Json, Session } from './types.ts';

function at(v: Json | undefined, path: (string | number)[]): Json | undefined {
  let cur: Json | undefined = v;
  for (const p of path) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string | number, Json>)[p];
  }
  return cur;
}

function mode(values: Json[]): Json | undefined {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(JSON.stringify(v), (counts.get(JSON.stringify(v)) ?? 0) + 1);
  let best: string | undefined;
  for (const [k, n] of counts) if (best === undefined || n > counts.get(best)!) best = k;
  return best === undefined ? undefined : (JSON.parse(best) as Json);
}

const typeDefault = (v: Json): Json => (typeof v === 'number' ? 0 : typeof v === 'boolean' ? false : '');

export function synthesizeGood(bad: Session): Session {
  const exchanges = bad.exchanges.map((e) => {
    const same = bad.exchanges.filter((o) => o.key === e.key);
    const others = same.filter((o) => o !== e).map(parseJson).filter((x) => x !== undefined);
    const latencyMs = Math.min(...same.map((o) => o.latencyMs));
    const body = parseJson(e);
    if (body === undefined) return { ...e, latencyMs };
    const neutral = (v: Json, path: (string | number)[]): Json => {
      if (Array.isArray(v)) return v.map((x, i) => neutral(x, [...path, i]));
      if (v !== null && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, neutral(x, [...path, k])]));
      const sample = mode(others.map((o) => at(o, path)).filter((x): x is Json => x !== undefined && x !== null && typeof x !== 'object'));
      return sample ?? typeDefault(v);
    };
    return { ...e, latencyMs, body: JSON.stringify(neutral(body, [])) };
  });
  return {
    ...bad,
    label: 'good (synthesized)',
    synthesized: true,
    env: { ...DEFAULT_ENV },
    storageStart: EMPTY_STORAGE,
    storageEnd: EMPTY_STORAGE,
    exchanges,
    consoleErrors: [],
    pageErrors: [],
    oracle: null,
  };
}
