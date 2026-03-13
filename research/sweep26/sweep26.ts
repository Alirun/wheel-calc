// Experiment 26: Cross-Asset Portfolio Analysis
// Run Conservative + Aggressive on ETH and BTC simultaneously.
// Measure portfolio-level Sharpe, MaxDD, and diversification benefit.
// Key questions:
//   1. What is the correlation between asset wheel returns?
//   2. Does combining assets reduce portfolio MaxDD below individual-asset levels?
//   3. What allocation (equal weight vs vol-weighted) maximizes portfolio Sharpe?

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { simulate } from "../../src/components/strategy/simulate.ts";
import { defaultRules } from "../../src/components/strategy/rules.ts";
import { summarizeRun } from "../../src/components/monte-carlo.ts";
import type { StrategyConfig, DailyState } from "../../src/components/strategy/types.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Data Loading ────────────────────────────────────────────────

interface DailyRecord { date: string; close: number }
interface AlignedDay { date: string; price: number; iv: number }

function alignData(prices: DailyRecord[], dvol: DailyRecord[]): AlignedDay[] {
  const dvolMap = new Map(dvol.map(d => [d.date, d.close / 100]));
  return prices
    .filter(p => dvolMap.has(p.date))
    .map(p => ({ date: p.date, price: p.close, iv: dvolMap.get(p.date)! }));
}

function loadAssetData(dataDir: string, dvol: string, prices: string): AlignedDay[] {
  const dvolData: DailyRecord[] = JSON.parse(readFileSync(join(dataDir, dvol), "utf-8"));
  const priceData: DailyRecord[] = JSON.parse(readFileSync(join(dataDir, prices), "utf-8"));
  return alignData(priceData, dvolData);
}

// ── Strategy Definitions ────────────────────────────────────────

const BASE_CONFIG: Pick<StrategyConfig, "impliedVol" | "riskFreeRate" | "contracts" | "bidAskSpreadPct" | "feePerTrade"> = {
  impliedVol: 0.80,
  riskFreeRate: 0.05,
  contracts: 1,
  bidAskSpreadPct: 0.05,
  feePerTrade: 0.50,
};

interface StrategyDef { name: string; config: StrategyConfig }

const CONSERVATIVE: StrategyDef = {
  name: "Conservative",
  config: {
    ...BASE_CONFIG,
    targetDelta: 0.10,
    cycleLengthDays: 30,
    adaptiveCalls: { minDelta: 0.10, maxDelta: 0.50, skipThresholdPct: 0, minStrikeAtCost: true },
    ivRvSpread: { lookbackDays: 45, minMultiplier: 0.8, maxMultiplier: 1.3, skipBelowRatio: 1.1, skipSide: "put" },
    rollPut: { initialDTE: 30, rollWhenDTEBelow: 14, requireNetCredit: true },
    positionSizing: { mode: "volScaled", volTarget: 0.40, volLookbackDays: 45, minSize: 0.10, coldStartDays: 45, coldStartSize: 0.50 },
  },
};

const AGGRESSIVE: StrategyDef = {
  name: "Aggressive",
  config: {
    ...BASE_CONFIG,
    targetDelta: 0.20,
    cycleLengthDays: 3,
    ivRvSpread: { lookbackDays: 20, minMultiplier: 0.8, maxMultiplier: 1.3, skipBelowRatio: 1.2, skipSide: "put" },
    positionSizing: { mode: "volScaled", volTarget: 0.40, volLookbackDays: 45, minSize: 0.10 },
  },
};

const STRATEGIES = [CONSERVATIVE, AGGRESSIVE];

// ── Statistics Helpers ──────────────────────────────────────────

function mean(arr: number[]): number {
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}
function std(arr: number[], m?: number): number {
  const mu = m ?? mean(arr);
  return Math.sqrt(arr.reduce((s, v) => s + (v - mu) ** 2, 0) / (arr.length - 1));
}
function fmt(n: number, dec = 2): string { return n.toFixed(dec); }
function pct(n: number, dec = 1): string { return (n * 100).toFixed(dec) + "%"; }

// ── Equity Curve & Portfolio Helpers ────────────────────────────

interface DailyEquity {
  date: string;
  equity: number;    // normalised: starts at 1.0
  dailyReturn: number;
}

function buildEquityCurve(data: AlignedDay[], strategy: StrategyDef): DailyEquity[] {
  const prices = data.map(d => d.price);
  const ivPath = data.map(d => d.iv);
  const rules = defaultRules();
  const result = simulate(prices, rules, strategy.config, ivPath);
  const capitalAtRisk = prices[0] * strategy.config.contracts;

  const equities: DailyEquity[] = [];
  for (let i = 0; i < result.dailyStates.length; i++) {
    const ds = result.dailyStates[i];
    const totalEquity = capitalAtRisk + ds.cumulativePL + ds.unrealizedPL;
    const normalised = totalEquity / capitalAtRisk;
    const dailyReturn = i === 0 ? 0 : (normalised - equities[i - 1].equity) / equities[i - 1].equity;
    equities.push({ date: data[i].date, equity: normalised, dailyReturn });
  }
  return equities;
}

function computeMaxDrawdown(equities: number[]): number {
  let peak = equities[0];
  let maxDD = 0;
  for (const eq of equities) {
    if (eq > peak) peak = eq;
    const dd = (peak - eq) / peak;
    if (dd > maxDD) maxDD = dd;
  }
  return maxDD;
}

function computeSharpe(dailyReturns: number[], rfAnnual: number): number {
  const rfDaily = rfAnnual / 365;
  const excess = dailyReturns.map(r => r - rfDaily);
  const m = mean(excess);
  const s = std(excess);
  return s === 0 ? 0 : (m / s) * Math.sqrt(365);
}

function computeSortino(dailyReturns: number[], rfAnnual: number): number {
  const rfDaily = rfAnnual / 365;
  const excess = dailyReturns.map(r => r - rfDaily);
  const m = mean(excess);
  const downside = excess.filter(r => r < 0);
  if (downside.length === 0) return m > 0 ? Infinity : 0;
  const downDev = Math.sqrt(downside.reduce((s, r) => s + r * r, 0) / downside.length);
  return downDev === 0 ? 0 : (m / downDev) * Math.sqrt(365);
}

function computeAPR(equityCurve: number[]): number {
  const totalReturn = equityCurve[equityCurve.length - 1] / equityCurve[0] - 1;
  const years = (equityCurve.length - 1) / 365;
  return (totalReturn / years) * 100;
}

function pearsonCorrelation(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  const mA = mean(a.slice(0, n)), mB = mean(b.slice(0, n));
  let num = 0, denA = 0, denB = 0;
  for (let i = 0; i < n; i++) {
    const dA = a[i] - mA, dB = b[i] - mB;
    num += dA * dB;
    denA += dA * dA;
    denB += dB * dB;
  }
  const den = Math.sqrt(denA * denB);
  return den === 0 ? 0 : num / den;
}

// ── Portfolio Construction ──────────────────────────────────────

interface PortfolioLeg {
  label: string;
  equities: DailyEquity[];
}

interface PortfolioConfig {
  name: string;
  legs: PortfolioLeg[];
  weights: number[];
}

function buildPortfolioEquity(portfolio: PortfolioConfig): DailyEquity[] {
  const n = Math.min(...portfolio.legs.map(l => l.equities.length));
  const result: DailyEquity[] = [];

  for (let i = 0; i < n; i++) {
    let portEquity = 0;
    for (let j = 0; j < portfolio.legs.length; j++) {
      portEquity += portfolio.weights[j] * portfolio.legs[j].equities[i].equity;
    }
    const dailyReturn = i === 0 ? 0 : (portEquity - result[i - 1].equity) / result[i - 1].equity;
    result.push({
      date: portfolio.legs[0].equities[i].date,
      equity: portEquity,
      dailyReturn,
    });
  }
  return result;
}

interface PortfolioMetrics {
  name: string;
  sharpe: number;
  sortino: number;
  apr: number;
  maxDrawdown: number;
  totalReturn: number;
  annVol: number;
  weights: string;
}

function computePortfolioMetrics(name: string, equities: DailyEquity[], weights: number[], rfAnnual: number): PortfolioMetrics {
  const dailyReturns = equities.slice(1).map(e => e.dailyReturn);
  const equityCurve = equities.map(e => e.equity);
  return {
    name,
    sharpe: computeSharpe(dailyReturns, rfAnnual),
    sortino: computeSortino(dailyReturns, rfAnnual),
    apr: computeAPR(equityCurve),
    maxDrawdown: computeMaxDrawdown(equityCurve),
    totalReturn: equityCurve[equityCurve.length - 1] / equityCurve[0] - 1,
    annVol: std(dailyReturns) * Math.sqrt(365) * 100,
    weights: weights.map(w => pct(w, 0)).join(" / "),
  };
}

// ── Rolling Window ──────────────────────────────────────────────

interface Window { id: number; startIdx: number; endIdx: number; startDate: string; endDate: string; days: number }

function generateWindows(length: number, dates: string[], windowDays = 365, stride = 90, minWindow = 300): Window[] {
  const windows: Window[] = [];
  let wid = 0;
  for (let start = 0; start + minWindow <= length; start += stride) {
    const end = Math.min(start + windowDays, length - 1);
    if (end - start < minWindow) break;
    windows.push({ id: ++wid, startIdx: start, endIdx: end, startDate: dates[start], endDate: dates[end], days: end - start });
  }
  return windows;
}

interface WindowMetrics {
  windowId: number;
  startDate: string;
  endDate: string;
  days: number;
  sharpe: number;
  sortino: number;
  apr: number;
  maxDrawdown: number;
}

function windowSlice(equities: DailyEquity[], w: Window): DailyEquity[] {
  const slice = equities.slice(w.startIdx, w.endIdx + 1);
  const baseEq = slice[0].equity;
  return slice.map((e, i) => ({
    date: e.date,
    equity: e.equity / baseEq,
    dailyReturn: i === 0 ? 0 : (e.equity - slice[i - 1].equity) / slice[i - 1].equity,
  }));
}

function computeWindowMetrics(equities: DailyEquity[], w: Window, rfAnnual: number): WindowMetrics {
  const sliced = windowSlice(equities, w);
  const dailyReturns = sliced.slice(1).map(e => e.dailyReturn);
  const eqCurve = sliced.map(e => e.equity);
  return {
    windowId: w.id,
    startDate: w.startDate,
    endDate: w.endDate,
    days: w.days,
    sharpe: computeSharpe(dailyReturns, rfAnnual),
    sortino: computeSortino(dailyReturns, rfAnnual),
    apr: computeAPR(eqCurve),
    maxDrawdown: computeMaxDrawdown(eqCurve),
  };
}

// ══════════════════════════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════════════════════════

function main() {
  console.log("═══ Experiment 26: Cross-Asset Portfolio Analysis ═══\n");
  const t0 = performance.now();
  const RF = 0.05;

  // ── Step 1: Load data ──
  console.log("Step 1: Loading cached data...");
  const ethAligned = loadAssetData(join(__dirname, "..", "sweep16", "data"), "dvol.json", "prices.json");
  const btcAligned = loadAssetData(join(__dirname, "..", "sweep24", "data"), "btc_dvol.json", "btc_prices.json");
  console.log(`  ETH: ${ethAligned.length} days (${ethAligned[0].date} → ${ethAligned[ethAligned.length - 1].date})`);
  console.log(`  BTC: ${btcAligned.length} days (${btcAligned[0].date} → ${btcAligned[btcAligned.length - 1].date})`);

  // Find common date range
  const ethDates = new Set(ethAligned.map(d => d.date));
  const btcDates = new Set(btcAligned.map(d => d.date));
  const commonDates = new Set([...ethDates].filter(d => btcDates.has(d)));
  const ethCommon = ethAligned.filter(d => commonDates.has(d.date));
  const btcCommon = btcAligned.filter(d => commonDates.has(d.date));
  console.log(`  Common dates: ${commonDates.size} days (${ethCommon[0].date} → ${ethCommon[ethCommon.length - 1].date})`);

  // ── Step 2: Build equity curves ──
  console.log("\nStep 2: Building equity curves...");
  const curves: Map<string, DailyEquity[]> = new Map();
  const assets = [
    { label: "ETH", data: ethCommon },
    { label: "BTC", data: btcCommon },
  ];

  for (const asset of assets) {
    for (const strategy of STRATEGIES) {
      const key = `${asset.label}-${strategy.name}`;
      console.log(`  Building ${key}...`);
      curves.set(key, buildEquityCurve(asset.data, strategy));
    }
  }

  // ══════════════════════════════════════════════════════════════
  // PART 1: CORRELATION ANALYSIS
  // ══════════════════════════════════════════════════════════════

  console.log("\n\n" + "═".repeat(70));
  console.log("PART 1: RETURN CORRELATION ANALYSIS");
  console.log("═".repeat(70) + "\n");

  const keys = ["ETH-Conservative", "ETH-Aggressive", "BTC-Conservative", "BTC-Aggressive"];

  // Daily return correlation matrix
  console.log("### Daily Return Correlation Matrix\n");
  console.log("| | " + keys.join(" | ") + " |");
  console.log("|" + "-|".repeat(keys.length + 1));

  for (const k1 of keys) {
    const row = [k1];
    const r1 = curves.get(k1)!.slice(1).map(e => e.dailyReturn);
    for (const k2 of keys) {
      const r2 = curves.get(k2)!.slice(1).map(e => e.dailyReturn);
      row.push(fmt(pearsonCorrelation(r1, r2), 3));
    }
    console.log("| " + row.join(" | ") + " |");
  }

  // Cross-asset same-strategy correlation
  console.log("\n### Key Correlations\n");
  const ethConsR = curves.get("ETH-Conservative")!.slice(1).map(e => e.dailyReturn);
  const btcConsR = curves.get("BTC-Conservative")!.slice(1).map(e => e.dailyReturn);
  const ethAggrR = curves.get("ETH-Aggressive")!.slice(1).map(e => e.dailyReturn);
  const btcAggrR = curves.get("BTC-Aggressive")!.slice(1).map(e => e.dailyReturn);

  console.log(`  ETH-Cons ↔ BTC-Cons: ${fmt(pearsonCorrelation(ethConsR, btcConsR), 3)}`);
  console.log(`  ETH-Aggr ↔ BTC-Aggr: ${fmt(pearsonCorrelation(ethAggrR, btcAggrR), 3)}`);
  console.log(`  ETH-Cons ↔ ETH-Aggr: ${fmt(pearsonCorrelation(ethConsR, ethAggrR), 3)}`);
  console.log(`  BTC-Cons ↔ BTC-Aggr: ${fmt(pearsonCorrelation(btcConsR, btcAggrR), 3)}`);
  console.log(`  ETH-Cons ↔ BTC-Aggr: ${fmt(pearsonCorrelation(ethConsR, btcAggrR), 3)}`);
  console.log(`  ETH-Aggr ↔ BTC-Cons: ${fmt(pearsonCorrelation(ethAggrR, btcConsR), 3)}`);

  // Rolling 90-day correlation
  console.log("\n### Rolling 90-Day Correlation (ETH ↔ BTC, same strategy)\n");
  console.log("| Window | Start | End | Cons Corr | Aggr Corr |");
  console.log("|--------|-------|-----|-----------|-----------|");

  const rollingCorrDays = 90;
  const rollingConsCorrs: number[] = [];
  const rollingAggrCorrs: number[] = [];
  for (let start = 0; start + rollingCorrDays < ethConsR.length; start += rollingCorrDays) {
    const end = Math.min(start + rollingCorrDays, ethConsR.length);
    const ecSlice = ethConsR.slice(start, end);
    const bcSlice = btcConsR.slice(start, end);
    const eaSlice = ethAggrR.slice(start, end);
    const baSlice = btcAggrR.slice(start, end);
    const consCorr = pearsonCorrelation(ecSlice, bcSlice);
    const aggrCorr = pearsonCorrelation(eaSlice, baSlice);
    rollingConsCorrs.push(consCorr);
    rollingAggrCorrs.push(aggrCorr);
    const startDate = curves.get("ETH-Conservative")![start + 1].date;
    const endDate = curves.get("ETH-Conservative")![Math.min(end, curves.get("ETH-Conservative")!.length - 1)].date;
    console.log(`| ${Math.floor(start / rollingCorrDays) + 1} | ${startDate} | ${endDate} | ${fmt(consCorr, 3)} | ${fmt(aggrCorr, 3)} |`);
  }

  console.log(`\nRolling Correlation Summary:`);
  console.log(`  Conservative: mean=${fmt(mean(rollingConsCorrs), 3)}, std=${fmt(std(rollingConsCorrs), 3)}, min=${fmt(Math.min(...rollingConsCorrs), 3)}, max=${fmt(Math.max(...rollingConsCorrs), 3)}`);
  console.log(`  Aggressive:   mean=${fmt(mean(rollingAggrCorrs), 3)}, std=${fmt(std(rollingAggrCorrs), 3)}, min=${fmt(Math.min(...rollingAggrCorrs), 3)}, max=${fmt(Math.max(...rollingAggrCorrs), 3)}`);

  // ══════════════════════════════════════════════════════════════
  // PART 2: PORTFOLIO CONSTRUCTION & FULL-PERIOD ANALYSIS
  // ══════════════════════════════════════════════════════════════

  console.log("\n\n" + "═".repeat(70));
  console.log("PART 2: PORTFOLIO CONSTRUCTION (FULL PERIOD)");
  console.log("═".repeat(70) + "\n");

  // Compute trailing annualised vol for vol-weighting
  function computeTrailingVol(equities: DailyEquity[], lookback = 90): number {
    const returns = equities.slice(Math.max(1, equities.length - lookback)).map(e => e.dailyReturn);
    return std(returns) * Math.sqrt(365);
  }

  // Compute average full-period vol for simple vol-weighting
  function computeFullVol(equities: DailyEquity[]): number {
    const returns = equities.slice(1).map(e => e.dailyReturn);
    return std(returns) * Math.sqrt(365);
  }

  // Build portfolios
  const portfolios: { name: string; equities: DailyEquity[]; weights: number[] }[] = [];

  // Single-asset baselines
  for (const key of keys) {
    const eq = curves.get(key)!;
    portfolios.push({ name: key, equities: eq, weights: [1.0] });
  }

  // Two-asset equal-weight portfolios
  const twoAssetCombos: [string, string][] = [
    ["ETH-Conservative", "BTC-Conservative"],
    ["ETH-Conservative", "BTC-Aggressive"],
    ["ETH-Aggressive", "BTC-Conservative"],
    ["ETH-Aggressive", "BTC-Aggressive"],
  ];

  for (const [a, b] of twoAssetCombos) {
    const config: PortfolioConfig = {
      name: `EW: ${a} + ${b}`,
      legs: [{ label: a, equities: curves.get(a)! }, { label: b, equities: curves.get(b)! }],
      weights: [0.5, 0.5],
    };
    const eq = buildPortfolioEquity(config);
    portfolios.push({ name: config.name, equities: eq, weights: [0.5, 0.5] });
  }

  // Two-asset inverse-vol-weighted portfolios
  for (const [a, b] of twoAssetCombos) {
    const volA = computeFullVol(curves.get(a)!);
    const volB = computeFullVol(curves.get(b)!);
    const invA = 1 / volA, invB = 1 / volB;
    const total = invA + invB;
    const wA = invA / total, wB = invB / total;
    const config: PortfolioConfig = {
      name: `IV: ${a} + ${b}`,
      legs: [{ label: a, equities: curves.get(a)! }, { label: b, equities: curves.get(b)! }],
      weights: [wA, wB],
    };
    const eq = buildPortfolioEquity(config);
    portfolios.push({ name: config.name, equities: eq, weights: [wA, wB] });
  }

  // Four-leg equal-weight portfolio
  {
    const config: PortfolioConfig = {
      name: "EW: All 4 Legs",
      legs: keys.map(k => ({ label: k, equities: curves.get(k)! })),
      weights: [0.25, 0.25, 0.25, 0.25],
    };
    const eq = buildPortfolioEquity(config);
    portfolios.push({ name: config.name, equities: eq, weights: [0.25, 0.25, 0.25, 0.25] });
  }

  // Four-leg inverse-vol-weighted portfolio
  {
    const vols = keys.map(k => computeFullVol(curves.get(k)!));
    const invVols = vols.map(v => 1 / v);
    const totalInv = invVols.reduce((s, v) => s + v, 0);
    const weights = invVols.map(v => v / totalInv);
    const config: PortfolioConfig = {
      name: "IV: All 4 Legs",
      legs: keys.map(k => ({ label: k, equities: curves.get(k)! })),
      weights,
    };
    const eq = buildPortfolioEquity(config);
    portfolios.push({ name: config.name, equities: eq, weights });
  }

  // Best cross-asset combo from Exp 24 insight: ETH-Cons + BTC-Aggr (different winners per asset)
  // Also test "best of each asset": ETH-Cons + BTC-best (Cons on BTC had higher rolling mean)
  // Sharpe-weighted: allocate proportional to trailing rolling Sharpe
  {
    const ethConsEq = curves.get("ETH-Conservative")!;
    const btcAggrEq = curves.get("BTC-Aggressive")!;
    // Compute trailing 365d Sharpe for dynamic weighting
    const lookback = 365;
    const dynamicEq: DailyEquity[] = [];
    for (let i = 0; i < Math.min(ethConsEq.length, btcAggrEq.length); i++) {
      if (i < lookback + 1) {
        // First year: equal weight
        const eq = 0.5 * ethConsEq[i].equity + 0.5 * btcAggrEq[i].equity;
        dynamicEq.push({
          date: ethConsEq[i].date,
          equity: eq,
          dailyReturn: i === 0 ? 0 : (eq - dynamicEq[i - 1].equity) / dynamicEq[i - 1].equity,
        });
      } else {
        const ethReturns = ethConsEq.slice(i - lookback, i).map(e => e.dailyReturn);
        const btcReturns = btcAggrEq.slice(i - lookback, i).map(e => e.dailyReturn);
        const ethSharpe = Math.max(computeSharpe(ethReturns, RF), 0.01);
        const btcSharpe = Math.max(computeSharpe(btcReturns, RF), 0.01);
        const total = ethSharpe + btcSharpe;
        const wETH = ethSharpe / total, wBTC = btcSharpe / total;
        const eq = wETH * ethConsEq[i].equity + wBTC * btcAggrEq[i].equity;
        dynamicEq.push({
          date: ethConsEq[i].date,
          equity: eq,
          dailyReturn: (eq - dynamicEq[i - 1].equity) / dynamicEq[i - 1].equity,
        });
      }
    }
    portfolios.push({ name: "Dynamic Sharpe: ETH-Cons + BTC-Aggr", equities: dynamicEq, weights: [] });
  }

  // Print full-period results table
  console.log("### Full-Period Portfolio Metrics\n");
  console.log("| Portfolio | Sharpe | Sortino | APR% | MaxDD | Total Return | Ann Vol | Weights |");
  console.log("|-----------|--------|---------|------|-------|--------------|---------|---------|");

  const allMetrics: PortfolioMetrics[] = [];
  for (const p of portfolios) {
    const metrics = computePortfolioMetrics(p.name, p.equities, p.weights, RF);
    allMetrics.push(metrics);
    console.log(`| ${metrics.name} | ${fmt(metrics.sharpe, 3)} | ${fmt(metrics.sortino, 3)} | ${fmt(metrics.apr)} | ${pct(metrics.maxDrawdown)} | ${pct(metrics.totalReturn)} | ${fmt(metrics.annVol)}% | ${metrics.weights} |`);
  }

  // Highlight best portfolios
  console.log("\n### Rankings\n");
  const bySharpe = [...allMetrics].sort((a, b) => b.sharpe - a.sharpe);
  console.log("**By Sharpe (top 5):**");
  for (let i = 0; i < Math.min(5, bySharpe.length); i++) {
    console.log(`  ${i + 1}. ${bySharpe[i].name}: ${fmt(bySharpe[i].sharpe, 3)} Sharpe, ${pct(bySharpe[i].maxDrawdown)} MaxDD`);
  }

  const byMaxDD = [...allMetrics].sort((a, b) => a.maxDrawdown - b.maxDrawdown);
  console.log("\n**By MaxDD (lowest 5):**");
  for (let i = 0; i < Math.min(5, byMaxDD.length); i++) {
    console.log(`  ${i + 1}. ${byMaxDD[i].name}: ${pct(byMaxDD[i].maxDrawdown)} MaxDD, ${fmt(byMaxDD[i].sharpe, 3)} Sharpe`);
  }

  // Diversification ratios
  console.log("\n### Diversification Benefit\n");
  const bestSingleSharpe = Math.max(...keys.map(k => allMetrics.find(m => m.name === k)!.sharpe));
  const bestSingleMaxDD = Math.min(...keys.map(k => allMetrics.find(m => m.name === k)!.maxDrawdown));

  console.log(`Best single-asset Sharpe: ${fmt(bestSingleSharpe, 3)}`);
  console.log(`Best single-asset MaxDD:  ${pct(bestSingleMaxDD)}\n`);

  const portfolioOnly = allMetrics.filter(m => !keys.includes(m.name));
  console.log("| Portfolio | Sharpe | ΔSharpe vs Best Single | MaxDD | ΔMaxDD vs Best Single |");
  console.log("|-----------|--------|------------------------|-------|----------------------|");
  for (const p of portfolioOnly) {
    const deltaSharpe = p.sharpe - bestSingleSharpe;
    const deltaMaxDD = p.maxDrawdown - bestSingleMaxDD;
    console.log(`| ${p.name} | ${fmt(p.sharpe, 3)} | ${deltaSharpe >= 0 ? "+" : ""}${fmt(deltaSharpe, 3)} | ${pct(p.maxDrawdown)} | ${deltaMaxDD >= 0 ? "+" : ""}${pct(deltaMaxDD)} |`);
  }

  // ══════════════════════════════════════════════════════════════
  // PART 3: ROLLING WINDOW ANALYSIS
  // ══════════════════════════════════════════════════════════════

  console.log("\n\n" + "═".repeat(70));
  console.log("PART 3: ROLLING WINDOW ANALYSIS");
  console.log("═".repeat(70) + "\n");

  // Use common date range for windows
  const commonLength = Math.min(...portfolios.map(p => p.equities.length));
  const commonDatesList = portfolios[0].equities.slice(0, commonLength).map(e => e.date);
  const windows = generateWindows(commonLength, commonDatesList);
  console.log(`Generated ${windows.length} rolling windows.\n`);

  // Run rolling windows for all portfolios
  const windowResults: Map<string, WindowMetrics[]> = new Map();
  for (const p of portfolios) {
    const metrics: WindowMetrics[] = [];
    for (const w of windows) {
      metrics.push(computeWindowMetrics(p.equities, w, RF));
    }
    windowResults.set(p.name, metrics);
  }

  // Summary table
  console.log("### Rolling Window Summary\n");
  console.log("| Portfolio | Mean Sharpe | Median | Std | Min | Max | Neg% | Mean MaxDD | Max MaxDD | Mean APR |");
  console.log("|-----------|-----------|--------|-----|-----|-----|------|------------|-----------|----------|");

  for (const p of portfolios) {
    const wm = windowResults.get(p.name)!;
    const sharpes = wm.map(w => w.sharpe);
    const maxDDs = wm.map(w => w.maxDrawdown);
    const aprs = wm.map(w => w.apr);
    const negPct = sharpes.filter(v => v < 0).length / sharpes.length;

    console.log(`| ${p.name} | ${fmt(mean(sharpes), 3)} | ${fmt(sharpes.sort((a, b) => a - b)[Math.floor(sharpes.length / 2)], 3)} | ${fmt(std(sharpes), 3)} | ${fmt(Math.min(...sharpes), 3)} | ${fmt(Math.max(...sharpes), 3)} | ${pct(negPct)} | ${pct(mean(maxDDs))} | ${pct(Math.max(...maxDDs))} | ${fmt(mean(aprs), 1)}% |`);
  }

  // Per-window detail for key portfolios
  const keyPortfolios = [
    "ETH-Conservative",
    "BTC-Aggressive",
    "EW: ETH-Conservative + BTC-Aggressive",
    "IV: ETH-Conservative + BTC-Aggressive",
    "EW: All 4 Legs",
  ];

  console.log("\n### Per-Window Detail (Key Portfolios)\n");
  console.log("| Win | Start | End | ETH-Cons | BTC-Aggr | EW E-C+B-A | IV E-C+B-A | EW All 4 | Winner |");
  console.log("|-----|-------|-----|----------|----------|------------|------------|----------|--------|");

  for (const w of windows) {
    const row = [String(w.id), w.startDate, w.endDate];
    const sharpes: { name: string; sharpe: number }[] = [];
    for (const pName of keyPortfolios) {
      const wm = windowResults.get(pName)!.find(m => m.windowId === w.id)!;
      row.push(fmt(wm.sharpe, 3));
      sharpes.push({ name: pName, sharpe: wm.sharpe });
    }
    const winner = sharpes.reduce((best, curr) => curr.sharpe > best.sharpe ? curr : best).name;
    const shortWinner = winner.includes("All 4") ? "All4" : winner.includes("IV:") ? "IV" : winner.includes("EW:") ? "EW" : winner.replace("-Conservative", "-C").replace("-Aggressive", "-A");
    row.push(shortWinner);
    console.log("| " + row.join(" | ") + " |");
  }

  // Portfolio vs individual: paired comparisons
  console.log("\n### Paired Comparisons: Best Portfolio vs Best Single\n");
  const bestPortfolio = portfolioOnly.reduce((best, curr) => {
    const bestWM = windowResults.get(best.name)!;
    const currWM = windowResults.get(curr.name)!;
    return mean(currWM.map(w => w.sharpe)) > mean(bestWM.map(w => w.sharpe)) ? curr : best;
  });

  const bestSingle = keys.reduce((best, curr) => {
    const bestWM = windowResults.get(best)!;
    const currWM = windowResults.get(curr)!;
    return mean(currWM.map(w => w.sharpe)) > mean(bestWM.map(w => w.sharpe)) ? curr : best;
  });

  const portWM = windowResults.get(bestPortfolio.name)!;
  const singleWM = windowResults.get(bestSingle)!;

  let portWins = 0, singleWins = 0;
  const deltaSharpesArr: number[] = [];
  for (let i = 0; i < portWM.length; i++) {
    const delta = portWM[i].sharpe - singleWM[i].sharpe;
    deltaSharpesArr.push(delta);
    if (delta > 0.01) portWins++;
    else if (delta < -0.01) singleWins++;
  }

  const meanDelta = mean(deltaSharpesArr);
  const stdDelta = std(deltaSharpesArr);
  const tStat = meanDelta / (stdDelta / Math.sqrt(deltaSharpesArr.length));

  console.log(`Best portfolio: ${bestPortfolio.name}`);
  console.log(`Best single:    ${bestSingle}`);
  console.log(`Portfolio wins: ${portWins}/${portWM.length}`);
  console.log(`Single wins:    ${singleWins}/${portWM.length}`);
  console.log(`Mean ΔSharpe: ${meanDelta >= 0 ? "+" : ""}${fmt(meanDelta, 3)} ± ${fmt(stdDelta, 3)}`);
  console.log(`t-stat: ${fmt(tStat, 2)} (significant at p<0.05 if |t| > ${fmt(2.12, 2)}, df=${portWM.length - 1})`);

  // MaxDD comparison
  console.log("\n### MaxDD Comparison: Portfolio vs. Individual\n");
  console.log("| Portfolio | Rolling Max MaxDD | Best Single Max MaxDD | Improvement |");
  console.log("|-----------|-------------------|-----------------------|-------------|");

  for (const p of portfolioOnly) {
    const pwm = windowResults.get(p.name)!;
    const portMaxDD = Math.max(...pwm.map(w => w.maxDrawdown));
    const improvement = bestSingleMaxDD - portMaxDD;
    console.log(`| ${p.name} | ${pct(portMaxDD)} | ${pct(bestSingleMaxDD)} | ${improvement > 0 ? "+" : ""}${pct(improvement)} |`);
  }

  // ══════════════════════════════════════════════════════════════
  // PART 4: SUB-PERIOD ANALYSIS
  // ══════════════════════════════════════════════════════════════

  console.log("\n\n" + "═".repeat(70));
  console.log("PART 4: SUB-PERIOD ANALYSIS");
  console.log("═".repeat(70) + "\n");

  const subPeriods = [
    { name: "2021 H2 (Bull)", start: "2021-03-24", end: "2021-11-09" },
    { name: "2022 (Bear)", start: "2021-11-10", end: "2022-11-21" },
    { name: "2023 (Recovery)", start: "2022-11-22", end: "2023-12-31" },
    { name: "2024 (Mixed)", start: "2024-01-01", end: "2024-12-31" },
    { name: "2025+ (Bear)", start: "2025-01-01", end: "2026-12-31" },
  ];

  const subPeriodPortfolios = ["ETH-Conservative", "BTC-Aggressive", "EW: ETH-Conservative + BTC-Aggressive", "EW: All 4 Legs"];

  console.log("### Sub-Period Sharpe\n");
  console.log("| Period | " + subPeriodPortfolios.map(p => p.replace("ETH-Conservative", "ETH-C").replace("BTC-Aggressive", "BTC-A").replace("EW: ETH-C + BTC-A", "EW E-C+B-A").replace("EW: All 4 Legs", "EW All4")).join(" | ") + " |");
  console.log("|--------|" + subPeriodPortfolios.map(() => "--------").join("|") + "|");

  for (const period of subPeriods) {
    const row = [period.name];
    for (const pName of subPeriodPortfolios) {
      const eq = portfolios.find(p => p.name === pName)!.equities;
      const subEq = eq.filter(e => e.date >= period.start && e.date <= period.end);
      if (subEq.length < 30) { row.push("N/A"); continue; }
      const baseEq = subEq[0].equity;
      const normed = subEq.map((e, i) => ({
        ...e,
        equity: e.equity / baseEq,
        dailyReturn: i === 0 ? 0 : (e.equity - subEq[i - 1].equity) / subEq[i - 1].equity,
      }));
      const dailyR = normed.slice(1).map(e => e.dailyReturn);
      row.push(fmt(computeSharpe(dailyR, RF), 3));
    }
    console.log("| " + row.join(" | ") + " |");
  }

  console.log("\n### Sub-Period MaxDD\n");
  console.log("| Period | " + subPeriodPortfolios.map(p => p.replace("ETH-Conservative", "ETH-C").replace("BTC-Aggressive", "BTC-A").replace("EW: ETH-C + BTC-A", "EW E-C+B-A").replace("EW: All 4 Legs", "EW All4")).join(" | ") + " |");
  console.log("|--------|" + subPeriodPortfolios.map(() => "--------").join("|") + "|");

  for (const period of subPeriods) {
    const row = [period.name];
    for (const pName of subPeriodPortfolios) {
      const eq = portfolios.find(p => p.name === pName)!.equities;
      const subEq = eq.filter(e => e.date >= period.start && e.date <= period.end);
      if (subEq.length < 30) { row.push("N/A"); continue; }
      const baseEq = subEq[0].equity;
      const normedEqs = subEq.map(e => e.equity / baseEq);
      row.push(pct(computeMaxDrawdown(normedEqs)));
    }
    console.log("| " + row.join(" | ") + " |");
  }

  // ══════════════════════════════════════════════════════════════
  // PART 5: DIVERSIFICATION RATIO & EFFICIENT FRONTIER
  // ══════════════════════════════════════════════════════════════

  console.log("\n\n" + "═".repeat(70));
  console.log("PART 5: DIVERSIFICATION ANALYSIS");
  console.log("═".repeat(70) + "\n");

  // Test allocations along ETH-Cons + BTC-Aggr spectrum
  console.log("### Efficient Frontier: ETH-Conservative + BTC-Aggressive\n");
  console.log("| ETH-Cons Wt | BTC-Aggr Wt | Sharpe | APR% | MaxDD | Ann Vol |");
  console.log("|-------------|-------------|--------|------|-------|---------|");

  const ethConsEq = curves.get("ETH-Conservative")!;
  const btcAggrEq = curves.get("BTC-Aggressive")!;
  let bestFrontierSharpe = -Infinity;
  let bestFrontierWeight = 0;

  for (let wETH = 0; wETH <= 100; wETH += 10) {
    const wBTC = 100 - wETH;
    const wE = wETH / 100, wB = wBTC / 100;
    const n = Math.min(ethConsEq.length, btcAggrEq.length);
    const combined: DailyEquity[] = [];
    for (let i = 0; i < n; i++) {
      const eq = wE * ethConsEq[i].equity + wB * btcAggrEq[i].equity;
      combined.push({
        date: ethConsEq[i].date,
        equity: eq,
        dailyReturn: i === 0 ? 0 : (eq - combined[i - 1].equity) / combined[i - 1].equity,
      });
    }
    const metrics = computePortfolioMetrics(`${wETH}/${wBTC}`, combined, [wE, wB], RF);
    console.log(`| ${pct(wE, 0)} | ${pct(wB, 0)} | ${fmt(metrics.sharpe, 3)} | ${fmt(metrics.apr)} | ${pct(metrics.maxDrawdown)} | ${fmt(metrics.annVol)}% |`);
    if (metrics.sharpe > bestFrontierSharpe) {
      bestFrontierSharpe = metrics.sharpe;
      bestFrontierWeight = wETH;
    }
  }
  console.log(`\nOptimal weight: ${bestFrontierWeight}% ETH-Conservative / ${100 - bestFrontierWeight}% BTC-Aggressive → Sharpe ${fmt(bestFrontierSharpe, 3)}`);

  // Same for ETH-Cons + BTC-Cons
  console.log("\n### Efficient Frontier: ETH-Conservative + BTC-Conservative\n");
  console.log("| ETH-Cons Wt | BTC-Cons Wt | Sharpe | APR% | MaxDD | Ann Vol |");
  console.log("|-------------|-------------|--------|------|-------|---------|");

  const btcConsEq = curves.get("BTC-Conservative")!;
  let bestCC = -Infinity, bestCCWeight = 0;

  for (let wETH = 0; wETH <= 100; wETH += 10) {
    const wBTC = 100 - wETH;
    const wE = wETH / 100, wB = wBTC / 100;
    const n = Math.min(ethConsEq.length, btcConsEq.length);
    const combined: DailyEquity[] = [];
    for (let i = 0; i < n; i++) {
      const eq = wE * ethConsEq[i].equity + wB * btcConsEq[i].equity;
      combined.push({
        date: ethConsEq[i].date,
        equity: eq,
        dailyReturn: i === 0 ? 0 : (eq - combined[i - 1].equity) / combined[i - 1].equity,
      });
    }
    const metrics = computePortfolioMetrics(`${wETH}/${wBTC}`, combined, [wE, wB], RF);
    console.log(`| ${pct(wE, 0)} | ${pct(wB, 0)} | ${fmt(metrics.sharpe, 3)} | ${fmt(metrics.apr)} | ${pct(metrics.maxDrawdown)} | ${fmt(metrics.annVol)}% |`);
    if (metrics.sharpe > bestCC) { bestCC = metrics.sharpe; bestCCWeight = wETH; }
  }
  console.log(`\nOptimal weight: ${bestCCWeight}% ETH-Conservative / ${100 - bestCCWeight}% BTC-Conservative → Sharpe ${fmt(bestCC, 3)}`);

  // ══════════════════════════════════════════════════════════════
  // VERDICT
  // ══════════════════════════════════════════════════════════════

  console.log("\n\n" + "═".repeat(70));
  console.log("VERDICT");
  console.log("═".repeat(70) + "\n");

  // Summarize key findings
  const ethConsCorr = pearsonCorrelation(ethConsR, btcConsR);
  const ethAggrCorr = pearsonCorrelation(ethAggrR, btcAggrR);
  const crossCorr = pearsonCorrelation(ethConsR, btcAggrR);

  const bestSingleFullSharpe = allMetrics.filter(m => keys.includes(m.name)).reduce((best, curr) => curr.sharpe > best.sharpe ? curr : best);
  const bestPortFullSharpe = allMetrics.filter(m => !keys.includes(m.name)).reduce((best, curr) => curr.sharpe > best.sharpe ? curr : best);
  const bestSingleRolling = keys.reduce((best, curr) => {
    return mean(windowResults.get(curr)!.map(w => w.sharpe)) > mean(windowResults.get(best)!.map(w => w.sharpe)) ? curr : best;
  });
  const bestPortRolling = portfolioOnly.reduce((best, curr) => {
    return mean(windowResults.get(curr.name)!.map(w => w.sharpe)) > mean(windowResults.get(best.name)!.map(w => w.sharpe)) ? curr : best;
  });

  console.log("Key Questions Answered:");
  console.log(`  1. Cross-asset return correlation:`);
  console.log(`     Conservative: ${fmt(ethConsCorr, 3)} | Aggressive: ${fmt(ethAggrCorr, 3)} | Cross: ${fmt(crossCorr, 3)}`);
  console.log(`     → ${ethConsCorr < 0.5 ? "LOW correlation — strong diversification potential" : ethConsCorr < 0.7 ? "MODERATE correlation — some diversification benefit" : "HIGH correlation — limited diversification"}`);
  console.log(`  2. Portfolio MaxDD vs best individual:`);
  const lowestPortMaxDD = Math.min(...portfolioOnly.map(p => p.maxDrawdown));
  console.log(`     Best individual MaxDD: ${pct(bestSingleMaxDD)}`);
  console.log(`     Best portfolio MaxDD:  ${pct(lowestPortMaxDD)}`);
  console.log(`     → ${lowestPortMaxDD < bestSingleMaxDD ? `REDUCED by ${pct(bestSingleMaxDD - lowestPortMaxDD)}` : "NOT reduced"}`);
  console.log(`  3. Best allocation:`);
  console.log(`     Full-period:  ${bestPortFullSharpe.name} (${fmt(bestPortFullSharpe.sharpe, 3)} Sharpe)`);
  console.log(`     Rolling mean: ${bestPortRolling.name} (${fmt(mean(windowResults.get(bestPortRolling.name)!.map(w => w.sharpe)), 3)} mean Sharpe)`);
  console.log(`     Frontier optimum: ${bestFrontierWeight}/${100 - bestFrontierWeight} ETH-Cons/BTC-Aggr (${fmt(bestFrontierSharpe, 3)} Sharpe)`);
  console.log(`  4. Does diversification help on risk-adjusted basis?`);
  console.log(`     Best single (full-period): ${bestSingleFullSharpe.name} (${fmt(bestSingleFullSharpe.sharpe, 3)} Sharpe)`);
  console.log(`     Best portfolio (full-period): ${bestPortFullSharpe.name} (${fmt(bestPortFullSharpe.sharpe, 3)} Sharpe)`);
  console.log(`     → ${bestPortFullSharpe.sharpe > bestSingleFullSharpe.sharpe ? "YES — portfolio beats best individual" : "NO — best individual is superior"}`);

  const elapsed = ((performance.now() - t0) / 1000).toFixed(2);
  console.log(`\n═══ Experiment 26 Complete (${elapsed}s) ═══`);
}

main();
