// Experiment 21: Dynamic Position Sizing
// Phase 1: Rolling window backtest with three position sizing modes.
// Phase 2: Monte Carlo validation of top configs.
// Goal: Reduce MaxDD below 40% while preserving Sharpe above 0.50.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { simulate } from "../../src/components/strategy/simulate.ts";
import { defaultRules } from "../../src/components/strategy/rules.ts";
import { summarizeRun } from "../../src/components/monte-carlo.ts";
import { runMonteCarlo } from "../../src/components/monte-carlo.ts";
import type { StrategyConfig, PositionSizingConfig } from "../../src/components/strategy/types.ts";
import type { MarketParams } from "../../src/components/monte-carlo.ts";

// ─── Load & align data ───

const BASE = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(BASE, "..", "sweep16", "data");

interface DataRecord { date: string; close: number }
const rawPrices: DataRecord[] = JSON.parse(readFileSync(path.join(DATA_DIR, "prices.json"), "utf-8"));
const rawDvol: DataRecord[] = JSON.parse(readFileSync(path.join(DATA_DIR, "dvol.json"), "utf-8"));

const dvolMap = new Map(rawDvol.map(d => [d.date, d.close / 100]));
interface AlignedDay { date: string; price: number; iv: number }
const aligned: AlignedDay[] = rawPrices
  .filter(p => dvolMap.has(p.date))
  .map(p => ({ date: p.date, price: p.close, iv: dvolMap.get(p.date)! }));

console.log(`Aligned data: ${aligned.length} days (${aligned[0].date} → ${aligned[aligned.length - 1].date})\n`);

// ─── Window generation ───

const WINDOW_DAYS = 365;
const STRIDE_DAYS = 90;
const MIN_WINDOW = 300;

interface Window { id: number; startIdx: number; endIdx: number; startDate: string; endDate: string; days: number }

const windows: Window[] = [];
let wid = 0;
for (let start = 0; start + MIN_WINDOW <= aligned.length; start += STRIDE_DAYS) {
  const end = Math.min(start + WINDOW_DAYS, aligned.length - 1);
  if (end - start < MIN_WINDOW) break;
  windows.push({ id: ++wid, startIdx: start, endIdx: end, startDate: aligned[start].date, endDate: aligned[end].date, days: end - start });
}

console.log(`Generated ${windows.length} windows (${WINDOW_DAYS}d, stride ${STRIDE_DAYS}d)\n`);

// ─── Base strategy configs ───

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
    name: "Conservative",
    config: {
      ...BASE_CONFIG,
      targetDelta: 0.10,
      cycleLengthDays: 30,
      adaptiveCalls: { minDelta: 0.10, maxDelta: 0.50, skipThresholdPct: 0, minStrikeAtCost: true },
      ivRvSpread: { lookbackDays: 45, minMultiplier: 0.8, maxMultiplier: 1.3, skipBelowRatio: 1.1, skipSide: "put" },
      rollPut: { initialDTE: 30, rollWhenDTEBelow: 14, requireNetCredit: true },
    },
  },
  {
    name: "Active",
    config: {
      ...BASE_CONFIG,
      targetDelta: 0.20,
      cycleLengthDays: 3,
      ivRvSpread: { lookbackDays: 20, minMultiplier: 0.8, maxMultiplier: 1.3, skipBelowRatio: 1.2, skipSide: "put" },
    },
  },
];

// ─── Sizing variants ───

interface SizingVariant {
  name: string;
  sizing: PositionSizingConfig | undefined;
}

const SIZING_VARIANTS: SizingVariant[] = [
  { name: "Baseline", sizing: undefined },

  // Fractional Kelly
  { name: "Kelly-0.125/5", sizing: { mode: "fractionalKelly", kellyFraction: 0.125, kellyLookbackTrades: 5, minSize: 0.1 } },
  { name: "Kelly-0.125/10", sizing: { mode: "fractionalKelly", kellyFraction: 0.125, kellyLookbackTrades: 10, minSize: 0.1 } },
  { name: "Kelly-0.25/5", sizing: { mode: "fractionalKelly", kellyFraction: 0.25, kellyLookbackTrades: 5, minSize: 0.1 } },
  { name: "Kelly-0.25/10", sizing: { mode: "fractionalKelly", kellyFraction: 0.25, kellyLookbackTrades: 10, minSize: 0.1 } },
  { name: "Kelly-0.25/20", sizing: { mode: "fractionalKelly", kellyFraction: 0.25, kellyLookbackTrades: 20, minSize: 0.1 } },
  { name: "Kelly-0.50/10", sizing: { mode: "fractionalKelly", kellyFraction: 0.50, kellyLookbackTrades: 10, minSize: 0.1 } },

  // Trailing Return Gate — mild thresholds
  { name: "TRG-30d-mild", sizing: { mode: "trailingReturn", returnLookbackDays: 30, returnThresholds: [{ drawdown: 0.15, sizeMult: 0.50 }, { drawdown: 0.25, sizeMult: 0.25 }], minSize: 0.1 } },
  { name: "TRG-60d-mild", sizing: { mode: "trailingReturn", returnLookbackDays: 60, returnThresholds: [{ drawdown: 0.15, sizeMult: 0.50 }, { drawdown: 0.25, sizeMult: 0.25 }], minSize: 0.1 } },
  { name: "TRG-90d-mild", sizing: { mode: "trailingReturn", returnLookbackDays: 90, returnThresholds: [{ drawdown: 0.15, sizeMult: 0.50 }, { drawdown: 0.25, sizeMult: 0.25 }], minSize: 0.1 } },
  // Trailing Return Gate — moderate thresholds
  { name: "TRG-30d-mod", sizing: { mode: "trailingReturn", returnLookbackDays: 30, returnThresholds: [{ drawdown: 0.10, sizeMult: 0.50 }, { drawdown: 0.20, sizeMult: 0.25 }, { drawdown: 0.30, sizeMult: 0.10 }], minSize: 0.1 } },
  { name: "TRG-60d-mod", sizing: { mode: "trailingReturn", returnLookbackDays: 60, returnThresholds: [{ drawdown: 0.10, sizeMult: 0.50 }, { drawdown: 0.20, sizeMult: 0.25 }, { drawdown: 0.30, sizeMult: 0.10 }], minSize: 0.1 } },
  { name: "TRG-90d-mod", sizing: { mode: "trailingReturn", returnLookbackDays: 90, returnThresholds: [{ drawdown: 0.10, sizeMult: 0.50 }, { drawdown: 0.20, sizeMult: 0.25 }, { drawdown: 0.30, sizeMult: 0.10 }], minSize: 0.1 } },
  // Trailing Return Gate — aggressive thresholds
  { name: "TRG-30d-agg", sizing: { mode: "trailingReturn", returnLookbackDays: 30, returnThresholds: [{ drawdown: 0.05, sizeMult: 0.50 }, { drawdown: 0.10, sizeMult: 0.25 }, { drawdown: 0.20, sizeMult: 0.10 }], minSize: 0.1 } },
  { name: "TRG-60d-agg", sizing: { mode: "trailingReturn", returnLookbackDays: 60, returnThresholds: [{ drawdown: 0.05, sizeMult: 0.50 }, { drawdown: 0.10, sizeMult: 0.25 }, { drawdown: 0.20, sizeMult: 0.10 }], minSize: 0.1 } },
  { name: "TRG-90d-agg", sizing: { mode: "trailingReturn", returnLookbackDays: 90, returnThresholds: [{ drawdown: 0.05, sizeMult: 0.50 }, { drawdown: 0.10, sizeMult: 0.25 }, { drawdown: 0.20, sizeMult: 0.10 }], minSize: 0.1 } },

  // Vol-scaled
  { name: "VS-40/20", sizing: { mode: "volScaled", volTarget: 0.40, volLookbackDays: 20, minSize: 0.1 } },
  { name: "VS-40/30", sizing: { mode: "volScaled", volTarget: 0.40, volLookbackDays: 30, minSize: 0.1 } },
  { name: "VS-40/45", sizing: { mode: "volScaled", volTarget: 0.40, volLookbackDays: 45, minSize: 0.1 } },
  { name: "VS-60/20", sizing: { mode: "volScaled", volTarget: 0.60, volLookbackDays: 20, minSize: 0.1 } },
  { name: "VS-60/30", sizing: { mode: "volScaled", volTarget: 0.60, volLookbackDays: 30, minSize: 0.1 } },
  { name: "VS-60/45", sizing: { mode: "volScaled", volTarget: 0.60, volLookbackDays: 45, minSize: 0.1 } },
  { name: "VS-80/20", sizing: { mode: "volScaled", volTarget: 0.80, volLookbackDays: 20, minSize: 0.1 } },
  { name: "VS-80/30", sizing: { mode: "volScaled", volTarget: 0.80, volLookbackDays: 30, minSize: 0.1 } },
  { name: "VS-80/45", sizing: { mode: "volScaled", volTarget: 0.80, volLookbackDays: 45, minSize: 0.1 } },
];

// ─── Window runner ───

interface WindowResult {
  strategy: string;
  sizingName: string;
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
  putSells: number;
  skippedCycles: number;
  underlyingReturn: number;
  alpha: number;
}

function runWindow(strategy: StrategyDef, sizing: SizingVariant, window: Window): WindowResult {
  const prices = aligned.slice(window.startIdx, window.endIdx + 1).map(d => d.price);
  const ivPath = aligned.slice(window.startIdx, window.endIdx + 1).map(d => d.iv);

  const cfg: StrategyConfig = sizing.sizing
    ? { ...strategy.config, positionSizing: sizing.sizing }
    : strategy.config;

  const rules = defaultRules();
  const result = simulate(prices, rules, cfg, ivPath);

  const capitalAtRisk = prices[0] * cfg.contracts;
  const yearsElapsed = window.days / 365;

  const summary = summarizeRun(0, result, prices, capitalAtRisk, yearsElapsed, cfg.riskFreeRate, cfg.contracts);

  const putSells = result.signalLog.filter(e => e.signal.action === "SELL_PUT").length;
  const benchmarkAPR = ((prices[prices.length - 1] - prices[0]) / prices[0]) / yearsElapsed * 100;

  return {
    strategy: strategy.name,
    sizingName: sizing.name,
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
    putSells,
    skippedCycles: summary.skippedCycles,
    underlyingReturn: (prices[prices.length - 1] - prices[0]) / prices[0],
    alpha: summary.apr - benchmarkAPR,
  };
}

// ─── Helpers ───

function fmt(n: number, dec = 2): string { return n.toFixed(dec); }
function pct(n: number, dec = 1): string { return (n * 100).toFixed(dec) + "%"; }

function stats(arr: number[]): { mean: number; median: number; std: number; min: number; max: number } {
  const sorted = [...arr].sort((a, b) => a - b);
  const n = sorted.length;
  const mean = arr.reduce((a, b) => a + b, 0) / n;
  const variance = n > 1 ? arr.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1) : 0;
  return {
    mean,
    median: n % 2 === 1 ? sorted[Math.floor(n / 2)] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2,
    std: Math.sqrt(variance),
    min: sorted[0],
    max: sorted[n - 1],
  };
}

// ═══════════════════════════════════════════════════════════════════
// PHASE 1: ROLLING WINDOW BACKTEST
// ═══════════════════════════════════════════════════════════════════

console.log("═══════════════════════════════════════════════════════════════════");
console.log("PHASE 1: Rolling Window Position Sizing Sweep");
console.log("═══════════════════════════════════════════════════════════════════\n");

const t0 = performance.now();
const allResults: WindowResult[] = [];

for (const strategy of STRATEGIES) {
  for (const sizing of SIZING_VARIANTS) {
    for (const window of windows) {
      allResults.push(runWindow(strategy, sizing, window));
    }
  }
}

const elapsed1 = ((performance.now() - t0) / 1000).toFixed(2);
const totalCombos = STRATEGIES.length * SIZING_VARIANTS.length;
console.log(`Phase 1: ${allResults.length} backtests (${STRATEGIES.length} strategies × ${SIZING_VARIANTS.length} sizing × ${windows.length} windows) in ${elapsed1}s\n`);

// ─── Analysis per strategy ───

for (const strategy of STRATEGIES) {
  console.log(`\n${"═".repeat(70)}`);
  console.log(`STRATEGY: ${strategy.name}`);
  console.log(`${"═".repeat(70)}\n`);

  const stratResults = allResults.filter(r => r.strategy === strategy.name);

  // Get baseline stats for comparison
  const baselineResults = stratResults.filter(r => r.sizingName === "Baseline");
  const baselineSharpes = baselineResults.map(r => r.sharpe);
  const baselineMaxDDs = baselineResults.map(r => r.maxDrawdown);
  const baseStats = {
    sharpe: stats(baselineSharpes),
    maxDD: stats(baselineMaxDDs),
  };

  console.log(`Baseline: Mean Sharpe ${fmt(baseStats.sharpe.mean, 3)}, Mean MaxDD ${pct(baseStats.maxDD.mean)}, Median MaxDD ${pct(baseStats.maxDD.median)}\n`);

  // Rank all sizing variants
  interface SizingSummary {
    name: string;
    meanSharpe: number;
    medianSharpe: number;
    meanMaxDD: number;
    medianMaxDD: number;
    maxMaxDD: number;
    meanAPR: number;
    negSharpeRate: number;
    dSharpe: number;
    dMaxDD: number;
    sharpePreservation: number;
  }

  const summaries: SizingSummary[] = [];

  for (const sizing of SIZING_VARIANTS) {
    const sResults = stratResults.filter(r => r.sizingName === sizing.name);
    const sharpes = sResults.map(r => r.sharpe);
    const maxDDs = sResults.map(r => r.maxDrawdown);
    const aprs = sResults.map(r => r.apr);
    const sStats = { sharpe: stats(sharpes), maxDD: stats(maxDDs), apr: stats(aprs) };
    const negCount = sharpes.filter(s => s < 0).length;

    summaries.push({
      name: sizing.name,
      meanSharpe: sStats.sharpe.mean,
      medianSharpe: sStats.sharpe.median,
      meanMaxDD: sStats.maxDD.mean,
      medianMaxDD: sStats.maxDD.median,
      maxMaxDD: sStats.maxDD.max,
      meanAPR: sStats.apr.mean,
      negSharpeRate: negCount / sharpes.length,
      dSharpe: sStats.sharpe.mean - baseStats.sharpe.mean,
      dMaxDD: sStats.maxDD.mean - baseStats.maxDD.mean,
      sharpePreservation: baseStats.sharpe.mean !== 0
        ? sStats.sharpe.mean / baseStats.sharpe.mean
        : 1,
    });
  }

  // Sort by MaxDD reduction (most negative dMaxDD = best) among those preserving ≥60% Sharpe
  const ranked = [...summaries].sort((a, b) => {
    const aOk = a.sharpePreservation >= 0.5;
    const bOk = b.sharpePreservation >= 0.5;
    if (aOk !== bOk) return aOk ? -1 : 1;
    return a.meanMaxDD - b.meanMaxDD;
  });

  console.log("### Sizing Variants Ranked by MaxDD Reduction (Sharpe ≥ 50% preserved)\n");
  console.log("| Rank | Sizing | Mean Sharpe | ΔSharpe | Sharpe% | Mean MaxDD | ΔMaxDD | Max MaxDD | Mean APR | Neg% |");
  console.log("|------|--------|-------------|---------|---------|------------|--------|-----------|----------|------|");
  ranked.forEach((s, i) => {
    console.log(`| ${i + 1} | ${s.name} | ${fmt(s.meanSharpe, 3)} | ${fmt(s.dSharpe, 3)} | ${pct(s.sharpePreservation)} | ${pct(s.meanMaxDD)} | ${pct(s.dMaxDD)} | ${pct(s.maxMaxDD)} | ${fmt(s.meanAPR, 1)}% | ${pct(s.negSharpeRate)} |`);
  });

  // Per-mode analysis
  console.log("\n### Summary by Sizing Mode\n");
  const modes = ["Baseline", "fractionalKelly", "trailingReturn", "volScaled"];
  const modeLabels: Record<string, string> = {
    "Baseline": "Baseline (no sizing)",
    "fractionalKelly": "Fractional Kelly",
    "trailingReturn": "Trailing Return Gate",
    "volScaled": "Vol-Scaled",
  };

  for (const mode of modes) {
    const modeResults = mode === "Baseline"
      ? summaries.filter(s => s.name === "Baseline")
      : summaries.filter(s => {
          if (mode === "fractionalKelly") return s.name.startsWith("Kelly");
          if (mode === "trailingReturn") return s.name.startsWith("TRG");
          return s.name.startsWith("VS");
        });

    if (modeResults.length === 0) continue;

    const avgDSharpe = modeResults.reduce((s, r) => s + r.dSharpe, 0) / modeResults.length;
    const avgDMaxDD = modeResults.reduce((s, r) => s + r.dMaxDD, 0) / modeResults.length;
    const bestVariant = modeResults.reduce((best, r) =>
      r.meanMaxDD < best.meanMaxDD && r.sharpePreservation >= 0.5 ? r : best,
      modeResults[0],
    );

    console.log(`**${modeLabels[mode]}**: Avg ΔSharpe ${fmt(avgDSharpe, 3)}, Avg ΔMaxDD ${pct(avgDMaxDD)}, Best variant: ${bestVariant.name} (MaxDD ${pct(bestVariant.meanMaxDD)}, Sharpe ${fmt(bestVariant.meanSharpe, 3)})`);
  }

  // Window-by-window comparison: best sizing vs baseline
  const bestSizing = ranked.find(s => s.name !== "Baseline" && s.sharpePreservation >= 0.5);
  if (bestSizing) {
    console.log(`\n### Window-by-Window: ${bestSizing.name} vs Baseline\n`);
    console.log("| Window | Start | End | Base Sharpe | Sized Sharpe | Base MaxDD | Sized MaxDD | ΔMaxDD |");
    console.log("|--------|-------|-----|-------------|--------------|------------|-------------|--------|");

    let winsDD = 0;
    let winsSharpe = 0;
    for (const w of windows) {
      const bw = baselineResults.find(r => r.windowId === w.id)!;
      const sw = stratResults.find(r => r.sizingName === bestSizing.name && r.windowId === w.id)!;
      const dDD = sw.maxDrawdown - bw.maxDrawdown;
      if (dDD < 0) winsDD++;
      if (sw.sharpe > bw.sharpe) winsSharpe++;
      console.log(`| ${w.id} | ${w.startDate} | ${w.endDate} | ${fmt(bw.sharpe, 3)} | ${fmt(sw.sharpe, 3)} | ${pct(bw.maxDrawdown)} | ${pct(sw.maxDrawdown)} | ${pct(dDD)} |`);
    }
    console.log(`\nMaxDD wins: ${winsDD}/${windows.length}. Sharpe wins: ${winsSharpe}/${windows.length}.`);
  }
}

// ═══════════════════════════════════════════════════════════════════
// PHASE 2: MONTE CARLO VALIDATION
// ═══════════════════════════════════════════════════════════════════

console.log(`\n\n${"═".repeat(70)}`);
console.log("PHASE 2: Monte Carlo Validation");
console.log(`${"═".repeat(70)}\n`);

// Pick top 3 sizing configs from Phase 1 (manual selection based on Phase 1 output)
// For automated execution, we use the best from each mode that preserved ≥50% Sharpe

function findBestPerMode(strategyName: string): SizingVariant[] {
  const stratResults = allResults.filter(r => r.strategy === strategyName);
  const baselineResults = stratResults.filter(r => r.sizingName === "Baseline");
  const baseMeanSharpe = stats(baselineResults.map(r => r.sharpe)).mean;

  const candidates: { variant: SizingVariant; meanMaxDD: number; sharpePreservation: number }[] = [];

  for (const sizing of SIZING_VARIANTS) {
    if (sizing.name === "Baseline") continue;
    const sResults = stratResults.filter(r => r.sizingName === sizing.name);
    const meanSharpe = stats(sResults.map(r => r.sharpe)).mean;
    const meanMaxDD = stats(sResults.map(r => r.maxDrawdown)).mean;
    const preservation = baseMeanSharpe !== 0 ? meanSharpe / baseMeanSharpe : 1;
    if (preservation >= 0.5) {
      candidates.push({ variant: sizing, meanMaxDD, sharpePreservation: preservation });
    }
  }

  candidates.sort((a, b) => a.meanMaxDD - b.meanMaxDD);
  // Take best from each mode
  const seen = new Set<string>();
  const result: SizingVariant[] = [];
  for (const c of candidates) {
    const mode = c.variant.sizing?.mode ?? "baseline";
    if (!seen.has(mode)) {
      seen.add(mode);
      result.push(c.variant);
    }
    if (result.length >= 3) break;
  }
  return result;
}

const MC_RUNS = 1000;
const MC_VOLS = [0.40, 0.60, 0.80];
const MC_DRIFTS = [0.0, 0.05, -0.30];
const MC_HORIZONS = [365, 1825];

for (const strategy of STRATEGIES) {
  console.log(`\n### Monte Carlo: ${strategy.name}\n`);

  const topSizings = findBestPerMode(strategy.name);
  if (topSizings.length === 0) {
    console.log("No sizing variant preserved ≥50% Sharpe. Skipping MC validation.\n");
    continue;
  }

  const mcSizings: SizingVariant[] = [
    { name: "Baseline", sizing: undefined },
    ...topSizings,
  ];

  console.log(`Testing: ${mcSizings.map(s => s.name).join(", ")}\n`);
  console.log("| Vol | Drift | Horizon | Sizing | Mean Sharpe | Mean MaxDD | Mean APR | ΔSharpe | ΔMaxDD |");
  console.log("|-----|-------|---------|--------|-------------|------------|----------|---------|--------|");

  for (const vol of MC_VOLS) {
    for (const drift of MC_DRIFTS) {
      for (const horizon of MC_HORIZONS) {
        const baseResults: { meanSharpe: number; meanMaxDD: number } = { meanSharpe: 0, meanMaxDD: 0 };

        for (const sizing of mcSizings) {
          const cfg: StrategyConfig = sizing.sizing
            ? { ...strategy.config, positionSizing: sizing.sizing }
            : strategy.config;

          const market: MarketParams = {
            startPrice: 2500,
            days: horizon,
            annualVol: vol,
            annualDrift: drift,
            model: "gbm",
            ivParams: {
              meanReversion: 5.0,
              volOfVol: 0.50,
              vrpOffset: 0.06,
              ivJumps: { lambda: 10, muJ: 0, sigmaJ: 0.15 },
            },
          };

          const mc = runMonteCarlo(market, cfg, MC_RUNS);
          const meanSharpe = mc.runs.reduce((s, r) => s + r.sharpe, 0) / mc.runs.length;
          const meanMaxDD = mc.runs.reduce((s, r) => s + r.maxDrawdown, 0) / mc.runs.length;
          const meanAPR = mc.runs.reduce((s, r) => s + r.apr, 0) / mc.runs.length;

          if (sizing.name === "Baseline") {
            baseResults.meanSharpe = meanSharpe;
            baseResults.meanMaxDD = meanMaxDD;
          }

          const horizonLabel = horizon === 365 ? "1yr" : "5yr";
          const dS = meanSharpe - baseResults.meanSharpe;
          const dDD = meanMaxDD - baseResults.meanMaxDD;
          console.log(`| ${pct(vol, 0)} | ${fmt(drift * 100, 0)}% | ${horizonLabel} | ${sizing.name} | ${fmt(meanSharpe, 3)} | ${pct(meanMaxDD)} | ${fmt(meanAPR, 1)}% | ${fmt(dS, 3)} | ${pct(dDD)} |`);
        }
      }
    }
  }
}

const totalElapsed = ((performance.now() - t0) / 1000).toFixed(2);
console.log(`\nTotal execution time: ${totalElapsed}s`);
