import { describe, expect, it } from 'vitest';
import { classify, variantsFor } from '../src/explain.ts';
import { ABSENT, type Decision, type Factor, type TruthRow } from '../src/types.ts';

function table(U: string[], fails: (on: string[]) => boolean): TruthRow[] {
  return Array.from({ length: 1 << U.length }, (_, m) => {
    const on = U.filter((_, i) => m & (1 << i));
    const decision: Decision = fails(on) ? 'FAIL' : 'PASS';
    return { on, decision, runs: 1, fails: decision === 'FAIL' ? 1 : 0 };
  });
}

describe('classify', () => {
  it('SINGLE, AND, OR, OTHER', () => {
    expect(classify(['a'], table(['a'], (s) => s.includes('a')))).toEqual({ structure: 'SINGLE', mins: [['a']] });
    expect(classify(['a', 'b'], table(['a', 'b'], (s) => s.length === 2))).toEqual({ structure: 'AND', mins: [['a', 'b']] });
    expect(classify(['a', 'b'], table(['a', 'b'], (s) => s.length > 0))).toEqual({ structure: 'OR', mins: [['a'], ['b']] });
    // (a AND b) OR c
    const U = ['a', 'b', 'c'];
    expect(classify(U, table(U, (s) => s.includes('c') || (s.includes('a') && s.includes('b')))).structure).toBe('OTHER');
    // non-monotone: b heals a
    expect(classify(['a', 'b'], table(['a', 'b'], (s) => s.includes('a') && !s.includes('b'))).structure).toBe('OTHER');
  });
});

describe('variantsFor', () => {
  const f = (p: Partial<Factor>): Factor => ({ id: 'f0', kind: 'body', label: '', target: 'GET /x#0', path: ['a'], observed: null, neutral: 'GB1', ...p });
  it('skips classes equal to observed or neutral', () => {
    const classes = variantsFor(f({})).map(([c]) => c);
    expect(classes).toEqual(['missing key', 'empty string', 'zero', 'false', 'empty array', 'empty object', 'wrong type']);
    expect(variantsFor(f({ kind: 'storage', area: 'localStorage', observed: 'v2', neutral: ABSENT }))).toEqual([['empty string', '']]);
    expect(variantsFor(f({ kind: 'delay', observed: 900, neutral: 5 }))).toEqual([]);
  });
});
