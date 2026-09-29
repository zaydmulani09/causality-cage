import { describe, expect, it } from 'vitest';
import { exchangeKey, matchesAny, normalizeUrl } from '../src/url.ts';

const base = 'http://localhost:5173';

describe('normalizeUrl', () => {
  it('sorts params and strips volatile ones', () => {
    expect(normalizeUrl(`${base}/api/x?b=2&_=123&a=1&ts=9`, base)).toBe('/api/x?a=1&b=2');
    expect(normalizeUrl(`${base}/api/x?a=2&a=1`, base)).toBe('/api/x?a=1&a=2');
  });
  it('keeps foreign origins', () => {
    expect(normalizeUrl('https://cdn.example.com/a?z=1', base)).toBe('https://cdn.example.com/a?z=1');
  });
  it('builds keys with upper-case method', () => {
    expect(exchangeKey('get', `${base}/api/cart`, base)).toBe('GET /api/cart');
  });
});

describe('globs', () => {
  it('matches ** and *', () => {
    expect(matchesAny('http://a.com/api/v1/x', ['**/api/**'])).toBe(true);
    expect(matchesAny('http://a.com/x', ['**/api/**'])).toBe(false);
    expect(matchesAny('http://a.com/a/b', ['http://a.com/*'])).toBe(false);
  });
});
