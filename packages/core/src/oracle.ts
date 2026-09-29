import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Page } from 'playwright';
import { tsImport } from 'tsx/esm/api';
import type { OracleOutcome, OracleSpec, RecordedRequest } from './types.ts';

export interface FlowContext {
  page: Page;
  baseURL: string;
}
export type FlowFn = (ctx: FlowContext) => Promise<void>;

export interface OracleContext {
  page: Page;
  consoleErrors: string[];
  pageErrors: string[];
  requests: RecordedRequest[];
}
export type OracleFn = (ctx: OracleContext) => Promise<OracleOutcome>;

async function importDefault<T>(file: string, what: string): Promise<T> {
  const abs = resolve(file);
  let mod: { default?: unknown };
  try {
    mod = (await tsImport(pathToFileURL(abs).href, import.meta.url)) as { default?: unknown };
  } catch (e) {
    throw new Error(`could not load ${what} ${abs}: ${(e as Error).message.split('\n')[0]}`);
  }
  // tsx may wrap CJS-shaped modules one level deeper.
  let fn = mod.default;
  if (fn && typeof fn === 'object' && 'default' in fn) fn = (fn as { default: unknown }).default;
  if (typeof fn !== 'function') throw new Error(`${what} ${abs} must \`export default async function\``);
  return fn as T;
}

export const loadFlow = (file: string) => importDefault<FlowFn>(file, 'flow');

export async function loadSource(file: string): Promise<string> {
  return readFile(resolve(file), 'utf8');
}

export function hasOracle(spec: OracleSpec): boolean {
  return !!(spec.file || spec.failOnUncaught || spec.failOnConsole?.length || spec.failOnTextMissing?.length || spec.failOnSelectorMissing?.length);
}

/** Built-in flags and the oracle file, combined with OR. */
export async function buildOracle(spec: OracleSpec): Promise<OracleFn> {
  if (!hasOracle(spec)) throw new Error('no oracle: pass --oracle <file> or a --fail-on-* flag');
  const fileOracle = spec.file ? await importDefault<OracleFn>(spec.file, 'oracle') : null;
  const consoleRes = (spec.failOnConsole ?? []).map((r) => new RegExp(r));
  return async (ctx) => {
    const reasons: string[] = [];
    if (spec.failOnUncaught && ctx.pageErrors.length) reasons.push(`uncaught: ${ctx.pageErrors[0]}`);
    for (const re of consoleRes) {
      const hit = ctx.consoleErrors.find((m) => re.test(m));
      if (hit) reasons.push(`console: ${hit}`);
    }
    if (spec.failOnTextMissing?.length) {
      const text = await ctx.page.locator('body').innerText();
      for (const t of spec.failOnTextMissing) if (!text.includes(t)) reasons.push(`text missing: ${t}`);
    }
    for (const css of spec.failOnSelectorMissing ?? []) {
      if ((await ctx.page.locator(css).count()) === 0) reasons.push(`selector missing: ${css}`);
    }
    if (fileOracle) {
      const r = await fileOracle(ctx);
      if (r.failed) reasons.push(r.reason ?? 'oracle reported failure');
    }
    return reasons.length ? { failed: true, reason: reasons.join('; ') } : { failed: false };
  };
}
