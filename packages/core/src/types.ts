// Public types. Single source of truth for sessions, factors, configurations and results.
// The bundle JSON schema (packages/core/src/schema.ts) is derived from these shapes.

export const SCHEMA_VERSION = 1;

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

export interface Exchange {
  /** Index in the session's exchange list. */
  id: number;
  method: string;
  url: string;
  /** method + normalized URL (see normalizeUrl). */
  key: string;
  /** 0-based occurrence of `key` in the session. */
  nth: number;
  reqBodyHash: string | null;
  resourceType: string;
  status: number;
  headers: Record<string, string>;
  body: string;
  bodyEncoding: 'utf8' | 'base64';
  /** ms since flow start when the request reached the router. */
  startMs: number;
  /** measured upstream latency in ms. */
  latencyMs: number;
  /** ms since flow start when the response was handed to the page. */
  endMs: number;
}

export interface CookieState {
  name: string;
  value: string;
  domain?: string;
  path?: string;
}

export interface StorageSnapshot {
  cookies: CookieState[];
  localStorage: Record<string, string>;
  sessionStorage: Record<string, string>;
}

export interface EnvState {
  viewport: { width: number; height: number };
  locale: string;
  timezoneId: string;
  /** empty string = browser default */
  userAgent: string;
}

/** Initial state a flow starts from (the `--state` file of `cage record`). */
export interface InitialState extends Partial<EnvState> {
  cookies?: CookieState[];
  localStorage?: Record<string, string>;
  sessionStorage?: Record<string, string>;
}

export interface OracleOutcome {
  failed: boolean;
  reason?: string;
}

export interface Session {
  schemaVersion: number;
  label: string;
  baseURL: string;
  createdAt: string;
  env: EnvState;
  storageStart: StorageSnapshot;
  storageEnd: StorageSnapshot;
  exchanges: Exchange[];
  consoleErrors: string[];
  pageErrors: string[];
  oracle: OracleOutcome | null;
  seqHash: string;
  /** set when the session was synthesized by --synthesize-good */
  synthesized?: boolean;
}

/** What the oracle sees about one API exchange served during a run. */
export interface RecordedRequest {
  method: string;
  url: string;
  key: string;
  status: number;
  body: string;
}

export type FactorKind = 'body' | 'status' | 'header' | 'delay' | 'order' | 'presence' | 'storage' | 'cookie' | 'env';

/** Marker for "key absent" in body/storage/cookie/header values. */
export const ABSENT = { $absent: true } as const;
export type Absent = typeof ABSENT;
export type FactorValue = Json | Absent;

export interface Factor {
  id: string;
  kind: FactorKind;
  /** Human readable, stable identity, e.g. `body GET /api/cart customer.tax_id`. */
  label: string;
  /** Exchange alignment key (`key#nth`) for exchange-scoped kinds. */
  target?: string;
  /** Second exchange for `order` (observed order is target, then target2). */
  target2?: string;
  /** JSON path segments (body), key name (storage/cookie/header/env). */
  path?: (string | number)[];
  /** storage area for `storage` factors. */
  area?: 'localStorage' | 'sessionStorage';
  observed: FactorValue;
  neutral: FactorValue;
}

export interface FactorNode {
  id: string;
  label: string;
  children?: FactorNode[];
  /** leaf nodes reference exactly one factor */
  factor?: string;
}

/** Configuration = set of factor ids at `observed`; everything else neutral. `overrides` replaces a factor's value. */
export interface Configuration {
  on: string[];
  overrides?: Record<string, FactorValue>;
}

/** DIFFERENT_FAILURE: the run failed, but not with the bad session's failure signature. Never counts as reproducing. */
export type Decision = 'FAIL' | 'PASS' | 'ERROR' | 'UNRESOLVED' | 'DIFFERENT_FAILURE';

export type Phase = 'gate' | 'search' | 'verify' | 'table' | 'variant' | 'delay';

export interface ExperimentRecord {
  n: number;
  phase: Phase;
  key: string;
  /** '1'/'0' per factor, in factor order. */
  bits: string;
  overrides?: Record<string, FactorValue>;
  runs: number;
  fails: number;
  errors: number;
  /** failing runs whose signature differs from the target */
  different?: number;
  /** failing runs per normalized failure signature */
  failureSignatures?: Record<string, number>;
  decision: Decision;
  wallMs: number;
  seqHashes: string[];
  reason?: string;
}

export type Verdict = 'explained' | 'partial' | 'unexplained' | 'untrustworthy-oracle';
export type Structure = 'SINGLE' | 'AND' | 'OR' | 'OTHER';

/** runs = informative runs (no infrastructure error, no different failure); different = runs that failed differently */
export interface GateRates {
  allTrue: { runs: number; fails: number; different?: number };
  allFalse: { runs: number; fails: number; different?: number };
}

export interface TruthRow {
  /** factor ids (from truthTable.factors) observed in this row */
  on: string[];
  decision: Decision;
  runs: number;
  fails: number;
}

export interface VerificationRow {
  set: string[];
  /** factor removed, null = the full set */
  removed: string | null;
  runs: number;
  fails: number;
  ok: boolean;
}

export interface VariantProbe {
  factor: string;
  cls: string;
  value: FactorValue;
  decision: Decision;
}

export interface DelayCurve {
  factor: string;
  neutralMs: number;
  observedMs: number;
  thresholdMs: number | null;
  grid: { ms: number; runs: number; fails: number }[];
}

export interface Result {
  verdict: Verdict;
  reason: string;
  sentence: string;
  mode: 'deterministic' | 'statistical';
  singleSession: boolean;
  /** normalized signature of the bad session's failure; only runs matching it count as FAIL (null = any failure) */
  signature: string | null;
  looseOracle: boolean;
  gate: GateRates;
  factorCount: number;
  minimalSets: string[][];
  structure: Structure | null;
  truthTable: { factors: string[]; rows: TruthRow[] } | null;
  verification: VerificationRow[];
  variants: VariantProbe[];
  delayCurves: DelayCurve[];
  budget: { used: number; limit: number };
  wallMs: number;
  warnings: string[];
}

export interface Manifest {
  schemaVersion: number;
  toolVersion: string;
  createdAt: string;
  baseOrigin: string;
  flowHash: string;
  flowFile: string;
  oracle: OracleSpec;
  apiGlobs: string[];
  allowUnmatched: string[];
  freezeRandom: boolean;
  freezeTime: boolean;
  redaction: RedactionReport | null;
}

export interface OracleSpec {
  file?: string;
  failOnUncaught?: boolean;
  failOnConsole?: string[];
  failOnTextMissing?: string[];
  failOnSelectorMissing?: string[];
}

export interface RedactionReport {
  headers: number;
  keyed: number;
  emails: number;
  jwts: number;
  cards: number;
  urlParams: number;
}

export interface Bundle {
  manifest: Manifest;
  bad: Session;
  good: Session;
  factors: Factor[];
  tree: FactorNode;
  experiments: ExperimentRecord[];
  result: Result;
  flowSource: string;
  oracleSource: string | null;
}
