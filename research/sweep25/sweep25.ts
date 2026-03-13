// Experiment 25: Additional Asset Validation (SOL)
// Repeats Exp 16 (IV dynamics) + Exp 18 (historical backtest) against SOL DVOL + SOL_USDC-PERPETUAL.
// KEY LIMITATION: SOL DVOL has only 206 records (May-Nov 2022, discontinued).
// Rolling window backtest impossible — insufficient aligned data for 365d windows.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getDVOLHistory, getTradingViewChart } from "../../src/components/deribit.js";
import { splitmix32, boxMuller } from "../../src/components/price-gen.js";
import { simulate, computeRealizedVol } from "../../src/components/strategy/simulate.ts";
import { defaultRules } from "../../src/components/strategy/rules.ts";
import { summarizeRun } from "../../src/components/monte-carlo.ts";
import type { StrategyConfig } from "../../src/components/strategy/types.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "data");
const SOL_DVOL_CACHE = join(DATA_DIR, "sol_dvol.json");
const SOL_PRICE_CACHE = join(DATA_DIR, "sol_prices.json");
const ETH_DATA_DIR = join(__dirname, "..", "sweep16", "data");
const BTC_DATA_DIR = join(__dirname, "..", "sweep24", "data");

// ── Data Fetch & Cache ──────────────────────────────────────────

interface DailyRecord { date: string; close: number }

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function fetchSOLDVOL(): Promise<DailyRecord[]> {
  if (existsSync(SOL_DVOL_CACHE)) {
    console.log("  Loading cached SOL DVOL data...");
    return JSON.parse(readFileSync(SOL_DVOL_CACHE, "utf-8"));
  }
  console.log("  Fetching SOL DVOL from Deribit...");
  const start = Date.UTC(2020, 0, 1);
  const end = Date.now();
  const raw = await getDVOLHistory("SOL", start, end, "1D");

  const byDate = new Map<string, number>();
  for (const r of raw) byDate.set(dateKey(r.date), r.close);

  const result: DailyRecord[] = Array.from(byDate.entries())
    .map(([date, close]) => ({ date, close }))
    .sort((a, b) => a.date.localeCompare(b.date));

  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(SOL_DVOL_CACHE, JSON.stringify(result, null, 2));
  console.log(`  Cached ${result.length} SOL daily DVOL records.`);
  return result;
}

async function fetchSOLPrices(): Promise<DailyRecord[]> {
  if (existsSync(SOL_PRICE_CACHE)) {
    console.log("  Loading cached SOL price data...");
    return JSON.parse(readFileSync(SOL_PRICE_CACHE, "utf-8"));
  }
  console.log("  Fetching SOL_USDC-PERPETUAL prices from Deribit...");
  const start = Date.UTC(2020, 0, 1);
  const end = Date.now();
  const raw = await getTradingViewChart("SOL_USDC-PERPETUAL", "1D", start, end);

  const byDate = new Map<string, number>();
  for (const r of raw) byDate.set(dateKey(r.date), r.close);

  const result: DailyRecord[] = Array.from(byDate.entries())
    .map(([date, close]) => ({ date, close }))
    .sort((a, b) => a.date.localeCompare(b.date));

  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(SOL_PRICE_CACHE, JSON.stringify(result, null, 2));
  console.log(`  Cached ${result.length} SOL daily price records.`);
  return result;
}

// ── Statistics Helpers ──────────────────────────────────────────

function mean(arr: number[]): number {
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}
function std(arr: number[], m?: number): number {
  const mu = m ?? mean(arr);
  return Math.sqrt(arr.reduce((s, v) => s + (v - mu) ** 2, 0) / (arr.length - 1));
}
function percentile(sorted: number[], p: number): number {
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}
function skewness(arr: number[]): number {
  const m = mean(arr);
  const s = std(arr, m);
  const n = arr.length;
  return (n / ((n - 1) * (n - 2))) * arr.reduce((acc, v) => acc + ((v - m) / s) ** 3, 0);
}
function kurtosis(arr: number[]): number {
  const m = mean(arr);
  const s = std(arr, m);
  return arr.reduce((acc, v) => acc + ((v - m) / s) ** 4, 0) / arr.length;
}
function autocorrelation(arr: number[], lag: number): number {
  const n = arr.length;
  if (lag >= n) return 0;
  const m = mean(arr);
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    den += (arr[i] - m) ** 2;
    if (i >= lag) num += (arr[i] - m) * (arr[i - lag] - m);
  }
  return num / den;
}
function trailingRV(logReturns: number[], lookback: number): number[] {
  const rv: number[] = [];
  for (let i = 0; i < logReturns.length; i++) {
    if (i < lookback - 1) { rv.push(NaN); continue; }
    const window = logReturns.slice(i - lookback + 1, i + 1);
    rv.push(std(window) * Math.sqrt(365) * 100);
  }
  return rv;
}

function fmt(n: number, dec = 2): string { return n.toFixed(dec); }
function pct(n: number, dec = 1): string { return (n * 100).toFixed(dec) + "%"; }

function arrStats(arr: number[]): { mean: number; median: number; std: number; min: number; max: number } {
  const sorted = [...arr].sort((a, b) => a - b);
  const n = sorted.length;
  const m = arr.reduce((a, b) => a + b, 0) / n;
  const variance = n > 1 ? arr.reduce((s, v) => s + (v - m) ** 2, 0) / (n - 1) : 0;
  return {
    mean: m,
    median: n % 2 === 1 ? sorted[Math.floor(n / 2)] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2,
    std: Math.sqrt(variance),
    min: sorted[0],
    max: sorted[n - 1],
  };
}

// ── Aligned Data Type ───────────────────────────────────────────

interface AlignedDay { date: string; price: number; iv: number }

function alignData(prices: DailyRecord[], dvol: DailyRecord[]): AlignedDay[] {
  const dvolMap = new Map(dvol.map(d => [d.date, d.close / 100])); // % → decimal
  return prices
    .filter(p => dvolMap.has(p.date))
    .map(p => ({ date: p.date, price: p.close, iv: dvolMap.get(p.date)! }));
}

// ══════════════════════════════════════════════════════════════════
// PART 1: IV DYNAMICS ANALYSIS (à la Exp 16)
// ══════════════════════════════════════════════════════════════════

function analyzeIVDynamics(label: string, dvol: DailyRecord[], aligned: AlignedDay[]): {
  kappa: number; vrpMean: number; skipRate12: number; acf1: number; deltaIVStd: number; deltaIVKurt: number; sqACF1: number; nDays: number;
} {
  console.log(`\n╔══════════════════════════════════════════════════╗`);
  console.log(`║  ${label}: IV DYNAMICS ANALYSIS`);
  console.log(`╚══════════════════════════════════════════════════╝\n`);

  const iv = aligned.map(d => d.iv * 100);
  const logReturns = aligned.slice(1).map((d, i) => Math.log(d.price / aligned[i].price));
  const rv20 = trailingRV(logReturns, 20);

  console.log("A1. Summary Statistics (DVOL, %):");
  const ivSorted = [...iv].sort((a, b) => a - b);
  console.log(`  Records:    ${iv.length}`);
  console.log(`  Mean:       ${mean(iv).toFixed(2)}%`);
  console.log(`  Std:        ${std(iv).toFixed(2)}%`);
  console.log(`  Min:        ${ivSorted[0].toFixed(2)}%`);
  console.log(`  P5:         ${percentile(ivSorted, 5).toFixed(2)}%`);
  console.log(`  Median:     ${percentile(ivSorted, 50).toFixed(2)}%`);
  console.log(`  P95:        ${percentile(ivSorted, 95).toFixed(2)}%`);
  console.log(`  Max:        ${ivSorted[ivSorted.length - 1].toFixed(2)}%`);

  const deltaIV = iv.slice(1).map((v, i) => v - iv[i]);
  const deltaIVStd = std(deltaIV);
  const deltaIVKurt = kurtosis(deltaIV);
  console.log("\nA2. Daily IV Changes (ΔIV) Distribution:");
  console.log(`  Mean:       ${mean(deltaIV).toFixed(4)}%`);
  console.log(`  Std:        ${deltaIVStd.toFixed(4)}%`);
  console.log(`  Skewness:   ${skewness(deltaIV).toFixed(4)}`);
  console.log(`  Kurtosis:   ${deltaIVKurt.toFixed(4)} (Gaussian=3)`);

  const n = deltaIV.length;
  const S = skewness(deltaIV);
  const K = deltaIVKurt - 3;
  const jb = (n / 6) * (S * S + (K * K) / 4);
  console.log(`  Jarque-Bera: ${jb.toFixed(2)} (χ²(2) critical=5.99 at 5%)`);
  console.log(`  → ${jb > 5.99 ? "REJECT Gaussian (fat tails)" : "Cannot reject Gaussian"}`);
  if (n < 500) {
    console.log(`  ⚠ WARNING: Only ${n} observations — kurtosis and JB estimates unreliable.`);
  }

  const acf1 = autocorrelation(iv, 1);
  console.log("\nA3. Autocorrelation of IV Levels:");
  for (const lag of [1, 2, 3, 5, 10, 15, 20]) {
    if (lag < iv.length) {
      console.log(`  ACF(${String(lag).padStart(2)}): ${autocorrelation(iv, lag).toFixed(4)}`);
    }
  }

  const sqDeltaIV = deltaIV.map(d => d * d);
  const sqACF1 = autocorrelation(sqDeltaIV, 1);
  const sigThreshold = 2 / Math.sqrt(sqDeltaIV.length);
  console.log("\nA4. ARCH Effects (Squared ΔIV ACF):");
  for (const lag of [1, 2, 3, 5, 10]) {
    if (lag < sqDeltaIV.length) {
      console.log(`  ACF(${String(lag).padStart(2)}): ${autocorrelation(sqDeltaIV, lag).toFixed(4)}`);
    }
  }
  console.log(`  Significance threshold: ±${sigThreshold.toFixed(4)}`);
  console.log(`  → ${Math.abs(sqACF1) > sigThreshold ? "SIGNIFICANT (ARCH effects present)" : "No significant ARCH effects"}`);

  const ivLag = iv.slice(0, -1);
  const ivCurr = iv.slice(1);
  const mLag = mean(ivLag), mCurr = mean(ivCurr);
  let ssXY = 0, ssXX = 0;
  for (let i = 0; i < ivLag.length; i++) {
    ssXY += (ivLag[i] - mLag) * (ivCurr[i] - mCurr);
    ssXX += (ivLag[i] - mLag) ** 2;
  }
  const phi = ssXY / ssXX;
  const kappaEst = -Math.log(Math.max(phi, 0.001)) * 365;
  const halfLife = Math.log(2) / (-Math.log(Math.max(phi, 0.001)));
  const longRunIV = (mCurr - phi * mLag) / (1 - phi);

  console.log("\nA5. Mean-Reversion Estimation:");
  console.log(`  φ (AR coeff):   ${phi.toFixed(6)}`);
  console.log(`  κ (annual):     ${kappaEst.toFixed(2)}`);
  console.log(`  Half-life:      ${halfLife.toFixed(1)} days`);
  console.log(`  Long-run IV:    ${longRunIV.toFixed(2)}%`);
  console.log(`  → OU expects κ=2–10: ${kappaEst >= 2 && kappaEst <= 10 ? "MATCHES" : kappaEst < 2 ? "SLOWER (Heston-like)" : "FASTER"}`);

  const vrp20: number[] = [];
  for (let i = 0; i < rv20.length; i++) {
    if (!isNaN(rv20[i])) vrp20.push(iv[i + 1] - rv20[i]);
  }
  const vrpMean = vrp20.length > 0 ? mean(vrp20) : 0;
  console.log("\nB1. VRP = DVOL − RV (20d lookback, %):");
  console.log(`  Records:    ${vrp20.length}`);
  console.log(`  Mean:       ${vrpMean.toFixed(2)}%`);
  if (vrp20.length > 0) {
    const vrp20s = [...vrp20].sort((a, b) => a - b);
    console.log(`  Median:     ${percentile(vrp20s, 50).toFixed(2)}%`);
    console.log(`  Std:        ${std(vrp20).toFixed(2)}%`);
    console.log(`  % days > 0: ${(vrp20.filter(v => v > 0).length / vrp20.length * 100).toFixed(1)}%`);
    console.log(`  % days ≥10: ${(vrp20.filter(v => v >= 10).length / vrp20.length * 100).toFixed(1)}%`);
    console.log(`  → Active floor (VRP≥5%): ${vrpMean >= 10 ? "ABOVE" : vrpMean >= 5 ? "ABOVE (marginal)" : "BELOW FLOOR"}`);
    console.log(`  → Conservative floor (VRP≥10%): ${vrpMean >= 10 ? "ABOVE" : "BELOW FLOOR"}`);
  }

  const ivRvRatio20: number[] = [];
  for (let i = 0; i < rv20.length; i++) {
    if (!isNaN(rv20[i]) && rv20[i] > 0) ivRvRatio20.push(iv[i + 1] / rv20[i]);
  }

  let skipRate12 = NaN;
  if (ivRvRatio20.length > 0) {
    const ratio20s = [...ivRvRatio20].sort((a, b) => a - b);
    console.log("\nC1. IV/RV Ratio (20d lookback):");
    console.log(`  Records:    ${ivRvRatio20.length}`);
    console.log(`  Mean:       ${mean(ivRvRatio20).toFixed(4)}`);
    console.log(`  Median:     ${percentile(ratio20s, 50).toFixed(4)}`);
    console.log(`  Std:        ${std(ivRvRatio20).toFixed(4)}`);
    console.log(`  P5:         ${percentile(ratio20s, 5).toFixed(4)}`);
    console.log(`  P95:        ${percentile(ratio20s, 95).toFixed(4)}`);

    console.log("\nC2. Skip Rates at Various Thresholds:");
    for (const t of [0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 1.5]) {
      const skip = ivRvRatio20.filter(r => r < t).length / ivRvRatio20.length * 100;
      console.log(`  t=${t.toFixed(1)}: skip ${skip.toFixed(1)}%, accept ${(100 - skip).toFixed(1)}%`);
      if (t === 1.2) skipRate12 = skip;
    }
  }

  // OU simulation comparison
  console.log("\nD1. Simulated OU Path Comparison (1000 paths):");
  const residuals = ivCurr.map((v, i) => v - (mCurr - phi * mLag) - phi * ivLag[i]);
  const residStd = std(residuals);
  const ouKappa = kappaEst;
  const ouLongRunIV = longRunIV / 100;
  const ouVolOfVol = (residStd / 100) * Math.sqrt(2 * kappaEst);
  const nPaths = 1000;
  const simDays = aligned.length;
  const simACF1s: number[] = [];
  const simDeltaIVStds: number[] = [];
  const simDeltaIVKurtoses: number[] = [];
  const simSqACF1s: number[] = [];
  const dt = 1 / 365;
  const sqrtDt = Math.sqrt(dt);

  for (let s = 0; s < nPaths; s++) {
    const rand = splitmix32(42 + s);
    const simIV: number[] = [ouLongRunIV];
    let iv_ = ouLongRunIV;
    for (let d = 1; d < simDays; d++) {
      const z = boxMuller(rand);
      iv_ += ouKappa * (ouLongRunIV - iv_) * dt + ouVolOfVol * sqrtDt * z;
      iv_ = Math.max(iv_, 0.05);
      simIV.push(iv_);
    }
    const simIVPct = simIV.map(v => v * 100);
    const simDelta = simIVPct.slice(1).map((v, i) => v - simIVPct[i]);
    const simSqDelta = simDelta.map(d => d * d);
    simACF1s.push(autocorrelation(simIVPct, 1));
    simDeltaIVStds.push(std(simDelta));
    simDeltaIVKurtoses.push(kurtosis(simDelta));
    simSqACF1s.push(autocorrelation(simSqDelta, 1));
  }

  console.log("                       Real      Sim Mean    Sim Std     Match");
  console.log(`  IV ACF(1):           ${acf1.toFixed(4)}    ${mean(simACF1s).toFixed(4)}      ${std(simACF1s).toFixed(4)}       ${Math.abs(acf1 - mean(simACF1s)) < 2 * std(simACF1s) ? "YES" : "NO"}`);
  console.log(`  ΔIV Std:             ${deltaIVStd.toFixed(4)}    ${mean(simDeltaIVStds).toFixed(4)}      ${std(simDeltaIVStds).toFixed(4)}       ${Math.abs(deltaIVStd - mean(simDeltaIVStds)) < 2 * std(simDeltaIVStds) ? "YES" : "NO"}`);
  console.log(`  ΔIV Kurtosis:        ${deltaIVKurt.toFixed(4)}    ${mean(simDeltaIVKurtoses).toFixed(4)}      ${std(simDeltaIVKurtoses).toFixed(4)}       ${Math.abs(deltaIVKurt - mean(simDeltaIVKurtoses)) < 2 * std(simDeltaIVKurtoses) ? "YES" : "NO"}`);
  console.log(`  Sq ΔIV ACF(1):       ${sqACF1.toFixed(4)}    ${mean(simSqACF1s).toFixed(4)}      ${std(simSqACF1s).toFixed(4)}       ${Math.abs(sqACF1 - mean(simSqACF1s)) < 2 * std(simSqACF1s) ? "YES" : "NO"}`);

  return { kappa: kappaEst, vrpMean, skipRate12, acf1, deltaIVStd, deltaIVKurt, sqACF1, nDays: aligned.length };
}

// ══════════════════════════════════════════════════════════════════
// PART 2: HISTORICAL BACKTEST (à la Exp 18)
// ══════════════════════════════════════════════════════════════════

const BASE_CONFIG: Pick<StrategyConfig, "impliedVol" | "riskFreeRate" | "contracts" | "bidAskSpreadPct" | "feePerTrade"> = {
  impliedVol: 0.80,
  riskFreeRate: 0.05,
  contracts: 1,
  bidAskSpreadPct: 0.05,
  feePerTrade: 0.50,
};

interface StrategyDef { name: string; config: StrategyConfig }

const STRATEGIES: StrategyDef[] = [
  {
    name: "Cons-Sized",
    config: {
      ...BASE_CONFIG,
      targetDelta: 0.10,
      cycleLengthDays: 30,
      adaptiveCalls: { minDelta: 0.10, maxDelta: 0.50, skipThresholdPct: 0, minStrikeAtCost: true },
      ivRvSpread: { lookbackDays: 45, minMultiplier: 0.8, maxMultiplier: 1.3, skipBelowRatio: 1.1, skipSide: "put" },
      rollPut: { initialDTE: 30, rollWhenDTEBelow: 14, requireNetCredit: true },
      positionSizing: { mode: "volScaled", volTarget: 0.40, volLookbackDays: 45, minSize: 0.10, coldStartDays: 45, coldStartSize: 0.50 },
    },
  },
  {
    name: "Aggressive-Sized",
    config: {
      ...BASE_CONFIG,
      targetDelta: 0.20,
      cycleLengthDays: 3,
      ivRvSpread: { lookbackDays: 20, minMultiplier: 0.8, maxMultiplier: 1.3, skipBelowRatio: 1.2, skipSide: "put" },
      positionSizing: { mode: "volScaled", volTarget: 0.40, volLookbackDays: 45, minSize: 0.10 },
    },
  },
];

interface BacktestResult {
  strategy: string;
  period: string;
  days: number;
  startPrice: number;
  endPrice: number;
  underlyingReturn: number;
  sharpe: number;
  sortino: number;
  apr: number;
  maxDrawdown: number;
  totalPL: number;
  premiumCollected: number;
  assignments: number;
  fullCycles: number;
  putSells: number;
  skippedCycles: number;
  skipRate: number;
  putRolls: number;
  stopLosses: number;
  benchmarkAPR: number;
  alpha: number;
  ivMean: number;
  ivStd: number;
}

function runBacktest(
  strategy: StrategyDef,
  data: AlignedDay[],
  periodName: string,
): BacktestResult {
  const prices = data.map(d => d.price);
  const ivPath = data.map(d => d.iv);
  const rules = defaultRules();
  const result = simulate(prices, rules, strategy.config, ivPath);
  const capitalAtRisk = prices[0] * strategy.config.contracts;
  const yearsElapsed = (data.length - 1) / 365;
  const summary = summarizeRun(0, result, prices, capitalAtRisk, yearsElapsed, strategy.config.riskFreeRate, strategy.config.contracts);

  const putSells = result.signalLog.filter(e => e.signal.action === "SELL_PUT").length;
  const skipRate = (putSells + result.summary.totalSkippedCycles) > 0
    ? result.summary.totalSkippedCycles / (putSells + result.summary.totalSkippedCycles) : 0;

  const ivVals = ivPath;
  const ivMean = mean(ivVals);
  const ivVar = ivVals.reduce((s, v) => s + (v - ivMean) ** 2, 0) / (ivVals.length - 1);

  return {
    strategy: strategy.name,
    period: periodName,
    days: data.length - 1,
    startPrice: prices[0],
    endPrice: prices[prices.length - 1],
    underlyingReturn: (prices[prices.length - 1] - prices[0]) / prices[0],
    sharpe: summary.sharpe,
    sortino: summary.sortino,
    apr: summary.apr,
    maxDrawdown: summary.maxDrawdown,
    totalPL: summary.totalPL,
    premiumCollected: summary.premiumCollected,
    assignments: summary.assignments,
    fullCycles: summary.fullCycles,
    putSells,
    skippedCycles: summary.skippedCycles,
    skipRate,
    putRolls: summary.totalPutRolls,
    stopLosses: summary.totalStopLosses,
    benchmarkAPR: summary.benchmarkAPR,
    alpha: summary.apr - summary.benchmarkAPR,
    ivMean,
    ivStd: Math.sqrt(ivVar),
  };
}

function printFullPeriodTable(label: string, results: BacktestResult[]): void {
  console.log(`\n## ${label} — Backtest Results\n`);
  const cols = results.map(r => r.strategy);
  console.log("| Metric | " + cols.join(" | ") + " |");
  console.log("|--------|" + cols.map(() => "--------").join("|") + "|");

  const rows: [string, (r: BacktestResult) => string][] = [
    ["Days", r => `${r.days}`],
    ["Start Price", r => `$${fmt(r.startPrice, 2)}`],
    ["End Price", r => `$${fmt(r.endPrice, 2)}`],
    ["Underlying Return", r => pct(r.underlyingReturn)],
    ["**Sharpe**", r => fmt(r.sharpe, 3)],
    ["**Sortino**", r => fmt(r.sortino, 3)],
    ["**APR (%)**", r => fmt(r.apr)],
    ["Total P/L ($)", r => fmt(r.totalPL, 2)],
    ["Premium Collected", r => `$${fmt(r.premiumCollected, 2)}`],
    ["**Max Drawdown**", r => pct(r.maxDrawdown)],
    ["Assignments", r => `${r.assignments}`],
    ["Full Cycles", r => `${r.fullCycles}`],
    ["Executed Put Sells", r => `${r.putSells}`],
    ["**Skip Rate**", r => pct(r.skipRate)],
    ["Put Rolls", r => `${r.putRolls}`],
    ["Stop Losses", r => `${r.stopLosses}`],
    ["Benchmark APR", r => fmt(r.benchmarkAPR)],
    ["**Alpha**", r => fmt(r.alpha)],
    ["Mean IV", r => pct(r.ivMean)],
    ["IV Std", r => pct(r.ivStd)],
  ];

  for (const [label, fn] of rows) {
    console.log(`| ${label} | ${results.map(fn).join(" | ")} |`);
  }
}

// ══════════════════════════════════════════════════════════════════
// PART 3: SOL PRICE-ONLY ANALYSIS (long-term RV dynamics)
// ══════════════════════════════════════════════════════════════════

function analyzePriceOnlyDynamics(label: string, prices: DailyRecord[]): void {
  console.log(`\n╔══════════════════════════════════════════════════╗`);
  console.log(`║  ${label}: PRICE-ONLY DYNAMICS (No IV)`);
  console.log(`╚══════════════════════════════════════════════════╝\n`);

  const closes = prices.map(p => p.close);
  const logReturns = closes.slice(1).map((c, i) => Math.log(c / closes[i]));

  console.log(`  Price records: ${prices.length}`);
  console.log(`  Date range: ${prices[0].date} → ${prices[prices.length - 1].date}`);
  console.log(`  Start price: $${closes[0].toFixed(2)}`);
  console.log(`  End price: $${closes[closes.length - 1].toFixed(2)}`);
  console.log(`  Total return: ${((closes[closes.length - 1] / closes[0] - 1) * 100).toFixed(1)}%`);

  const rvAnn = std(logReturns) * Math.sqrt(365) * 100;
  console.log(`\n  Annualized RV: ${rvAnn.toFixed(1)}%`);

  const rv20 = trailingRV(logReturns, 20);
  const validRV = rv20.filter(v => !isNaN(v));
  if (validRV.length > 0) {
    const rvSorted = [...validRV].sort((a, b) => a - b);
    console.log(`  20d trailing RV:`);
    console.log(`    Mean: ${mean(validRV).toFixed(1)}%`);
    console.log(`    Std: ${std(validRV).toFixed(1)}%`);
    console.log(`    P5: ${percentile(rvSorted, 5).toFixed(1)}%`);
    console.log(`    Median: ${percentile(rvSorted, 50).toFixed(1)}%`);
    console.log(`    P95: ${percentile(rvSorted, 95).toFixed(1)}%`);
  }

  // Year-by-year RV
  console.log("\n  Year-by-Year Annualized RV:");
  for (const year of [2022, 2023, 2024, 2025, 2026]) {
    const yearPrices = prices.filter(p => p.date.startsWith(String(year)));
    if (yearPrices.length < 30) continue;
    const yrCloses = yearPrices.map(p => p.close);
    const yrLogRet = yrCloses.slice(1).map((c, i) => Math.log(c / yrCloses[i]));
    const yrRV = std(yrLogRet) * Math.sqrt(365) * 100;
    const yrReturn = ((yrCloses[yrCloses.length - 1] / yrCloses[0] - 1) * 100);
    console.log(`    ${year}: RV=${yrRV.toFixed(1)}% Return=${yrReturn.toFixed(1)}% (${yearPrices.length} days)`);
  }

  // RV ACF — to check for vol clustering
  if (validRV.length > 50) {
    console.log("\n  RV(20d) Autocorrelation (vol persistence):");
    for (const lag of [1, 5, 10, 20]) {
      if (lag < validRV.length) {
        console.log(`    ACF(${String(lag).padStart(2)}): ${autocorrelation(validRV, lag).toFixed(4)}`);
      }
    }
  }
}

// ══════════════════════════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════════════════════════

async function main() {
  console.log("═══ Experiment 25: Additional Asset Validation (SOL) ═══\n");
  const t0 = performance.now();

  // ── Step 1: Fetch data ──
  console.log("Step 1: Fetching data...");
  mkdirSync(DATA_DIR, { recursive: true });
  const [solDvol, solPrices] = await Promise.all([fetchSOLDVOL(), fetchSOLPrices()]);
  console.log(`  SOL DVOL: ${solDvol.length} days (${solDvol[0]?.date ?? "N/A"} → ${solDvol[solDvol.length - 1]?.date ?? "N/A"})`);
  console.log(`  SOL Prices: ${solPrices.length} days (${solPrices[0]?.date ?? "N/A"} → ${solPrices[solPrices.length - 1]?.date ?? "N/A"})`);

  // Load ETH + BTC data for cross-asset comparison
  const ethDvol: DailyRecord[] = JSON.parse(readFileSync(join(ETH_DATA_DIR, "dvol.json"), "utf-8"));
  const ethPrices: DailyRecord[] = JSON.parse(readFileSync(join(ETH_DATA_DIR, "prices.json"), "utf-8"));
  const btcDvol: DailyRecord[] = JSON.parse(readFileSync(join(BTC_DATA_DIR, "btc_dvol.json"), "utf-8"));
  const btcPrices: DailyRecord[] = JSON.parse(readFileSync(join(BTC_DATA_DIR, "btc_prices.json"), "utf-8"));
  console.log(`  ETH DVOL: ${ethDvol.length} days, ETH Prices: ${ethPrices.length} days`);
  console.log(`  BTC DVOL: ${btcDvol.length} days, BTC Prices: ${btcPrices.length} days`);

  const solAligned = alignData(solPrices, solDvol);
  const ethAligned = alignData(ethPrices, ethDvol);
  const btcAligned = alignData(btcPrices, btcDvol);
  console.log(`  SOL aligned: ${solAligned.length} days (${solAligned[0]?.date ?? "N/A"} → ${solAligned[solAligned.length - 1]?.date ?? "N/A"})`);
  console.log(`  ETH aligned: ${ethAligned.length} days (${ethAligned[0]?.date ?? "N/A"} → ${ethAligned[ethAligned.length - 1]?.date ?? "N/A"})`);
  console.log(`  BTC aligned: ${btcAligned.length} days (${btcAligned[0]?.date ?? "N/A"} → ${btcAligned[btcAligned.length - 1]?.date ?? "N/A"})`);

  // ══════════════════════════════════════════════════════════════
  // CRITICAL DATA LIMITATION
  // ══════════════════════════════════════════════════════════════

  console.log("\n" + "!".repeat(70));
  console.log("CRITICAL: SOL DVOL has only " + solDvol.length + " records (" +
    (solDvol[0]?.date ?? "N/A") + " → " + (solDvol[solDvol.length - 1]?.date ?? "N/A") + ")");
  console.log("DVOL was DISCONTINUED after Nov 2022.");
  console.log("Rolling window backtest (365d windows) is IMPOSSIBLE.");
  console.log("IV dynamics analysis is SEVERELY UNDERPOWERED (n=" + solAligned.length + " vs ETH n=1812).");
  console.log("Backtest covers ONLY the May-Nov 2022 period (FTX crash era).");
  console.log("!".repeat(70));

  // ══════════════════════════════════════════════════════════════
  // PART 1: IV DYNAMICS (limited SOL data)
  // ══════════════════════════════════════════════════════════════

  console.log("\n\n" + "═".repeat(70));
  console.log("PART 1: IV DYNAMICS ANALYSIS");
  console.log("═".repeat(70));

  const solStats = analyzeIVDynamics("SOL (206 days, May-Nov 2022)", solDvol, solAligned);

  // For fair comparison, slice ETH and BTC to the same period
  const ethSamePeriod = ethAligned.filter(d => d.date >= solAligned[0].date && d.date <= solAligned[solAligned.length - 1].date);
  const btcSamePeriod = btcAligned.filter(d => d.date >= solAligned[0].date && d.date <= solAligned[solAligned.length - 1].date);
  const ethDvolSamePeriod = ethDvol.filter(d => d.date >= solAligned[0].date && d.date <= solAligned[solAligned.length - 1].date);
  const btcDvolSamePeriod = btcDvol.filter(d => d.date >= solAligned[0].date && d.date <= solAligned[solAligned.length - 1].date);

  console.log(`\n  Period-matched comparison data:`);
  console.log(`    ETH same-period aligned: ${ethSamePeriod.length} days`);
  console.log(`    BTC same-period aligned: ${btcSamePeriod.length} days`);

  let ethSameStats: ReturnType<typeof analyzeIVDynamics> | null = null;
  let btcSameStats: ReturnType<typeof analyzeIVDynamics> | null = null;
  if (ethSamePeriod.length >= 50) {
    ethSameStats = analyzeIVDynamics("ETH (same period: May-Nov 2022)", ethDvolSamePeriod, ethSamePeriod);
  }
  if (btcSamePeriod.length >= 50) {
    btcSameStats = analyzeIVDynamics("BTC (same period: May-Nov 2022)", btcDvolSamePeriod, btcSamePeriod);
  }

  // Full ETH + BTC stats for reference
  const ethFullStats = analyzeIVDynamics("ETH (full, 1812 days)", ethDvol, ethAligned);
  const btcFullStats = analyzeIVDynamics("BTC (full, 1814 days)", btcDvol, btcAligned);

  // Cross-asset comparison
  console.log("\n\n╔══════════════════════════════════════════════════╗");
  console.log("║  CROSS-ASSET IV DYNAMICS COMPARISON              ║");
  console.log("╚══════════════════════════════════════════════════╝\n");

  console.log("### Same-Period Comparison (May-Nov 2022)\n");
  console.log("| Metric | SOL | ETH (same) | BTC (same) | SOL vs ETH | SOL vs BTC |");
  console.log("|--------|-----|------------|------------|------------|------------|");
  if (ethSameStats && btcSameStats) {
    console.log(`| κ (mean-reversion) | ${fmt(solStats.kappa)} | ${fmt(ethSameStats.kappa)} | ${fmt(btcSameStats.kappa)} | ${fmt(solStats.kappa - ethSameStats.kappa)} | ${fmt(solStats.kappa - btcSameStats.kappa)} |`);
    console.log(`| Mean VRP (%) | ${fmt(solStats.vrpMean)} | ${fmt(ethSameStats.vrpMean)} | ${fmt(btcSameStats.vrpMean)} | ${fmt(solStats.vrpMean - ethSameStats.vrpMean)} | ${fmt(solStats.vrpMean - btcSameStats.vrpMean)} |`);
    console.log(`| Skip rate t=1.2 | ${fmt(solStats.skipRate12, 1)}% | ${fmt(ethSameStats.skipRate12, 1)}% | ${fmt(btcSameStats.skipRate12, 1)}% | ${fmt(solStats.skipRate12 - ethSameStats.skipRate12, 1)}pp | ${fmt(solStats.skipRate12 - btcSameStats.skipRate12, 1)}pp |`);
    console.log(`| IV ACF(1) | ${fmt(solStats.acf1, 4)} | ${fmt(ethSameStats.acf1, 4)} | ${fmt(btcSameStats.acf1, 4)} | ${fmt(solStats.acf1 - ethSameStats.acf1, 4)} | ${fmt(solStats.acf1 - btcSameStats.acf1, 4)} |`);
    console.log(`| ΔIV Std | ${fmt(solStats.deltaIVStd, 4)} | ${fmt(ethSameStats.deltaIVStd, 4)} | ${fmt(btcSameStats.deltaIVStd, 4)} | ${fmt(solStats.deltaIVStd - ethSameStats.deltaIVStd, 4)} | ${fmt(solStats.deltaIVStd - btcSameStats.deltaIVStd, 4)} |`);
    console.log(`| ΔIV Kurtosis | ${fmt(solStats.deltaIVKurt, 2)} | ${fmt(ethSameStats.deltaIVKurt, 2)} | ${fmt(btcSameStats.deltaIVKurt, 2)} | ${fmt(solStats.deltaIVKurt - ethSameStats.deltaIVKurt, 2)} | ${fmt(solStats.deltaIVKurt - btcSameStats.deltaIVKurt, 2)} |`);
    console.log(`| Sq ΔIV ACF(1) | ${fmt(solStats.sqACF1, 4)} | ${fmt(ethSameStats.sqACF1, 4)} | ${fmt(btcSameStats.sqACF1, 4)} | ${fmt(solStats.sqACF1 - ethSameStats.sqACF1, 4)} | ${fmt(solStats.sqACF1 - btcSameStats.sqACF1, 4)} |`);
    console.log(`| N days | ${solStats.nDays} | ${ethSameStats.nDays} | ${btcSameStats.nDays} | | |`);
  }

  console.log("\n### SOL vs Full-Period ETH/BTC\n");
  console.log("| Metric | SOL (206d) | ETH (1812d) | BTC (1814d) | SOL vs ETH | SOL vs BTC |");
  console.log("|--------|------------|-------------|-------------|------------|------------|");
  console.log(`| κ (mean-reversion) | ${fmt(solStats.kappa)} | ${fmt(ethFullStats.kappa)} | ${fmt(btcFullStats.kappa)} | ${fmt(solStats.kappa - ethFullStats.kappa)} | ${fmt(solStats.kappa - btcFullStats.kappa)} |`);
  console.log(`| Mean VRP (%) | ${fmt(solStats.vrpMean)} | ${fmt(ethFullStats.vrpMean)} | ${fmt(btcFullStats.vrpMean)} | ${fmt(solStats.vrpMean - ethFullStats.vrpMean)} | ${fmt(solStats.vrpMean - btcFullStats.vrpMean)} |`);
  console.log(`| Skip rate t=1.2 | ${!isNaN(solStats.skipRate12) ? fmt(solStats.skipRate12, 1) + "%" : "N/A"} | ${!isNaN(ethFullStats.skipRate12) ? fmt(ethFullStats.skipRate12, 1) + "%" : "N/A"} | ${!isNaN(btcFullStats.skipRate12) ? fmt(btcFullStats.skipRate12, 1) + "%" : "N/A"} | | |`);
  console.log(`| IV ACF(1) | ${fmt(solStats.acf1, 4)} | ${fmt(ethFullStats.acf1, 4)} | ${fmt(btcFullStats.acf1, 4)} | ${fmt(solStats.acf1 - ethFullStats.acf1, 4)} | ${fmt(solStats.acf1 - btcFullStats.acf1, 4)} |`);
  console.log(`| ΔIV Std | ${fmt(solStats.deltaIVStd, 4)} | ${fmt(ethFullStats.deltaIVStd, 4)} | ${fmt(btcFullStats.deltaIVStd, 4)} | ${fmt(solStats.deltaIVStd - ethFullStats.deltaIVStd, 4)} | ${fmt(solStats.deltaIVStd - btcFullStats.deltaIVStd, 4)} |`);
  console.log(`| ΔIV Kurtosis | ${fmt(solStats.deltaIVKurt, 2)} | ${fmt(ethFullStats.deltaIVKurt, 2)} | ${fmt(btcFullStats.deltaIVKurt, 2)} | ${fmt(solStats.deltaIVKurt - ethFullStats.deltaIVKurt, 2)} | ${fmt(solStats.deltaIVKurt - btcFullStats.deltaIVKurt, 2)} |`);
  console.log(`| Sq ΔIV ACF(1) | ${fmt(solStats.sqACF1, 4)} | ${fmt(ethFullStats.sqACF1, 4)} | ${fmt(btcFullStats.sqACF1, 4)} | ${fmt(solStats.sqACF1 - ethFullStats.sqACF1, 4)} | ${fmt(solStats.sqACF1 - btcFullStats.sqACF1, 4)} |`);

  // ══════════════════════════════════════════════════════════════
  // PART 2: LIMITED HISTORICAL BACKTEST
  // ══════════════════════════════════════════════════════════════

  console.log("\n\n" + "═".repeat(70));
  console.log("PART 2: LIMITED HISTORICAL BACKTEST (206 days, May-Nov 2022)");
  console.log("═".repeat(70));
  console.log("\n⚠ WARNING: This covers ONLY the May-Nov 2022 period.");
  console.log("  This includes: Terra/Luna collapse (May), 3AC contagion (June),");
  console.log("  FTX collapse (Nov). Extreme bear market bias — NOT representative.\n");

  // SOL backtest
  const solResults: BacktestResult[] = [];
  for (const strategy of STRATEGIES) {
    solResults.push(runBacktest(strategy, solAligned, "May-Nov 2022"));
  }
  printFullPeriodTable("SOL (May-Nov 2022)", solResults);

  // Run same-period ETH + BTC for comparison
  const ethSamePeriodResults: BacktestResult[] = [];
  const btcSamePeriodResults: BacktestResult[] = [];
  if (ethSamePeriod.length >= 50) {
    for (const strategy of STRATEGIES) {
      ethSamePeriodResults.push(runBacktest(strategy, ethSamePeriod, "May-Nov 2022"));
    }
    printFullPeriodTable("ETH (same period)", ethSamePeriodResults);
  }
  if (btcSamePeriod.length >= 50) {
    for (const strategy of STRATEGIES) {
      btcSamePeriodResults.push(runBacktest(strategy, btcSamePeriod, "May-Nov 2022"));
    }
    printFullPeriodTable("BTC (same period)", btcSamePeriodResults);
  }

  // Cross-asset comparison for same period
  if (ethSamePeriodResults.length > 0 && btcSamePeriodResults.length > 0) {
    console.log("\n\n╔══════════════════════════════════════════════════╗");
    console.log("║  CROSS-ASSET BACKTEST COMPARISON (May-Nov 2022)  ║");
    console.log("╚══════════════════════════════════════════════════╝\n");

    console.log("| Metric | SOL Cons | ETH Cons | BTC Cons | SOL Aggr | ETH Aggr | BTC Aggr |");
    console.log("|--------|----------|----------|----------|----------|----------|----------|");

    const solC = solResults.find(r => r.strategy === "Cons-Sized")!;
    const ethC = ethSamePeriodResults.find(r => r.strategy === "Cons-Sized")!;
    const btcC = btcSamePeriodResults.find(r => r.strategy === "Cons-Sized")!;
    const solA = solResults.find(r => r.strategy === "Aggressive-Sized")!;
    const ethA = ethSamePeriodResults.find(r => r.strategy === "Aggressive-Sized")!;
    const btcA = btcSamePeriodResults.find(r => r.strategy === "Aggressive-Sized")!;

    const compRows: [string, (r: BacktestResult) => string][] = [
      ["Sharpe", r => fmt(r.sharpe, 3)],
      ["APR%", r => fmt(r.apr)],
      ["MaxDD", r => pct(r.maxDrawdown)],
      ["Alpha", r => fmt(r.alpha)],
      ["Skip Rate", r => pct(r.skipRate)],
      ["Put Sells", r => `${r.putSells}`],
      ["Assignments", r => `${r.assignments}`],
      ["Premium", r => `$${fmt(r.premiumCollected, 2)}`],
      ["Underlying Ret", r => pct(r.underlyingReturn)],
    ];
    for (const [label, fn] of compRows) {
      console.log(`| ${label} | ${fn(solC)} | ${fn(ethC)} | ${fn(btcC)} | ${fn(solA)} | ${fn(ethA)} | ${fn(btcA)} |`);
    }
  }

  // ══════════════════════════════════════════════════════════════
  // PART 3: SOL PRICE-ONLY ANALYSIS (long-term RV from SOL_USDC-PERPETUAL)
  // ══════════════════════════════════════════════════════════════

  console.log("\n\n" + "═".repeat(70));
  console.log("PART 3: LONG-TERM SOL PRICE DYNAMICS (SOL_USDC-PERPETUAL)");
  console.log("═".repeat(70));
  console.log("\nSince DVOL is discontinued, analyze SOL's realized vol dynamics");
  console.log("to assess whether the asset's volatility structure is OU-compatible.\n");

  analyzePriceOnlyDynamics("SOL (SOL_USDC-PERPETUAL)", solPrices);

  // Same for ETH and BTC (all available price data) for comparison
  analyzePriceOnlyDynamics("ETH (ETH prices)", ethPrices);
  analyzePriceOnlyDynamics("BTC (BTC prices)", btcPrices);

  // Cross-asset RV comparison table
  console.log("\n\n╔══════════════════════════════════════════════════╗");
  console.log("║  CROSS-ASSET REALIZED VOL COMPARISON             ║");
  console.log("╚══════════════════════════════════════════════════╝\n");

  for (const [label, prices] of [
    ["SOL", solPrices],
    ["ETH", ethPrices],
    ["BTC", btcPrices],
  ] as [string, DailyRecord[]][]) {
    const closes = prices.map(p => p.close);
    const logRet = closes.slice(1).map((c, i) => Math.log(c / closes[i]));
    const rvAnn = std(logRet) * Math.sqrt(365) * 100;
    const rv20 = trailingRV(logRet, 20);
    const validRV = rv20.filter(v => !isNaN(v));
    const rvStats = arrStats(validRV);

    console.log(`${label}: Ann RV=${rvAnn.toFixed(1)}%, 20d RV mean=${rvStats.mean.toFixed(1)}%, std=${rvStats.std.toFixed(1)}%, P5=${percentile([...validRV].sort((a,b)=>a-b), 5).toFixed(1)}%, P95=${percentile([...validRV].sort((a,b)=>a-b), 95).toFixed(1)}%`);
  }

  // ══════════════════════════════════════════════════════════════
  // PART 4: ROLLING WINDOW ASSESSMENT
  // ══════════════════════════════════════════════════════════════

  console.log("\n\n" + "═".repeat(70));
  console.log("PART 4: ROLLING WINDOW ASSESSMENT");
  console.log("═".repeat(70));
  console.log(`\nSOL aligned data: ${solAligned.length} days.`);
  console.log("Minimum for 1 rolling window: 365 days.");
  console.log("Minimum for meaningful rolling analysis (5+ windows): 730+ days.");
  console.log(`→ IMPOSSIBLE. SOL has ${solAligned.length} aligned days — ${((solAligned.length / 365) * 100).toFixed(0)}% of minimum.`);
  console.log("\nRolling window backtest SKIPPED.\n");

  // ══════════════════════════════════════════════════════════════
  // VERDICT
  // ══════════════════════════════════════════════════════════════

  console.log("\n" + "═".repeat(70));
  console.log("VERDICT");
  console.log("═".repeat(70) + "\n");

  console.log("Data Availability Assessment:");
  console.log(`  SOL DVOL: ${solDvol.length} records (${solDvol[0]?.date ?? "N/A"} → ${solDvol[solDvol.length - 1]?.date ?? "N/A"})`);
  console.log(`  SOL_USDC-PERPETUAL: ${solPrices.length} records (${solPrices[0]?.date ?? "N/A"} → ${solPrices[solPrices.length - 1]?.date ?? "N/A"})`);
  console.log(`  ETH DVOL: ${ethDvol.length} records, BTC DVOL: ${btcDvol.length} records`);
  console.log(`  SOL DVOL/ETH DVOL ratio: ${(solDvol.length / ethDvol.length * 100).toFixed(1)}%`);

  console.log("\nIV Dynamics Assessment:");
  const ouCompatible = solStats.kappa >= 2 && solStats.kappa <= 10;
  const vrpSufficient = solStats.vrpMean >= 5;
  console.log(`  κ = ${fmt(solStats.kappa)} → ${ouCompatible ? "OU-compatible" : "NOT OU-compatible"}`);
  console.log(`  VRP = ${fmt(solStats.vrpMean)}% → ${vrpSufficient ? "Above Active floor (5%)" : "BELOW Active floor"}`);
  console.log(`  ACF(1) = ${fmt(solStats.acf1, 4)} → ${solStats.acf1 > 0.9 ? "Persistent (OU-like)" : "Fast-decaying"}`);
  console.log(`  ⚠ All statistics based on ONLY ${solAligned.length} days of data.`);
  console.log(`  ⚠ Period covers ONLY May-Nov 2022 — extreme bear market bias.`);

  console.log("\nBacktest Assessment:");
  const solConsSharpe = solResults.find(r => r.strategy === "Cons-Sized")?.sharpe ?? NaN;
  const solAggrSharpe = solResults.find(r => r.strategy === "Aggressive-Sized")?.sharpe ?? NaN;
  console.log(`  Conservative Sharpe: ${fmt(solConsSharpe, 3)} (bear period only)`);
  console.log(`  Aggressive Sharpe: ${fmt(solAggrSharpe, 3)} (bear period only)`);
  console.log(`  ⚠ Single ~7-month period. NOT comparable to 5yr ETH/BTC backtests.`);

  console.log("\nConclusion:");
  console.log("  SOL DVOL was discontinued after Nov 2022 (206 days total).");
  console.log("  This is fundamentally insufficient for multi-asset validation:");
  console.log("    - Cannot run rolling window backtest (need 365+ days)");
  console.log("    - Cannot validate across market regimes (only bear period)");
  console.log("    - IV dynamics statistics are unreliable (n=206 vs ETH n=1812)");
  console.log("    - Results are biased toward crash dynamics (Terra, 3AC, FTX)");
  console.log("  SOL CANNOT be included in Exp 26 (portfolio analysis).");
  console.log("  Exp 26 should proceed with ETH + BTC only.");

  const totalElapsed = ((performance.now() - t0) / 1000).toFixed(2);
  console.log(`\n═══ Experiment 25 Complete (${totalElapsed}s) ═══`);
}

main().catch(e => { console.error(e); process.exit(1); });
