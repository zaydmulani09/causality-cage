// Builds the publishable `causality-cage` package into dist-npm/: one esbuild bundle of the CLI (workspace
// packages inlined) plus the files it reads at runtime. Usage: node scripts/build-npm.mjs, then npm publish dist-npm
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';

const out = 'dist-npm';
const cli = JSON.parse(await readFile('packages/cli/package.json', 'utf8'));
await rm(out, { recursive: true, force: true });
await mkdir(`${out}/bin`, { recursive: true });

await build({
  entryPoints: ['packages/cli/src/main.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: `${out}/bin/cage.mjs`,
  external: ['playwright', 'tsx', 'tsx/*', 'fflate'],
  banner: { js: '#!/usr/bin/env node' },
  legalComments: 'none',
});

// runtime reads, at the same relative paths as in the source tree
await cp('packages/report/src/style.css', `${out}/bin/style.css`);
await cp('packages/report/src/client.js', `${out}/bin/client.js`);
await cp('packages/core/schema', `${out}/schema`, { recursive: true });
await cp('packages/bench/ground-truth.json', `${out}/ground-truth.json`);
await cp('LICENSE', `${out}/LICENSE`);
await cp('README.md', `${out}/README.md`);

const repo = 'https://github.com/zaydmulani09/causality-cage';
await writeFile(
  `${out}/package.json`,
  JSON.stringify(
    {
      name: 'causality-cage',
      version: cli.version,
      description: cli.description,
      keywords: ['debugging', 'delta-debugging', 'playwright', 'root-cause', 'flaky-tests', 'counterfactual', 'browser-testing'],
      license: 'MIT',
      author: 'Zayd Mulani',
      homepage: `${repo}#readme`,
      repository: { type: 'git', url: `git+${repo}.git` },
      bugs: { url: `${repo}/issues` },
      type: 'module',
      bin: { cage: 'bin/cage.mjs' },
      files: ['bin', 'schema', 'ground-truth.json'],
      engines: { node: '>=20.16' },
      dependencies: { fflate: '^0.8.2', playwright: '^1.60.0', tsx: '^4.20.6' },
    },
    null,
    2,
  ) + '\n',
);
console.log(`built ${out}/ (causality-cage@${cli.version})`);
