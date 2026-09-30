import { readFileSync } from 'node:fs';
import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { generateSchema, SCHEMA_FILE } from '../../../scripts/gen-schema.ts';
import { assembleBundle, packBundle, unpackBundle } from '../src/bundle.ts';
import { extractFactors } from '../src/factors.ts';
import { redact } from '../src/redact.ts';
import { sentence } from '../src/sentence.ts';
import { DEFAULT_ENV } from '../src/run.ts';
import { validateAgainst } from '../src/schema.ts';
import type { Exchange, Result, Session } from '../src/types.ts';
import { exchangeKey } from '../src/url.ts';

const base = 'http://127.0.0.1:5173';
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhZGEifQ.c2lnbmF0dXJlLXZhbHVl';
const SECRETS = ['tok_live_9f8e7d6c5b4a', 'tok_live_other_1234', 'ada.lovelace@example.com', '4111 1111 1111 1111', '4111111111111111', 'sess-ABCDEF123456', 'ak-0987654321zz', 'urltok-55555', JWT];

function ex(url: string, body: unknown, headers: Record<string, string> = {}): Exchange {
  return { id: 0, method: 'GET', url, key: exchangeKey('GET', url, base), nth: 0, reqBodyHash: null, resourceType: 'fetch', status: 200, headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), bodyEncoding: 'utf8', startMs: 0, latencyMs: 5, endMs: 5 };
}

function session(label: string, token: string, taxId: string | null): Session {
  const storage = { cookies: [{ name: 'session_id', value: 'sess-ABCDEF123456' }], localStorage: { api_key: 'ak-0987654321zz', theme: 'dark' }, sessionStorage: {} };
  return {
    schemaVersion: 1,
    label,
    baseURL: base,
    createdAt: '2026-09-29T00:00:00.000Z',
    env: DEFAULT_ENV,
    storageStart: storage,
    storageEnd: storage,
    exchanges: [
      ex(`${base}/api/cart?token=urltok-55555`, { customer: { tax_id: taxId, contact: 'ada.lovelace@example.com', pin_key: 4242, note: 'card 4111 1111 1111 1111' }, auth_token: token, ts: 1727600000000 }, { authorization: `Bearer ${JWT}` }),
    ],
    consoleErrors: [`failed for ada.lovelace@example.com with ${token}`],
    pageErrors: [],
    oracle: null,
    seqHash: 'x',
  };
}

function bundle(doRedact: boolean) {
  const bad = session('bad', 'tok_live_9f8e7d6c5b4a', null);
  const good = session('good', 'tok_live_other_1234', 'GB1');
  const x = extractFactors(bad, good);
  const tokenFactor = x.factors.find((f) => f.label.endsWith('auth_token'))!.id;
  const result: Result = {
    verdict: 'explained',
    reason: 'ok',
    sentence: 'The failure happens when GET /api/cart returns auth_token = "tok_live_9f8e7d6c5b4a" (mail ada.lovelace@example.com).',
    mode: 'deterministic',
    singleSession: false,
    signature: null,
    looseOracle: false,
    gate: { allTrue: { runs: 5, fails: 5 }, allFalse: { runs: 5, fails: 0 } },
    factorCount: x.factors.length,
    minimalSets: [[tokenFactor]],
    structure: 'SINGLE',
    truthTable: { factors: [tokenFactor], rows: [{ on: [], decision: 'PASS', runs: 1, fails: 0 }, { on: [tokenFactor], decision: 'FAIL', runs: 1, fails: 1 }] },
    verification: [],
    variants: [{ factor: tokenFactor, cls: 'empty string', value: '', decision: 'PASS' }],
    delayCurves: [],
    budget: { used: 3, limit: 500 },
    wallMs: 10,
    warnings: [],
  };
  const out = { ...x, result, experiments: [{ n: 0, phase: 'search' as const, key: '1', bits: '1', runs: 1, fails: 1, errors: 0, decision: 'FAIL' as const, wallMs: 5, seqHashes: ['a'], reason: 'uncaught: bad token tok_live_9f8e7d6c5b4a' }] };
  return assembleBundle({
    out,
    bad,
    good,
    manifest: { toolVersion: '0.1.0', baseOrigin: base, flowHash: 'h', flowFile: 'flow.ts', oracle: { failOnUncaught: true }, apiGlobs: [], allowUnmatched: [], freezeRandom: false, freezeTime: false },
    flowSource: 'export default async function flow() {}\n',
    oracleSource: null,
    redact: doRedact,
  });
}

describe('redaction', () => {
  it('no planted secret survives anywhere in the zipped bundle', () => {
    const b = bundle(true);
    const files = unzipSync(packBundle(b, `<html>${b.result.sentence}</html>`));
    for (const [name, bytes] of Object.entries(files)) {
      const text = strFromU8(bytes);
      for (const s of SECRETS) expect(text.includes(s), `${s} leaked in ${name}`).toBe(false);
    }
    expect(b.manifest.redaction).toMatchObject({ headers: 2, jwts: 0 });
    expect(b.manifest.redaction!.emails).toBeGreaterThan(0);
    expect(b.manifest.redaction!.cards).toBeGreaterThan(0);
    expect(b.manifest.redaction!.urlParams).toBe(2);
  });

  it('does not leak the prefix of a long secret through the truncated verdict sentence', () => {
    const long = 'sk_live_' + 'Z9x'.repeat(20);
    const b0 = bundle(false);
    const bad = { ...b0.bad, storageStart: { ...b0.bad.storageStart, localStorage: { ...b0.bad.storageStart.localStorage, session_key: long } } };
    const x = extractFactors(bad, b0.good);
    const f = x.factors.find((k) => k.label === 'storage localStorage session_key')!;
    const result = { ...b0.result, minimalSets: [[f.id]], truthTable: null };
    result.sentence = sentence(result, x.factors, '');
    expect(result.sentence).toContain(long.slice(0, 20)); // unredacted input really does quote a prefix
    const b = assembleBundle({ out: { ...x, result, experiments: [] }, bad, good: b0.good, manifest: b0.manifest, flowSource: '', oracleSource: null, redact: true });
    const files = unzipSync(packBundle(b, b.result.sentence));
    for (const [name, bytes] of Object.entries(files)) expect(strFromU8(bytes).includes(long.slice(0, 16)), name).toBe(false);
  });

  it('keeps types, nulls, distinctness and consistency', () => {
    const b = bundle(true);
    const body = (s: Session) => JSON.parse(s.exchanges[0]!.body);
    const [bb, gb] = [body(b.bad), body(b.good)];
    expect(bb.customer.tax_id).toBeNull();
    expect(typeof bb.customer.pin_key).toBe('number');
    expect(bb.ts).toBe(1727600000000); // not Luhn-valid: a timestamp, kept
    expect(bb.auth_token).not.toBe(gb.auth_token); // different secrets stay different
    const f = b.factors.find((x) => x.label.endsWith('auth_token'))!;
    expect(f.observed).toBe(bb.auth_token); // factor values match the served bodies
    expect(bb.customer.contact).toBe(gb.customer.contact); // equal secrets stay equal
    expect(bb.customer.contact).toMatch(/@example\.invalid$/);
    expect(b.bad.storageStart.localStorage.theme).toBe('dark');
  });

  it('respects the allow list', () => {
    const { data } = redact({ ...bundle(false), experiments: [] }, ['customer.contact']);
    expect(JSON.parse(data.bad.exchanges[0]!.body).customer.contact).toBe('ada.lovelace@example.com');
  });

  it('--no-redact keeps values', () => {
    expect(bundle(false).bad.exchanges[0]!.body).toContain('tok_live_9f8e7d6c5b4a');
  });
});

describe('bundle', () => {
  it('round-trips', () => {
    const b = bundle(true);
    const { bundle: back, files } = unpackBundle(packBundle(b, '<html></html>'));
    expect(back).toEqual(b);
    expect(Object.keys(files).sort()).toEqual(
      ['experiments.jsonl', 'factors.json', 'manifest.json', 'report.html', 'repro/README.md', 'repro/cage-repro.spec.ts', 'repro/fixtures/plan.ts', 'repro/flow.ts', 'repro/playwright.config.ts', 'result.json', 'sessions/bad.json', 'sessions/good.json'].sort(),
    );
  });

  it('schema file is generated from types.ts and current', () => {
    expect(JSON.parse(readFileSync(SCHEMA_FILE, 'utf8'))).toEqual(generateSchema());
  }, 60_000); // builds a TS program

  it('rejects malformed files with a specific message', () => {
    expect(validateAgainst('Result', { ...bundle(false).result, verdict: 'maybe' })).toEqual(['$.verdict: expected one of explained, partial, unexplained, untrustworthy-oracle']);
    expect(validateAgainst('Session', { ...bundle(false).bad, exchanges: [{}] })[0]).toBe('$.exchanges[0].id: missing');
    expect(() => unpackBundle(new Uint8Array([1, 2, 3]))).toThrow('not a .cage bundle');
  });
});
