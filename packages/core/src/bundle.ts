// .cage bundle = zip. Layout and schema: docs/bundle-format.md.
import { readFile, writeFile } from 'node:fs/promises';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { Explained } from './explain.ts';
import { exportTest } from './export.ts';
import { redact } from './redact.ts';
import { validateAgainst } from './schema.ts';
import { SCHEMA_VERSION, type Bundle, type ExperimentRecord, type Factor, type FactorNode, type Manifest, type Result, type Session } from './types.ts';

const j = (v: unknown) => JSON.stringify(v, null, 2);

export function packBundle(b: Bundle, reportHtml: string): Uint8Array {
  const files: Record<string, string> = {
    'manifest.json': j(b.manifest),
    'sessions/bad.json': j(b.bad),
    [b.good.synthesized ? 'sessions/good.synthesized.json' : 'sessions/good.json']: j(b.good),
    'factors.json': j({ factors: b.factors, tree: b.tree }),
    'experiments.jsonl': b.experiments.map((e) => JSON.stringify(e)).join('\n') + '\n',
    'result.json': j(b.result),
    'report.html': reportHtml,
  };
  for (const [p, c] of Object.entries(exportTest(b))) files[`repro/${p}`] = c;
  // flow/oracle sources are also kept verbatim for `cage repro`
  files['repro/flow.ts'] = b.flowSource;
  if (b.oracleSource) files['repro/oracle.ts'] = b.oracleSource;
  return zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])), { level: 6, mtime: new Date(b.manifest.createdAt) });
}

export async function writeBundle(path: string, b: Bundle, reportHtml: string): Promise<void> {
  await writeFile(path, packBundle(b, reportHtml));
}

export class BundleError extends Error {}

export function unpackBundle(bytes: Uint8Array): { bundle: Bundle; files: Record<string, string> } {
  let raw: Record<string, Uint8Array>;
  try {
    raw = unzipSync(bytes);
  } catch {
    throw new BundleError('not a .cage bundle (zip could not be read)');
  }
  const files = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, strFromU8(v)]));
  const need = (p: string) => {
    const s = files[p];
    if (s === undefined) throw new BundleError(`bundle is missing ${p}`);
    return s;
  };
  const parse = <T>(p: string, def: string): T => {
    let v: unknown;
    try {
      v = JSON.parse(need(p));
    } catch (e) {
      throw new BundleError(`${p} is not valid JSON: ${(e as Error).message}`);
    }
    const errs = validateAgainst(def, v);
    if (errs.length) throw new BundleError(`${p} does not match the ${def} schema:\n  ${errs.slice(0, 5).join('\n  ')}`);
    return v as T;
  };
  const manifest = parse<Manifest>('manifest.json', 'Manifest');
  if (manifest.schemaVersion !== SCHEMA_VERSION) throw new BundleError(`bundle schemaVersion ${manifest.schemaVersion}, this cage reads ${SCHEMA_VERSION}`);
  const goodPath = files['sessions/good.json'] !== undefined ? 'sessions/good.json' : 'sessions/good.synthesized.json';
  const fj = JSON.parse(need('factors.json')) as { factors: Factor[]; tree: FactorNode };
  const ferr = [...fj.factors.flatMap((f) => validateAgainst('Factor', f)), ...validateAgainst('FactorNode', fj.tree)];
  if (ferr.length) throw new BundleError(`factors.json does not match the schema:\n  ${ferr.slice(0, 5).join('\n  ')}`);
  const experiments = need('experiments.jsonl')
    .split('\n')
    .filter(Boolean)
    .map((l, i) => {
      const e = JSON.parse(l) as ExperimentRecord;
      const errs = validateAgainst('ExperimentRecord', e);
      if (errs.length) throw new BundleError(`experiments.jsonl line ${i + 1}: ${errs[0]}`);
      return e;
    });
  const bundle: Bundle = {
    manifest,
    bad: parse<Session>('sessions/bad.json', 'Session'),
    good: parse<Session>(goodPath, 'Session'),
    factors: fj.factors,
    tree: fj.tree,
    experiments,
    result: parse<Result>('result.json', 'Result'),
    flowSource: need('repro/flow.ts'),
    oracleSource: files['repro/oracle.ts'] ?? null,
  };
  return { bundle, files };
}

export async function readBundle(path: string): Promise<{ bundle: Bundle; files: Record<string, string> }> {
  let bytes: Uint8Array;
  try {
    bytes = await readFile(path);
  } catch {
    throw new BundleError(`cannot read bundle "${path}": file not found`);
  }
  return unpackBundle(bytes);
}

export interface AssembleOptions {
  out: Explained;
  bad: Session;
  good: Session;
  manifest: Omit<Manifest, 'schemaVersion' | 'createdAt' | 'redaction'>;
  flowSource: string;
  oracleSource: string | null;
  redact: boolean;
  redactAllow?: string[];
}

/** Explain output → Bundle, redacted unless disabled. */
export function assembleBundle(o: AssembleOptions): Bundle {
  const raw = { bad: o.bad, good: o.good, factors: o.out.factors, tree: o.out.tree, experiments: o.out.experiments, result: o.out.result };
  const { data, report } = o.redact ? redact(raw, o.redactAllow) : { data: raw, report: null };
  return {
    manifest: { schemaVersion: SCHEMA_VERSION, createdAt: new Date().toISOString(), ...o.manifest, redaction: report },
    ...data,
    flowSource: o.flowSource,
    oracleSource: o.oracleSource,
  };
}
