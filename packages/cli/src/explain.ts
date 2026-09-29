import { chromium } from 'playwright';
import { buildOracle, explain as run, loadFlow, type ExperimentRecord, type Result, type Session } from '@causality-cage/core';
import { int, need, ORACLE_HELP, ORACLE_OPTIONS, oracleSpec, parse, readJson, UsageError } from './args.ts';

const HELP = `cage explain --flow <flow> --bad <session.json> (--good <session.json> | --synthesize-good) [options]

Finds the minimal set of conditions (API fields, latency, ordering, storage,
cookies, environment) that make the failing session fail, by replaying the
flow with conditions flipped one group at a time (hierarchical delta debugging).

Options:
  --flow <file>             flow module (required)
  --bad <file>              failing session (required)
  --good <file>             passing session
  --synthesize-good         EXPERIMENTAL: no passing session; synthesize neutral values
  --out <file.cage>         bundle to write
  --open                    open the HTML report when done
  --budget <n>              max experiments (default 500)
  --concurrency <n>         parallel browser contexts (default 4)
  --timeout <ms>            per-experiment timeout (default 20000)
  --base-url <url>          app origin (default: the bad session's)
  --api <glob>              intercept only matching URLs (repeatable; default all fetch/xhr)
  --allow-unmatched <glob>  unrecorded requests matching glob go to the network (repeatable)
  --freeze-random           seed Math.random
  --freeze-time             start the page clock at a fixed time (virtual Date; interacts with delay factors)
  --json                    print the result as JSON
  --debug                   stack traces on errors

${ORACLE_HELP}

Exit codes: 0 explained, 2 partial, 3 unexplained, 4 untrustworthy-oracle, 1 tool error.

Example (PowerShell):
  cage explain --flow examples/flows/checkout.ts --oracle examples/oracles/no-crash.ts --bad sessions/bad.json --good sessions/good.json --out result.cage --open`;

export const EXIT: Record<Result['verdict'], number> = { explained: 0, partial: 2, unexplained: 3, 'untrustworthy-oracle': 4 };

const tty = process.stdout.isTTY;
const color = (c: number, s: string) => (tty ? `\x1b[${c}m${s}\x1b[0m` : s);
const DOT: Record<string, string> = { FAIL: color(31, '●'), PASS: color(32, '○'), ERROR: color(33, 'x'), UNRESOLVED: color(33, '?') };

export async function explainCmd(argv: string[]): Promise<number> {
  const a = parse(
    argv,
    {
      flow: { type: 'string' },
      bad: { type: 'string' },
      good: { type: 'string' },
      'synthesize-good': { type: 'boolean' },
      out: { type: 'string' },
      open: { type: 'boolean' },
      budget: { type: 'string' },
      concurrency: { type: 'string' },
      timeout: { type: 'string' },
      'base-url': { type: 'string' },
      api: { type: 'string', multiple: true },
      'allow-unmatched': { type: 'string', multiple: true },
      'freeze-random': { type: 'boolean' },
      'freeze-time': { type: 'boolean' },
      json: { type: 'boolean' },
      ...ORACLE_OPTIONS,
    },
    HELP,
  );
  if (!a) return 0;
  const v = a.values;
  const flowFile = need(v.flow, '--flow', HELP);
  const bad = await readJson<Session>(need(v.bad, '--bad', HELP), 'bad session');
  if (!v.good && !v['synthesize-good']) throw new UsageError(`pass --good <session.json>, or --synthesize-good to try without one\n\n${HELP}`);
  const good = await readJson<Session>(v.good!, 'good session');
  const oracle = await buildOracle(oracleSpec(v));
  const flow = await loadFlow(flowFile);
  const browser = await chromium.launch();
  const recent: string[] = [];
  let count = 0;
  let phaseMsg = '';
  const status = () => {
    if (!tty || v.json) return;
    process.stdout.write(`\r\x1b[K${String(count).padStart(4)} experiments ${recent.join('')} ${color(2, phaseMsg)}`);
  };
  try {
    const out = await run({
      browser,
      baseURL: v['base-url'] ?? bad.baseURL,
      flow,
      oracle,
      bad,
      good,
      budget: int(v.budget, '--budget', 500),
      concurrency: int(v.concurrency, '--concurrency', 4),
      timeoutMs: int(v.timeout, '--timeout', 20_000),
      apiGlobs: v.api ?? [],
      allowUnmatched: v['allow-unmatched'] ?? [],
      freezeRandom: !!v['freeze-random'],
      freezeTime: !!v['freeze-time'],
      onRecord: (rec: ExperimentRecord) => {
        count++;
        recent.push(DOT[rec.decision]!);
        if (recent.length > 30) recent.shift();
        status();
      },
      onPhase: (m) => {
        phaseMsg = m;
        status();
      },
    });
    if (tty && !v.json) process.stdout.write('\r\x1b[K');
    const res = out.result;
    if (v.json) console.log(JSON.stringify({ result: res, factors: out.factors }, null, 2));
    else printSummary(res, out.factors);
    return EXIT[res.verdict];
  } finally {
    await browser.close();
  }
}

function printSummary(r: Result, factors: { id: string; label: string }[]) {
  const label = new Map(factors.map((f) => [f.id, f.label]));
  const head = { explained: color(32, 'EXPLAINED'), partial: color(33, 'PARTIAL'), unexplained: color(33, 'UNEXPLAINED'), 'untrustworthy-oracle': color(31, 'UNTRUSTWORTHY ORACLE') }[r.verdict];
  console.log(`${head}  ${r.sentence}`);
  for (const [i, s] of r.minimalSets.entries()) console.log(`  set ${i + 1}${r.structure ? ` (${r.structure})` : ''}: ${s.map((id) => label.get(id)).join('  +  ')}`);
  console.log(`  gate: all-observed failed ${r.gate.allTrue.fails}/${r.gate.allTrue.runs}, all-neutral failed ${r.gate.allFalse.fails}/${r.gate.allFalse.runs}; mode ${r.mode}; ${r.factorCount} factors; ${r.budget.used}/${r.budget.limit} experiments; ${(r.wallMs / 1000).toFixed(1)} s`);
  for (const w of r.warnings) console.log(color(33, `  warning: ${w}`));
  if (r.verdict === 'partial') console.log(color(33, '  PARTIAL RESULT: not verified. Raise --budget or narrow the diff.'));
}
