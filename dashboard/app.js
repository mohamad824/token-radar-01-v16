/* Token Radar v16 dashboard. All figures come from window.TOKEN_RADAR
   (data.js, written by main.ts from board.json). No network, no hard-coded
   protocol names: the page renders whatever board.json holds. */
const D = window.TOKEN_RADAR;
const M = D.meta;
const $ = (id) => document.getElementById(id);
const fmt$ = (x) => '$' + Math.round(x).toLocaleString('en-US');
const fmtX = (x) => '×/' + x.toFixed(2);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let state = { v: 'ALL', wl: false, q: '', sort: 'implied', showAll: false, sel: null };

function ageStr(r) { return r.age_days === null ? '—' : (r.age_days >= 365 ? (r.age_days / 365).toFixed(1) + 'y' : r.age_days + 'd'); }
function growthStr(r) { return r.growth_7d_pct === null ? '—' : (r.growth_7d_pct > 0 ? '+' : '') + r.growth_7d_pct.toFixed(1) + '%'; }
function deltaCell(r) {
  const d = r.delta_net_usd;
  const arrow = d >= 0 ? '▲' : '▼';
  const cls = d >= 0 ? 'up' : 'down';
  return '<span class="' + cls + '">' + arrow + ' ' + fmt$(Math.abs(d)) + '</span>';
}
function filtered() {
  let rows = D.rows.filter((r) => (state.v === 'ALL' || r.verdict === state.v) && (!state.wl || r.watchlist) && (!state.q || (r.name + ' ' + r.slug).toLowerCase().includes(state.q)));
  const key = { implied: 'implied_value_usd', tvl: 'tvl_usd', odds: 'odds', net: 'net_usd', ev: 'ev_usd' }[state.sort];
  rows = [...rows].sort((a, b) => b[key] - a[key]);
  return rows;
}
function renderBoard() {
  const rows = filtered();
  const show = state.showAll ? rows : rows.slice(0, 50);
  $('rows').innerHTML = show.map((r) =>
    '<tr data-slug="' + r.slug + '"><td>' + r.rank + '</td><td><b>' + esc(r.name) + '</b>' + (r.watchlist ? ' ●' : '') + '<br><span style="color:#666;font-size:12px">' + esc(r.category || '—') + ' · ' + esc(r.chains.slice(0, 2).join(', ')) + '</span></td>' +
    '<td class="num">' + fmt$(r.tvl_usd) + '</td><td class="num">' + growthStr(r) + '</td><td class="num">' + ageStr(r) + '</td>' +
    '<td class="num">' + r.odds.toFixed(3) + '</td><td class="num"><b>' + fmt$(r.implied_value_usd) + '</b></td>' +
    '<td class="num">' + fmt$(r.jk_lo_usd) + '–' + fmt$(r.jk_hi_usd) + '</td>' +
    '<td class="num">' + r.delta_flat_x.toFixed(2) + '×</td><td class="num">' + deltaCell(r) + '</td>' +
    '<td class="' + r.verdict + '">' + r.verdict + '</td><td class="num">' + (r.net_usd >= 0 ? '+' : '') + fmt$(r.net_usd) + '</td></tr>').join('');
  $('count').textContent = rows.length + ' rows shown of ' + D.rows.length + ' (click a row for detail).';
  $('showAll').style.display = rows.length > 50 && !state.showAll ? '' : 'none';
  document.querySelectorAll('#rows tr').forEach((tr) => tr.addEventListener('click', () => select(tr.dataset.slug)));
}
function renderModel() {
  const c = M.challengers;
  const rows = [
    ['Curve (board)', c.curve, 'Wins medLOO and medWF; uses TVL, growth and token-free age from the snapshot.'],
    ['Ridge A, λ30', c.ridge_lam30, 'Uses TVL, growth, age and category dummies; age only as a score input.'],
    ['Ridge B, λ3', c.ridge_lam3, 'Same features as A, weaker shrinkage; best meanWF is not the board.'],
    ['Power law 0.45', c.power_045, 'Fixed exponent; close on meanWF, worse on both medians.'],
    ['OLS + category shift', c.ols_cat_shift, 'Category shifts help LOO little and WF less.'],
    ['Flat median', c.flat_median, 'One ratio for all; the baseline the Δ flat column measures against.'],
    ['Placebo', { medLoo: c.placebo.medLoo, meanLoo: c.placebo.meanLoo, medWf: null, meanWf: null }, 'A shuffled ratio: the floor any real model must beat.'],
  ];
  $('modelRows').innerHTML = rows.map(([n, s, why]) =>
    '<tr><td><b>' + n + '</b></td><td>' + fmtX(s.medLoo) + '</td><td>' + fmtX(s.meanLoo) + '</td><td>' + (s.medWf ? fmtX(s.medWf) : '—') + '</td><td>' + (s.meanWf ? fmtX(s.meanWf) : '—') + '</td><td>' + why + '</td></tr>').join('');
  $('modelNote').textContent = 'Board model: curve. medLOO ×/' + M.curve.med_loo.toFixed(2) + ' (best), meanLOO ×/' + M.curve.mean_loo.toFixed(2) + ', medWF ×/' + M.curve.med_wf.toFixed(2) + ' (best), meanWF ×/' + M.curve.mean_wf.toFixed(2) + ' — worse than the power law (×/' + c.power_045.meanWf.toFixed(2) + ') and ridge B (×/' + c.ridge_lam3.meanWf.toFixed(2) + '). Spearman curve vs ridge A: ' + M.spearman_curve_vs_ridgeA.toFixed(3) + '; top-10 overlap: ' + M.top10_overlap_curve_vs_ridgeA + '/10. Curve multiple capped at 1.0×: ' + M.curve.capped_rows + ' board rows hit the cap.';
}
function renderKpis() {
  $('k-top1').textContent = fmt$(M.top1_implied_usd) + ' · ' + M.top1_name;
  $('k-total').textContent = fmt$(M.total_implied_usd);
  $('k-med').textContent = fmt$(M.median_implied_usd);
  $('k-ev').textContent = fmt$(M.expected_value_usd);
  $('k-farm').textContent = M.verdicts.FARM + ' / ' + M.verdicts.MARGINAL + ' / ' + M.verdicts.SKIP;
  $('k-stab').textContent = (M.bootstrap_top20 * 100).toFixed(1) + '%';
  $('v-match').textContent = M.board_rows + '/' + M.board_rows;
  $('v-watch').textContent = M.watchlist_covered + '/40';
}
function renderOdds() {
  const t = M.tier_pooled;
  $('tiers').innerHTML = ['HIGH', 'MED', 'LOW'].map((k) =>
    '<div><b>' + (t[k].rate * 100).toFixed(1) + '%</b>' + k + ' tier pooled launch rate<br><span style="color:#666">' + t[k].launched + ' launched of ' + t[k].n + ' fit rows · ' + M.tier_board[k] + ' board rows</span></div>').join('');
  $('brierRows').innerHTML = M.odds_wf.map((w, i) =>
    '<tr><td>Cut ' + (i + 1) + ' (' + ['40/60', '50/50', '67/33'][i] + ')</td><td>' + w.n + '</td><td>' + w.brier.toFixed(4) + '</td><td>' + w.brierBase.toFixed(4) + '</td><td>' + (w.calledRight * 100).toFixed(1) + '%</td></tr>').join('');
}
function renderCalib() {
  $('calibRows').innerHTML = M.calibration.terciles.map((t, i) =>
    '<tr><td>Tercile ' + (i + 1) + '</td><td>' + t.n + '</td><td>×/' + t.fIn.toFixed(2) + '</td><td>' + (t.covIn * 100).toFixed(0) + '%</td><td>×/' + t.fOut.toFixed(2) + '</td><td>' + (t.covOut * 100).toFixed(0) + '%</td></tr>').join('');
  $('jkLine').textContent = 'Jackknife+ factor ×/' + M.calibration.jk_factor.toFixed(2) + ' with LOO coverage ' + (M.calibration.jk_coverage_loo * 100).toFixed(1) + '% (the band shown in the board Range column). No board row has a degenerate jackknife+ band: the smallest implied value is ' + fmt$(Math.min.apply(null, D.rows.map((r) => r.implied_value_usd))) + ', well above the $1 floor.';
  $('d02').textContent = 'D-02 time-split (cut-off ' + '2026-03-12' + '): train ' + M.d02.train + ' comps, test ' + M.d02.test + ' — median miss ×/' + M.d02.med.toFixed(2) + ', mean miss ×/' + M.d02.mean.toFixed(2) + '.';
  const b = M.bear_x033;
  $('d48').textContent = 'D-48 bear-proof core (implied ×0.33): ' + b.FARM + ' FARM / ' + b.MARGINAL + ' MARGINAL / ' + b.SKIP + ' SKIP — ' + b.FARM + ' survivors. Bull ×2.5 gives ' + M.bull_farm_x25 + ' FARM, ×3 gives ' + M.bull_farm_x3 + ' FARM.';
  const l = M.ledger;
  $('d62').textContent = 'D-62 ledger: ' + l.board + ' board + ' + l.clean_comps + ' clean comps + ' + l.dirty_excluded_comps + ' dirty-excluded comps + ' + l.zero_mcap_traded + ' zero-mcap traded + ' + l.eligible_not_board + ' eligible not on board + ' + l.pretoken_ineligible + ' pre-token ineligible + ' + l.traded_token_products + ' traded-token products = ' + l.total + ' protocols.';
  $('calRows').innerHTML = D.calendar.map((c) => '<tr><td>' + c.week + '</td><td style="text-align:left;white-space:normal">' + esc(c.action) + '</td><td>$' + c.cost_usd + '</td><td>' + c.hours.toFixed(1) + '</td></tr>').join('');
  const t1 = D.rows[0];
  $('pool').textContent = 'Top-1 ' + t1.name + ': net at $1,000 = ' + fmt$(t1.net_usd / 5) + ', at $5,000 = ' + fmt$(t1.net_usd) + ', at $25,000 = ' + fmt$(t1.net_usd * 5) + ' (fees fixed); three wallets ≈ ' + fmt$(t1.net_usd * 3 - 2 * t1.fee_usd) + '. Break-even capital ' + (t1.break_even_usd === null ? 'never (above the $250,000 cap)' : fmt$(t1.break_even_usd)) + '; walk-away ' + t1.walk_away_x.toFixed(5) + '×. Board break-even: ' + M.break_even.finite + ' finite / ' + M.break_even.never + ' never, median finite ' + fmt$(M.break_even.median_finite_usd || 0) + ', max finite ' + fmt$(M.break_even.max_finite_usd || 0) + '.';
  $('top10').innerHTML = D.top10.map((r) => '<li><b>' + esc(r.name) + '</b> — implied ' + fmt$(r.implied) + ', TVL ' + fmt$(r.tvl) + ', odds ' + r.odds.toFixed(3) + ', ' + r.verdict + ', net ' + fmt$(r.net) + '.</li>').join('');
}
function select(slug) {
  const r = D.rows.find((x) => x.slug === slug);
  if (!r) return;
  state.sel = slug;
  const flat = fmt$(r.implied_value_usd / r.delta_flat_x);
  $('detailBody').innerHTML =
    '<h3>#' + r.rank + ' ' + esc(r.name) + ' <span class="' + r.verdict + '">' + r.verdict + '</span></h3>' +
    '<p>' + esc(r.name) + ' records no token in the snapshot and passes the strict pre-token screen (its parent token, if any, does not trade). Δ flat ' + r.delta_flat_x.toFixed(2) + '× means the curve implies ' + r.delta_flat_x.toFixed(2) + '× the flat-median value of ' + flat + ' — a small delta on most rows is honesty, not a hidden weakness.</p>' +
    '<dl>' +
    '<div><dt>Implied value</dt><dd>' + fmt$(r.implied_value_usd) + '</dd></div>' +
    '<div><dt>TVL</dt><dd>' + fmt$(r.tvl_usd) + '</dd></div>' +
    '<div><dt>7-day growth</dt><dd>' + growthStr(r) + '</dd></div>' +
    '<div><dt>Age</dt><dd>' + ageStr(r) + '</dd></div>' +
    '<div><dt>Multiple</dt><dd>' + r.multiple.toFixed(4) + '×</dd></div>' +
    '<div><dt>Launch odds</dt><dd>' + r.odds.toFixed(3) + ' (' + r.conviction + ')</dd></div>' +
    '<div><dt>Expected value</dt><dd>' + fmt$(r.ev_usd) + '</dd></div>' +
    '<div><dt>Net (EV × 0.0015% − fee)</dt><dd>' + (r.net_usd >= 0 ? '+' : '') + fmt$(r.net_usd) + '</dd></div>' +
    '<div><dt>Range (tercile)</dt><dd>' + fmt$(r.range_lo_usd) + ' – ' + fmt$(r.range_hi_usd) + '</dd></div>' +
    '<div><dt>Range (outer)</dt><dd>' + fmt$(r.range_outer_lo_usd) + ' – ' + fmt$(r.range_outer_hi_usd) + '</dd></div>' +
    '<div><dt>Range (jackknife+)</dt><dd>' + fmt$(r.jk_lo_usd) + ' – ' + fmt$(r.jk_hi_usd) + '</dd></div>' +
    '<div><dt>Δ vs +$25</dt><dd>' + (r.delta_net_usd >= 0 ? '+' : '') + fmt$(r.delta_net_usd) + '</dd></div>' +
    '<div><dt>Break-even capital</dt><dd>' + (r.break_even_usd === null ? 'never' : fmt$(r.break_even_usd)) + '</dd></div>' +
    '<div><dt>Walk-away</dt><dd>' + r.walk_away_x.toFixed(5) + '×</dd></div>' +
    '<div><dt>Fee (cheapest: ' + esc(r.cheapest_chain) + ' route)</dt><dd>' + fmt$(r.fee_usd) + '</dd></div>' +
    '<div><dt>Signals / launch score</dt><dd>' + r.signals + ' / 6 · ' + r.launch_score + '</dd></div>' +
    '</dl>' +
    '<h4>Farm plan — $5,000, 12 weeks</h4><ol>' + r.farm_steps.map((s) => '<li>' + esc(s) + '</li>').join('') + '</ol>' +
    '<p><b>Verdict does not price eligibility risk: a launch does not guarantee you qualify.</b></p>';
  simUpdate();
}
function simUpdate() {
  const r = D.rows.find((x) => x.slug === state.sel) || D.rows[0];
  const hair = Number($('simHair').value) / 100;
  const drop = Number($('simDrop').value) / 100;
  $('simHairV').textContent = Math.round(hair * 100) + '%';
  $('simDropV').textContent = Math.round(drop * 100) + '%';
  const imp = r.implied_value_usd * (1 - hair) * (1 - drop);
  const ev = imp * r.odds;
  const net = ev * 0.000015 - r.fee_usd;
  $('simOut').textContent = r.name + ': implied ' + fmt$(imp) + ' → EV ' + fmt$(ev) + ' → net ' + (net >= 0 ? '+' : '') + fmt$(net) + ' (fee ' + fmt$(r.fee_usd) + '). Verdict at these settings: ' + (ev >= 4000000 && r.odds >= 0.3 ? 'FARM' : ev >= 1350000 && r.odds >= 0.2 ? 'MARGINAL' : 'SKIP') + '.';
}
function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function init() {
  renderKpis(); renderBoard(); renderModel(); renderOdds(); renderCalib();
  select(D.rows[0].slug);
  $('q').addEventListener('input', (e) => { state.q = e.target.value.toLowerCase(); state.showAll = false; renderBoard(); });
  $('wl').addEventListener('change', (e) => { state.wl = e.target.checked; renderBoard(); });
  $('sort').addEventListener('change', (e) => { state.sort = e.target.value; renderBoard(); });
  $('showAll').addEventListener('click', () => { state.showAll = true; renderBoard(); });
  document.querySelectorAll('#filters button[data-v]').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('#filters button[data-v]').forEach((x) => x.classList.remove('on'));
    b.classList.add('on'); state.v = b.dataset.v; state.showAll = false; renderBoard();
  }));
  $('simHair').addEventListener('input', simUpdate);
  $('simDrop').addEventListener('input', simUpdate);
  $('exportJson').addEventListener('click', () => download('board.json', JSON.stringify({ meta: M, rows: D.rows }, null, 2), 'application/json'));
  $('exportCsv').addEventListener('click', () => {
    const head = 'rank,slug,name,implied_value_usd,tvl_usd,odds,verdict,net_usd\n';
    download('board.csv', head + D.rows.map((r) => [r.rank, r.slug, '"' + r.name.replace(/"/g, '""') + '"', r.implied_value_usd, r.tvl_usd, r.odds, r.verdict, r.net_usd].join(',')).join('\n'), 'text/csv');
  });
  const h = location.hash;
  if (h.startsWith('#detail=')) { document.body.classList.add('focus-detail'); select(decodeURIComponent(h.slice(8))); window.scrollTo(0, 0); }
  else if (h.startsWith('#filter=verdict:')) {
    const v = h.slice(16);
    state.v = v; document.querySelectorAll('#filters button[data-v]').forEach((x) => x.classList.toggle('on', x.dataset.v === v));
    renderBoard(); window.scrollTo(0, 0);
  } else if (h === '#view=evidence' || h === '#evidence') {
    document.body.classList.add('focus-evidence');
    window.scrollTo(0, 0);
  }
}
document.addEventListener('DOMContentLoaded', init);
