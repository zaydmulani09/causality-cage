// Validates bundle files against schema/bundle.schema.json (generated from types.ts by scripts/gen-schema.ts).
// Supports the subset the generator emits: type, const, enum, anyOf, properties, required, additionalProperties, items, $ref.
import { readFileSync } from 'node:fs';

type Schema = {
  type?: string;
  const?: unknown;
  enum?: unknown[];
  anyOf?: Schema[];
  properties?: Record<string, Schema>;
  required?: string[];
  additionalProperties?: Schema | false;
  items?: Schema;
  $ref?: string;
};

const root = JSON.parse(readFileSync(new URL('../schema/bundle.schema.json', import.meta.url), 'utf8')) as { definitions: Record<string, Schema> };

function typeOf(v: unknown): string {
  return v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v;
}

function check(v: unknown, s: Schema, path: string, errs: string[]): void {
  if (errs.length > 20) return;
  if (s.$ref) return check(v, root.definitions[s.$ref.split('/').pop()!]!, path, errs);
  if ('const' in s && v !== s.const) return void errs.push(`${path}: expected ${JSON.stringify(s.const)}`);
  if (s.enum && !s.enum.includes(v)) return void errs.push(`${path}: expected one of ${s.enum.join(', ')}`);
  if (s.anyOf) {
    if (!s.anyOf.some((x) => validate(v, x).length === 0)) errs.push(`${path}: matches none of the allowed shapes`);
    return;
  }
  if (s.type && typeOf(v) !== s.type) return void errs.push(`${path}: expected ${s.type}, got ${typeOf(v)}`);
  if (s.type === 'array' && s.items) (v as unknown[]).forEach((x, i) => check(x, s.items!, `${path}[${i}]`, errs));
  if (s.type === 'object') {
    const o = v as Record<string, unknown>;
    for (const k of s.required ?? []) if (!(k in o)) errs.push(`${path}.${k}: missing`);
    for (const [k, x] of Object.entries(o)) {
      const ps = s.properties?.[k];
      if (ps) check(x, ps, `${path}.${k}`, errs);
      else if (s.additionalProperties === false) errs.push(`${path}.${k}: unexpected property`);
      else if (s.additionalProperties) check(x, s.additionalProperties, `${path}.${k}`, errs);
    }
  }
}

function validate(v: unknown, s: Schema, path = '$'): string[] {
  const errs: string[] = [];
  check(v, s, path, errs);
  return errs;
}

/** Errors for `value` against definition `name` (e.g. 'Session'); empty = valid. */
export function validateAgainst(name: string, value: unknown): string[] {
  const def = root.definitions[name];
  if (!def) throw new Error(`no schema definition ${name}`);
  return validate(value, def);
}
