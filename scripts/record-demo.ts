// Records launch/demo.{mp4,gif,png}: a real `cage explain` run on the demo bug (streamed into a terminal-styled page),
// then the real report with ?demo=1. The run itself is sped up (labelled on screen); the verdict and the report are real time.
// Needs `pnpm shop:build` and an ffmpeg binary: FFMPEG=<path> (e.g. from the ffmpeg-static npm package) or ffmpeg on PATH.
// Usage: node --import tsx scripts/record-demo.ts
import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import { REPO, startShop } from '../packages/bench/src/index.ts';

const SPEED = 12;
const FFMPEG = process.env.FFMPEG ?? 'ffmpeg';
const CLI = join(REPO, 'packages/cli/bin/cage.mjs');
const EXAMPLES = join(REPO, 'examples');
const OUT = join(REPO, 'launch');
const TMP = join(REPO, '.cage-out', 'demo-video');
const COMMAND = 'cage explain --flow flows/checkout.ts --oracle oracles/no-crash.ts --bad sessions/bad.json --good sessions/good.json';

function run(cmd: string, args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv; onData?: (s: string) => void } = {}): Promise<number> {
  return new Promise((res, rej) => {
    const p = spawn(cmd, args, { cwd: opts.cwd, env: { ...process.env, ...opts.env }, stdio: ['ignore', 'pipe', 'pipe'] });
    p.stdout.on('data', (d: Buffer) => (opts.onData ? opts.onData(d.toString()) : process.stdout.write(d)));
    p.stderr.on('data', (d: Buffer) => process.stderr.write(d));
    p.on('error', rej);
    p.on('exit', (code) => res(code ?? 1));
  });
}

const TERMINAL = `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;height:100%;background:#0f1115;color:#d7dae0;font:22px/1.5 'Cascadia Mono',Consolas,ui-monospace,monospace}
  #t{padding:28px 32px;white-space:pre-wrap;word-break:break-word}
  .p{color:#7ea2f0}.c31{color:#f2837a}.c32{color:#7cc795}.c33{color:#e8b85c}.c2{color:#7d828c}
  #badge{position:fixed;top:14px;right:18px;font:600 14px system-ui,sans-serif;color:#0f1115;background:#e8b85c;border-radius:6px;padding:3px 9px}
  .cur{display:inline-block;width:10px;height:1.1em;background:#d7dae0;vertical-align:text-bottom}
</style></head><body><div id="badge">${SPEED}x speed</div><div id="t"></div><script>
  const t = document.getElementById('t');
  let line = document.createElement('div'); t.append(line);
  let cls = '';
  window.typeCmd = async (prompt, cmd) => {
    line.innerHTML = '<span class="p">' + prompt + '</span>';
    const s = document.createElement('span'); line.append(s);
    for (const ch of cmd) { s.textContent += ch; await new Promise(r => setTimeout(r, 18)); }
    line = document.createElement('div'); t.append(line);
  };
  window.write = (chunk) => {
    const parts = chunk.split(/(\\x1b\\[[0-9;]*[mK]|\\r|\\n)/);
    for (const p of parts) {
      if (!p) continue;
      if (p === '\\n') { line = document.createElement('div'); t.append(line); }
      else if (p === '\\r') line.innerHTML = '';
      else if (p.startsWith('\\x1b[')) { if (p.endsWith('m')) { const n = p.slice(2, -1); cls = n === '0' || n === '' ? '' : 'c' + n; } }
      else { const s = document.createElement('span'); if (cls) s.className = cls; s.textContent = p; line.append(s); }
    }
    window.scrollTo(0, document.body.scrollHeight);
  };
</script></body></html>`;

async function main() {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
  mkdirSync(join(EXAMPLES, 'sessions'), { recursive: true });
  const bad = await startShop('demo', 'bad');
  const good = await startShop('demo', 'good');
  try {
    const rec = (url: string, label: string) =>
      run(process.execPath, [CLI, 'record', 'flows/checkout.ts', '--base-url', url, '--out', `sessions/${label}.json`, '--label', label, '--oracle', 'oracles/no-crash.ts'], { cwd: EXAMPLES });
    await rec(bad.url, 'bad');
    await rec(good.url, 'good');
    await good.stop();

    const browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, colorScheme: 'dark', recordVideo: { dir: TMP, size: { width: 1280, height: 720 } } });
    const page = await context.newPage();
    const t0 = Date.now();
    await page.setContent(TERMINAL);
    await page.waitForTimeout(600);
    await page.evaluate(([p, c]) => (window as unknown as { typeCmd: (a: string, b: string) => Promise<void> }).typeCmd(p!, c!), ['examples $ ', COMMAND]);
    let chain = Promise.resolve();
    const code = await run(process.execPath, [CLI, ...COMMAND.split(' ').slice(1)], {
      cwd: EXAMPLES,
      env: { CAGE_PROGRESS: '1' },
      onData: (s) => {
        process.stdout.write(s);
        chain = chain.then(() => page.evaluate((x) => (window as unknown as { write: (s: string) => void }).write(x), s));
      },
    });
    await chain;
    if (code !== 0) throw new Error(`cage explain exited ${code}`);
    const tDone = (Date.now() - t0) / 1000;
    await page.waitForTimeout(1800);
    const tSwitch = (Date.now() - t0) / 1000;
    await page.goto(pathToFileURL(join(EXAMPLES, 'result.html')).href + '?demo=1');
    await page.waitForTimeout(4400); // autoplay: toggles at 1-4 s
    await page.evaluate(() => document.getElementById('latency')?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    await page.waitForTimeout(5200); // autoplay: latency sweep at 5-9 s
    await context.close();
    await browser.close();

    const webm = join(TMP, readdirSync(TMP).find((f) => f.endsWith('.webm'))!);
    const mp4 = join(OUT, 'demo.mp4');
    mkdirSync(OUT, { recursive: true });
    const filter = `[0:v]trim=0:${tDone},setpts=(PTS-STARTPTS)/${SPEED}[a];[0:v]trim=${tDone},setpts=PTS-STARTPTS[b];[a][b]concat=n=2:v=1:a=0,fps=30[v]`;
    await run(FFMPEG, ['-y', '-loglevel', 'error', '-i', webm, '-filter_complex', filter, '-map', '[v]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '22', '-movflags', '+faststart', mp4]);
    const gifFilter = 'fps=12,scale=880:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128:stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle';
    await run(FFMPEG, ['-y', '-loglevel', 'error', '-i', mp4, '-vf', gifFilter, join(OUT, 'demo.gif')]);
    // poster: the report with FAILURE red, before the first toggle
    const poster = tDone / SPEED + (tSwitch - tDone) + 0.8;
    await run(FFMPEG, ['-y', '-loglevel', 'error', '-ss', poster.toFixed(2), '-i', mp4, '-frames:v', '1', join(OUT, 'demo.png')]);
    renameSync(webm, join(TMP, 'raw.webm'));
    for (const f of ['demo.mp4', 'demo.gif', 'demo.png']) console.log(`${f}: ${(statSync(join(OUT, f)).size / 1e6).toFixed(2)} MB`);
    console.log(`run ${tDone.toFixed(1)} s real → ${(tDone / SPEED).toFixed(1)} s; total ${(tDone / SPEED + (tSwitch - tDone) + 9.6).toFixed(1)} s`);
  } finally {
    await bad.stop();
    await good.stop();
  }
}

await main();
