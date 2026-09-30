import { describe, expect, it } from 'vitest';
import { decideFixed, failureSignature, pickSignature } from '../src/signature.ts';

describe('failureSignature', () => {
  it('keeps the error type and message, strips what varies between runs', () => {
    expect(failureSignature("uncaught: TypeError: Cannot read properties of undefined (reading 'tags')")).toBe(
      "uncaught: TypeError: Cannot read properties of undefined (reading 'tags')",
    );
    expect(failureSignature('flow threw: Timeout 10000ms exceeded at https://api.example.com/v1/items?id=42')).toBe('flow threw: Timeout <n>ms exceeded at <url>');
    expect(failureSignature('order 3f2a9c1e0b7d4455 failed for 123e4567-e89b-12d3-a456-426614174000')).toBe('order <id> failed for <id>');
    expect(failureSignature('bad token eyJhbGciOiJIUzI1NiJ9abc123')).toBe('bad token <id>');
    expect(failureSignature('etag 9f86d081 changed')).toBe('etag <hash> changed');
    expect(failureSignature('text missing:   Total: $42.00')).toBe('text missing: Total: $<n>');
  });
  it('tells different failures apart', () => {
    const a = failureSignature("TypeError: Cannot read properties of undefined (reading 'tags')");
    const b = failureSignature("TypeError: Cannot read properties of undefined (reading 'body')");
    expect(a).not.toBe(b);
  });
});

describe('pickSignature', () => {
  it('prefers the recorded failure when the replays show it, else the majority', () => {
    const counts = { A: 3, B: 2 };
    expect(pickSignature(counts, 'B')).toBe('B');
    expect(pickSignature(counts, 'C')).toBe('A');
    expect(pickSignature(counts, null)).toBe('A');
    expect(pickSignature({}, 'A')).toBeNull();
  });
});

describe('decideFixed', () => {
  it('needs all valid runs to agree', () => {
    expect(decideFixed({ runs: 3, errors: 0, fails: 3, different: 0 })).toBe('FAIL');
    expect(decideFixed({ runs: 3, errors: 0, fails: 0, different: 3 })).toBe('DIFFERENT_FAILURE');
    expect(decideFixed({ runs: 3, errors: 0, fails: 0, different: 0 })).toBe('PASS');
    expect(decideFixed({ runs: 3, errors: 0, fails: 2, different: 1 })).toBe('FAIL'); // the different one is censored
    expect(decideFixed({ runs: 3, errors: 0, fails: 0, different: 1 })).toBe('PASS');
    expect(decideFixed({ runs: 3, errors: 0, fails: 1, different: 0 })).toBe('UNRESOLVED');
    expect(decideFixed({ runs: 3, errors: 2, fails: 1, different: 0 })).toBe('ERROR');
  });
});
