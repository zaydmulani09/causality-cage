// Checks every markdown link in the given files: relative targets must exist, http(s) targets must answer < 400.
// Usage: node scripts/check-links.mjs README.md docs/*.md
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

let bad = 0;
for (const file of process.argv.slice(2)) {
  const text = readFileSync(file, 'utf8').replace(/```[\s\S]*?```/g, '');
  for (const [, target] of text.matchAll(/\]\(([^)\s]+)\)/g)) {
    const [path] = target.split('#');
    let ok;
    if (/^https?:/.test(target)) {
      const res = await fetch(target, { redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0 (link check)' } }).catch((e) => ({ status: String(e.cause?.code ?? e.message) }));
      ok = typeof res.status === 'number' && res.status < 400;
      console.log(`${ok ? 'ok ' : 'BAD'} ${res.status} ${target}`);
    } else {
      ok = !path || existsSync(resolve(dirname(file), path));
      console.log(`${ok ? 'ok ' : 'BAD'} file ${target}`);
    }
    if (!ok) bad++;
  }
}
process.exit(bad ? 1 : 0);
