import type { Bundle } from '@causality-cage/core';

// Placeholder until M6.
export function renderReport(b: Bundle): string {
  return `<!doctype html><meta charset="utf-8"><title>cage report</title><p>${b.result.sentence.replace(/</g, '&lt;')}</p>`;
}
