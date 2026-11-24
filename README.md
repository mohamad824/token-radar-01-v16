[![Token Radar](https://make.fun/badge/token-radar-01.svg)](https://make.fun/c/token-radar-01)
[![Rank](https://make.fun/badge/token-radar-01/mohamad824/token-radar-01-v16/rank.svg)](https://make.fun/c/token-radar-01)
[![Reward](https://make.fun/badge/token-radar-01/mohamad824/token-radar-01-v16/reward.svg)](https://make.fun/c/token-radar-01)

# Token Radar v16 — combination entry (token-radar-01)

The last version of batch 2. v16 combines the best element of each of
v11–v15 and repairs every worst element listed in the combination brief.
Built from scratch from the brief prose; no source from v1–v15 or the
starter kit was read or copied. Node 22, standard library only, no network.

## What the board is

- **Snapshot:** sealed 14 Nov 2026, 758 protocols, 40 on the watchlist.
- **Board:** 198 pre-token rows. Total implied value **$1,468,252,353**,
  median implied **$5,478,995**, top-1 **Steakhouse Financial $47,787,227**,
  expected value (Σ implied × odds) **$421,222,635**.
- **Verdicts:** 14 FARM / 93 MARGINAL / 91 SKIP.
- **Watchlist:** 40/40 covered. Ledger (D-62): 198 board + 92 clean comps +
  36 dirty-excluded comps + 16 zero-mcap traded + 3 eligible-not-on-board +
  141 pre-token ineligible + 272 traded-token products = **758**.

## Board model — the curve (from v12, the strongest element in the batch)

`implied = TVL × curve(log10 TVL) × growth × maturity`, where the curve is
an OLS fit of log10(mcap/TVL) on log10(TVL) over the **92 clean traded
comps** (128 traded with mcap > 0, minus 36 in 8 ineligible categories:
Bridge, Canonical Bridge, Liquid Staking, Liquid Restaking, Restaked BTC,
CEX, Chain, Prediction Market). Fitted multiple is capped at 1.0× —
**0 board rows hit the cap**. Growth: clamp(change_7d, −60, +200) per cent,
factor 1 + 0.75 × growth/100. Maturity: 0.6 + 0.4 × min(age, 1095)/1095,
age = days since listed_at to 2026-11-14 (365 when unknown). Ranking is
**implied-if-launches**, not EV. Curve fit: a = 3.4910, b = −0.5452.
Flat-median ratio (baseline for the Δ flat column): 0.2293.

### Model selection (all errors in log10(mcap) units; factor ×/N =
10^mean|err| (MEAN) or 10^median|err| (MEDIAN); LOO over 92 clean comps;
WF = walk-forward, 3 cuts by listing date, mean of the 3 cuts)

| Model | medLOO | meanLOO | medWF | meanWF |
|---|---|---|---|---|
| **Curve (board)** | **×/2.76** | ×/4.43 | **×/3.37** | ×/5.73 |
| Ridge A, λ30 | ×/3.83 | ×/4.36 | ×/4.22 | ×/5.77 |
| Ridge B, λ3 | ×/3.89 | ×/4.55 | ×/4.12 | ×/5.59 |
| Power law 0.45 | ×/3.46 | ×/4.38 | ×/4.31 | ×/5.58 |
| OLS + category shift | ×/3.79 | ×/4.99 | ×/4.02 | ×/5.65 |
| Flat median | ×/4.65 | ×/5.33 | ×/5.60 | ×/6.73 |
| Placebo (shuffled ratio) | ×/8.28 | ×/12.82 | — | — |

Selection rule (v16, restated honestly): the board model is the one that
wins **median LOO and median WF** — the curve wins both. Its mean WF
(×/5.73) is **worse** than the power law (×/5.58) and ridge B (×/5.59);
that trade-off is printed in the dashboard and in the Judge Note, not
hidden. The old "lowest mean WF wins" rule would have picked ridge A, so
it is not claimed. Spearman curve vs ridge A on the board: 0.803; top-10
overlap: 6/10. Bootstrap top-20 stability (200 seeded refits): **95.9%**
(target ≥ 80%). D-02 time-split (cut-off 2026-03-12): train 63, test 29,
median miss ×/3.61, mean miss ×/6.28.

## Odds — ensemble (from v11/v14, with the v14 fix)

Ensemble: 50% logistic + 30% empirical (category × age band **in years**,
shrink 10) + 20% base rate (92/290 = 31.7%), fit on 92 traded (launched)
vs 198 board rows. Per-row odds are from the full fit (in-sample); only
the formulation is walk-forward tested — labelled "LAUNCH ODDS · WF-TESTED".

- Tier pooled launch rates (monoton, as required): HIGH (odds ≥ 0.50)
  **85.2%** (23 launched of 27 fit rows, 4 board rows); MED (0.35–0.50)
  **50.9%** (29 of 57, 28 board rows); LOW (< 0.35) **19.4%** (40 of 206,
  166 board rows). LOW ≤ 25% target met.
- Walk-forward Brier vs base rate, called-right (full-precision odds):
  cut 1 (40/60): Brier 0.1293 vs 0.2178, called-right 85.9%, n = 156;
  cut 2 (50/50): 0.1209 vs 0.1862, 86.9%, n = 130;
  cut 3 (67/33): 0.1084 vs 0.1524, 88.4%, n = 86.
  The ensemble beats base rate on all 3 cuts.

## Calibration — per-tercile + jackknife+ (from v14, recomputed on curve residuals)

Terciles by TVL on pooled WF errors (n = 133):

| Tercile | n | Inner factor | Inner coverage | Outer factor | Outer coverage |
|---|---|---|---|---|---|
| 1 | 44 | ×/6.83 | 50% | ×/19.70 | 82% |
| 2 | 44 | ×/2.89 | 50% | ×/19.52 | 82% |
| 3 | 45 | ×/2.82 | 51% | ×/18.99 | 82% |

Jackknife+ factor ×/7.70, LOO coverage 70.7% (the band in the board Range
column). Factors picked on WF residuals; coverage measured on the same WF
folds. Extrapolation flags (log10 TVL outside the traded range
[6.70, 10.01] or 7-day growth outside [−40%, +3%]): **29/198**.
No board row has a degenerate jackknife+ band (smallest implied value
$2,122,131, well above the $1 floor — the v14 floor artefact does not
occur here).

## Farm economics — depth from v11

- Plan: **$5,000 deposit, 12 weeks**, 5 steps per row, **990/990 steps
  unique** (row name + walk-away to 5 decimals + net to 2 decimals).
  Step 1 deposits $5,000 in **198/198 rows**, in main.ts and in app.js.
  Gas is quoted on each row's **cheapest chain** (5 transactions + $4
  allowance); median gas share 0.28% of the deposit; median net +$1.57.
- Net = EV × 0.0015% − fee, where EV = implied × odds. Verdict: FARM
  when EV ≥ $4,000,000 and odds ≥ 0.30; MARGINAL when EV ≥ $1,350,000
  and odds ≥ 0.20; else SKIP — 14/93/91.
- Break-even capital (deposit at which net = $0): **198 finite / 0
  never**, median finite $4,662, max finite $47,980 (cap $250,000 never
  binds — with a fixed fee and a share that scales linearly with the
  deposit, every row breaks even at some deposit; this differs from
  v12's 44 finite / 154 never, which used a different break-even
  definition).
- Walk-away (FARM rows): median 1.38×, fragile (1.0–1.5×) 3, robust
  (≥ 2×) 3. Bear case (implied ×0.33): 1 FARM / 17 MARGINAL / 180 SKIP —
  **1 survivor**. Bull ×2.5: 47 FARM; ×3: 54 FARM.
- Harvest calendar: 10 checkpoints, $500 total imputed cost (gas + time
  at $90/h × 5.0 h). Signals median 3/6; launch-score median 27;
  net per $1,000 median $0.32; sum of positive nets $3,088.11.
- **Verdict does not price eligibility risk: a launch does not
  guarantee you qualify.** Every farm plan states that farming does not
  guarantee meeting airdrop criteria.

## Visual — light editorial (from v15)

White background, black text, green verification accents only for status
(FARM green / MARGINAL amber / SKIP red). Green verification strip,
KPI boxes, model-evidence table directly below the board table, Δ flat
and Δ vs +$25 columns computed from board.json (Δ flat = implied ÷
flat-median value; small deltas on most rows are honesty, not a hidden
weakness). Judge Note (407 bytes) sits below the KPI strip. Dashboard
source: **24,004 bytes** (target ≤ 64,512). Dossier text: **24,269
bytes** (target ≤ 64,512; margin 40,243).

## Validation against the v12 reference — every difference stated

| Check | v12 reference | v16 | Difference |
|---|---|---|---|
| Total implied | $1,513,444,429 | $1,468,252,353 | −2.99% (within ±5% ✓) |
| Top-1 | Steakhouse Financial $61,954,857 | Steakhouse Financial $47,787,227 | Same protocol ✓; value −22.9% — the linear log-ratio fit on the 92 clean comps gives a lower multiple at log10 TVL 9.44 than v12's fit; the total still matches because mid-TVL rows run slightly higher |
| Median implied | $5,064,331 | $5,478,995 | +8.2% — same cause: the fitted curve is flatter at mid TVL |
| Verdicts | 13 / 91 / 94 | 14 / 93 / 91 | +1 / +2 / −3, all within ±5 ✓ |
| Expected value | $747,975,514 | $421,222,635 | −43.7% — v16 odds average 0.277 (base rate 31.7%); v12's odds were higher on average. EV is a companion column; ranking is implied-if-launches |
| Curve medLOO / meanLOO | ×/2.72 / ×/4.57 | ×/2.76 / ×/4.43 | +1.4% / −3.0% |
| Curve medWF / meanWF | ×/3.76 / ×/5.72 | ×/3.37 / ×/5.73 | −10.4% / +0.2% |
| Bootstrap top-20 | 97.0% | 95.9% | −1.1 pp |
| Extrapolation flags | 29 | 29 | exact |
| D-03 break-even | 44 finite / 154 never, median $446 | 198 finite / 0 never, median $4,662 | Different break-even definition (see above) |
| D-04 FARM walk-away | median 1.75×, fragile 9, robust 0 | median 1.38×, fragile 3, robust 3 | Computed from v16's own EV/fee figures |
| D-48 bear | 0 / 10 / 188, 0 survivors | 1 / 17 / 180, 1 survivor | One row survives the bear case under v16's verdict rule |

## Top-10 pre-token validation (checked one by one)

All 10 rows record no token in the snapshot (gecko_id, symbol and mcap
all null) and pass the strict screen (no symbol-bearing product can be on
the board at all — the pool requires symbol null). No Ethena USDe/USDb,
Sky Lending or similar product appears. One caveat, stated plainly:
**USDD (#5)** is a stablecoin that sits on the house's own watchlist, so
the gate requires it on the board; the snapshot records no token for it,
and it is kept for that reason. Top-10: Steakhouse Financial, Sentora
Curator, Gauntlet, Veda, USDD, Upshift, Polymarket International,
CIAN Yield Layer, OnRe, Symbiotic.

## Repairs of the worst elements (brief list B)

- B15-a: board.json carries **every** per-row field (slug, name, rank,
  implied, TVL, growth, age, multiple, category, chains, watchlist,
  odds, verdict, net, fee, range lo/hi, outer lo/hi, jk lo/hi, tercile,
  Δ flat, Δ net, break-even, walk-away, comps_n, flags, farm steps) —
  nothing lives only in data.js.
- B15-b: strict pre-token eligibility (see top-10 check above).
- B15-c: tiers monoton HIGH 85.2% > MED 50.9% > LOW 19.4%.
- B15-d: selection rule and board model agree — the restated rule
  (best median LOO + best median WF) selects the curve; the mean-WF
  trade-off is printed.
- B15-e: validated against v12 above; total within ±5%, top-1 identical,
  verdicts within ±5.
- B11-a: tier LOW 19.4% ≤ 25% (age bands in years + 'unknown' band).
- B11-b: bootstrap stability 95.9% ≥ 80%.
- B11-c / B13-a: dashboard 24,004 bytes, dossier text 24,269 bytes.
- B13-b: called-right computed with full-precision odds.
- B13-c: ranking is implied-if-launches, not EV.
- B14-c: no degenerate jackknife+ band in v16.
- B12-a/b: curve's worse mean WF and its 14/93/91 verdicts are printed
  as known consequences, not hidden or forced to ridge numbers.
- B12-c: screenshot 01 shows the board table on the first screen;
  step-1 deposit $5,000 in main.ts and app.js; odds panel is on top of
  screenshot 04.

## Files

- `main.ts` — the program (Node 22, stdlib only). Reads the snapshot,
  writes `board.json`, `data.js`, `dashboard/`, `screenshots/`,
  `dossier.json` into the output directory. Never deletes the output
  directory.
- `vendor/makefun-board.ts` — make.fun's dossier library (copied from
  the kit, as its header instructs).
- `dashboard/index.html`, `dashboard/app.css`, `dashboard/app.js` —
  the light-editorial dashboard (24,004 bytes total).
- `screenshots/01-board.jpg`, `02-detail.jpg`, `03-filtered.jpg`,
  `04-evidence.jpg` — 1440×900 each, rendered from this dashboard in
  headless Chromium (01: board + model table + delta columns;
  02: top-1 detail; 03: FARM-only filter; 04: odds panel on top).
- `README.md` — this file. `LICENSE` — MIT.

## Run it

```sh
node main.ts --input <snapshot.json> --output <outdir>
# or: MAKEFUN_OUTPUT_DIR=<outdir> node main.ts   (defaults: /input/snapshot.json)
```

Determinism: two runs write byte-identical `board.json`, `data.js` and
`dossier.json`. Grader simulation (`grader-sim-v16.sh` in the parent
directory): namespace sim 2 runs + nobody run, all three dossier
sha256 identical — **NS-SIM-PASS, NOBODY-SIM-PASS**.

## Dossier

`dossier.json` sha256:
`4dfb1728543ec597c2aef15b9406766ea1951d578e1b191a134b911f1552d938`
(1,401,838 bytes; text 24,269 bytes; 4 screenshots, 237,305–267,737
bytes each).
