import { chromium } from 'playwright';
import { applyConfig, buildOracle, extractFactors, loadFlow, makeReplayer, runFlow, type Factor, type Session } from '@causality-cage/core';
import { int, UsageError, need, ORACLE_HELP, ORACLE_OPTIONS, oracleSpec, parse, readJson } from './args.ts';

const HELP = `cage verify <flow> --session <session.json> [options]

Replays a recorded session N times and reports whether the oracle outcome and
the request sequence are identical every time. This is the tool's own trust check.

Options:
  --session <file>          session to replay (required)
  --good <file>             passing session: enables factors; the replayed config starts all-observed
  --set <factor>=<v>        observed | neutral for one factor (id or label), or all=neutral (repeatable; needs --good)
  --runs <n>                replays (default 5)
  --base-url <url>          app origin (default: the session's)
  --allow-unmatched <glob>  let unrecorded requests matching glob hit the network (repeatable)
  --json                    machine-readable output

${ORACLE_HELP}

Example (PowerShell):
  cage verify examples/flows/checkout.ts --session sessions/bad.json --runs 20 --oracle examples/oracles/no-crash.ts`;

export async function verify(argv: string[]): Promise<number> {
  const a = parse(argv, { session: { type: 'string' }, good: { type: 'string' }, set: { type: 'string', multiple: true }, runs: { type: 'string' }, 'base-url': { type: 'string' }, 'allow-unmatched': { type: 'string', multiple: true }, json: { type: 'boolean' }, ...ORACLE_OPTIONS }, HELP);
  if (!a) return 0;
  const flow = await loadFlow(need(a.positionals[0], '<flow>', HELP));
  const session = await readJson<Session>(need(a.values.session, '--session', HELP), 'session');
  const runs = int(a.values.runs, '--runs', 5);
  const oracle = await buildOracle(oracleSpec(a.values));
  const baseURL = a.values['base-url'] ?? session.baseURL;
  const good = a.values.good ? await readJson<Session>(a.values.good, 'good session') : session;
  const ex = extractFactors(session, good);
  const on = selectConfig(ex.factors, a.values.set ?? []);
  if (a.values.good && !a.values.json) {
    console.log(`${ex.factors.length} factors (${on.length} observed):`);
    for (const f of ex.factors) console.log(`  ${on.includes(f.id) ? '[x]' : '[ ]'} ${f.id} ${f.label}`);
  }
  const applied = applyConfig(session, good, ex.pairs, ex.factors, { on });
  const browser = await chromium.launch();
  const outcomes: string[] = [];
  const seqs: string[] = [];
  try {
    for (let i = 0; i < runs; i++) {
      const r = makeReplayer(applied.plan, a.values['allow-unmatched'] ?? []);
      const out = await runFlow({ browser, baseURL, env: applied.env, storage: applied.storage, flow, oracle, apiGlobs: [], onApi: r.onApi, timeoutMs: 20_000 });
      const outcome = out.infraError || r.unmatched.length ? `ERROR` : out.failed ? 'FAIL' : 'PASS';
      outcomes.push(outcome);
      seqs.push(out.seqHash);
      if (!a.values.json) process.stdout.write(`\rrun ${i + 1}/${runs}: ${outcome}   `);
    }
  } finally {
    await browser.close();
  }
  const count = (xs: string[]) => [...new Set(xs)].map((x) => [x, xs.filter((y) => y === x).length] as const);
  const top = (xs: string[]) => Math.max(...count(xs).map(([, n]) => n));
  const report = {
    factors: ex.factors.length,
    observed: on.length,
    runs,
    outcomes: Object.fromEntries(count(outcomes)),
    outcomeConsistency: top(outcomes) / runs,
    distinctSeqHashes: new Set(seqs).size,
    seqConsistency: top(seqs) / runs,
  };
  if (a.values.json) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`\noutcomes: ${count(outcomes).map(([o, n]) => `${o} ${n}/${runs}`).join(', ')}`);
    console.log(`outcome consistency ${(report.outcomeConsistency * 100).toFixed(0)}%, request-sequence consistency ${(report.seqConsistency * 100).toFixed(0)}% (${report.distinctSeqHashes} distinct)`);
  }
  return report.outcomeConsistency === 1 && report.seqConsistency === 1 ? 0 : 1;
}

/** Start all-observed; apply --set entries in order. */
export function selectConfig(factors: Factor[], sets: string[]): string[] {
  const on = new Set(factors.map((f) => f.id));
  for (const s of sets) {
    const i = s.lastIndexOf('=');
    const [name, v] = [s.slice(0, i), s.slice(i + 1)];
    if (v !== 'observed' && v !== 'neutral') throw new UsageError(`--set ${s}: value must be observed or neutral`);
    const hit = name === 'all' ? factors : factors.filter((f) => f.id === name || f.label === name);
    if (!hit.length) throw new UsageError(`--set ${s}: no factor with id or label "${name}" (pass --good to get factors)`);
    for (const f of hit) {
      if (v === 'observed') on.add(f.id);
      else on.delete(f.id);
    }
  }
  return factors.filter((f) => on.has(f.id)).map((f) => f.id);
}
