// Templated plain-English verdict. No LLM.
import { isAbsent, pathString, shortTarget } from './factors.ts';
import type { Factor, FactorValue, Result } from './types.ts';

const fmt = (v: FactorValue): string => (isAbsent(v) ? 'absent' : typeof v === 'string' ? `"${v.length > 40 ? v.slice(0, 40) + '…' : v}"` : JSON.stringify(v));

export function describe(f: Factor, r?: Result): string {
  const t = f.target ? shortTarget(f.target) : '';
  const v = f.observed;
  switch (f.kind) {
    case 'body':
      if (!f.path) return `${t} returns a different body`;
      return isAbsent(v) ? `${t} returns no ${pathString(f.path)}` : `${t} returns ${pathString(f.path)} = ${fmt(v)}`;
    case 'status':
      return `${t} responds with status ${fmt(v)}`;
    case 'header':
      return isAbsent(v) ? `${t} responds without header ${f.path![0]}` : `${t} responds with header ${f.path![0]}: ${fmt(v)}`;
    case 'delay': {
      const c = r?.delayCurves.find((d) => d.factor === f.id);
      const slower = (f.observed as number) > (f.neutral as number);
      return c?.thresholdMs != null ? `${t} takes ${slower ? 'longer' : 'less'} than ~${c.thresholdMs} ms` : `${t} takes ${v} ms instead of ${fmt(f.neutral)} ms`;
    }
    case 'order':
      return `${shortTarget(f.target!)} arrives before ${shortTarget(f.target2!)}`;
    case 'presence':
      return v === true ? `${t} gets its recorded response` : `${t} fails at the network level`;
    case 'storage':
      return isAbsent(v) ? `${f.area} ${f.path![0]} is absent` : `${f.area} ${f.path![0]} is ${fmt(v)}`;
    case 'cookie':
      return isAbsent(v) ? `cookie ${f.path![0]} is absent` : `cookie ${f.path![0]} is ${fmt(v)}`;
    case 'env':
      return `${f.path![0]} is ${fmt(v)}`;
  }
}

export function sentence(r: Result, factors: Factor[], failReason: string): string {
  const byId = new Map(factors.map((f) => [f.id, f]));
  const d = (id: string) => describe(byId.get(id)!, r);
  const what = failReason ? `The failure ("${failReason.length > 90 ? failReason.slice(0, 90) + '…' : failReason}")` : 'The failure';
  const sets = r.minimalSets;
  const n = r.budget.used;
  if (r.verdict === 'untrustworthy-oracle' || r.verdict === 'unexplained') return r.reason;
  if (!sets.length) return r.reason;
  const timing = factors.filter((f) => f.kind === 'delay' || f.kind === 'order');
  const usedTiming = sets.flat().some((id) => ['delay', 'order'].includes(byId.get(id)!.kind));
  const latencyNote = timing.length && !usedTiming ? ' Timing differences do not matter.' : '';
  if (r.verdict === 'partial') return `${r.reason} Best candidate: ${sets[0]!.map(d).join(' AND ')}.`;
  let core: string;
  if (sets.length > 1) core = `${what} happens when ${sets.map((s) => s.map(d).join(' AND ')).join(', OR when ')}. Each alone is enough.`;
  else if (sets[0]!.length === 1) core = `${what} happens when ${d(sets[0]![0]!)}. Restoring the passing value prevents it.`;
  else if (r.structure === 'OTHER') core = `${what} depends on a non-simple combination of: ${sets[0]!.map(d).join('; ')} (see the truth table).`;
  else core = `${what} happens only when ${sets[0]!.map(d).join(' AND ')}. Removing any one of them prevents it.`;
  return `${core}${latencyNote} (${n} experiments.)`;
}
