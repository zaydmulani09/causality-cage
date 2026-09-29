// Generates packages/core/schema/bundle.schema.json from packages/core/src/types.ts (the single source of truth).
// Usage: node --import tsx scripts/gen-schema.ts
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

export const TYPES_FILE = fileURLToPath(new URL('../packages/core/src/types.ts', import.meta.url));
export const SCHEMA_FILE = fileURLToPath(new URL('../packages/core/schema/bundle.schema.json', import.meta.url));
const ROOTS = ['Manifest', 'Session', 'Factor', 'FactorNode', 'ExperimentRecord', 'Result'];
/** recursive "any JSON" aliases: no useful constraint */
const OPAQUE = new Set(['Json', 'FactorValue']);

type Schema = Record<string, unknown>;

export function generateSchema(): Schema {
  const program = ts.createProgram([TYPES_FILE], { strict: true, target: ts.ScriptTarget.ES2022, noEmit: true, allowImportingTsExtensions: true });
  const checker = program.getTypeChecker();
  const defs: Record<string, Schema> = {};
  const queue = [...ROOTS];
  const byName = new Map<string, ts.Type>();
  ts.forEachChild(program.getSourceFile(TYPES_FILE)!, (n) => {
    if (ts.isInterfaceDeclaration(n)) byName.set(n.name.text, checker.getTypeAtLocation(n));
  });

  const conv = (t: ts.Type): Schema => {
    if (t.aliasSymbol && OPAQUE.has(t.aliasSymbol.name)) return {};
    const f = t.flags;
    if (f & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return {};
    if (t.isStringLiteral()) return { const: t.value };
    if (t.isNumberLiteral()) return { const: t.value };
    if (f & ts.TypeFlags.BooleanLiteral) return { const: (t as unknown as { intrinsicName: string }).intrinsicName === 'true' };
    if (f & ts.TypeFlags.String) return { type: 'string' };
    if (f & ts.TypeFlags.Number) return { type: 'number' };
    if (f & ts.TypeFlags.Boolean) return { type: 'boolean' };
    if (f & ts.TypeFlags.Null) return { type: 'null' };
    if (t.isUnion()) {
      const parts = t.types.filter((x) => !(x.flags & ts.TypeFlags.Undefined));
      if (parts.length && parts.every((x) => x.flags & ts.TypeFlags.BooleanLiteral)) return { type: 'boolean' };
      if (parts.every((x) => x.isStringLiteral())) return { enum: parts.map((x) => (x as ts.StringLiteralType).value) };
      const schemas = parts.map(conv);
      return schemas.length === 1 ? schemas[0]! : { anyOf: schemas };
    }
    if (checker.isArrayType(t)) return { type: 'array', items: conv(checker.getTypeArguments(t as ts.TypeReference)[0]!) };
    const name = t.getSymbol()?.getName();
    if (name && byName.has(name) && byName.get(name) === t) {
      if (!defs[name] && !queue.includes(name)) queue.push(name);
      return { $ref: `#/definitions/${name}` };
    }
    return objectSchema(t);
  };

  const objectSchema = (t: ts.Type): Schema => {
    const properties: Record<string, Schema> = {};
    const required: string[] = [];
    for (const p of checker.getPropertiesOfType(t)) {
      properties[p.name] = conv(stripUndefined(checker.getTypeOfSymbol(p)));
      if (!(p.flags & ts.SymbolFlags.Optional)) required.push(p.name);
    }
    const index = checker.getIndexInfoOfType(t, ts.IndexKind.String);
    const s: Schema = { type: 'object', properties, additionalProperties: index ? conv(index.type) : false };
    if (required.length) s.required = required;
    return s;
  };
  const stripUndefined = (t: ts.Type): ts.Type => (t.isUnion() && t.types.some((x) => x.flags & ts.TypeFlags.Undefined) ? checker.getNonNullableType(t) : t);

  while (queue.length) {
    const name = queue.shift()!;
    if (!defs[name]) defs[name] = objectSchema(byName.get(name)!);
  }
  const sorted = Object.fromEntries(Object.keys(defs).sort().map((k) => [k, defs[k]!]));
  return { $schema: 'http://json-schema.org/draft-07/schema#', title: 'cage bundle files', definitions: sorted };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  writeFileSync(SCHEMA_FILE, JSON.stringify(generateSchema(), null, 2) + '\n');
  console.log(`wrote ${SCHEMA_FILE}`);
}
