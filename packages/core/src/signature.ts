// Failure signatures: an oracle reason with the parts that vary between runs of the same bug stripped out. Pure.
import type { Decision } from './types.ts';

/** URLs, UUIDs, long hex/base64-ish tokens and numbers become placeholders; whitespace is collapsed. */
export function failureSignature(reason: string): string {
  return reason
    .replace(/[a-z][a-z0-9+.-]*:\/\/[^\s'")\]]+/gi, '<url>')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<id>')
    .replace(/\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{16,}\b/g, '<id>')
    .replace(/\b(?=[0-9a-f]*\d)[0-9a-f]{8,}\b/gi, '<hash>')
    .replace(/\d+(\.\d+)?/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

/**
 * The target signature: the recorded bad session's own failure if the replays show it, else the most common
 * signature among the all-observed replays (ties: the one seen first).
 */
export function pickSignature(counts: Record<string, number>, recorded: string | null | undefined): string | null {
  const entries = Object.entries(counts);
  if (!entries.length) return null;
  const rec = recorded ? failureSignature(recorded) : null;
  if (rec && rec in counts) return rec;
  return entries.reduce((a, b) => (b[1] > a[1] ? b : a))[0];
}

export interface Tally {
  runs: number;
  errors: number;
  fails: number;
  different: number;
}

/**
 * Decision for a fixed number of runs. A run that failed differently is censored: the other failure came first,
 * so it says nothing about the target failure. Only the remaining (informative) runs must agree.
 */
export function decideFixed(t: Tally): Decision {
  const informative = t.runs - t.errors - t.different;
  if (t.errors * 2 > t.runs) return 'ERROR';
  if (informative === 0) return 'DIFFERENT_FAILURE';
  if (t.fails === informative) return 'FAIL';
  if (t.fails === 0) return 'PASS';
  return 'UNRESOLVED';
}
