import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { parseArgs, type ParseArgsConfig } from 'node:util';
import type { OracleSpec } from '@causality-cage/core';

type Options = NonNullable<ParseArgsConfig['options']>;

export const ORACLE_OPTIONS = {
  oracle: { type: 'string' },
  'fail-on-uncaught': { type: 'boolean' },
  'fail-on-console': { type: 'string', multiple: true },
  'fail-on-text-missing': { type: 'string', multiple: true },
  'fail-on-selector-missing': { type: 'string', multiple: true },
} as const satisfies Options;

export const ORACLE_HELP = `Oracle (combined with OR; at least one required):
  --oracle <file>                  module: export default async ({ page, consoleErrors, pageErrors, requests }) => ({ failed, reason })
  --fail-on-uncaught               fail on any uncaught page error
  --fail-on-console <regex>        fail when a console error matches (repeatable)
  --fail-on-text-missing <text>    fail when body text lacks <text> after the flow (repeatable)
  --fail-on-selector-missing <css> fail when no element matches after the flow (repeatable)`;

export class UsageError extends Error {}

export function parse<O extends Options>(argv: string[], options: O, help: string) {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(help);
    return null;
  }
  try {
    return parseArgs({ args: argv, options: { ...options, debug: { type: 'boolean' } }, allowPositionals: true, allowNegative: true, strict: true });
  } catch (e) {
    throw new UsageError(`${(e as Error).message}\n\n${help}`);
  }
}

export function oracleSpec(v: Record<string, unknown>): OracleSpec {
  const spec: OracleSpec = {};
  if (typeof v.oracle === 'string') spec.file = v.oracle;
  if (v['fail-on-uncaught']) spec.failOnUncaught = true;
  const list = (k: string) => (Array.isArray(v[k]) ? (v[k] as string[]) : undefined);
  if (list('fail-on-console')) spec.failOnConsole = list('fail-on-console');
  if (list('fail-on-text-missing')) spec.failOnTextMissing = list('fail-on-text-missing');
  if (list('fail-on-selector-missing')) spec.failOnSelectorMissing = list('fail-on-selector-missing');
  return spec;
}

export function need<T>(value: T | undefined, what: string, help: string): T {
  if (value === undefined || value === '') throw new UsageError(`missing ${what}\n\n${help}`);
  return value;
}

export async function readJson<T>(file: string, what: string): Promise<T> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch {
    throw new Error(`cannot read ${what} "${file}": file not found`);
  }
  try {
    return JSON.parse(text) as T;
  } catch (e) {
    throw new Error(`${what} "${file}" is not valid JSON: ${(e as Error).message}`);
  }
}

export function int(v: unknown, what: string, dflt: number): number {
  if (v === undefined) return dflt;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw new UsageError(`${what} must be a positive integer, got "${String(v)}"`);
  return n;
}

/** Open a file in the default browser/app. Best effort. */
export function openFile(path: string): void {
  const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', path]] : process.platform === 'darwin' ? ['open', [path]] : ['xdg-open', [path]];
  spawn(cmd, args as string[], { stdio: 'ignore', detached: true, windowsVerbatimArguments: process.platform === 'win32' }).unref();
}

export const TOOL_VERSION = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version;
