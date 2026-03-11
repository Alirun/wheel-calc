// Experiment 24: Multi-Asset Validation (BTC)
// Repeats Exp 16 (IV dynamics) + Exp 18 (historical backtest) + Exp 20/23 (rolling window)
// against BTC DVOL + BTC-PERPETUAL data from Deribit.
// Key question: does Conservative's dominance hold on BTC, or is it ETH-specific?

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
const BTC_DVOL_CACHE = join(DATA_DIR, "btc_dvol.json");
const BTC_PRICE_CACHE = join(DATA_DIR, "btc_prices.json");
const ETH_DATA_DIR = join(__dirname, "..", "sweep16", "data");

// ── Data Fetch & Cache ──────────────────────────────────────────

interface DailyRecord { date: string; close: number }

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function fetchBTCDVOL(): Promise<DailyRecord[]> {
  if (existsSync(BTC_DVOL_CACHE)) {
    console.log("  Loading cached BTC DVOL data...");
    return JSON.parse(readFileSync(BTC_DVOL_CACHE, "utf-8"));
  }
  console.log("  Fetching BTC DVOL from Deribit...");
  const start = Date.UTC(2020, 0, 1);
  const end = Date.now();
  const raw = await getDVOLHistory("BTC", start, end, "1D");

  const byDate = new Map<string, number>();
  for (const r of raw) byDate.set(dateKey(r.date), r.close);

  const result: DailyRecord[] = Array.from(byDate.entries())
    .map(([date, close]) => ({ date, close }))
    .sort((a, b) => a.date.localeCompare(b.date));

  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(BTC_DVOL_CACHE, JSON.stringify(result, null, 2));
  console.log(`  Cached ${result.length} BTC daily DVOL records.`);
  return result;
}

async function fetchBTCPrices(): Promise<DailyRecord[]> {
  if (existsSync(BTC_PRICE_CACHE)) {
    console.log("  Loading cached BTC price data...");
    return JSON.parse(readFileSync(BTC_PRICE_CACHE, "utf-8"));
  }
  console.log("  Fetching BTC-PERPETUAL prices from Deribit...");
  const start = Date.UTC(2020, 0, 1);
  const end = Date.now();
  const raw = await getTradingViewChart("BTC-PERPETUAL", "1D", start, end);

  const byDate = new Map<string, number>();
  for (const r of raw) byDate.set(dateKey(r.date), r.close);

  const result: DailyRecord[] = Array.from(byDate.entries())
    .map(([date, close]) => ({ date, close }))
    .sort((a, b) => a.date.localeCompare(b.date));

  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(BTC_PRICE_CACHE, JSON.stringify(result, null, 2));
  console.log(`  Cached ${result.length} BTC daily price records.`);
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
  kappa: number; vrpMean: number; skipRate12: number; acf1: number; deltaIVStd: number; deltaIVKurt: number; sqACF1: number;
} {
  console.log(`\n╔══════════════════════════════════════════════════╗`);
  console.log(`║  ${label}: IV DYNAMICS ANALYSIS`);
  console.log(`╚══════════════════════════════════════════════════╝\n`);

  const iv = aligned.map(d => d.iv * 100); // back to % for analysis
  const logReturns = aligned.slice(1).map((d, i) => Math.log(d.price / aligned[i].price));
  const rv20 = trailingRV(logReturns, 20);

  // A. Summary stats
  const ivSorted = [...iv].sort((a, b) => a - b);
  console.log("A1. Summary Statistics (DVOL, %):");
  console.log(`  Mean:       ${mean(iv).toFixed(2)}%`);
  console.log(`  Std:        ${std(iv).toFixed(2)}%`);
  console.log(`  Min:        ${ivSorted[0].toFixed(2)}%`);
  console.log(`  P5:         ${percentile(ivSorted, 5).toFixed(2)}%`);
  console.log(`  Median:     ${percentile(ivSorted, 50).toFixed(2)}%`);
  console.log(`  P95:        ${percentile(ivSorted, 95).toFixed(2)}%`);
  console.log(`  Max:        ${ivSorted[ivSorted.length - 1].toFixed(2)}%`);

  // B. Delta IV distribution
  const deltaIV = iv.slice(1).map((v, i) => v - iv[i]);
  const deltaIVStd = std(deltaIV);
  const deltaIVKurt = kurtosis(deltaIV);
  console.log("\nA2. Daily IV Changes (ΔIV) Distribution:");
  console.log(`  Mean:       ${mean(deltaIV).toFixed(4)}%`);
  console.log(`  Std:        ${deltaIVStd.toFixed(4)}%`);
  console.log(`  Skewness:   ${skewness(deltaIV).toFixed(4)}`);
  console.log(`  Kurtosis:   ${deltaIVKurt.toFixed(4)} (Gaussian=3)`);

  // Jarque-Bera
  const n = deltaIV.length;
  const S = skewness(deltaIV);
  const K = deltaIVKurt - 3;
  const jb = (n / 6) * (S * S + (K * K) / 4);
  console.log(`  Jarque-Bera: ${jb.toFixed(2)} (χ²(2) critical=5.99 at 5%)`);
  console.log(`  → ${jb > 5.99 ? "REJECT Gaussian (fat tails)" : "Cannot reject Gaussian"}`);

  // C. ACF
  const acf1 = autocorrelation(iv, 1);
  console.log("\nA3. Autocorrelation of IV Levels:");
  for (const lag of [1, 2, 3, 5, 10, 15, 20]) {
    console.log(`  ACF(${String(lag).padStart(2)}): ${autocorrelation(iv, lag).toFixed(4)}`);
  }

  // D. ARCH effects
  const sqDeltaIV = deltaIV.map(d => d * d);
  const sqACF1 = autocorrelation(sqDeltaIV, 1);
  const sigThreshold = 2 / Math.sqrt(sqDeltaIV.length);
  console.log("\nA4. ARCH Effects (Squared ΔIV ACF):");
  for (const lag of [1, 2, 3, 5, 10]) {
    console.log(`  ACF(${String(lag).padStart(2)}): ${autocorrelation(sqDeltaIV, lag).toFixed(4)}`);
  }
  console.log(`  Significance threshold: ±${sigThreshold.toFixed(4)}`);
  console.log(`  → ${Math.abs(sqACF1) > sigThreshold ? "SIGNIFICANT (ARCH effects present)" : "No significant ARCH effects"}`);

  // E. AR(1) mean-reversion
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

  // F. VRP
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

  // G. IV/RV ratio & skip rates
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

  // H. OU simulation comparison
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

  // I. Sub-period analysis
  console.log("\nE1. Sub-Period Analysis:");
  const periods = [
    { name: "2021 H2", start: "2021-07-01", end: "2021-12-31" },
    { name: "2022 (Bear)", start: "2022-01-01", end: "2022-12-31" },
    { name: "2023 (Recovery)", start: "2023-01-01", end: "2023-12-31" },
    { name: "2024 (Bull)", start: "2024-01-01", end: "2024-12-31" },
    { name: "2025+", start: "2025-01-01", end: "2026-12-31" },
  ];

  console.log("Period                   Days  IV Mean  IV Std  VRP Mean  κ Est   ΔIV Kurt  Skip%");
  console.log("─".repeat(95));

  for (const p of periods) {
    const subset = aligned.filter(d => d.date >= p.start && d.date <= p.end);
    if (subset.length < 50) { console.log(`${p.name.padEnd(25)} Insufficient data (${subset.length} days)`); continue; }

    const pIV = subset.map(d => d.iv * 100);
    const pDeltaIV = pIV.slice(1).map((v, i) => v - pIV[i]);
    const pLogRet = subset.slice(1).map((d, i) => Math.log(d.price / subset[i].price));
    const pRV20 = trailingRV(pLogRet, 20);
    const pVRP: number[] = [];
    const pRatio: number[] = [];
    for (let i = 0; i < pRV20.length; i++) {
      if (!isNaN(pRV20[i])) {
        pVRP.push(pIV[i + 1] - pRV20[i]);
        if (pRV20[i] > 0) pRatio.push(pIV[i + 1] / pRV20[i]);
      }
    }

    const pLag = pIV.slice(0, -1);
    const pCurr = pIV.slice(1);
    let pssXY = 0, pssXX = 0;
    const pmLag = mean(pLag), pmCurr = mean(pCurr);
    for (let i = 0; i < pLag.length; i++) {
      pssXY += (pLag[i] - pmLag) * (pCurr[i] - pmCurr);
      pssXX += (pLag[i] - pmLag) ** 2;
    }
    const pPhi = pssXY / pssXX;
    const pKappa = -Math.log(Math.max(pPhi, 0.001)) * 365;
    const pSkip = pRatio.length > 0 ? pRatio.filter(r => r < 1.2).length / pRatio.length * 100 : NaN;

    console.log(
      `${p.name.padEnd(25)}${String(subset.length).padStart(4)}  ` +
      `${mean(pIV).toFixed(1).padStart(6)}%  ` +
      `${std(pIV).toFixed(1).padStart(5)}  ` +
      `${pVRP.length > 0 ? mean(pVRP).toFixed(1).padStart(6) + "%" : "   N/A "}  ` +
      `${pKappa.toFixed(1).padStart(5)}  ` +
      `${kurtosis(pDeltaIV).toFixed(2).padStart(8)}  ` +
      `${!isNaN(pSkip) ? pSkip.toFixed(0).padStart(4) + "%" : " N/A"}`
    );
  }

  return { kappa: kappaEst, vrpMean, skipRate12, acf1, deltaIVStd, deltaIVKurt, sqACF1 };
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
  console.log(`\n## ${label} — Full-Period Results\n`);
  const cols = results.map(r => r.strategy);
  console.log("| Metric | " + cols.join(" | ") + " |");
  console.log("|--------|" + cols.map(() => "--------").join("|") + "|");

  const rows: [string, (r: BacktestResult) => string][] = [
    ["Days", r => `${r.days}`],
    ["Start Price", r => `$${fmt(r.startPrice, 0)}`],
    ["End Price", r => `$${fmt(r.endPrice, 0)}`],
    ["Underlying Return", r => pct(r.underlyingReturn)],
    ["**Sharpe**", r => fmt(r.sharpe, 3)],
    ["**Sortino**", r => fmt(r.sortino, 3)],
    ["**APR (%)**", r => fmt(r.apr)],
    ["Total P/L ($)", r => fmt(r.totalPL, 0)],
    ["Premium Collected", r => `$${fmt(r.premiumCollected, 0)}`],
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
// PART 3: ROLLING WINDOW BACKTEST (à la Exp 20/23)
// ══════════════════════════════════════════════════════════════════

interface Window {
  id: number;
  startIdx: number;
  endIdx: number;
  startDate: string;
  endDate: string;
  days: number;
}

function generateWindows(aligned: AlignedDay[], windowDays = 365, stride = 90, minWindow = 300): Window[] {
  const windows: Window[] = [];
  let wid = 0;
  for (let start = 0; start + minWindow <= aligned.length; start += stride) {
    const end = Math.min(start + windowDays, aligned.length - 1);
    if (end - start < minWindow) break;
    windows.push({
      id: ++wid,
      startIdx: start,
      endIdx: end,
      startDate: aligned[start].date,
      endDate: aligned[end].date,
      days: end - start,
    });
  }
  return windows;
}

interface WindowResult {
  strategy: string;
  windowId: number;
  startDate: string;
  endDate: string;
  days: number;
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
  underlyingReturn: number;
  alpha: number;
}

function runWindow(strategy: StrategyDef, aligned: AlignedDay[], window: Window): WindowResult {
  const prices = aligned.slice(window.startIdx, window.endIdx + 1).map(d => d.price);
  const ivPath = aligned.slice(window.startIdx, window.endIdx + 1).map(d => d.iv);
  const rules = defaultRules();
  const result = simulate(prices, rules, strategy.config, ivPath);
  const capitalAtRisk = prices[0] * strategy.config.contracts;
  const yearsElapsed = window.days / 365;
  const summary = summarizeRun(0, result, prices, capitalAtRisk, yearsElapsed, strategy.config.riskFreeRate, strategy.config.contracts);

  const putSells = result.signalLog.filter(e => e.signal.action === "SELL_PUT").length;
  const skipRate = (putSells + result.summary.totalSkippedCycles) > 0
    ? result.summary.totalSkippedCycles / (putSells + result.summary.totalSkippedCycles) : 0;
  const benchmarkAPR = ((prices[prices.length - 1] - prices[0]) / prices[0]) / yearsElapsed * 100;

  return {
    strategy: strategy.name,
    windowId: window.id,
    startDate: window.startDate,
    endDate: window.endDate,
    days: window.days,
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
    underlyingReturn: (prices[prices.length - 1] - prices[0]) / prices[0],
    alpha: summary.apr - benchmarkAPR,
  };
}

// ══════════════════════════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════════════════════════

async function main() {
  console.log("═══ Experiment 24: Multi-Asset Validation (BTC) ═══\n");
  const t0 = performance.now();

  // ── Step 1: Fetch data ──
  console.log("Step 1: Fetching data...");
  mkdirSync(DATA_DIR, { recursive: true });
  const [btcDvol, btcPrices] = await Promise.all([fetchBTCDVOL(), fetchBTCPrices()]);
  console.log(`  BTC DVOL: ${btcDvol.length} days (${btcDvol[0].date} → ${btcDvol[btcDvol.length - 1].date})`);
  console.log(`  BTC Prices: ${btcPrices.length} days (${btcPrices[0].date} → ${btcPrices[btcPrices.length - 1].date})`);

  // Load ETH data for cross-asset comparison
  const ethDvol: DailyRecord[] = JSON.parse(readFileSync(join(ETH_DATA_DIR, "dvol.json"), "utf-8"));
  const ethPrices: DailyRecord[] = JSON.parse(readFileSync(join(ETH_DATA_DIR, "prices.json"), "utf-8"));
  console.log(`  ETH DVOL: ${ethDvol.length} days, ETH Prices: ${ethPrices.length} days`);

  const btcAligned = alignData(btcPrices, btcDvol);
  const ethAligned = alignData(ethPrices, ethDvol);
  console.log(`  BTC aligned: ${btcAligned.length} days (${btcAligned[0].date} → ${btcAligned[btcAligned.length - 1].date})`);
  console.log(`  ETH aligned: ${ethAligned.length} days (${ethAligned[0].date} → ${ethAligned[ethAligned.length - 1].date})`);

  // ══════════════════════════════════════════════════════════════
  // PART 1: IV DYNAMICS
  // ══════════════════════════════════════════════════════════════

  console.log("\n\n" + "═".repeat(70));
  console.log("PART 1: IV DYNAMICS ANALYSIS");
  console.log("═".repeat(70));

  const btcStats = analyzeIVDynamics("BTC", btcDvol, btcAligned);
  const ethStats = analyzeIVDynamics("ETH", ethDvol, ethAligned);

  // Cross-asset comparison table
  console.log("\n\n╔══════════════════════════════════════════════════╗");
  console.log("║  CROSS-ASSET IV DYNAMICS COMPARISON              ║");
  console.log("╚══════════════════════════════════════════════════╝\n");

  console.log("| Metric | BTC | ETH | Difference | Implication |");
  console.log("|--------|-----|-----|------------|-------------|");
  console.log(`| κ (mean-reversion) | ${fmt(btcStats.kappa)} | ${fmt(ethStats.kappa)} | ${fmt(btcStats.kappa - ethStats.kappa)} | ${Math.abs(btcStats.kappa - ethStats.kappa) < 3 ? "Similar" : btcStats.kappa > ethStats.kappa ? "BTC reverts faster" : "ETH reverts faster"} |`);
  console.log(`| Mean VRP (%) | ${fmt(btcStats.vrpMean)} | ${fmt(ethStats.vrpMean)} | ${fmt(btcStats.vrpMean - ethStats.vrpMean)} | ${btcStats.vrpMean >= 5 ? "BTC viable" : "BTC marginal"} |`);
  console.log(`| Skip rate t=1.2 | ${fmt(btcStats.skipRate12, 1)}% | ${fmt(ethStats.skipRate12, 1)}% | ${fmt(btcStats.skipRate12 - ethStats.skipRate12, 1)}pp | ${Math.abs(btcStats.skipRate12 - ethStats.skipRate12) < 10 ? "Similar selectivity" : "Different selectivity"} |`);
  console.log(`| IV ACF(1) | ${fmt(btcStats.acf1, 4)} | ${fmt(ethStats.acf1, 4)} | ${fmt(btcStats.acf1 - ethStats.acf1, 4)} | ${btcStats.acf1 > 0.9 ? "Persistent (OU-like)" : "Fast-decaying"} |`);
  console.log(`| ΔIV Std | ${fmt(btcStats.deltaIVStd, 4)} | ${fmt(ethStats.deltaIVStd, 4)} | ${fmt(btcStats.deltaIVStd - ethStats.deltaIVStd, 4)} | ${btcStats.deltaIVStd < ethStats.deltaIVStd ? "BTC smoother" : "BTC more volatile"} |`);
  console.log(`| ΔIV Kurtosis | ${fmt(btcStats.deltaIVKurt, 2)} | ${fmt(ethStats.deltaIVKurt, 2)} | ${fmt(btcStats.deltaIVKurt - ethStats.deltaIVKurt, 2)} | ${btcStats.deltaIVKurt > 6 ? "Fat tails" : "Near-Gaussian"} |`);
  console.log(`| Sq ΔIV ACF(1) | ${fmt(btcStats.sqACF1, 4)} | ${fmt(ethStats.sqACF1, 4)} | ${fmt(btcStats.sqACF1 - ethStats.sqACF1, 4)} | ${btcStats.sqACF1 > 0.1 ? "ARCH present" : "No ARCH"} |`);

  // ══════════════════════════════════════════════════════════════
  // PART 2: HISTORICAL BACKTEST
  // ══════════════════════════════════════════════════════════════

  console.log("\n\n" + "═".repeat(70));
  console.log("PART 2: HISTORICAL BACKTEST");
  console.log("═".repeat(70));

  // Sub-periods — adapted for BTC data range
  interface Period { name: string; start: string; end: string }
  const subPeriods: Period[] = [
    { name: "2021 H2 (Bull)", start: "2021-03-24", end: "2021-11-09" },
    { name: "2022 (Bear)", start: "2021-11-10", end: "2022-11-21" },
    { name: "2023 (Recovery)", start: "2022-11-22", end: "2023-12-31" },
    { name: "2024 (Mixed)", start: "2024-01-01", end: "2024-12-31" },
    { name: "2025 H1 (Bear)", start: "2025-01-01", end: "2026-03-09" },
  ];

  // Run BTC backtests
  console.log("\n### BTC Backtests\n");
  const btcFullResults: BacktestResult[] = [];
  for (const strategy of STRATEGIES) {
    btcFullResults.push(runBacktest(strategy, btcAligned, "Full Period"));
  }
  printFullPeriodTable("BTC", btcFullResults);

  // Sub-period breakdowns
  console.log("\n### BTC Sub-Period Breakdown\n");
  for (const strategy of STRATEGIES) {
    console.log(`\n#### ${strategy.name}\n`);
    console.log("| Period | Days | Ret | Sharpe | APR% | MaxDD | Skip% | Puts | Assigns | Alpha |");
    console.log("|--------|------|-----|--------|------|-------|-------|------|---------|-------|");

    for (const period of subPeriods) {
      const slice = btcAligned.filter(d => d.date >= period.start && d.date <= period.end);
      if (slice.length < 30) continue;
      const r = runBacktest(strategy, slice, period.name);
      console.log(`| ${period.name} | ${r.days} | ${pct(r.underlyingReturn)} | ${fmt(r.sharpe, 3)} | ${fmt(r.apr)} | ${pct(r.maxDrawdown)} | ${pct(r.skipRate)} | ${r.putSells} | ${r.assignments} | ${fmt(r.alpha)} |`);
    }
  }

  // Run ETH backtests (for comparison)
  console.log("\n### ETH Backtests (comparison)\n");
  const ethFullResults: BacktestResult[] = [];
  for (const strategy of STRATEGIES) {
    ethFullResults.push(runBacktest(strategy, ethAligned, "Full Period"));
  }
  printFullPeriodTable("ETH", ethFullResults);

  // Cross-asset strategy comparison
  console.log("\n\n╔══════════════════════════════════════════════════╗");
  console.log("║  CROSS-ASSET STRATEGY COMPARISON                 ║");
  console.log("╚══════════════════════════════════════════════════╝\n");

  console.log("| Metric | BTC Cons | ETH Cons | BTC Aggr | ETH Aggr |");
  console.log("|--------|----------|----------|----------|----------|");

  const btcC = btcFullResults.find(r => r.strategy === "Cons-Sized")!;
  const ethC = ethFullResults.find(r => r.strategy === "Cons-Sized")!;
  const btcA = btcFullResults.find(r => r.strategy === "Aggressive-Sized")!;
  const ethA = ethFullResults.find(r => r.strategy === "Aggressive-Sized")!;

  const compRows: [string, (r: BacktestResult) => string][] = [
    ["Sharpe", r => fmt(r.sharpe, 3)],
    ["APR%", r => fmt(r.apr)],
    ["MaxDD", r => pct(r.maxDrawdown)],
    ["Alpha", r => fmt(r.alpha)],
    ["Skip Rate", r => pct(r.skipRate)],
    ["Put Sells", r => `${r.putSells}`],
    ["Assignments", r => `${r.assignments}`],
    ["Premium", r => `$${fmt(r.premiumCollected, 0)}`],
  ];
  for (const [label, fn] of compRows) {
    console.log(`| ${label} | ${fn(btcC)} | ${fn(ethC)} | ${fn(btcA)} | ${fn(ethA)} |`);
  }

  // ══════════════════════════════════════════════════════════════
  // PART 3: ROLLING WINDOW BACKTEST
  // ══════════════════════════════════════════════════════════════

  console.log("\n\n" + "═".repeat(70));
  console.log("PART 3: ROLLING WINDOW BACKTEST");
  console.log("═".repeat(70));

  const btcWindows = generateWindows(btcAligned);
  const ethWindows = generateWindows(ethAligned);
  console.log(`\nBTC: ${btcWindows.length} windows. ETH: ${ethWindows.length} windows.\n`);

  // Run BTC rolling windows
  const btcWindowResults: WindowResult[] = [];
  for (const strategy of STRATEGIES) {
    for (const w of btcWindows) {
      btcWindowResults.push(runWindow(strategy, btcAligned, w));
    }
  }

  // Run ETH rolling windows
  const ethWindowResults: WindowResult[] = [];
  for (const strategy of STRATEGIES) {
    for (const w of ethWindows) {
      ethWindowResults.push(runWindow(strategy, ethAligned, w));
    }
  }

  const elapsed1 = ((performance.now() - t0) / 1000).toFixed(2);
  console.log(`All backtests completed in ${elapsed1}s\n`);

  // ── BTC rolling window summary ──
  console.log("### BTC Rolling Window Distribution\n");
  console.log("| Strategy | Mean Sharpe | Median | Std | Min | Max | Neg% | Mean MaxDD | Max MaxDD | Mean APR |");
  console.log("|----------|-----------|--------|-----|-----|-----|------|------------|-----------|----------|");

  for (const strategy of STRATEGIES) {
    const results = btcWindowResults.filter(r => r.strategy === strategy.name);
    const sharpes = results.map(r => r.sharpe);
    const maxDDs = results.map(r => r.maxDrawdown);
    const aprs = results.map(r => r.apr);
    const s = arrStats(sharpes);
    const d = arrStats(maxDDs);
    const negPct = sharpes.filter(v => v < 0).length / sharpes.length;
    console.log(`| ${strategy.name} | ${fmt(s.mean, 3)} | ${fmt(s.median, 3)} | ${fmt(s.std, 3)} | ${fmt(s.min, 3)} | ${fmt(s.max, 3)} | ${pct(negPct)} | ${pct(d.mean)} | ${pct(d.max)} | ${fmt(arrStats(aprs).mean, 1)}% |`);
  }

  // ── ETH rolling window summary ──
  console.log("\n### ETH Rolling Window Distribution\n");
  console.log("| Strategy | Mean Sharpe | Median | Std | Min | Max | Neg% | Mean MaxDD | Max MaxDD | Mean APR |");
  console.log("|----------|-----------|--------|-----|-----|-----|------|------------|-----------|----------|");

  for (const strategy of STRATEGIES) {
    const results = ethWindowResults.filter(r => r.strategy === strategy.name);
    const sharpes = results.map(r => r.sharpe);
    const maxDDs = results.map(r => r.maxDrawdown);
    const aprs = results.map(r => r.apr);
    const s = arrStats(sharpes);
    const d = arrStats(maxDDs);
    const negPct = sharpes.filter(v => v < 0).length / sharpes.length;
    console.log(`| ${strategy.name} | ${fmt(s.mean, 3)} | ${fmt(s.median, 3)} | ${fmt(s.std, 3)} | ${fmt(s.min, 3)} | ${fmt(s.max, 3)} | ${pct(negPct)} | ${pct(d.mean)} | ${pct(d.max)} | ${fmt(arrStats(aprs).mean, 1)}% |`);
  }

  // ── Cross-asset rolling comparison ──
  console.log("\n\n╔══════════════════════════════════════════════════╗");
  console.log("║  CROSS-ASSET ROLLING WINDOW COMPARISON           ║");
  console.log("╚══════════════════════════════════════════════════╝\n");

  console.log("| Metric | BTC Cons | ETH Cons | BTC Aggr | ETH Aggr |");
  console.log("|--------|----------|----------|----------|----------|");

  for (const [label, getter] of [
    ["Mean Sharpe", (rs: WindowResult[]) => fmt(arrStats(rs.map(r => r.sharpe)).mean, 3)],
    ["Median Sharpe", (rs: WindowResult[]) => fmt(arrStats(rs.map(r => r.sharpe)).median, 3)],
    ["Sharpe Std", (rs: WindowResult[]) => fmt(arrStats(rs.map(r => r.sharpe)).std, 3)],
    ["Neg Sharpe %", (rs: WindowResult[]) => pct(rs.filter(r => r.sharpe < 0).length / rs.length)],
    ["Mean MaxDD", (rs: WindowResult[]) => pct(arrStats(rs.map(r => r.maxDrawdown)).mean)],
    ["Max MaxDD", (rs: WindowResult[]) => pct(arrStats(rs.map(r => r.maxDrawdown)).max)],
    ["Mean APR%", (rs: WindowResult[]) => fmt(arrStats(rs.map(r => r.apr)).mean, 1) + "%"],
    ["Mean Skip%", (rs: WindowResult[]) => pct(rs.reduce((a, r) => a + r.skipRate, 0) / rs.length)],
    ["Mean Puts/Window", (rs: WindowResult[]) => fmt(rs.reduce((a, r) => a + r.putSells, 0) / rs.length, 1)],
  ] as [string, (rs: WindowResult[]) => string][]) {
    const btcCons = btcWindowResults.filter(r => r.strategy === "Cons-Sized");
    const ethCons = ethWindowResults.filter(r => r.strategy === "Cons-Sized");
    const btcAggr = btcWindowResults.filter(r => r.strategy === "Aggressive-Sized");
    const ethAggr = ethWindowResults.filter(r => r.strategy === "Aggressive-Sized");
    console.log(`| ${label} | ${getter(btcCons)} | ${getter(ethCons)} | ${getter(btcAggr)} | ${getter(ethAggr)} |`);
  }

  // ── Per-window detail (BTC) ──
  console.log("\n### BTC Per-Window Detail\n");
  console.log("| Window | Start | End | BTC Ret | Cons Sharpe | Cons MaxDD | Aggr Sharpe | Aggr MaxDD | Winner |");
  console.log("|--------|-------|-----|---------|-------------|------------|-------------|------------|--------|");

  for (const w of btcWindows) {
    const cons = btcWindowResults.find(r => r.strategy === "Cons-Sized" && r.windowId === w.id)!;
    const aggr = btcWindowResults.find(r => r.strategy === "Aggressive-Sized" && r.windowId === w.id)!;
    const winner = cons.sharpe > aggr.sharpe + 0.01 ? "Cons" : aggr.sharpe > cons.sharpe + 0.01 ? "Aggr" : "Tie";
    console.log(`| ${w.id} | ${w.startDate} | ${w.endDate} | ${pct(cons.underlyingReturn)} | ${fmt(cons.sharpe, 3)} | ${pct(cons.maxDrawdown)} | ${fmt(aggr.sharpe, 3)} | ${pct(aggr.maxDrawdown)} | ${winner} |`);
  }

  // ── Paired comparison: Conservative vs Aggressive on BTC ──
  console.log("\n### BTC Paired Comparison: Conservative vs Aggressive\n");
  const btcConsResults = btcWindowResults.filter(r => r.strategy === "Cons-Sized");
  const btcAggrResults = btcWindowResults.filter(r => r.strategy === "Aggressive-Sized");

  let consWins = 0, aggrWins = 0;
  const deltaSharpes: number[] = [];
  for (let i = 0; i < btcConsResults.length; i++) {
    const diff = btcConsResults[i].sharpe - btcAggrResults[i].sharpe;
    deltaSharpes.push(diff);
    if (diff > 0.01) consWins++;
    else if (diff < -0.01) aggrWins++;
  }
  const meanDelta = mean(deltaSharpes);
  const stdDelta = std(deltaSharpes);
  const tStat = meanDelta / (stdDelta / Math.sqrt(deltaSharpes.length));

  console.log(`Conservative wins: ${consWins}/${btcConsResults.length}`);
  console.log(`Aggressive wins:   ${aggrWins}/${btcConsResults.length}`);
  console.log(`Ties:              ${btcConsResults.length - consWins - aggrWins}/${btcConsResults.length}`);
  console.log(`Mean ΔSharpe (Cons−Aggr): ${meanDelta >= 0 ? "+" : ""}${fmt(meanDelta, 3)} ± ${fmt(stdDelta, 3)}`);
  console.log(`t-stat: ${fmt(tStat, 2)} (significant if |t| > 2.12 at p<0.05, df=${btcConsResults.length - 1})`);

  // ── Walk-forward ──
  console.log("\n### Walk-Forward Validation\n");
  console.log("| Asset | Strategy | 1st Half Sharpe | 2nd Half Sharpe | Δ | Consistent? |");
  console.log("|-------|----------|-----------------|-----------------|---|-------------|");

  for (const [asset, windowResults, windows_] of [
    ["BTC", btcWindowResults, btcWindows],
    ["ETH", ethWindowResults, ethWindows],
  ] as [string, WindowResult[], Window[]][]) {
    const midWindow = Math.floor(windows_.length / 2);
    for (const strategy of STRATEGIES) {
      const results = windowResults.filter(r => r.strategy === strategy.name);
      const firstHalf = results.filter(r => r.windowId <= windows_[midWindow - 1].id);
      const secondHalf = results.filter(r => r.windowId > windows_[midWindow - 1].id);
      const meanFirst = mean(firstHalf.map(r => r.sharpe));
      const meanSecond = mean(secondHalf.map(r => r.sharpe));
      const delta = meanSecond - meanFirst;
      const consistent = (meanFirst > 0) === (meanSecond > 0) ? "Yes" : "NO";
      console.log(`| ${asset} | ${strategy.name} | ${fmt(meanFirst, 3)} | ${fmt(meanSecond, 3)} | ${delta >= 0 ? "+" : ""}${fmt(delta, 3)} | ${consistent} |`);
    }
  }

  // ══════════════════════════════════════════════════════════════
  // VERDICT
  // ══════════════════════════════════════════════════════════════

  console.log("\n\n" + "═".repeat(70));
  console.log("VERDICT");
  console.log("═".repeat(70) + "\n");

  const btcConsMeanSharpe = arrStats(btcWindowResults.filter(r => r.strategy === "Cons-Sized").map(r => r.sharpe)).mean;
  const btcAggrMeanSharpe = arrStats(btcWindowResults.filter(r => r.strategy === "Aggressive-Sized").map(r => r.sharpe)).mean;
  const btcConsMaxDD = arrStats(btcWindowResults.filter(r => r.strategy === "Cons-Sized").map(r => r.maxDrawdown)).max;
  const btcAggrMaxDD = arrStats(btcWindowResults.filter(r => r.strategy === "Aggressive-Sized").map(r => r.maxDrawdown)).max;

  const ethConsMeanSharpe = arrStats(ethWindowResults.filter(r => r.strategy === "Cons-Sized").map(r => r.sharpe)).mean;
  const ethAggrMeanSharpe = arrStats(ethWindowResults.filter(r => r.strategy === "Aggressive-Sized").map(r => r.sharpe)).mean;

  console.log("Key Questions Answered:");
  console.log(`  1. BTC IV mean-reversion: κ=${fmt(btcStats.kappa)} → ${btcStats.kappa >= 2 && btcStats.kappa <= 10 ? "OU-compatible" : btcStats.kappa < 2 ? "Too slow (Heston-like)" : "Faster than OU"}`);
  console.log(`  2. BTC VRP: ${fmt(btcStats.vrpMean)}% → ${btcStats.vrpMean >= 10 ? "Above both floors" : btcStats.vrpMean >= 5 ? "Above Active floor (5%), below Conservative (10%)" : "Below floor"}`);
  console.log(`  3. BTC skip rate at t=1.2: ${fmt(btcStats.skipRate12, 1)}% (ETH: ${fmt(ethStats.skipRate12, 1)}%) → ${Math.abs(btcStats.skipRate12 - ethStats.skipRate12) < 10 ? "Similar" : "Different"}`);
  console.log(`  4. Strategy ranking on BTC: ${btcConsMeanSharpe > btcAggrMeanSharpe ? "Conservative > Aggressive" : "Aggressive > Conservative"} (Mean Sharpe: Cons=${fmt(btcConsMeanSharpe, 3)}, Aggr=${fmt(btcAggrMeanSharpe, 3)})`);
  console.log(`     ETH ranking confirmation: ${ethConsMeanSharpe > ethAggrMeanSharpe ? "Conservative > Aggressive" : "Aggressive > Conservative"} (Mean Sharpe: Cons=${fmt(ethConsMeanSharpe, 3)}, Aggr=${fmt(ethAggrMeanSharpe, 3)})`);
  console.log(`  5. BTC MaxDD target (<40%): Cons=${pct(btcConsMaxDD)} (${btcConsMaxDD < 0.40 ? "PASS" : "FAIL"}), Aggr=${pct(btcAggrMaxDD)} (${btcAggrMaxDD < 0.40 ? "PASS" : "FAIL"})`);

  const btcConsWinner = btcConsMeanSharpe > btcAggrMeanSharpe;
  const ethConsWinner = ethConsMeanSharpe > ethAggrMeanSharpe;
  console.log(`\n  → Conservative dominance is ${btcConsWinner === ethConsWinner ? "CONSISTENT" : "NOT CONSISTENT"} across assets.`);
  console.log(`  → Framework is ${btcStats.kappa >= 2 && btcStats.vrpMean >= 5 ? "VALIDATED" : "NOT VALIDATED"} for BTC deployment.`);

  const totalElapsed = ((performance.now() - t0) / 1000).toFixed(2);
  console.log(`\n═══ Experiment 24 Complete (${totalElapsed}s) ═══`);
}

main().catch(e => { console.error(e); process.exit(1); });
