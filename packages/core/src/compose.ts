// Configuration → what the browser gets: served responses, order gates, env, storage. Pure.
import { isAbsent, parseJson, type Pair } from './factors.ts';
import type { Plan, Served } from './replay.ts';
import type { Configuration, EnvState, Factor, FactorValue, Json, Session, StorageSnapshot } from './types.ts';

export interface Applied {
  plan: Plan;
  env: EnvState;
  storage: StorageSnapshot;
}

export const configKey = (factors: Factor[], cfg: Configuration) => {
  const on = new Set(cfg.on);
  const bits = factors.map((f) => (on.has(f.id) ? '1' : '0')).join('');
  const ov = cfg.overrides && Object.keys(cfg.overrides).length ? JSON.stringify(Object.entries(cfg.overrides).sort()) : '';
  return { bits, key: ov ? `${bits}|${ov}` : bits };
};

function setPath(root: Json, path: (string | number)[], v: FactorValue): Json {
  if (!path.length) return isAbsent(v) ? null : v;
  let node = root as Record<string | number, Json>;
  for (const seg of path.slice(0, -1)) {
    if (typeof node[seg] !== 'object' || node[seg] === null) node[seg] = typeof seg === 'number' ? [] : {};
    node = node[seg] as Record<string | number, Json>;
  }
  const last = path[path.length - 1]!;
  if (isAbsent(v)) {
    if (Array.isArray(node) && typeof last === 'number') node.splice(last, 1);
    else delete node[last];
  } else node[last] = v;
  return root;
}

export function applyConfig(bad: Session, good: Session, pairs: Pair[], factors: Factor[], cfg: Configuration): Applied {
  const on = new Set(cfg.on);
  const val = (f: Factor): FactorValue => (cfg.overrides && f.id in cfg.overrides ? cfg.overrides[f.id]! : on.has(f.id) ? f.observed : f.neutral);
  const byTarget = new Map<string, Factor[]>();
  for (const f of factors) if (f.target && f.kind !== 'order') byTarget.set(f.target, [...(byTarget.get(f.target) ?? []), f]);

  const responses = new Map<string, Served>();
  for (const p of pairs) {
    const fs = byTarget.get(p.target) ?? [];
    const presence = fs.find((f) => f.kind === 'presence');
    if (presence) {
      const e = (p.bad ?? p.good)!;
      responses.set(p.target, val(presence) === true ? { status: e.status, headers: e.headers, body: e.body, bodyEncoding: e.bodyEncoding, latencyMs: e.latencyMs } : { status: 0, headers: {}, body: '', bodyEncoding: 'utf8', latencyMs: 0, abort: true });
      continue;
    }
    const b = p.bad!;
    const g = p.good!;
    const s: Served = { status: g.status, headers: { ...g.headers }, body: g.body, bodyEncoding: g.bodyEncoding, latencyMs: g.latencyMs };
    let json: Json | undefined;
    for (const f of fs) {
      const v = val(f);
      if (f.kind === 'status') s.status = v as number;
      else if (f.kind === 'delay') s.latencyMs = v as number;
      else if (f.kind === 'header') {
        if (isAbsent(v)) delete s.headers[f.path![0] as string];
        else s.headers[f.path![0] as string] = String(v);
      } else if (f.kind === 'body' && !f.path) {
        if (v === f.observed) [s.body, s.bodyEncoding] = [b.body, b.bodyEncoding];
        else if (v !== f.neutral) [s.body, s.bodyEncoding] = [String(v), 'utf8'];
      } else if (f.kind === 'body') {
        json ??= parseJson(g)!;
        json = setPath(json, f.path!, v);
      }
    }
    if (json !== undefined) s.body = JSON.stringify(json);
    responses.set(p.target, s);
  }

  const orders = factors
    .filter((f) => f.kind === 'order')
    .map((f) => {
      const [first, second] = val(f) as string[];
      return { first: first!, second: second! };
    });

  const env: EnvState = { ...good.env, viewport: { ...good.env.viewport } };
  const storage: StorageSnapshot = {
    cookies: good.storageStart.cookies.map((c) => ({ ...c })),
    localStorage: { ...good.storageStart.localStorage },
    sessionStorage: { ...good.storageStart.sessionStorage },
  };
  for (const f of factors) {
    const v = val(f);
    const k = f.path?.[0] as string;
    if (f.kind === 'env') (env as unknown as Record<string, unknown>)[k] = v;
    else if (f.kind === 'storage') {
      const area = storage[f.area!];
      if (isAbsent(v)) delete area[k];
      else area[k] = String(v);
    } else if (f.kind === 'cookie') {
      storage.cookies = storage.cookies.filter((c) => c.name !== k);
      if (!isAbsent(v)) storage.cookies.push({ ...(bad.storageStart.cookies.find((c) => c.name === k) ?? { name: k }), value: String(v) });
    }
  }
  return { plan: { responses, orders }, env, storage };
}
