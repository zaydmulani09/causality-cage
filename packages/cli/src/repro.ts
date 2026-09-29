import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { align, applyConfig, buildOracle, exportTest, loadFlow, makeReplayer, readBundle, runFlow, selectConfig, sha, type Bundle, type OracleSpec } from '@causality-cage/core';
import { int, need, parse, UsageError } from './args.ts';

/** Flow/oracle paths for a bundle: the original files if unchanged, else the copies stored in the bundle. */
async function sources(b: Bundle): Promise<{ flowFile: string; oracle: OracleSpec }> {
  const m = b.manifest;
  let tmp: string | undefined;
  const dir = async () => (tmp ??= await mkdtemp(join(tmpdir(), 'cage-repro-')));
  let flowFile = m.flowFile;
  if (!existsSync(flowFile) || sha(readFileSync(flowFile, 'utf8')) !== m.flowHash) {
    flowFile = join(await dir(), 'flow.ts');
    await writeFile(flowFile, b.flowSource);
    console.error(`note: ${m.flowFile} changed or missing; using the flow stored in the bundle (relative imports in it will not resolve)`);
  }
  const oracle = { ...m.oracle };
  if (oracle.file && !existsSync(oracle.file) && b.oracleSource) {
    oracle.file = join(await dir(), 'oracle.ts');
    await writeFile(oracle.file, b.oracleSource);
  }
  return { flowFile, oracle };
}

const REPRO_HELP = `cage repro <result.cage> [options]

Replays the bundle's minimal failing configuration once and prints the outcome.

Options:
  --set <factor>=<observed|neutral>   flip a factor (id, label, or all) on top of the minimal set (repeatable)
  --runs <n>                          replays (default 1)
  --base-url <url>                    app origin (default: the bundle's)
  --headed                            show the browser

Example (PowerShell):
  cage repro result.cage
  cage repro result.cage --set f3=neutral --headed`;

export async function repro(argv: string[]): Promise<number> {
  const a = parse(argv, { set: { type: 'string', multiple: true }, runs: { type: 'string' }, 'base-url': { type: 'string' }, headed: { type: 'boolean' } }, REPRO_HELP);
  if (!a) return 0;
  const { bundle: b } = await readBundle(need(a.positionals[0], '<result.cage>', REPRO_HELP));
  const { flowFile, oracle: spec } = await sources(b);
  const flow = await loadFlow(flowFile);
  const oracle = await buildOracle(spec);
  let on: string[];
  try {
    on = selectConfig(b.factors, b.result.minimalSets[0] ?? b.factors.map((f) => f.id), a.values.set ?? []);
  } catch (e) {
    throw new UsageError((e as Error).message);
  }
  const label = new Map(b.factors.map((f) => [f.id, f.label]));
  console.log(`observed (${on.length}/${b.factors.length}): ${on.map((id) => label.get(id)).join(', ') || 'none (all neutral)'}`);
  const applied = applyConfig(b.bad, b.good, align(b.bad, b.good), b.factors, { on });
  const browser = await chromium.launch({ headless: !a.values.headed });
  try {
    for (let i = 0; i < int(a.values.runs, '--runs', 1); i++) {
      const r = makeReplayer(applied.plan, b.manifest.allowUnmatched);
      const out = await runFlow({ browser, baseURL: a.values['base-url'] ?? b.manifest.baseOrigin, env: applied.env, storage: applied.storage, flow, oracle, apiGlobs: b.manifest.apiGlobs, onApi: r.onApi, timeoutMs: 30_000, freezeRandom: b.manifest.freezeRandom, freezeTime: b.manifest.freezeTime });
      const outcome = out.infraError ? `ERROR (${out.infraError})` : r.unmatched.length ? `ERROR (unmatched ${r.unmatched[0]})` : out.failed ? `FAIL (${out.reason})` : 'PASS';
      console.log(`run ${i + 1}: ${outcome}`);
    }
  } finally {
    await browser.close();
  }
  return 0;
}

const EXPORT_HELP = `cage export-test <result.cage> --out <dir> [--expect fixed|broken]

Writes a standalone Playwright test that replays the minimal failing configuration
from fixtures. It needs only @playwright/test, not cage.

  --expect fixed    (default) the test asserts the oracle passes: it fails today and passes once the bug is fixed
  --expect broken   the test asserts the bug still reproduces (documents a known bug)

Example (PowerShell):
  cage export-test result.cage --out repro
  cd repro; $env:CAGE_BASE_URL = "http://127.0.0.1:5173"; npx playwright test`;

export async function exportTestCmd(argv: string[]): Promise<number> {
  const a = parse(argv, { out: { type: 'string' }, expect: { type: 'string' } }, EXPORT_HELP);
  if (!a) return 0;
  const { bundle: b } = await readBundle(need(a.positionals[0], '<result.cage>', EXPORT_HELP));
  const out = need(a.values.out, '--out', EXPORT_HELP);
  const expect = a.values.expect ?? 'fixed';
  if (expect !== 'fixed' && expect !== 'broken') throw new UsageError(`--expect must be fixed or broken, got "${expect}"`);
  for (const [p, content] of Object.entries(exportTest(b, expect))) {
    const file = join(out, p);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, content);
  }
  console.log(`wrote ${resolve(out)}\nrun (PowerShell):  cd ${out}; $env:CAGE_BASE_URL = "${b.manifest.baseOrigin}"; npx playwright test`);
  return 0;
}
