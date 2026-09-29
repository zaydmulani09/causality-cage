import { describe, expect, it } from 'vitest';
import { extractFactors } from '../src/factors.ts';
import { DEFAULT_ENV } from '../src/run.ts';
import { synthesizeGood } from '../src/synthesize.ts';
import type { Exchange, Session } from '../src/types.ts';

const ex = (nth: number, body: unknown, latencyMs: number): Exchange => ({
  id: nth, method: 'GET', url: '/a', key: 'GET /a', nth, reqBodyHash: null, resourceType: 'fetch', status: 200,
  headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), bodyEncoding: 'utf8', startMs: 0, latencyMs, endMs: latencyMs,
});

const bad: Session = {
  schemaVersion: 1, label: 'bad', baseURL: 'http://x', createdAt: '', env: { ...DEFAULT_ENV, locale: 'tr-TR' },
  storageStart: { cookies: [{ name: 'c', value: '1' }], localStorage: { k: 'v' }, sessionStorage: {} },
  storageEnd: { cookies: [], localStorage: {}, sessionStorage: {} },
  exchanges: [ex(0, { cur: 'USD', n: 3, tags: ['a'], id: null }, 900), ex(1, { cur: 'USD', n: 3, tags: ['a'], id: 'x' }, 20), ex(2, { cur: 'JPY', n: 3, tags: ['a'], id: 'x' }, 30)],
  consoleErrors: [], pageErrors: [], oracle: { failed: true }, seqHash: '',
};

describe('synthesizeGood', () => {
  const good = synthesizeGood(bad);
  it('uses the most common sibling sample, then type defaults, keeping shape', () => {
    expect(JSON.parse(good.exchanges[2]!.body)).toEqual({ cur: 'USD', n: 3, tags: ['a'], id: 'x' });
    expect(JSON.parse(good.exchanges[0]!.body)).toEqual({ cur: 'USD', n: 3, tags: ['a'], id: 'x' });
  });
  it('uses the minimum latency per endpoint and clears storage/env', () => {
    expect(good.exchanges.map((e) => e.latencyMs)).toEqual([20, 20, 20]);
    expect(good.env).toEqual(DEFAULT_ENV);
    expect(good.storageStart).toEqual({ cookies: [], localStorage: {}, sessionStorage: {} });
    expect(good.synthesized).toBe(true);
  });
  it('turns into factors', () => {
    const labels = extractFactors(bad, good).factors.map((f) => f.label);
    expect(labels).toEqual(expect.arrayContaining(['body GET /a#2 cur', 'body GET /a id', 'delay GET /a', 'storage localStorage k', 'cookie c', 'env locale']));
  });
  it('falls back to type defaults without siblings', () => {
    const one = synthesizeGood({ ...bad, exchanges: [ex(0, { s: 'JPY', n: 5, b: true, z: null }, 5)] });
    expect(JSON.parse(one.exchanges[0]!.body)).toEqual({ s: '', n: 0, b: false, z: '' });
  });
});
