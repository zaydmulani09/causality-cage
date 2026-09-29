export const DEFAULT_VOLATILE_PARAMS = ['_', 'ts', 't', 'nonce', 'cacheBust'];
/** Secret-looking names. Such query params are left out of exchange keys, so keys never carry secrets. */
export const SECRET_KEY = /token|secret|password|passwd|session|auth|jwt|key/i;

/** Sort query params, drop volatile and secret-named ones, drop origin when it equals baseURL's origin. */
export function normalizeUrl(url: string, baseURL: string, volatile = DEFAULT_VOLATILE_PARAMS): string {
  const u = new URL(url, baseURL);
  const params = [...u.searchParams].filter(([k]) => !volatile.includes(k) && !SECRET_KEY.test(k));
  params.sort(([a, av], [b, bv]) => (a === b ? (av < bv ? -1 : av > bv ? 1 : 0) : a < b ? -1 : 1));
  const qs = params.length ? '?' + new URLSearchParams(params).toString() : '';
  const origin = u.origin === new URL(baseURL).origin ? '' : u.origin;
  return origin + u.pathname + qs;
}

export function exchangeKey(method: string, url: string, baseURL: string): string {
  return `${method.toUpperCase()} ${normalizeUrl(url, baseURL)}`;
}

/** Glob to RegExp: `**` any chars, `*` any chars but `/`, `?` one char. */
export function globToRegExp(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*';
        i++;
      } else re += '[^/]*';
    } else if (c === '?') re += '.';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

export function matchesAny(url: string, globs: string[]): boolean {
  return globs.some((g) => globToRegExp(g).test(url));
}
