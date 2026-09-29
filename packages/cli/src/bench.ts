import { chromium } from 'playwright';
import { synthesizeGood } from '@causality-cage/core';
import { loadCases, medianExperimentMs, runCase, selfcheck, table, type CaseRun, type SelfcheckRun } from '@causality-cage/bench';
import { int, parse, UsageError } from './args.ts';

const HELP = `cage bench [--only <ids>] [options]

Runs the planted-bug benchmark on examples/shop: for each bug, records a bad and
a good session from fresh servers, runs explain, and scores it against
packages/bench/ground-truth.json. Needs \`pnpm shop:build\` (pnpm bench does it).

Options:
  --only <ids>        comma-separated bug ids, e.g. B1,B5
  --concurrency <n>   default 4
  --budget <n>        default 500
  --synthesize-good   EXPERIMENTAL: ignore the recorded good sessions, synthesize them

Example (PowerShell):
  pnpm bench
  pnpm cage bench --only B3 --concurrency 2`;

export async function bench(argv: string[]): Promise<number> {
  const a = parse(argv, { only: { type: 'string' }, concurrency: { type: 'string' }, budget: { type: 'string' }, 'synthesize-good': { type: 'boolean' } }, HELP);
  if (!a) return 0;
  let cases = loadCases();
  if (a.values.only) {
    const ids = a.values.only.split(',').map((s) => s.trim());
    const unknown = ids.filter((id) => !cases.some((c) => c.id === id));
    if (unknown.length) throw new UsageError(`unknown bug id(s): ${unknown.join(', ')}. Known: ${cases.map((c) => c.id).join(', ')}`);
    cases = cases.filter((c) => ids.includes(c.id));
  }
  const concurrency = int(a.values.concurrency, '--concurrency', 4);
  const budget = int(a.values.budget, '--budget', 500);
  const browser = await chromium.launch();
  const runs: CaseRun[] = [];
  try {
    for (const c of cases) {
      process.stderr.write(`${c.id}: recording + explaining…\n`);
      const r = await runCase(c, browser, { concurrency, budget, ...(a.values['synthesize-good'] ? { synthesize: synthesizeGood } : {}) });
      process.stderr.write(`${c.id}: ${r.match ? 'match' : 'MISMATCH'} (${r.got})\n`);
      runs.push(r);
    }
  } finally {
    await browser.close();
  }
  console.log(`\ncage bench, concurrency ${concurrency}, budget ${budget}${a.values['synthesize-good'] ? ', single-session mode (experimental)' : ''}\n`);
  console.log(table(runs));
  console.log(`\nexact match: ${runs.filter((r) => r.match).length}/${runs.length}; median time per replay run: ${(medianExperimentMs(runs) / 1000).toFixed(2)} s`);
  return runs.every((r) => r.match) ? 0 : 1;
}

const SELFCHECK_HELP = `cage selfcheck [--seed <n>]

Self-validation: records a passing session from examples/shop, injects synthetic
faults (mutated response fields) with a known hidden cause, uses an oracle that
fails exactly when that cause is served, and checks explain recovers it.

Example (PowerShell):
  pnpm test:selfcheck`;

export async function selfcheckCmd(argv: string[]): Promise<number> {
  const a = parse(argv, { seed: { type: 'string' } }, SELFCHECK_HELP);
  if (!a) return 0;
  const browser = await chromium.launch();
  let runs: SelfcheckRun[];
  try {
    runs = await selfcheck(browser, int(a.values.seed, '--seed', 7));
  } finally {
    await browser.close();
  }
  for (const r of runs) {
    console.log(`${r.match ? 'ok  ' : 'FAIL'} ${r.name} (${r.experiments} experiments)`);
    if (!r.match) console.log(`     ${r.verdict}: ${r.reason}\n     expected ${JSON.stringify(r.expected)}\n     got      ${JSON.stringify(r.got)}`);
  }
  console.log(`selfcheck: ${runs.filter((r) => r.match).length}/${runs.length}`);
  return runs.every((r) => r.match) ? 0 : 1;
}
