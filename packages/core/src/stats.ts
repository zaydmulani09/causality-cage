// Wald's sequential probability ratio test for a Bernoulli fail rate. Pure.
export const SPRT = { p0: 0.2, p1: 0.8, alpha: 0.05, beta: 0.05, maxRuns: 12 };

export function sprt(fails: number, runs: number, o = SPRT): 'FAIL' | 'PASS' | 'CONTINUE' {
  const llr = fails * Math.log(o.p1 / o.p0) + (runs - fails) * Math.log((1 - o.p1) / (1 - o.p0));
  if (llr >= Math.log((1 - o.beta) / o.alpha)) return 'FAIL';
  if (llr <= Math.log(o.beta / (1 - o.alpha))) return 'PASS';
  return 'CONTINUE';
}
