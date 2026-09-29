// One flow execution in a fresh BrowserContext. Shared by record and replay.
import type { Browser, Request, Route } from 'playwright';
import { sha } from './hash.ts';
import type { FlowFn, OracleFn } from './oracle.ts';
import type { EnvState, RecordedRequest, StorageSnapshot } from './types.ts';
import { exchangeKey, matchesAny } from './url.ts';

export const DEFAULT_ENV: EnvState = { viewport: { width: 1280, height: 720 }, locale: 'en-US', timezoneId: 'UTC', userAgent: '' };
export const EMPTY_STORAGE: StorageSnapshot = { cookies: [], localStorage: {}, sessionStorage: {} };
const SEED_PATH = '/__cage_seed__';

export interface ApiCall {
  route: Route;
  request: Request;
  key: string;
  nth: number;
  /** ms since flow start */
  t: () => number;
  /** report what the page was served, for the oracle */
  served: (r: RecordedRequest) => void;
}

export interface RunInput {
  browser: Browser;
  baseURL: string;
  env: EnvState;
  storage: StorageSnapshot;
  flow: FlowFn;
  oracle: OracleFn | null;
  /** empty = every fetch/xhr request */
  apiGlobs: string[];
  onApi: (call: ApiCall) => Promise<void>;
  timeoutMs: number;
  freezeRandom?: boolean;
  freezeTime?: boolean;
  headed?: boolean;
}

export interface RunOutput {
  failed: boolean;
  reason?: string;
  /** infrastructure problem: the run says nothing about the app */
  infraError?: string;
  consoleErrors: string[];
  pageErrors: string[];
  requests: RecordedRequest[];
  seqHash: string;
  storageEnd: StorageSnapshot;
}

// Seeded Math.random (mulberry32).
const FREEZE_RANDOM = `(() => { let s = 0x2f6b1d; Math.random = () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();`;

export function isApiRequest(req: Request, apiGlobs: string[]): boolean {
  if (apiGlobs.length) return matchesAny(req.url(), apiGlobs);
  const t = req.resourceType();
  return t === 'fetch' || t === 'xhr';
}

export async function runFlow(input: RunInput): Promise<RunOutput> {
  const { browser, baseURL, env } = input;
  const origin = new URL(baseURL).origin;
  const context = await browser.newContext({
    serviceWorkers: 'block',
    viewport: env.viewport,
    locale: env.locale,
    timezoneId: env.timezoneId,
    ...(env.userAgent ? { userAgent: env.userAgent } : {}),
  });
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const requests: RecordedRequest[] = [];
  const seq: string[] = [];
  const counts = new Map<string, number>();
  let t0 = Date.now();
  try {
    if (input.storage.cookies.length) {
      await context.addCookies(
        input.storage.cookies.map((c) => (c.domain ? { name: c.name, value: c.value, domain: c.domain, path: c.path ?? '/' } : { name: c.name, value: c.value, url: origin })),
      );
    }
    if (input.freezeRandom) await context.addInitScript(FREEZE_RANDOM);
    const page = await context.newPage();
    if (input.freezeTime) await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
    page.setDefaultTimeout(Math.min(10_000, input.timeoutMs / 2));
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text());
    });
    page.on('pageerror', (e) => pageErrors.push(e.message));

    await page.route('**/*', async (route, request) => {
      if (request.url() === origin + SEED_PATH) return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>seed</title>' });
      if (!isApiRequest(request, input.apiGlobs)) return route.continue();
      const key = exchangeKey(request.method(), request.url(), baseURL);
      const nth = counts.get(key) ?? 0;
      counts.set(key, nth + 1);
      seq.push(key);
      try {
        await input.onApi({ route, request, key, nth, t: () => Date.now() - t0, served: (r) => requests.push(r) });
      } catch (e) {
        // page closed mid-flight at the end of a run: ignore
        if (!/closed|disposed/i.test((e as Error).message)) throw e;
      }
    });

    const { localStorage: ls, sessionStorage: ss } = input.storage;
    if (Object.keys(ls).length || Object.keys(ss).length) {
      await page.goto(origin + SEED_PATH);
      await page.evaluate(
        ([l, s]) => {
          for (const [k, v] of Object.entries(l)) window.localStorage.setItem(k, v);
          for (const [k, v] of Object.entries(s)) window.sessionStorage.setItem(k, v);
        },
        [ls, ss] as const,
      );
    }

    t0 = Date.now();
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<'timeout'>((r) => (timer = setTimeout(() => r('timeout'), input.timeoutMs)));
    const body = (async (): Promise<Omit<RunOutput, 'storageEnd' | 'seqHash' | 'consoleErrors' | 'pageErrors' | 'requests'>> => {
      try {
        await input.flow({ page, baseURL });
      } catch (e) {
        return { failed: true, reason: `flow threw: ${(e as Error).message.split('\n')[0]}` };
      }
      if (!input.oracle) return { failed: false };
      try {
        return await input.oracle({ page, consoleErrors, pageErrors, requests });
      } catch (e) {
        return { failed: false, infraError: `oracle threw: ${(e as Error).message.split('\n')[0]}` };
      }
    })();
    const out = await Promise.race([body, timeout]);
    clearTimeout(timer);
    if (out === 'timeout') {
      return { failed: false, infraError: `experiment exceeded ${input.timeoutMs} ms`, consoleErrors, pageErrors, requests, seqHash: sha(seq.join('\n')), storageEnd: EMPTY_STORAGE };
    }
    const storageEnd = await snapshot(page, context);
    return { ...out, consoleErrors, pageErrors, requests, seqHash: sha(seq.join('\n')), storageEnd };
  } finally {
    await context.close().catch(() => {});
  }
}

async function snapshot(page: import('playwright').Page, context: import('playwright').BrowserContext): Promise<StorageSnapshot> {
  const cookies = (await context.cookies()).map((c) => ({ name: c.name, value: c.value, domain: c.domain, path: c.path }));
  const { l, s } = await page
    .evaluate(() => ({ l: { ...window.localStorage }, s: { ...window.sessionStorage } }))
    .catch(() => ({ l: {}, s: {} }));
  return { cookies, localStorage: l, sessionStorage: s };
}
