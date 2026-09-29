import { describe, expect, it } from 'vitest';
import { applyConfig } from '../src/compose.ts';
import { align, diffJson, extractFactors, leavesOf } from '../src/factors.ts';
import { DEFAULT_ENV } from '../src/run.ts';
import { ABSENT, type Exchange, type Session } from '../src/types.ts';
import { exchangeKey } from '../src/url.ts';

const base = 'http://127.0.0.1:5173';

function session(label: string, ex: Partial<Exchange>[], extra: Partial<Session> = {}): Session {
  const counts = new Map<string, number>();
  const exchanges = ex.map((e, id) => {
    const key = exchangeKey(e.method ?? 'GET', e.url ?? '/', base);
    const nth = counts.get(key) ?? 0;
    counts.set(key, nth + 1);
    return { id, method: 'GET', url: '/', key, nth, reqBodyHash: null, resourceType: 'fetch', status: 200, headers: { 'content-type': 'application/json' }, body: '{}', bodyEncoding: 'utf8' as const, startMs: 0, latencyMs: 5, endMs: 5, ...e };
  });
  return { schemaVersion: 1, label, baseURL: base, createdAt: '', env: DEFAULT_ENV, storageStart: { cookies: [], localStorage: {}, sessionStorage: {} }, storageEnd: { cookies: [], localStorage: {}, sessionStorage: {} }, exchanges, consoleErrors: [], pageErrors: [], oracle: null, seqHash: '', ...extra };
}

describe('align', () => {
  it('pairs duplicate URLs by occurrence and normalizes query order', () => {
    const bad = session('bad', [{ url: `${base}/a?x=1&y=2` }, { url: `${base}/a?y=2&x=1`, body: '{"n":2}' }]);
    const good = session('good', [{ url: `${base}/a?x=1&y=2&_=99` }, { url: `${base}/a?x=1&y=2`, body: '{"n":3}' }]);
    const pairs = align(bad, good);
    expect(pairs.map((p) => p.target)).toEqual(['GET /a?x=1&y=2#0', 'GET /a?x=1&y=2#1']);
    expect(pairs.every((p) => p.bad && p.good)).toBe(true);
    const { factors } = extractFactors(bad, good);
    expect(factors.map((f) => f.label)).toEqual(['body GET /a?x=1&y=2#1 n']);
  });

  it('turns missing exchanges into presence factors', () => {
    const bad = session('bad', [{ url: `${base}/a` }, { url: `${base}/only-bad` }]);
    const good = session('good', [{ url: `${base}/a` }, { url: `${base}/only-good` }]);
    const { factors } = extractFactors(bad, good);
    expect(factors.map((f) => [f.label, f.observed, f.neutral])).toEqual([
      ['presence GET /only-bad', true, false],
      ['presence GET /only-good', false, true],
    ]);
  });
});

describe('diffJson', () => {
  it('keeps null, missing and values distinct', () => {
    const d = diffJson({ a: null, b: 1, c: { d: [1, 2] } }, { b: 1, a: 'x', c: { d: [1, 3], e: true } });
    expect(d).toEqual([
      { path: ['a'], observed: null, neutral: 'x' },
      { path: ['c', 'd', 1], observed: 2, neutral: 3 },
      { path: ['c', 'e'], observed: ABSENT, neutral: true },
    ]);
  });
  it('treats arrays of different length as one leaf and ignores key order', () => {
    expect(diffJson({ a: [1] }, { a: [1, 2] })).toEqual([{ path: ['a'], observed: [1], neutral: [1, 2] }]);
    expect(diffJson({ a: 1, b: 2 }, { b: 2, a: 1 })).toEqual([]);
  });
});

describe('extract + apply', () => {
  const bad = session('bad', [
    { url: `${base}/cart`, body: JSON.stringify({ customer: { tax_id: null, name: 'A' }, meta: { t: 1 } }), latencyMs: 900, headers: { 'content-type': 'application/json', 'x-region': 'eu', 'x-request-id': '1' } },
    { url: `${base}/p`, startMs: 0, endMs: 20 },
    { url: `${base}/q`, startMs: 0, endMs: 100 },
  ], { storageStart: { cookies: [{ name: 'locale', value: 'tr-TR' }], localStorage: { exp: 'v2' }, sessionStorage: {} } });
  const good = session('good', [
    { url: `${base}/cart`, body: JSON.stringify({ customer: { tax_id: 'GB1', name: 'A' }, meta: { t: 2 } }), latencyMs: 10, headers: { 'content-type': 'application/json', 'x-region': 'us', 'x-request-id': '2' } },
    { url: `${base}/p`, startMs: 0, endMs: 100 },
    { url: `${base}/q`, startMs: 0, endMs: 20 },
  ]);
  const ex = extractFactors(bad, good);

  it('finds every factor kind and skips volatile headers', () => {
    expect(ex.factors.map((f) => f.label)).toEqual([
      'header GET /cart x-region',
      'body GET /cart customer.tax_id',
      'body GET /cart meta.t',
      'delay GET /cart',
      'order GET /p before GET /q',
      'storage localStorage exp',
      'cookie locale',
    ]);
    expect(leavesOf(ex.tree).sort()).toEqual(ex.factors.map((f) => f.id).sort());
  });

  it('all-observed reproduces bad, all-neutral reproduces good', () => {
    const all = applyConfig(bad, good, ex.pairs, ex.factors, { on: ex.factors.map((f) => f.id) });
    const cart = all.plan.responses.get('GET /cart#0')!;
    expect(JSON.parse(cart.body)).toEqual(JSON.parse(bad.exchanges[0]!.body));
    expect([cart.latencyMs, cart.headers['x-region']]).toEqual([900, 'eu']);
    expect(all.plan.orders).toEqual([{ first: 'GET /p#0', second: 'GET /q#0' }]);
    expect(all.storage).toMatchObject({ localStorage: { exp: 'v2' }, cookies: [{ name: 'locale', value: 'tr-TR' }] });

    const none = applyConfig(bad, good, ex.pairs, ex.factors, { on: [] });
    expect(none.plan.responses.get('GET /cart#0')!.body).toBe(good.exchanges[0]!.body);
    expect(none.plan.orders).toEqual([{ first: 'GET /q#0', second: 'GET /p#0' }]);
    expect(none.storage).toMatchObject({ localStorage: {}, cookies: [] });
  });

  it('overlays single leaves and overrides', () => {
    const taxId = ex.factors.find((f) => f.label.endsWith('tax_id'))!;
    const one = applyConfig(bad, good, ex.pairs, ex.factors, { on: [taxId.id] });
    expect(JSON.parse(one.plan.responses.get('GET /cart#0')!.body)).toEqual({ customer: { tax_id: null, name: 'A' }, meta: { t: 2 } });
    const missing = applyConfig(bad, good, ex.pairs, ex.factors, { on: [taxId.id], overrides: { [taxId.id]: ABSENT } });
    expect(JSON.parse(missing.plan.responses.get('GET /cart#0')!.body).customer).toEqual({ name: 'A' });
  });
});
