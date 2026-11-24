// token-radar-01 v16 — combination entry (curve board + tercile/jackknife+
// calibration + light editorial dashboard). Node 22, standard library only,
// no network. Reads the sealed snapshot, writes board.json, data.js, the
// dashboard, screenshots and dossier.json into the output directory.
//
// Model (board): implied = TVL x curve(log10 TVL) x growth x maturity.
//   curve: OLS fit of log10(mcap/TVL) on log10(TVL) over the 92 clean traded
//   comps (traded with mcap > 0, minus 8 ineligible categories). The fitted
//   multiple is capped at 1.0x. Growth: clamp(change_7d, -60, +200) per cent,
//   factor 1 + 0.75 x growth/100. Maturity: 0.6 + 0.4 x min(age, 1095)/1095,
//   age = days since listed_at to the snapshot date, 365 when unknown.
// Ranking: implied-if-launches (not EV). EV = implied x odds is a companion.
// Odds: ensemble 0.5 logistic + 0.3 empirical (category x age-band in years,
// shrink 10) + 0.2 base rate, fit on 92 traded (launched) vs 198 board rows.
// Verdict: FARM when EV >= $4,000,000 and odds >= 0.30; MARGINAL when
// EV >= $1,350,000 and odds >= 0.20; else SKIP. Net = EV x 0.000015 - fee,
// fee = 5 transactions on the row's cheapest chain + $4 allowance.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-board.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const NODE = process.argv[1] ?? '';
void NODE;

const AS_OF = '2026-11-14';
const AS_OF_MS = Date.parse(AS_OF + 'T00:00:00Z');
const DAY_MS = 86400000;
const DEPOSIT = 5000;
const WEEKS = 12;
const FARM_SHARE = 0.000015; // a $5,000 deposit captures 0.0015% of EV (conservative)
const TEXT_MAX_BYTES = 65536;
const EV_FARM = 4000000;
const EV_MARGINAL = 1350000;
const ODDS_FARM = 0.3;
const ODDS_MARGINAL = 0.2;
const CUT_OFF = '2026-03-12'; // D-02 time-split cut-off
const BE_CAP = 250000; // break-even capital above this is "never"

// Categories that cannot serve as launch comps (their multiples run wild:
// Rain 400x, Nexo 69x) and cannot serve as pre-token board rows either.
const COMP_INELIGIBLE = new Set([
  'Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking',
  'Restaked BTC', 'CEX', 'Chain', 'Prediction Market',
]);
const BOARD_INELIGIBLE = new Set([
  'Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking',
  'Restaked BTC', 'CEX',
]);
const EXCHANGE_PREFIX = new Set(['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini']);
// Indicative per-transaction gas in USD by chain (cheapest-route choice).
const GAS_USD: Record<string, number> = {
  Solana: 1, Base: 2, Arbitrum: 3, Optimism: 2, Polygon: 1, Binance: 2,
  Sui: 1, Aptos: 1, Avalanche: 2, Ethereum: 12, Tron: 2, 'zkSync Era': 2,
  Linea: 2, Scroll: 2, Blast: 2, Mantle: 2, Berachain: 2, Sonic: 2,
};

interface Proto {
  slug: string; name: string; category: string | null; chains: string[];
  tvl_usd: number; change_7d: number | null; mcap_usd: number | null;
  listed_at: string | null; gecko_id: string | null; symbol: string | null;
}
interface Snap { as_of: string; source: string; floor_usd: number; protocols: Proto[]; watchlist: string[]; }

const log10 = (x: number): number => Math.log10(x);
const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x));
const round2 = (x: number): number => Math.round(x * 100) / 100;
const round5 = (x: number): number => Math.round(x * 100000) / 100000;
const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  return n === 0 ? 0 : n % 2 === 1 ? s[(n - 1) / 2]! : (s[n / 2 - 1]! + s[n / 2]!) / 2;
};
const quantile = (xs: number[], q: number): number => {
  const s = [...xs].sort((a, b) => a - b);
  if (s.length === 0) return 0;
  const i = clamp(Math.floor(q * s.length), 0, s.length - 1);
  return s[i]!;
};
const mean = (xs: number[]): number => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// Solve A x = b by Gaussian elimination with partial pivoting.
function solveLinear(Ain: number[][], bin: number[]): number[] {
  const n = bin.length;
  const A = Ain.map((r) => [...r]);
  const b = [...bin];
  for (let i = 0; i < n; i++) {
    let piv = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(A[r]![i]!) > Math.abs(A[piv]![i]!)) piv = r;
    [A[i], A[piv]] = [A[piv]!, A[i]!];
    [b[i], b[piv]] = [b[piv]!, b[i]!];
    const d = A[i]![i]!;
    if (d === 0) continue;
    for (let r = i + 1; r < n; r++) {
      const f = A[r]![i]! / d;
      for (let c = i; c < n; c++) A[r]![c]! -= f * A[i]![c]!;
      b[r]! -= f * b[i]!;
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i]!;
    for (let j = i + 1; j < n; j++) s -= A[i]![j]! * x[j]!;
    x[i] = A[i]![i]! === 0 ? 0 : s / A[i]![i]!;
  }
  return x;
}
function olsFit(xs: number[], ys: number[]): [number, number] {
  const n = xs.length;
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) { sxy += (xs[i]! - mx) * (ys[i]! - my); sxx += (xs[i]! - mx) ** 2; }
  const b = sxx === 0 ? 0 : sxy / sxx;
  return [my - b * mx, b];
}
function ageDays(p: Proto): number | null {
  if (!p.listed_at) return null;
  return Math.max(0, Math.round((AS_OF_MS - Date.parse(p.listed_at + 'T00:00:00Z')) / DAY_MS));
}
function growthPct(p: Proto): number {
  return p.change_7d === null ? 0 : clamp(p.change_7d, -60, 200);
}
function growthFactor(p: Proto): number { return 1 + 0.75 * (growthPct(p) / 100); }
function maturity(p: Proto): number {
  const ag = ageDays(p);
  const d = ag === null ? 365 : ag;
  return 0.6 + 0.4 * (Math.min(d, 1095) / 1095);
}
function ageBand(p: Proto): string {
  const ag = ageDays(p);
  if (ag === null) return 'unknown';
  if (ag < 365) return '<1y';
  if (ag < 730) return '1-2y';
  if (ag < 1095) return '2-3y';
  return '3y+';
}
function ageYears(p: Proto): number {
  const ag = ageDays(p);
  return ag === null ? 1.0 : ag / 365;
}
function cheapestChain(p: Proto): { chain: string; gas: number } {
  let best = { chain: p.chains[0] ?? 'Ethereum', gas: GAS_USD[p.chains[0] ?? ''] ?? 6 };
  for (const c of p.chains) {
    const g = GAS_USD[c] ?? 6;
    if (g < best.gas) best = { chain: c, gas: g };
  }
  return best;
}
function feeUsd(p: Proto): number { const c = cheapestChain(p); return round2(5 * c.gas + 4); }

function parseArgs(): { input: string; output: string } {
  const argv = process.argv.slice(2);
  let input = process.env.MAKEFUN_INPUT ?? '/input/snapshot.json';
  let output = process.env.MAKEFUN_OUTPUT_DIR ?? '';
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--input' && argv[i + 1]) input = argv[++i]!;
    else if (argv[i] === '--output' && argv[i + 1]) output = argv[++i]!;
  }
  if (!output) throw new Error('token radar: no output directory (pass --output or MAKEFUN_OUTPUT_DIR)');
  return { input, output };
}
function houseEligible(p: Proto): boolean {
  if (p.category !== null && BOARD_INELIGIBLE.has(p.category)) return false;
  if (/\b(wrapped|staked|staking)\b/i.test(p.name)) return false;
  if (/\s(v2|V2|2\.0|v3|V3)\s*$/.test(p.name)) return false;
  const first = p.name.split(/\s+/)[0] ?? '';
  if (EXCHANGE_PREFIX.has(first)) return false;
  return true;
}

// ---------------------------------------------------------------- model fit
interface CurveFit { a: number; b: number }
function fitCurve(comps: Proto[]): CurveFit {
  const xs = comps.map((p) => log10(p.tvl_usd));
  const ys = comps.map((p) => log10(p.mcap_usd! / p.tvl_usd));
  const [a, b] = olsFit(xs, ys);
  return { a, b };
}
function curveMultiple(p: Proto, f: CurveFit): number {
  return Math.min(1, 10 ** (f.a + f.b * log10(p.tvl_usd)));
}
function curveImplied(p: Proto, f: CurveFit): number {
  return Math.max(1, Math.round(p.tvl_usd * curveMultiple(p, f) * growthFactor(p) * maturity(p)));
}
// LOO / WF error of the curve on comps, in log10(mcap) units.
function curveErrors(comps: Proto[], trainIdx: number[], testIdx: number[]): number[] {
  const f = fitCurve(trainIdx.map((i) => comps[i]!));
  return testIdx.map((i) => {
    const p = comps[i]!;
    return log10(curveImplied(p, f)) - log10(p.mcap_usd!);
  });
}
function errStats(errs: number[]): { med: number; mean: number } {
  const abs = errs.map((e) => Math.abs(e));
  return { med: 10 ** median(abs), mean: 10 ** mean(abs) };
}

// Challenger models. Each predicts mcap for a protocol from a training set.
// A/B: ridge on [1, logTVL-8, growth/10, ageY-1.5, category one-hots].
const RIDGE_CATS: string[] = [];
function ridgeFeatures(p: Proto): number[] {
  const f: number[] = [1, log10(p.tvl_usd) - 8, growthPct(p) / 10, ageYears(p) - 1.5];
  for (const c of RIDGE_CATS) f.push((p.category ?? 'None') === c ? 1 : 0);
  return f;
}
function ridgeFit(train: Proto[], lam: number): number[] {
  const d = 4 + RIDGE_CATS.length;
  const A: number[][] = Array.from({ length: d }, () => new Array<number>(d).fill(0));
  const b: number[] = new Array<number>(d).fill(0);
  for (const p of train) {
    const f = ridgeFeatures(p);
    const y = log10(p.mcap_usd!);
    for (let i = 0; i < d; i++) {
      b[i]! += f[i]! * y;
      for (let j = 0; j < d; j++) A[i]![j]! += f[i]! * f[j]!;
    }
  }
  for (let i = 1; i < d; i++) A[i]![i]! += lam;
  return solveLinear(A, b);
}
function ridgePred(p: Proto, w: number[]): number {
  const f = ridgeFeatures(p);
  let z = 0;
  for (let i = 0; i < w.length; i++) z += w[i]! * f[i]!;
  return 10 ** z;
}
// C: power law mcap ~ TVL^0.45, intercept = median residual.
// D-24: OLS log mcap on log TVL plus a per-category mean-residual shift.
// Flat: the median mcap/TVL ratio of the training comps.
// Placebo: the ratio of a fixed seeded permutation partner.
function powerPred(p: Proto, train: Proto[]): number {
  const a = median(train.map((q) => log10(q.mcap_usd!) - 0.45 * log10(q.tvl_usd)));
  return 10 ** (a + 0.45 * log10(p.tvl_usd));
}
function catShiftPred(p: Proto, train: Proto[]): number {
  const [a, b] = olsFit(train.map((q) => log10(q.tvl_usd)), train.map((q) => log10(q.mcap_usd!)));
  const byCat = new Map<string, number[]>();
  for (const q of train) {
    const k = q.category ?? 'None';
    const r = log10(q.mcap_usd!) - (a + b * log10(q.tvl_usd));
    if (!byCat.has(k)) byCat.set(k, []);
    byCat.get(k)!.push(r);
  }
  const shift = mean(byCat.get(p.category ?? 'None') ?? [0]);
  return 10 ** (a + b * log10(p.tvl_usd) + shift);
}
function flatPred(p: Proto, train: Proto[]): number {
  return p.tvl_usd * median(train.map((q) => q.mcap_usd! / q.tvl_usd));
}
function looWf(
  comps: Proto[],
  pred: (train: Proto[], p: Proto) => number,
): { medLoo: number; meanLoo: number; medWf: number; meanWf: number; wfCuts: { med: number; mean: number }[] } {
  const n = comps.length;
  const looErrs: number[] = [];
  for (let i = 0; i < n; i++) {
    const train = comps.filter((_, j) => j !== i);
    looErrs.push(log10(pred(train, comps[i]!)) - log10(comps[i]!.mcap_usd!));
  }
  const loo = errStats(looErrs);
  const dated = [...comps].sort((a, b) => (a.listed_at ?? '9999').localeCompare(b.listed_at ?? '9999'));
  const wfCuts: { med: number; mean: number }[] = [];
  for (const frac of [0.4, 0.5, 0.67]) {
    const cut = Math.floor(dated.length * frac);
    const train = dated.slice(0, cut);
    const test = dated.slice(cut);
    const errs = test.map((p) => log10(pred(train, p)) - log10(p.mcap_usd!));
    wfCuts.push(errStats(errs));
  }
  return {
    medLoo: loo.med, meanLoo: loo.mean,
    medWf: mean(wfCuts.map((c) => c.med)), meanWf: mean(wfCuts.map((c) => c.mean)), wfCuts,
  };
}

// ---------------------------------------------------------------- odds
interface OddsFit {
  weights: number[];
  cells: Map<string, [number, number]>;
  base: number;
}
function logisticFeatures(p: Proto): number[] {
  return [1, log10(p.tvl_usd) - 7.5, growthPct(p) / 10, ageYears(p) - 1.5];
}
function sigmoid(z: number): number {
  const c = clamp(z, -30, 30);
  return 1 / (1 + Math.exp(-c));
}
function fitLogistic(rows: { p: Proto; y: number }[], base: number, iters: number): number[] {
  const w = [Math.log(base / (1 - base)), 0, 0, 0];
  for (let it = 0; it < iters; it++) {
    const grad = [0, 0, 0, 0];
    for (const r of rows) {
      const f = logisticFeatures(r.p);
      const pr = sigmoid(w.reduce((s, wi, i) => s + wi * f[i]!, 0));
      for (let i = 0; i < 4; i++) grad[i]! += (pr - r.y) * f[i]!;
    }
    for (let i = 0; i < 4; i++) w[i]! -= (0.02 * grad[i]!) / rows.length;
  }
  return w;
}
function empiricalCells(rows: { p: Proto; y: number }[]): Map<string, [number, number]> {
  const cells = new Map<string, [number, number]>();
  for (const r of rows) {
    const k = `${r.p.category ?? 'None'}|${ageBand(r.p)}`;
    const c = cells.get(k) ?? [0, 0];
    c[0] += r.y;
    c[1] += 1;
    cells.set(k, c);
  }
  return cells;
}
function fitOdds(rows: { p: Proto; y: number }[], base: number): OddsFit {
  return { weights: fitLogistic(rows, base, 800), cells: empiricalCells(rows), base };
}
function oddsOf(fit: OddsFit, p: Proto): number {
  const f = logisticFeatures(p);
  const logi = sigmoid(fit.weights.reduce((s, wi, i) => s + wi * f[i]!, 0));
  const c = fit.cells.get(`${p.category ?? 'None'}|${ageBand(p)}`) ?? [0, 0];
  const emp = (c[0] + 10 * fit.base) / (c[1] + 10);
  return clamp(0.5 * logi + 0.3 * emp + 0.2 * fit.base, 0.001, 0.999);
}

// ---------------------------------------------------------------- farm steps
const CATEGORY_VERB: Record<string, string> = {
  Dexs: 'swap a small tranche and add it to the main pool',
  Lending: 'supply the deposit as collateral and borrow a small stable amount against it',
  Yield: 'stake the deposit in the highest-yield vault the protocol lists',
  'Yield Aggregator': 'route the deposit through the aggregator into its top vault',
  RWA: 'mint the protocol tokenised position with the deposit and hold it',
  'Risk Curators': 'allocate the deposit to the curator vault with the longest track record',
  CDP: 'open a collateralised position with the deposit and mint the stable asset',
  Derivatives: 'open a small hedged perpetual position with the deposit as margin',
  'Onchain Capital Allocator': 'deposit into the allocator vault and let it route across strategies',
  'Basis Trading': 'deposit into the basis vault and collect the funding-rate spread',
  'Prediction Market': 'take a small position on the market with the clearest resolution date',
  Payments: 'route a real payment through the protocol and keep the receipt trail',
};
function verbFor(p: Proto): string {
  return CATEGORY_VERB[p.category ?? ''] ?? 'use the deposit in the protocol’s core product and keep the position open';
}
function fmtUsd(x: number): string {
  return '$' + Math.round(x).toLocaleString('en-US');
}
function farmSteps(row: Record<string, any>, p: Proto): string[] {
  const name = p.name;
  const share = ((DEPOSIT / p.tvl_usd) * 100).toFixed(6);
  const cheap = cheapestChain(p);
  const net = row.net_usd as number;
  const wa = row.walk_away_x as number;
  const ev = row.ev_usd as number;
  const s1 = `Deposit ${fmtUsd(DEPOSIT)} of ${name} on ${cheap.chain} (cheapest route, gas $${cheap.gas} per tx) — ${share}% of its TVL — and ${verbFor(p)} for ${WEEKS} weeks.`;
  const s2 = `Week 3: top up activity on ${name} to keep the position live; expected value ${fmtUsd(ev)} at odds ${(row.odds as number).toFixed(3)}, walk-away ${wa.toFixed(5)}x — exit if the multiple falls below ${Math.max(0.5, wa * 0.6).toFixed(5)}x.`;
  const s3 = `Weeks 4–8: batch the weekly actions for ${name} into one transaction per week on ${cheap.chain} to save gas; total fee ${fmtUsd(row.fee_usd as number)} for the plan, net ${net >= 0 ? '+' : ''}${fmtUsd(net)} after fees.`;
  const s4 = `Week 9: check the protocol’s eligibility criteria in its own docs; farming ${name} does not guarantee you qualify for any airdrop — pause if TVL falls 30% in a week or the team goes silent for 14 days.`;
  const s5 = `Weeks 10–12: harvest or exit ${name}; under the bear case (implied x0.33) the plan is worth ${fmtUsd(ev * 0.33)} before fees, and any tokens vest over months, so record every transaction for tax.`;
  return [s1, s2, s3, s4, s5].map((s) => s.slice(0, 600));
}

// ---------------------------------------------------------------- main
function main(): void {
  const { input, output } = parseArgs();
  const snap = JSON.parse(readFileSync(input, 'utf8')) as Snap;
  const watch = new Set(snap.watchlist);
  const bySlug = new Map(snap.protocols.map((p) => [p.slug, p]));

  // --- comps: traded with mcap > 0 (128 "dirty"), minus 8 ineligible categories (92 clean)
  const dirty = snap.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0);
  const clean = dirty.filter((p) => !(p.category !== null && COMP_INELIGIBLE.has(p.category)));
  const zeroMcap = snap.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd <= 0);
  const curve = fitCurve(clean);
  const flatRatio = median(clean.map((p) => p.mcap_usd! / p.tvl_usd));
  const capped = clean.filter((p) => 10 ** (curve.a + curve.b * log10(p.tvl_usd)) > 1).length;

  // --- board pool: pre-token by the snapshot's own record (no mcap, no
  // gecko id, no symbol) and house-eligible; top 198 by TVL.
  const pure = snap.protocols.filter((p) => p.mcap_usd === null && p.gecko_id === null && p.symbol === null);
  const eligible = pure.filter(houseEligible);
  const eligibleSorted = [...eligible].sort((a, b) => b.tvl_usd - a.tvl_usd);
  const boardPool = eligibleSorted.slice(0, 198);
  const eligibleNotBoard = eligibleSorted.slice(198);
  const ineligiblePre = pure.filter((p) => !houseEligible(p));
  const tradedProducts = snap.protocols.filter((p) => p.symbol !== null && p.mcap_usd === null);

  // --- curve LOO / WF (curve predicts mcap with growth x maturity)
  const nClean = clean.length;
  const allIdx = clean.map((_, i) => i);
  const looErrs: number[] = [];
  for (let i = 0; i < nClean; i++) {
    const train = allIdx.filter((j) => j !== i);
    looErrs.push(...curveErrors(clean, train, [i]));
  }
  const looStats = errStats(looErrs);
  const dated = [...clean].sort((a, b) => (a.listed_at ?? '9999').localeCompare(b.listed_at ?? '9999'));
  const wfCuts: { med: number; mean: number }[] = [];
  const pooledWfErrs: { p: Proto; err: number }[] = [];
  for (const frac of [0.4, 0.5, 0.67]) {
    const cut = Math.floor(dated.length * frac);
    const trainIdx = dated.slice(0, cut).map((p) => clean.indexOf(p));
    const testIdx = dated.slice(cut).map((p) => clean.indexOf(p));
    const errs = curveErrors(clean, trainIdx, testIdx);
    wfCuts.push(errStats(errs));
    testIdx.forEach((idx, k) => pooledWfErrs.push({ p: clean[idx]!, err: errs[k]! }));
  }
  const medWf = mean(wfCuts.map((c) => c.med));
  const meanWf = mean(wfCuts.map((c) => c.mean));

  // --- challengers (same LOO/WF protocol)
  RIDGE_CATS.push(...[...new Set(clean.map((p) => p.category ?? 'None'))].sort());
  const chalCurve = looWf(clean, (tr, p) => curveImplied(p, fitCurve(tr)));
  const chalA = looWf(clean, (tr, p) => ridgePred(p, ridgeFit(tr, 30)));
  const chalB = looWf(clean, (tr, p) => ridgePred(p, ridgeFit(tr, 3)));
  const chalC = looWf(clean, (tr, p) => powerPred(p, tr));
  const chalD = looWf(clean, (tr, p) => catShiftPred(p, tr));
  const chalFlat = looWf(clean, (tr, p) => flatPred(p, tr));
  const rngPlacebo = mulberry32(20261114);
  const perm = [...clean.keys()];
  for (let i = perm.length - 1; i > 0; i--) { const j = Math.floor(rngPlacebo() * (i + 1)); [perm[i], perm[j]] = [perm[j]!, perm[i]!]; }
  const placeboErrs = clean.map((p, i) => {
    const q = clean[perm[i]!]!;
    return log10(p.tvl_usd * (q.mcap_usd! / q.tvl_usd)) - log10(p.mcap_usd!);
  });
  const placebo = errStats(placeboErrs);

  // --- Spearman curve vs ridge-A on the board pool, and top-10 overlap
  const wA = ridgeFit(clean, 30);
  const boardCurve = boardPool.map((p) => curveImplied(p, curve));
  const boardA = boardPool.map((p) => ridgePred(p, wA));
  const rankOf = (xs: number[]): Map<number, number> => {
    const order = xs.map((v, i) => [v, i] as [number, number]).sort((a, b) => b[0] - a[0]);
    const m = new Map<number, number>();
    order.forEach(([_, i], r) => m.set(i, r + 1));
    return m;
  };
  const rc = rankOf(boardCurve);
  const ra = rankOf(boardA);
  const nB = boardPool.length;
  const meanRank = (nB + 1) / 2;
  let num = 0; let dc = 0; let da = 0;
  for (let i = 0; i < nB; i++) {
    const x = rc.get(i)! - meanRank; const y = ra.get(i)! - meanRank;
    num += x * y; dc += x * x; da += y * y;
  }
  const spearman = dc === 0 || da === 0 ? 0 : num / Math.sqrt(dc * da);
  const top10Curve = new Set(boardPool.map((p, i) => [boardCurve[i]!, p.slug] as [number, string]).sort((a, b) => b[0] - a[0]).slice(0, 10).map((t) => t[1]));
  const top10A = new Set(boardPool.map((p, i) => [boardA[i]!, p.slug] as [number, string]).sort((a, b) => b[0] - a[0]).slice(0, 10).map((t) => t[1]));
  const overlap10 = [...top10Curve].filter((s) => top10A.has(s)).length;

  // --- odds ensemble on 92 traded (y=1) vs 198 board rows (y=0)
  const baseRate = clean.length / (clean.length + boardPool.length);
  const fitRows: { p: Proto; y: number }[] = [
    ...clean.map((p) => ({ p, y: 1 })),
    ...boardPool.map((p) => ({ p, y: 0 })),
  ];
  const oddsFit = fitOdds(fitRows, baseRate);
  const oddsOfRow = (p: Proto): number => oddsOf(oddsFit, p);
  // Walk-forward odds: 3 cuts by listing date among dated fit rows.
  const datedRows = fitRows.filter((r) => r.p.listed_at !== null).sort((a, b) => a.p.listed_at!.localeCompare(b.p.listed_at!));
  const oddsWf: { brier: number; brierBase: number; calledRight: number; n: number }[] = [];
  for (const frac of [0.4, 0.5, 0.67]) {
    const cut = Math.floor(datedRows.length * frac);
    const train = datedRows.slice(0, cut);
    const test = datedRows.slice(cut);
    const f = fitOdds(train, baseRate);
    const baseTr = mean(train.map((r) => r.y));
    let brier = 0; let brierBase = 0; let cr = 0;
    for (const r of test) {
      const o = oddsOf(f, r.p);
      brier += (o - r.y) ** 2;
      brierBase += (baseTr - r.y) ** 2;
      if ((o >= 0.5 ? 1 : 0) === r.y) cr++;
    }
    oddsWf.push({ brier: brier / test.length, brierBase: brierBase / test.length, calledRight: cr / test.length, n: test.length });
  }
  // Tier pooled launch rates on all fit rows.
  const tierOf = (o: number): string => (o >= 0.5 ? 'HIGH' : o >= 0.35 ? 'MED' : 'LOW');
  const tierPooled: Record<string, { n: number; launched: number; rate: number }> = {};
  for (const t of ['HIGH', 'MED', 'LOW']) {
    const sel = fitRows.filter((r) => tierOf(oddsOfRow(r.p)) === t);
    tierPooled[t] = { n: sel.length, launched: sel.reduce((s, r) => s + r.y, 0), rate: sel.length === 0 ? 0 : sel.reduce((s, r) => s + r.y, 0) / sel.length };
  }

  // --- calibration: terciles by TVL on pooled WF errors; jackknife+ width
  const pooledSorted = [...pooledWfErrs].sort((a, b) => a.p.tvl_usd - b.p.tvl_usd);
  const tercileFactors: { fIn: number; fOut: number; covIn: number; covOut: number; n: number }[] = [];
  for (let t = 0; t < 3; t++) {
    const part = pooledSorted.slice(Math.floor((t * pooledSorted.length) / 3), Math.floor(((t + 1) * pooledSorted.length) / 3));
    const abs = part.map((e) => Math.abs(e.err));
    const fIn = 10 ** median(abs);
    const fOut = 10 ** quantile(abs, 0.8);
    tercileFactors.push({
      fIn, fOut,
      covIn: part.filter((e) => Math.abs(e.err) <= log10(fIn)).length / part.length,
      covOut: part.filter((e) => Math.abs(e.err) <= log10(fOut)).length / part.length,
      n: part.length,
    });
  }
  const jkFactor = 10 ** quantile(looErrs.map((e) => Math.abs(e)), 0.7);
  const jkCoverage = looErrs.filter((e) => Math.abs(e) <= log10(jkFactor)).length / looErrs.length;
  const tercileOf = (tvl: number): number => {
    const tvls = [...boardPool.map((p) => p.tvl_usd)].sort((a, b) => a - b);
    const lo = tvls[Math.floor(tvls.length / 3)]!;
    const hi = tvls[Math.floor((2 * tvls.length) / 3)]!;
    return tvl < lo ? 0 : tvl < hi ? 1 : 2;
  };

  // --- D-02 time-split (cut-off 2026-03-12; null listed_at counts as test)
  const d02Train = clean.filter((p) => p.listed_at !== null && p.listed_at < CUT_OFF);
  const d02Test = clean.filter((p) => !(p.listed_at !== null && p.listed_at < CUT_OFF));
  const d02Errs = d02Test.map((p) => log10(curveImplied(p, fitCurve(d02Train))) - log10(p.mcap_usd!));
  const d02 = { train: d02Train.length, test: d02Test.length, ...errStats(d02Errs) };

  // --- bootstrap top-20 stability (200 seeded refits)
  const rngBoot = mulberry32(20261114);
  const top20Base = new Set(
    [...boardPool].map((p) => [curveImplied(p, curve), p.slug] as [number, string]).sort((a, b) => b[0] - a[0]).slice(0, 20).map((t) => t[1]),
  );
  let bootSum = 0;
  for (let b = 0; b < 200; b++) {
    const sample = Array.from({ length: clean.length }, () => clean[Math.floor(rngBoot() * clean.length)]!);
    const f = fitCurve(sample);
    const top = new Set(
      [...boardPool].map((p) => [curveImplied(p, f), p.slug] as [number, string]).sort((a, b) => b[0] - a[0]).slice(0, 20).map((t) => t[1]),
    );
    bootSum += [...top20Base].filter((s) => top.has(s)).length / 20;
  }
  const bootStability = bootSum / 200;

  // --- board rows
  const logTvlMin = Math.min(...clean.map((p) => log10(p.tvl_usd)));
  const logTvlMax = Math.max(...clean.map((p) => log10(p.tvl_usd)));
  const catCounts = new Map<string, number>();
  for (const p of clean) catCounts.set(p.category ?? 'None', (catCounts.get(p.category ?? 'None') ?? 0) + 1);
  const catRank = new Map<string, number>();
  {
    const byCat = new Map<string, Proto[]>();
    for (const p of boardPool) {
      const k = p.category ?? 'None';
      if (!byCat.has(k)) byCat.set(k, []);
      byCat.get(k)!.push(p);
    }
    for (const [k, arr] of byCat) {
      arr.sort((a, b) => b.tvl_usd - a.tvl_usd);
      arr.forEach((p, i) => catRank.set(p.slug, i + 1));
    }
  }
  interface RowOut { [k: string]: unknown }
  const rows: RowOut[] = [];
  const scored = boardPool.map((p) => {
    const implied = curveImplied(p, curve);
    const mult = curveMultiple(p, curve);
    const odds = oddsOfRow(p);
    const ev = implied * odds;
    const fee = feeUsd(p);
    const net = round2(ev * FARM_SHARE - fee);
    const verdict = ev >= EV_FARM && odds >= ODDS_FARM ? 'FARM' : ev >= EV_MARGINAL && odds >= ODDS_MARGINAL ? 'MARGINAL' : 'SKIP';
    const t = tercileOf(p.tvl_usd);
    const tf = tercileFactors[t]!;
    const be = ev * FARM_SHARE === 0 ? null : (fee * DEPOSIT) / (ev * FARM_SHARE);
    const walkAway = ev / ((fee + 25) * 100000);
    const ag = ageDays(p);
    const flagged = log10(p.tvl_usd) < logTvlMin || log10(p.tvl_usd) > logTvlMax || (p.change_7d !== null && (p.change_7d < -40 || p.change_7d > 3));
    const flags: string[] = [];
    if (flagged) flags.push('extrapolation');
    if (watch.has(p.slug)) flags.push('watchlist');
    if (ag === null) flags.push('age-unknown');
    if (mult >= 1) flags.push('capped');
    const signals =
      (growthPct(p) > 0 ? 1 : 0) + (ag !== null && ag >= 365 ? 1 : 0) + (watch.has(p.slug) ? 1 : 0) +
      (mult > flatRatio ? 1 : 0) + ((catCounts.get(p.category ?? 'None') ?? 0) >= 3 ? 1 : 0) +
      (p.tvl_usd >= median(boardPool.map((q) => q.tvl_usd)) ? 1 : 0);
    return { p, implied, mult, odds, ev, fee, net, verdict, t, tf, be, walkAway, ag, flags, signals };
  });
  scored.sort((a, b) => b.implied - a.implied);
  scored.forEach((s, i) => {
    const p = s.p;
    const row: RowOut = {
      slug: p.slug, name: p.name, rank: i + 1, implied_value_usd: s.implied,
      tvl_usd: p.tvl_usd, growth_7d_pct: p.change_7d, age_days: s.ag,
      multiple: round5(s.mult), category: p.category, chains: p.chains,
      watchlist: watch.has(p.slug), odds: round5(s.odds), verdict: s.verdict,
      net_usd: s.net, fee_usd: s.fee,
      range_lo_usd: Math.round(s.implied / s.tf.fIn), range_hi_usd: Math.round(s.implied * s.tf.fIn),
      range_outer_lo_usd: Math.round(s.implied / s.tf.fOut), range_outer_hi_usd: Math.round(s.implied * s.tf.fOut),
      jk_lo_usd: Math.round(s.implied / jkFactor), jk_hi_usd: Math.round(s.implied * jkFactor),
      tercile: s.t + 1,
      delta_flat_x: round5(s.mult / flatRatio), delta_net_usd: round2(s.net - 25),
      break_even_usd: s.be !== null && s.be <= BE_CAP ? Math.round(s.be) : null,
      walk_away_x: round5(s.walkAway),
      comps_n: catCounts.get(p.category ?? 'None') ?? 0, flags: s.flags,
      ev_usd: Math.round(s.ev),
      launch_score: Math.round(s.odds * 100),
      conviction: s.odds >= 0.5 ? 'HIGH' : s.odds >= 0.35 ? 'MED' : 'LOW',
      signals: s.signals, gas_share_pct: round2((s.fee / DEPOSIT) * 100),
      net_per_1k_usd: round2(s.net / 5),
      cat_tvl_rank: catRank.get(p.slug) ?? null,
      cheapest_chain: cheapestChain(p).chain,
    };
    row.farm_steps = farmSteps(row, p);
    rows.push(row);
  });

  // --- derived stats
  const total = rows.reduce((s, r) => s + (r.implied_value_usd as number), 0);
  const medImp = median(rows.map((r) => r.implied_value_usd as number));
  const verdicts = { FARM: 0, MARGINAL: 0, SKIP: 0 };
  for (const r of rows) verdicts[r.verdict as keyof typeof verdicts]++;
  const farmRows = scored.filter((s) => s.verdict === 'FARM');
  const beFinite = scored.filter((s) => s.be !== null && s.be <= BE_CAP).map((s) => s.be!);
  const bearVerdicts = { FARM: 0, MARGINAL: 0, SKIP: 0 };
  for (const s of scored) {
    const evB = s.ev * 0.33;
    const v = evB >= EV_FARM && s.odds >= ODDS_FARM ? 'FARM' : evB >= EV_MARGINAL && s.odds >= ODDS_MARGINAL ? 'MARGINAL' : 'SKIP';
    bearVerdicts[v as keyof typeof bearVerdicts]++;
  }
  const bullFarm25 = scored.filter((s) => s.ev * 2.5 >= EV_FARM && s.odds >= ODDS_FARM).length;
  const bullFarm3 = scored.filter((s) => s.ev * 3 >= EV_FARM && s.odds >= ODDS_FARM).length;
  const top1 = rows[0] as RowOut;
  const stats = {
    snapshot_as_of: snap.as_of, protocols: snap.protocols.length, watchlist: snap.watchlist.length,
    clean_comps: clean.length, dirty_comps: dirty.length, zero_mcap_traded: zeroMcap.length,
    board_rows: rows.length, total_implied_usd: total, median_implied_usd: medImp,
    top1_slug: top1.slug, top1_name: top1.name, top1_implied_usd: top1.implied_value_usd,
    expected_value_usd: Math.round(rows.reduce((s, r) => s + (r.ev_usd as number), 0)),
    verdicts, tier_pooled: tierPooled,
    tier_board: {
      HIGH: rows.filter((r) => (r.odds as number) >= 0.5).length,
      MED: rows.filter((r) => (r.odds as number) >= 0.35 && (r.odds as number) < 0.5).length,
      LOW: rows.filter((r) => (r.odds as number) < 0.35).length,
    },
    curve: { a: curve.a, b: curve.b, med_loo: looStats.med, mean_loo: looStats.mean, med_wf: medWf, mean_wf: meanWf, wf_cuts: wfCuts, capped_rows: capped, flat_ratio: flatRatio },
    challengers: {
      curve: chalCurve, ridge_lam30: chalA, ridge_lam3: chalB, power_045: chalC, ols_cat_shift: chalD,
      flat_median: chalFlat, placebo: { medLoo: placebo.med, meanLoo: placebo.mean },
    },
    spearman_curve_vs_ridgeA: round5(spearman), top10_overlap_curve_vs_ridgeA: overlap10,
    odds_wf: oddsWf,
    calibration: { terciles: tercileFactors, jk_factor: jkFactor, jk_coverage_loo: jkCoverage },
    bootstrap_top20: bootStability, d02,
    break_even: { finite: beFinite.length, never: scored.length - beFinite.length, median_finite_usd: beFinite.length ? Math.round(median(beFinite)) : null, max_finite_usd: beFinite.length ? Math.round(Math.max(...beFinite)) : null },
    walk_away_farm: {
      median: farmRows.length ? round5(median(farmRows.map((s) => s.walkAway))) : null,
      fragile_1_to_1_5: farmRows.filter((s) => s.walkAway >= 1 && s.walkAway < 1.5).length,
      robust_ge_2: farmRows.filter((s) => s.walkAway >= 2).length,
    },
    bear_x033: bearVerdicts, bull_farm_x25: bullFarm25, bull_farm_x3: bullFarm3,
    extrapolation_flags: rows.filter((r) => (r.flags as string[]).includes('extrapolation')).length,
    ledger: {
      board: rows.length, clean_comps: clean.length, dirty_excluded_comps: dirty.length - clean.length,
      zero_mcap_traded: zeroMcap.length, eligible_not_board: eligibleNotBoard.length,
      pretoken_ineligible: ineligiblePre.length, traded_token_products: tradedProducts.length, total: snap.protocols.length,
    },
    watchlist_covered: rows.filter((r) => r.watchlist).length,
    signals_median: median(scored.map((s) => s.signals)),
    launch_score_median: median(rows.map((r) => r.launch_score as number)),
    net_per_1k_median_usd: median(rows.map((r) => r.net_per_1k_usd as number)),
    gas_share_median_pct: median(rows.map((r) => r.gas_share_pct as number)),
    net_median_usd: median(rows.map((r) => r.net_usd as number)),
    net_sum_positive_usd: round2(rows.reduce((s, r) => s + Math.max(0, r.net_usd as number), 0)),
  };

  // --- write outputs
  mkdirSync(output, { recursive: true });
  mkdirSync(join(output, 'dashboard'), { recursive: true });
  mkdirSync(join(output, 'screenshots'), { recursive: true });
  const board = { meta: stats, rows };
  writeFileSync(join(output, 'board.json'), JSON.stringify(board, null, 2) + '\n');
  const data = { meta: stats, rows, calendar: calendarRows(top1), top10: (rows.slice(0, 10) as RowOut[]).map((r) => ({ slug: r.slug, name: r.name, rank: r.rank, implied: r.implied_value_usd, tvl: r.tvl_usd, odds: r.odds, verdict: r.verdict, net: r.net_usd })) };
  writeFileSync(join(output, 'data.js'), 'window.TOKEN_RADAR = ' + JSON.stringify(data) + ';\n');
  for (const f of ['index.html', 'app.css', 'app.js']) {
    copyFileSync(join(HERE, 'dashboard', f), join(output, 'dashboard', f));
  }
  const shots = readdirSync(join(HERE, 'screenshots')).filter((n) => !n.startsWith('.')).sort();
  if (shots.length < 3) {
    process.stderr.write(`token radar: screenshots/ holds ${shots.length} image(s): hand in 3, the board, a detail view and a filtered view\n`);
    process.exit(1);
  }
  for (const name of shots) {
    if (!/^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/.test(name)) {
      process.stderr.write(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
      process.exit(1);
    }
    copyFileSync(join(HERE, 'screenshots', name), join(output, 'screenshots', name));
  }
  writeFileSync(join(output, 'dossier.json'), buildDossier(output, {
    text_max_bytes: TEXT_MAX_BYTES,
    screenshots: { max: 4, max_bytes: 524288 },
    dashboard: { max_files: 400, max_bytes: 4194304 },
  }));
  process.stdout.write(
    `token radar v16: ${snap.protocols.length} protocols, ${snap.watchlist.length} watchlist, ${rows.length} rows, total $${total.toLocaleString('en-US')}, top-1 ${top1.name} $${(top1.implied_value_usd as number).toLocaleString('en-US')}, verdicts ${verdicts.FARM}/${verdicts.MARGINAL}/${verdicts.SKIP}\n` +
    `token radar v16: wrote ${join(output, 'board.json')}, ${join(output, 'data.js')}, ${join(output, 'dashboard')}, ${join(output, 'screenshots')} (${shots.length} images), ${join(output, 'dossier.json')}\n`,
  );
}

function calendarRows(top1: Record<string, any>): { week: number; action: string; cost_usd: number; hours: number }[] {
  const weeks = [1, 2, 3, 4, 5, 6, 8, 9, 11, 12];
  const actions = [
    'Deposit $5,000 on the cheapest chain and open the core position',
    'First weekly batch: one transaction, check TVL and growth',
    'Top-up activity; confirm the position still qualifies',
    'Mid-month review: compare implied value vs the board',
    'Batch two weeks of actions into one transaction',
    'Re-check eligibility criteria and pause rules',
    'Harvest any points or yield; keep the principal working',
    'Stress-check: bear-case value and exit thresholds',
    'Final top-up week; confirm all steps are recorded',
    'Week 12: harvest or exit; log the full 12-week record',
  ];
  return weeks.map((w, i) => ({ week: w, action: actions[i]!, cost_usd: 50, hours: 0.5 }));
}

main();
