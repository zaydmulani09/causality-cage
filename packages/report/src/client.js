// @ts-check
// Report interactivity: factor toggles (truth-table lookup), latency marker, table sort/filter, ?demo=1 autoplay.
(() => {
  /** @typedef {{ id: string, label: string, observed: string, neutral: string }} F */
  /** @typedef {{ factor: string, label: string, neutralMs: number, observedMs: number, thresholdMs: number | null, grid: { ms: number, runs: number, fails: number }[] }} Curve */
  /** @type {{ factors: F[], table: { on: string[], decision: string }[] | null, curves: Curve[] }} */
  const data = JSON.parse(/** @type {HTMLElement} */ (document.getElementById('cage-data')).textContent || '{}');
  const on = new Set(data.factors.map((f) => f.id));

  function lookup() {
    if (!data.table) return 'FAIL';
    const row = data.table.find((r) => r.on.length === on.size && r.on.every((id) => on.has(id)));
    return row ? row.decision : 'UNKNOWN';
  }
  function render() {
    const d = lookup();
    const cls = d === 'FAIL' || d === 'PASS' ? d : 'UNKNOWN';
    for (const o of document.querySelectorAll('.outcome')) {
      o.setAttribute('class', `outcome ${cls}`);
      o.setAttribute('data-decision', d);
      const t = o.querySelector('.outcome-text');
      if (t) t.textContent = d === 'FAIL' ? 'FAILURE' : d === 'PASS' ? 'NO FAILURE' : d === 'DIFFERENT_FAILURE' ? 'OTHER FAILURE' : d;
    }
    for (const f of data.factors) {
      const obs = on.has(f.id);
      const v = obs ? f.observed : f.neutral;
      for (const g of document.querySelectorAll(`.factor[data-id="${f.id}"]`)) {
        g.setAttribute('class', obs ? 'factor' : 'factor neutral');
        g.setAttribute('aria-pressed', String(obs));
        g.setAttribute('aria-label', `${f.label}: ${obs ? 'observed' : 'neutral'}. Press to toggle`);
        const state = g.querySelector('.state');
        if (state) state.textContent = `${obs ? 'observed' : 'neutral'}: ${v.length > 30 ? v.slice(0, 29) + '…' : v}`;
      }
      for (const e of document.querySelectorAll(`[data-edge="${f.id}"]`)) e.setAttribute('class', obs ? 'edge hot' : 'edge');
    }
    for (const e of document.querySelectorAll('.edge-out')) e.setAttribute('class', cls === 'FAIL' ? 'edge hot edge-out' : 'edge edge-out');
  }
  /** @param {string} id */
  function toggle(id) {
    if (!data.table) return;
    if (on.has(id)) on.delete(id);
    else on.add(id);
    render();
  }
  for (const g of document.querySelectorAll('.factor')) {
    const id = g.getAttribute('data-id') || '';
    g.addEventListener('click', () => toggle(id));
    g.addEventListener('keydown', (e) => {
      const k = /** @type {KeyboardEvent} */ (e).key;
      if (k === 'Enter' || k === ' ') {
        e.preventDefault();
        toggle(id);
      }
    });
  }

  // latency: marker + readout from the nearest measured grid point
  /** @type {((ms: number) => void)[]} */
  const setLatency = [];
  document.querySelectorAll('.chart-card').forEach((card) => {
    const c = data.curves[Number(card.getAttribute('data-curve'))];
    const input = /** @type {HTMLInputElement | null} */ (card.querySelector('input[type=range]'));
    const marker = card.querySelector('.marker');
    const readout = card.querySelector('.readout');
    const svg = card.querySelector('svg');
    if (!c || !input || !marker || !readout || !svg) return;
    const [left = 0, right = 1, maxMs = 1] = (input.getAttribute('data-plot') || '0,1,1').split(',').map(Number);
    const x = (/** @type {number} */ ms) => left + ((right - left) * ms) / maxMs;
    const set = (/** @type {number} */ ms) => {
      input.value = String(Math.round(ms));
      marker.setAttribute('x1', String(x(ms)));
      marker.setAttribute('x2', String(x(ms)));
      const near = c.grid.reduce((a, b) => (Math.abs(b.ms - ms) < Math.abs(a.ms - ms) ? b : a));
      const side = c.thresholdMs == null ? '' : ms >= c.thresholdMs ? ' (above the flip point)' : ' (below the flip point)';
      readout.textContent = `${Math.round(ms)} ms${side}: nearest measurement ${near.ms} ms failed ${near.fails}/${near.runs} runs.`;
    };
    input.addEventListener('input', () => set(Number(input.value)));
    let dragging = false;
    const fromPointer = (/** @type {PointerEvent} */ e) => {
      const r = svg.getBoundingClientRect();
      const vx = ((e.clientX - r.left) / r.width) * svg.viewBox.baseVal.width;
      set(Math.max(0, Math.min(maxMs, ((vx - left) / (right - left)) * maxMs)));
    };
    svg.addEventListener('pointerdown', (e) => {
      dragging = true;
      svg.setPointerCapture(e.pointerId);
      fromPointer(e);
    });
    svg.addEventListener('pointermove', (e) => dragging && fromPointer(e));
    svg.addEventListener('pointerup', () => (dragging = false));
    set(Number(input.value));
    setLatency.push((ms) => set(ms));
  });

  // experiment table: filter + sort
  const table = /** @type {HTMLTableElement | null} */ (document.getElementById('exp-table'));
  const search = /** @type {HTMLInputElement | null} */ (document.getElementById('exp-search'));
  if (table && search) {
    const body = /** @type {HTMLTableSectionElement} */ (table.tBodies[0]);
    search.addEventListener('input', () => {
      const q = search.value.toLowerCase();
      for (const tr of body.rows) tr.hidden = !!q && !(tr.textContent || '').toLowerCase().includes(q);
    });
    let dir = 1;
    table.querySelectorAll('th button').forEach((btn) => {
      btn.addEventListener('click', () => {
        const col = Number(btn.getAttribute('data-col'));
        dir = -dir;
        const key = (/** @type {HTMLTableRowElement} */ tr) => {
          const td = /** @type {HTMLTableCellElement} */ (tr.cells[col]);
          const v = td.getAttribute('data-v') ?? td.textContent ?? '';
          return isNaN(Number(v)) ? v : Number(v);
        };
        const rows = [...body.rows].sort((a, b) => (key(a) > key(b) ? dir : key(a) < key(b) ? -dir : 0));
        body.append(...rows);
      });
    });
  }

  render();

  // ?demo=1: toggle each factor to neutral and back, 1 s cadence, then sweep the latency marker
  if (new URLSearchParams(location.search).get('demo') === '1') {
    /** @type {(() => void)[]} */
    const steps = [];
    for (const f of data.factors) {
      steps.push(() => toggle(f.id), () => toggle(f.id));
    }
    for (const c of data.curves) {
      const set = setLatency[data.curves.indexOf(c)];
      if (!set) continue;
      const top = Math.max(...c.grid.map((g) => g.ms));
      for (const t of [0, 0.25, 0.5, 0.75, 1]) steps.push(() => set(top * t));
    }
    let i = 0;
    if (steps.length) setInterval(() => steps[i++ % steps.length]?.(), 1000);
  }
})();
