import { writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { buildOracle, hasOracle, loadFlow, recordSession, type InitialState } from '@causality-cage/core';
import { need, ORACLE_HELP, ORACLE_OPTIONS, oracleSpec, parse, readJson } from './args.ts';

const HELP = `cage record <flow> --base-url <url> --out <session.json> [options]

Runs <flow> once against the live app and records every fetch/xhr exchange,
the initial storage, and the environment.

Options:
  --base-url <url>   app origin, e.g. http://127.0.0.1:5173 (required)
  --out <file>       session JSON to write (required)
  --label <name>     bad | good (default: bad)
  --state <file>     initial state JSON: { cookies, localStorage, sessionStorage, viewport, locale, timezoneId, userAgent }
  --api <glob>       intercept only URLs matching glob (repeatable; default: all fetch/xhr)
  --headed           show the browser

${ORACLE_HELP}
  (oracle optional here: when given, the outcome is stored in the session)

Examples (PowerShell):
  cage record examples/flows/checkout.ts --base-url http://127.0.0.1:5173 --out sessions/bad.json --label bad --oracle examples/oracles/no-crash.ts
  cage record examples/flows/checkout.ts --base-url http://127.0.0.1:5173 --out sessions/good.json --label good --state examples/shop/states/b2-good.json`;

export async function record(argv: string[]): Promise<number> {
  const a = parse(argv, { 'base-url': { type: 'string' }, out: { type: 'string' }, label: { type: 'string' }, state: { type: 'string' }, api: { type: 'string', multiple: true }, headed: { type: 'boolean' }, ...ORACLE_OPTIONS }, HELP);
  if (!a) return 0;
  const flowFile = need(a.positionals[0], '<flow>', HELP);
  const baseURL = need(a.values['base-url'], '--base-url', HELP);
  const out = need(a.values.out, '--out', HELP);
  const spec = oracleSpec(a.values);
  const state = a.values.state ? await readJson<InitialState>(a.values.state, 'state file') : undefined;
  const flow = await loadFlow(flowFile);
  const oracle = hasOracle(spec) ? await buildOracle(spec) : null;
  const browser = await chromium.launch({ headless: !a.values.headed });
  try {
    const s = await recordSession({ browser, baseURL, flow, oracle, label: a.values.label ?? 'bad', state, apiGlobs: a.values.api ?? [] });
    await writeFile(out, JSON.stringify(s, null, 2));
    const outcome = s.oracle ? (s.oracle.failed ? `FAIL (${s.oracle.reason})` : 'PASS') : 'not evaluated';
    console.log(`recorded ${s.exchanges.length} API exchanges → ${out}\noracle: ${outcome}`);
    if (!s.exchanges.length) console.log('warning: no fetch/xhr requests seen. Is --base-url right? Use --api <glob> for other request types.');
  } finally {
    await browser.close();
  }
  return 0;
}
