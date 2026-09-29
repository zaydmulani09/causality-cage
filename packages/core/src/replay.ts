// Serves a precomputed Plan to the page: per exchange latency, order gates, fail-closed on unknown requests.
import type { ApiCall } from './run.ts';
import { matchesAny } from './url.ts';

export interface Served {
  status: number;
  headers: Record<string, string>;
  body: string;
  bodyEncoding: 'utf8' | 'base64';
  latencyMs: number;
  /** presence factor says this exchange does not exist: abort the request */
  abort?: boolean;
}

export interface Plan {
  /** by `key#nth` */
  responses: Map<string, Served>;
  /** `second` is released only after `first` was delivered */
  orders: { first: string; second: string }[];
}

export const ORDER_GAP_MS = 60;
const ORDER_WAIT_MAX_MS = 5_000;
const DROP_HEADERS = new Set(['content-length', 'content-encoding', 'transfer-encoding', 'connection', 'keep-alive']);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const target = (key: string, nth: number) => `${key}#${nth}`;

export function servingHeaders(h: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(h).filter(([k]) => !DROP_HEADERS.has(k.toLowerCase())));
}

export function makeReplayer(plan: Plan, allowUnmatched: string[] = []) {
  const unmatched: string[] = [];
  const delivered = new Map<string, { promise: Promise<void>; resolve: () => void }>();
  const gate = (t: string) => {
    let g = delivered.get(t);
    if (!g) {
      let resolve!: () => void;
      const promise = new Promise<void>((r) => (resolve = r));
      g = { promise, resolve };
      delivered.set(t, g);
    }
    return g;
  };

  async function onApi({ route, request, key, nth, served }: ApiCall): Promise<void> {
    const t = target(key, nth);
    const s = plan.responses.get(t);
    if (!s) {
      if (matchesAny(request.url(), allowUnmatched)) return route.continue();
      unmatched.push(t);
      await route.fulfill({ status: 599, contentType: 'text/plain', body: `cage: no recorded response for ${t}` });
      return;
    }
    if (s.abort) {
      gate(t).resolve();
      await route.abort('failed');
      return;
    }
    if (s.latencyMs > 0) await sleep(s.latencyMs);
    for (const o of plan.orders) {
      if (o.second !== t) continue;
      await Promise.race([gate(o.first).promise, sleep(ORDER_WAIT_MAX_MS)]);
      await sleep(ORDER_GAP_MS);
    }
    const body = Buffer.from(s.body, s.bodyEncoding);
    served({ method: request.method(), url: request.url(), key, status: s.status, body: s.bodyEncoding === 'utf8' ? s.body : '' });
    await route.fulfill({ status: s.status, headers: servingHeaders(s.headers), body });
    gate(t).resolve();
  }
  return { onApi, unmatched };
}
