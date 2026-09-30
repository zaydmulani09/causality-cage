// Single-file offline report: inline CSS, inline JS, inline SVG, zero network requests.
import { readFileSync } from 'node:fs';
import { describe, isAbsent, type Bundle, type DelayCurve, type Factor, type FactorValue } from '@causality-cage/core';

const CSS = readFileSync(new URL('./style.css', import.meta.url), 'utf8');
const JS = readFileSync(new URL('./client.js', import.meta.url), 'utf8');

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const trunc = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const fmtVal = (v: FactorValue) => (isAbsent(v) ? 'absent' : JSON.stringify(v));
const VERDICT_LABEL = { explained: 'Explained', partial: 'Partial result', unexplained: 'Unexplained', 'untrustworthy-oracle': 'Untrustworthy oracle' } as const;

export function renderReport(b: Bundle): string {
  const r = b.result;
  const byId = new Map(b.factors.map((f) => [f.id, f]));
  const graphIds = r.truthTable?.factors ?? [...new Set(r.minimalSets.flat())];
  const data = {
    factors: graphIds.map((id) => ({ id, label: byId.get(id)!.label, observed: fmtVal(byId.get(id)!.observed), neutral: fmtVal(byId.get(id)!.neutral) })),
    table: r.truthTable ? r.truthTable.rows.map((row) => ({ on: row.on, decision: row.decision })) : null,
    curves: r.delayCurves.map((c) => ({ ...c, label: byId.get(c.factor)?.label ?? c.factor })),
  };
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  const cage = 'result.cage';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:">
<title>cage report: ${esc(VERDICT_LABEL[r.verdict].toLowerCase())}</title>
<style>${CSS}</style>
</head>
<body>
<header class="top"><span class="brand">cage</span><span class="meta">counterfactual replay report · ${esc(b.manifest.baseOrigin)} · ${esc(b.manifest.createdAt.replace('T', ' ').slice(0, 19))} UTC · v${esc(b.manifest.toolVersion)}</span></header>
<main>
${verdict(b)}
${graph(b, graphIds)}
${r.delayCurves.length ? latency(r.delayCurves, byId) : ''}
${variants(b)}
${experiments(b)}
${scope(b)}
<section id="reproduce"><h2>Reproduce</h2>
<div class="card">
<p class="muted">Replay the minimal failing configuration (flip factors with <code>--set</code>):</p>
<pre>cage repro ${cage}${r.minimalSets[0]?.[0] ? `\ncage repro ${cage} --set ${r.minimalSets[0][0]}=neutral` : ''}</pre>
<p class="muted">Standalone regression test (needs only @playwright/test; fails until the bug is fixed):</p>
<pre>cage export-test ${cage} --out repro
cd repro
$env:CAGE_BASE_URL = "${esc(b.manifest.baseOrigin)}"   # bash: export CAGE_BASE_URL=...
npx playwright test</pre>
</div></section>
</main>
<script type="application/json" id="cage-data">${json}</script>
<script>${JS}</script>
</body>
</html>
`;
}

function verdict(b: Bundle): string {
  const r = b.result;
  const label = new Map(b.factors.map((f) => [f.id, f.label]));
  const sets = r.minimalSets.length && (r.verdict === 'explained' || r.verdict === 'partial')
    ? `<ul class="sets">${r.minimalSets.map((s, i) => `<li><span class="muted">set ${i + 1}${r.structure ? ` (${r.structure})` : ''}:</span> ${s.map((id) => `<code>${esc(label.get(id) ?? id)}</code>`).join(' + ')}</li>`).join('')}</ul>`
    : '';
  return `<section id="verdict" class="card verdict verdict-${r.verdict}">
<div class="verdict-label">${VERDICT_LABEL[r.verdict]}${r.singleSession ? ' · single-session mode (experimental)' : ''}</div>
<p class="sentence">${esc(r.sentence)}</p>
<dl class="stats">
<div><dt>factors</dt><dd>${r.factorCount}</dd></div>
<div><dt>experiments</dt><dd>${r.budget.used} / ${r.budget.limit}</dd></div>
<div><dt>mode</dt><dd>${r.mode}</dd></div>
<div><dt>wall time</dt><dd>${(r.wallMs / 1000).toFixed(1)} s</dd></div>
</dl>
<p class="signature"><span class="muted">failure signature:</span> ${r.looseOracle ? '<span class="muted">not checked (--loose-oracle: any failure counts)</span>' : r.signature ? `<code>${esc(r.signature)}</code>` : '<span class="muted">none</span>'}</p>${sets}
${r.warnings.map((w) => `<p class="warn">${esc(w)}</p>`).join('')}
</section>`;
}

function graph(b: Bundle, ids: string[]): string {
  const r = b.result;
  if (!ids.length) {
    return `<section id="graph"><h2>Causal graph</h2><div class="card"><p class="muted">No causal graph: ${esc(r.reason)}</p></div></section>`;
  }
  const byId = new Map(b.factors.map((f) => [f.id, f]));
  const joinLabel = r.structure === 'OR' ? 'OR' : r.structure === 'AND' ? 'AND' : r.structure === 'OTHER' ? 'MIX' : ids.length > 1 ? 'AND' : '';
  const single = ids.length === 1;
  const factorNode = (id: string, x: number, y: number, w: number) => {
    const f = byId.get(id)!;
    return `<g class="factor" data-id="${id}" tabindex="0" role="button" aria-pressed="true" aria-label="${esc(f.label)}: observed. Press to toggle">
<title>${esc(f.label)}</title>
<rect x="${x}" y="${y}" width="${w}" height="44" rx="6"/>
<text x="${x + 10}" y="${y + 19}">${esc(trunc(shortLabel(f), 38))}</text>
<text class="state" x="${x + 10}" y="${y + 36}">observed: ${esc(trunc(fmtVal(f.observed), 30))}</text>
</g>`;
  };
  const outcome = (x: number, y: number, w: number) =>
    `<g class="outcome FAIL"><rect x="${x}" y="${y}" width="${w}" height="56" rx="8"/><text class="outcome-text" x="${x + w / 2}" y="${y + 34}" text-anchor="middle">FAILURE</text></g>`;
  const joinNode = (cx: number, cy: number) => `<g class="join"><circle cx="${cx}" cy="${cy}" r="26"/><text x="${cx}" y="${cy + 5}" text-anchor="middle">${joinLabel}</text></g>`;

  // wide: factors left, join middle, outcome right
  const H = Math.max(140, ids.length * 64 + 24);
  const mid = H / 2;
  const wide = ids
    .map((id, i) => {
      const y = mid - (ids.length * 64) / 2 + i * 64 + 10;
      const [tx, ty] = single ? [500, mid] : [374, mid];
      return `<path class="edge hot" data-edge="${id}" d="M310 ${y + 22} C 350 ${y + 22}, 340 ${ty}, ${tx} ${ty}"/>${factorNode(id, 8, y, 302)}`;
    })
    .join('\n');
  // narrow (phones): factors stacked, join below, outcome at the bottom
  const fy = ids.length * 56;
  const jy = fy + 44;
  const oy = single ? fy + 24 : jy + 52;
  const narrow = ids
    .map((id, i) => {
      const y = 4 + i * 56;
      const [tx, ty] = single ? [180, oy] : [206, jy];
      return `<path class="edge hot" data-edge="${id}" d="M300 ${y + 22} C 340 ${y + 22}, 340 ${ty}, ${tx} ${ty}"/>${factorNode(id, 4, y, 296)}`;
    })
    .join('\n');
  const tableNote = r.truthTable
    ? 'Click a factor to switch it between its observed (failing-session) and neutral (passing-session) value. The outcome is looked up in the truth table measured during the search; nothing is re-executed here.'
    : `The truth table was not measured (more than 5 factors in the union of minimal sets), so toggling is disabled.`;
  return `<section id="graph"><h2>Causal graph</h2><div class="card">
<svg class="graph graph-wide" viewBox="0 0 720 ${H}" role="group" aria-label="causal graph">
${wide}
${single ? '' : `<path class="edge hot edge-out" d="M426 ${mid} L500 ${mid}"/>${joinNode(400, mid)}`}
${outcome(500, mid - 28, 210)}
</svg>
<svg class="graph graph-narrow" viewBox="0 0 360 ${oy + 60}" role="group" aria-label="causal graph">
${narrow}
${single ? '' : `<path class="edge hot edge-out" d="M180 ${jy + 26} L180 ${oy}"/>${joinNode(180, jy)}`}
${outcome(60, oy, 240)}
</svg>
<p class="caption">${tableNote}</p>
</div></section>`;
}

function shortLabel(f: Factor): string {
  return f.label.replace(/^(body|header|status|presence) /, (m) => (m === 'body ' ? '' : m));
}

function latency(curves: DelayCurve[], byId: Map<string, Factor>): string {
  return `<section id="latency"><h2>Latency</h2>${curves
    .map((c, i) => {
      const W = 640;
      const H = 240;
      const L = 48;
      const R = 16;
      const T = 16;
      const B = 36;
      const maxMs = Math.max(...c.grid.map((g) => g.ms), 1);
      const x = (ms: number) => L + ((W - L - R) * ms) / maxMs;
      const y = (rate: number) => T + (H - T - B) * (1 - rate);
      const pts = c.grid.map((g) => [x(g.ms), y(g.runs ? g.fails / g.runs : 0)] as const);
      const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => Math.round(maxMs * t));
      return `<div class="card chart-card" data-curve="${i}">
<p class="muted">${esc(byId.get(c.factor)?.label ?? c.factor)}: passing session ${c.neutralMs} ms, failing session ${c.observedMs} ms. Failure rate measured at ${c.grid.length} latencies, ${c.grid[0]?.runs ?? 0} runs each.</p>
<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="failure rate by latency">
${[0, 0.5, 1].map((t) => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/><text x="${L - 8}" y="${y(t) + 4}" text-anchor="end">${t * 100}%</text>`).join('')}
<line class="axis" x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}"/>
${ticks.map((t) => `<text x="${x(t)}" y="${H - B + 18}" text-anchor="middle">${t} ms</text>`).join('')}
${c.thresholdMs != null ? `<line class="threshold" x1="${x(c.thresholdMs)}" x2="${x(c.thresholdMs)}" y1="${T}" y2="${H - B}"/><text class="tlabel" x="${x(c.thresholdMs) + 6}" y="${H - B - 8}">flips at ~${c.thresholdMs} ms</text>` : ''}
<path class="curve" d="${pts.map(([px, py], j) => `${j ? 'L' : 'M'}${px.toFixed(1)} ${py.toFixed(1)}`).join(' ')}"/>
${pts.map(([px, py]) => `<circle class="pt" cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="3.5"/>`).join('')}
<line class="marker" x1="${x(c.observedMs)}" x2="${x(c.observedMs)}" y1="${T}" y2="${H - B}"/>
</svg>
<label class="muted" for="lat-${i}">latency</label>
<input id="lat-${i}" type="range" min="0" max="${maxMs}" step="1" value="${Math.min(c.observedMs, maxMs)}" data-plot="${L},${W - R},${maxMs}">
<p class="readout" aria-live="polite"></p>
</div>`;
    })
    .join('')}</section>`;
}

function variants(b: Bundle): string {
  const r = b.result;
  if (!r.variants.length) return '';
  const byId = new Map(b.factors.map((f) => [f.id, f]));
  const rows = r.variants
    .map((v) => `<tr><td><code>${esc(byId.get(v.factor)?.label ?? v.factor)}</code></td><td>${esc(v.cls)}</td><td><code>${esc(fmtVal(v.value))}</code></td><td><span class="badge ${v.decision}">${v.decision === 'FAIL' ? 'reproduces' : v.decision === 'PASS' ? 'no failure' : v.decision === 'DIFFERENT_FAILURE' ? 'different failure' : v.decision.toLowerCase()}</span></td></tr>`)
    .join('');
  const ids = [...new Set(r.variants.map((v) => v.factor))];
  const summary = ids
    .map((id) => {
      const f = byId.get(id)!;
      const failing = r.variants.filter((v) => v.factor === id && v.decision === 'FAIL').map((v) => v.cls);
      return `<li><code>${esc(f.label)}</code>: observed ${esc(fmtVal(f.observed))} fails; ${failing.length ? `so do: ${esc(failing.join(', '))}` : 'no other value class tried fails'}.</li>`;
    })
    .join('');
  return `<section id="variants"><h2>Value variants</h2>
<p class="muted">Each factor in the minimal set was replaced by other value classes, everything else unchanged.</p>
<ul>${summary}</ul>
<div class="table-wrap"><table><thead><tr><th>Factor</th><th>Value class</th><th>Value</th><th>Outcome</th></tr></thead><tbody>${rows}</tbody></table></div>
</section>`;
}

function experiments(b: Bundle): string {
  const label = b.factors.map((f) => f.label);
  const describeBits = (bits: string) => {
    const on = [...bits].flatMap((c, i) => (c === '1' ? [label[i]!] : []));
    if (!on.length) return 'all neutral';
    if (on.length === bits.length) return `all observed (${on.length})`;
    return on.length > 3 ? `${on.length} observed: ${on.slice(0, 3).join(', ')}, …` : on.join(', ');
  };
  const rows = b.experiments
    .map((e) => {
      const ov = e.overrides ? ` · override ${Object.entries(e.overrides).map(([k, v]) => `${label[Number(k.slice(1))] ?? k} = ${fmtVal(v)}`).join(', ')}` : '';
      return `<tr><td data-v="${e.n}">${e.n + 1}</td><td>${e.phase}</td><td>${esc(describeBits(e.bits) + ov)}</td><td data-v="${e.decision}"><span class="badge ${e.decision}">${e.decision}</span></td><td data-v="${e.runs}">${e.fails}/${e.runs}${e.errors ? ` (${e.errors} err)` : ''}</td><td data-v="${e.wallMs}">${(e.wallMs / 1000).toFixed(2)} s</td></tr>`;
    })
    .join('');
  return `<section id="experiments"><h2>Experiment log</h2>
<input type="search" id="exp-search" placeholder="Filter experiments" aria-label="Filter experiments">
<div class="table-wrap"><table id="exp-table"><thead><tr>${['#', 'Phase', 'Configuration', 'Outcome', 'Fails/runs', 'Time'].map((h, i) => `<th><button data-col="${i}">${h}</button></th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>
</section>`;
}

function scope(b: Bundle): string {
  const r = b.result;
  const g = r.gate;
  const sentence = r.minimalSets[0] ? r.minimalSets.map((s) => s.map((id) => describe(b.factors.find((f) => f.id === id)!, r)).join(' AND ')).join(' OR ') : '';
  return `<section id="scope" class="scope" aria-label="Scope of this claim"><h2>Scope of this claim</h2>
<p>${sentence ? `The claim (<em>${esc(sentence)}</em>) is` : 'Any claim here is'} necessary and sufficient <strong>only within the ${r.factorCount} modeled factors</strong>, under this flow and oracle, at the measured repeat rates. Removing any one factor of a reported set stops the failure (1-minimal); it is not guaranteed to be the globally smallest cause, and behavior can be non-monotone (adding a factor can heal a failure).</p>
<p>Modeled: API response body fields, status codes, allow-listed response headers, response latency, arrival order of concurrent responses, requests present only in the failing run, localStorage, sessionStorage, cookies, viewport, locale, timezone, user agent.</p>
<p>Not modeled (a cause here shows up as <em>unexplained</em>): server-side state not visible in API responses; static assets and third-party scripts (served live); WebSockets and WebRTC; IndexedDB; service workers (blocked during replay); multi-tab flows; non-Chromium browsers.</p>
<ul>
<li>${r.looseOracle ? 'Oracle: loose, any failure counted as the bug.' : `Only runs whose failure matches the bad session's signature count as reproducing it; other failures are DIFFERENT_FAILURE.`}</li>
<li>Determinism gate: all-observed failed ${g.allTrue.fails}/${g.allTrue.runs} runs, all-neutral failed ${g.allFalse.fails}/${g.allFalse.runs} (needs ≥ 80% and ≤ 20%).${g.allTrue.different || g.allFalse.different ? ` Runs that failed differently are left out of these rates (all-observed ${g.allTrue.different ?? 0}, all-neutral ${g.allFalse.different ?? 0}): another failure came first, so they say nothing about this one.` : ''}</li>
<li>Mode: ${r.mode}${r.mode === 'statistical' ? ' (each experiment repeated until a sequential probability ratio test decided, 0.2 vs 0.8 fail rate, α = β = 0.05, max 12 runs)' : ' (one run per experiment; leave-one-out checks repeated 3 times)'}.</li>
<li>Budget: ${r.budget.used} of ${r.budget.limit} experiments used.${r.verdict === 'partial' ? ' <strong>Search stopped early: result not verified.</strong>' : ''}</li>
${r.singleSession ? '<li><strong>Single-session mode (experimental):</strong> neutral values were synthesized, not observed in a passing run.</li>' : ''}
<li>Verification: ${r.verification.length ? `${r.verification.filter((v) => v.ok).length}/${r.verification.length} leave-one-out checks held.` : 'not run.'}</li>
</ul>
</section>`;
}
