// Renders launch/og.png (1200x630) from a real report: the causal graph SVG is taken verbatim from
// examples/result.html (written by scripts/record-demo.ts or scripts/demo.*), with the report's own CSS.
// Usage: node --import tsx scripts/render-og.ts [report.html]
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import { REPO } from '../packages/bench/src/index.ts';

const report = process.argv[2] ?? join(REPO, 'examples', 'result.html');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, colorScheme: 'dark' });
await page.goto(pathToFileURL(report).href);
const { css, svg } = await page.evaluate(() => ({
  css: document.querySelector('style')!.textContent!,
  svg: document.querySelector('.graph-wide')!.outerHTML,
}));
await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${css}
  body { margin: 0; width: 1200px; height: 630px; display: flex; flex-direction: column; justify-content: center; padding: 0 64px; box-sizing: border-box; }
  .name { font: 700 44px ui-monospace, 'Cascadia Mono', Consolas, monospace; color: var(--fg); margin: 0; }
  .pitch { font: 26px/1.35 system-ui, sans-serif; color: var(--muted); margin: 10px 0 34px; max-width: 1040px; }
  .card { padding: 22px 26px; }
  .graph { max-width: 1072px; }
</style></head><body>
  <p class="name">causality-cage</p>
  <p class="pitch">Replays a failing browser session with conditions flipped and finds the minimal set that causes the bug.</p>
  <div class="card">${svg}</div>
</body></html>`);
await page.screenshot({ path: join(REPO, 'launch', 'og.png') });
await browser.close();
console.log('wrote launch/og.png');
