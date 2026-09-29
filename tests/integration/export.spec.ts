// M5 gate: bundle round trip on real data, and the exported regression test fails against BUG=B1, passes against BUG=none.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { chromium, expect, test } from '@playwright/test';
import { FLOW, loadCases, recordCase, REPO, startShop } from '../../packages/bench/src/index.ts';
import { assembleBundle, buildOracle, explain, exportTest, loadFlow, loadSource, packBundle, sha, unpackBundle } from '../../packages/core/src/index.ts';

test('exported test fails on the bug and passes on the fix', async () => {
  const c = loadCases().find((x) => x.id === 'B1')!;
  const browser = await chromium.launch();
  const recorded = await recordCase(c, browser);
  const bugShop = await startShop('B1', 'bad');
  const fixedShop = await startShop('none', 'bad');
  try {
    const out = await explain({ browser, baseURL: bugShop.url, flow: await loadFlow(FLOW), oracle: await buildOracle(c.oracle), ...recorded });
    expect(out.result.verdict).toBe('explained');
    const flowSource = await loadSource(FLOW);
    const bundle = assembleBundle({
      out,
      ...recorded,
      manifest: { toolVersion: 'test', baseOrigin: bugShop.url, flowHash: sha(flowSource), flowFile: FLOW, oracle: c.oracle, apiGlobs: [], allowUnmatched: [], freezeRandom: false, freezeTime: false },
      flowSource,
      oracleSource: await loadSource(c.oracle.file!),
      redact: true,
    });
    expect(unpackBundle(packBundle(bundle, '<html></html>')).bundle).toEqual(bundle);

    mkdirSync(join(REPO, '.cage-out'), { recursive: true });
    const dir = mkdtempSync(join(REPO, '.cage-out', 'export-'));
    for (const [p, content] of Object.entries(exportTest(bundle))) {
      mkdirSync(dirname(join(dir, p)), { recursive: true });
      writeFileSync(join(dir, p), content);
    }
    const run = (url: string) => spawnSync('npx playwright test', { cwd: dir, env: { ...process.env, CAGE_BASE_URL: url }, shell: true, encoding: 'utf8' });
    const onBug = run(bugShop.url);
    expect(onBug.status, onBug.stdout).not.toBe(0);
    expect(onBug.stdout).toContain('the failure still reproduces');
    const onFix = run(fixedShop.url);
    expect(onFix.status, onFix.stdout).toBe(0);
  } finally {
    await Promise.all([bugShop.stop(), fixedShop.stop()]);
    await browser.close();
  }
});
