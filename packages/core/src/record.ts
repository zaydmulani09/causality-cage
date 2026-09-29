import type { Browser } from 'playwright';
import { sha } from './hash.ts';
import type { FlowFn, OracleFn } from './oracle.ts';
import { DEFAULT_ENV, runFlow } from './run.ts';
import { SCHEMA_VERSION, type Exchange, type InitialState, type Session } from './types.ts';

const TEXTY = /json|text|javascript|xml|x-www-form-urlencoded|svg/i;

export interface RecordOptions {
  browser: Browser;
  baseURL: string;
  flow: FlowFn;
  oracle: OracleFn | null;
  label: string;
  state?: InitialState;
  apiGlobs?: string[];
  timeoutMs?: number;
}

export function stateToSession(state: InitialState = {}) {
  return {
    env: {
      viewport: state.viewport ?? DEFAULT_ENV.viewport,
      locale: state.locale ?? DEFAULT_ENV.locale,
      timezoneId: state.timezoneId ?? DEFAULT_ENV.timezoneId,
      userAgent: state.userAgent ?? DEFAULT_ENV.userAgent,
    },
    storage: { cookies: state.cookies ?? [], localStorage: state.localStorage ?? {}, sessionStorage: state.sessionStorage ?? {} },
  };
}

export async function recordSession(o: RecordOptions): Promise<Session> {
  const { env, storage } = stateToSession(o.state);
  const exchanges: Exchange[] = [];
  const out = await runFlow({
    browser: o.browser,
    baseURL: o.baseURL,
    env,
    storage,
    flow: o.flow,
    oracle: o.oracle,
    apiGlobs: o.apiGlobs ?? [],
    timeoutMs: o.timeoutMs ?? 30_000,
    onApi: async ({ route, request, key, nth, t, served }) => {
      const post = request.postDataBuffer();
      const ex: Exchange = {
        id: exchanges.length,
        method: request.method(),
        url: request.url(),
        key,
        nth,
        reqBodyHash: post ? sha(post) : null,
        resourceType: request.resourceType(),
        status: 0,
        headers: {},
        body: '',
        bodyEncoding: 'utf8',
        startMs: t(),
        latencyMs: 0,
        endMs: 0,
      };
      exchanges.push(ex);
      const started = Date.now();
      const res = await route.fetch();
      const buf = await res.body();
      ex.latencyMs = Date.now() - started;
      ex.status = res.status();
      ex.headers = res.headers();
      const texty = TEXTY.test(ex.headers['content-type'] ?? '');
      ex.body = texty ? buf.toString('utf8') : buf.toString('base64');
      ex.bodyEncoding = texty ? 'utf8' : 'base64';
      ex.endMs = t();
      served({ method: ex.method, url: ex.url, key, status: ex.status, body: texty ? ex.body : '' });
      await route.fulfill({ response: res, body: buf });
    },
  });
  if (out.infraError) throw new Error(`recording failed: ${out.infraError}`);
  return {
    schemaVersion: SCHEMA_VERSION,
    label: o.label,
    baseURL: o.baseURL,
    createdAt: new Date().toISOString(),
    env,
    storageStart: storage,
    storageEnd: out.storageEnd,
    exchanges,
    consoleErrors: out.consoleErrors,
    pageErrors: out.pageErrors,
    oracle: o.oracle ? { failed: out.failed, ...(out.reason ? { reason: out.reason } : {}) } : null,
    seqHash: out.seqHash,
  };
}
