import { describe, expect, it } from 'vitest';
import { sprt } from '../src/stats.ts';

describe('sprt (0.2 vs 0.8, alpha = beta = 0.05)', () => {
  // each fail adds ln 4, each pass subtracts ln 4; boundaries are ±ln 19 ≈ ±2.944 → net 3 decides
  it('decides after a net lead of three', () => {
    expect(sprt(2, 2)).toBe('CONTINUE');
    expect(sprt(3, 3)).toBe('FAIL');
    expect(sprt(0, 3)).toBe('PASS');
    expect(sprt(4, 5)).toBe('FAIL');
    expect(sprt(3, 5)).toBe('CONTINUE');
    expect(sprt(1, 5)).toBe('PASS');
    expect(sprt(6, 12)).toBe('CONTINUE');
  });
});
