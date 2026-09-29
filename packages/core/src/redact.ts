// Bundle redaction. Masks are HMAC-derived with a per-bundle random key (not stored): equal secrets stay
// equal, different ones stay different, types are kept (string→string, number→number, null→null),
// so causality and replay survive. A final sweep replaces every registered secret anywhere it was copied.
import { createHmac, randomBytes } from 'node:crypto';
import { pathString } from './factors.ts';
import { SECRET_KEY } from './url.ts';
import type { ExperimentRecord, Factor, FactorNode, Json, RedactionReport, Result, Session } from './types.ts';

const SECRET_HEADER = /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key|x-auth-token|x-csrf-token|x-xsrf-token)$/i;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const JWT = /eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g;
const CARD = /(?<![\d-])\d(?:[ -]?\d){12,18}(?![\d-])/g;

function luhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2) d = d * 2 > 9 ? d * 2 - 9 : d * 2;
    sum += d;
  }
  return sum % 10 === 0;
}

export interface Redacted {
  bad: Session;
  good: Session;
  factors: Factor[];
  tree: FactorNode;
  experiments: ExperimentRecord[];
  result: Result;
}

export function redact(input: Redacted, allow: string[] = []): { data: Redacted; report: RedactionReport } {
  const key = randomBytes(32);
  const report: RedactionReport = { headers: 0, keyed: 0, emails: 0, jwts: 0, cards: 0, urlParams: 0 };
  const secrets = new Map<string, string>();
  /** masks already produced: patterns must not re-mask them (idempotent sweep) */
  const produced = new Set<string>();
  const h = (s: string) => createHmac('sha256', key).update(s).digest('hex');
  const maskStr = (s: string) => {
    if (s.length < 4) return s.length ? 'redacted' : s;
    let m = secrets.get(s);
    if (!m) secrets.set(s, (m = `redacted-${h(s).slice(0, 10)}`));
    produced.add(m);
    return m;
  };
  const maskNum = (n: number) => parseInt(h(String(n)).slice(0, 8), 16) % 1_000_000;
  const allowed = new Set(allow.map((p) => p.replace(/^\$\.?/, '')));
  /** values at allow-listed paths: never masked, wherever they appear */
  const keep = new Set<string>();
  const collect = (v: Json, path: (string | number)[]): void => {
    if (allowed.has(pathString(path)) && typeof v === 'string') keep.add(v);
    else if (Array.isArray(v)) v.forEach((x, i) => collect(x, [...path, i]));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) collect(x, [...path, k]);
  };
  if (allowed.size)
    for (const e of [...input.bad.exchanges, ...input.good.exchanges]) {
      try {
        collect(JSON.parse(e.body) as Json, []);
      } catch {
        // not JSON
      }
    }

  const patterns = (s: string): string =>
    s
      .replace(JWT, (m) => (produced.has(m) || keep.has(m) ? m : (report.jwts++, maskStr(m))))
      .replace(EMAIL, (m) => {
        if (produced.has(m) || keep.has(m)) return m;
        report.emails++;
        const v = `redacted-${h(m).slice(0, 10)}@example.invalid`;
        secrets.set(m, v);
        produced.add(v);
        return v;
      })
      .replace(CARD, (m) => {
        if (produced.has(m) || keep.has(m)) return m;
        const digits = m.replace(/\D/g, '');
        if (!luhn(digits)) return m;
        report.cards++;
        const v = (h(digits).replace(/\D/g, '') + '0'.repeat(20)).slice(0, digits.length);
        secrets.set(m, v);
        produced.add(v);
        return v;
      });

  /** mask every scalar under a secret key */
  const maskAll = (v: Json): Json => {
    if (typeof v === 'string') return (report.keyed++, maskStr(v));
    if (typeof v === 'number') return (report.keyed++, maskNum(v));
    if (Array.isArray(v)) return v.map(maskAll);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, maskAll(x)]));
    return v;
  };
  const walk = (v: Json, path: (string | number)[]): Json => {
    if (allowed.has(pathString(path))) return v;
    if (typeof v === 'string') return patterns(v);
    if (Array.isArray(v)) return v.map((x, i) => walk(x, [...path, i]));
    if (v && typeof v === 'object')
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, SECRET_KEY.test(k) && !allowed.has(pathString([...path, k])) ? maskAll(x) : walk(x, [...path, k])]));
    return v;
  };
  const kv = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, SECRET_KEY.test(k) ? (report.keyed++, maskStr(v)) : patterns(v)]));
  const url = (u: string) => {
    try {
      const x = new URL(u);
      for (const [k, v] of [...x.searchParams]) {
        if (SECRET_KEY.test(k)) {
          report.urlParams++;
          x.searchParams.set(k, maskStr(v));
        }
      }
      return patterns(x.toString());
    } catch {
      return patterns(u);
    }
  };

  const session = (s: Session): Session => {
    const storage = (st: Session['storageStart']) => ({
      cookies: st.cookies.map((c) => ({ ...c, value: SECRET_KEY.test(c.name) ? (report.keyed++, maskStr(c.value)) : patterns(c.value) })),
      localStorage: kv(st.localStorage),
      sessionStorage: kv(st.sessionStorage),
    });
    return {
      ...s,
      storageStart: storage(s.storageStart),
      storageEnd: storage(s.storageEnd),
      exchanges: s.exchanges.map((e) => {
        const headers = Object.fromEntries(Object.entries(e.headers).map(([k, v]) => [k, SECRET_HEADER.test(k) ? (report.headers++, maskStr(v)) : patterns(v)]));
        let body = e.body;
        if (e.bodyEncoding === 'utf8') {
          try {
            body = JSON.stringify(walk(JSON.parse(e.body) as Json, []));
          } catch {
            body = patterns(e.body);
          }
        }
        return { ...e, url: url(e.url), headers, body };
      }),
    };
  };

  const bad = session(input.bad);
  const good = session(input.good);
  const factors = input.factors.map((f) => {
    const secretPath = f.path?.some((p) => typeof p === 'string' && SECRET_KEY.test(p)) && !(f.path && allowed.has(pathString(f.path)));
    const val = (v: Factor['observed']) => (secretPath && (f.kind === 'body' || f.kind === 'storage' || f.kind === 'cookie') ? maskAll(v as Json) : v);
    return { ...f, observed: val(f.observed), neutral: val(f.neutral) };
  });

  // final sweep: every string anywhere, including labels, reasons, the sentence and the bodies above
  const needles = [...secrets.entries()].sort((a, b) => b[0].length - a[0].length);
  const sweepStr = (s: string) => {
    let out = patterns(s);
    for (const [secret, mask] of needles) if (out.includes(secret)) out = out.split(secret).join(mask);
    return out;
  };
  const sweep = <T>(v: T): T => {
    if (typeof v === 'string') return sweepStr(v) as T;
    if (Array.isArray(v)) return v.map(sweep) as T;
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, sweep(x)])) as T;
    return v;
  };
  return { data: sweep({ bad, good, factors, tree: input.tree, experiments: input.experiments, result: input.result }), report };
}
