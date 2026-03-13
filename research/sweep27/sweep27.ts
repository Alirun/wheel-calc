// Experiment 27: Sized Strategy Cost Sensitivity on Real Data
// Re-runs Exp 13's cost sweep on final sized configurations (Conservative VS+CS,
// Aggressive VS) against historical ETH and BTC data.
// Key question: at what friction level does each sized preset's Sharpe cross zero?

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { simulate } from "../../src/components/strategy/simulate.ts";
import { defaultRules } from "../../src/components/strategy/rules.ts";
import { summarizeRun } from "../../src/components/monte-carlo.ts";
import type { StrategyConfig } from "../../src/components/strategy/types.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Data Loading ────────────────────────────────────────────────

interface DailyRecord { date: string; close: number }
interface AlignedDay { date: string; price: number; iv: number }

function loadAsset(dataDir: string, dvolFile: string, priceFile: string): AlignedDay[] {
  const dvol: DailyRecord[] = JSON.parse(readFileSync(join(dataDir, dvolFile), "utf-8"));
  const prices: DailyRecord[] = JSON.parse(readFileSync(join(dataDir, priceFile), "utf-8"));
  const dvolMap = new Map(dvol.map(d => [d.date, d.close / 100]));
  return prices
    .filter(p => dvolMap.has(p.date))
    .map(p => ({ date: p.date, price: p.close, iv: dvolMap.get(p.date)! }));
}

const ETH_DATA_DIR = join(__dirname, "..", "sweep16", "data");
const BTC_DATA_DIR = join(__dirname, "..", "sweep24", "data");

const ethData = loadAsset(ETH_DATA_DIR, "dvol.json", "prices.json");
const btcData = loadAsset(BTC_DATA_DIR, "btc_dvol.json", "btc_prices.json");

// ── Strategy Definitions ────────────────────────────────────────

function makeConservative(spreadPct: number, fee: number): StrategyConfig {
  return {
    impliedVol: 0.80,
    riskFreeRate: 0.05,
    contracts: 1,
    bidAskSpreadPct: spreadPct,
    feePerTrade: fee,
    targetDelta: 0.10,
    cycleLengthDays: 30,
    adaptiveCalls: { minDelta: 0.10, maxDelta: 0.50, skipThresholdPct: 0, minStrikeAtCost: true },
    ivRvSpread: { lookbackDays: 45, minMultiplier: 0.8, maxMultiplier: 1.3, skipBelowRatio: 1.1, skipSide: "put" },
    rollPut: { initialDTE: 30, rollWhenDTEBelow: 14, requireNetCredit: true },
    positionSizing: { mode: "volScaled", volTarget: 0.40, volLookbackDays: 45, minSize: 0.10, coldStartDays: 45, coldStartSize: 0.50 },
  };
}

function makeAggressive(spreadPct: number, fee: number): StrategyConfig {
  return {
    impliedVol: 0.80,
    riskFreeRate: 0.05,
    contracts: 1,
    bidAskSpreadPct: spreadPct,
    feePerTrade: fee,
    targetDelta: 0.20,
    cycleLengthDays: 3,
    ivRvSpread: { lookbackDays: 20, minMultiplier: 0.8, maxMultiplier: 1.3, skipBelowRatio: 1.2, skipSide: "put" },
    positionSizing: { mode: "volScaled", volTarget: 0.40, volLookbackDays: 45, minSize: 0.10 },
  };
}

// ── Window Helpers ──────────────────────────────────────────────

const WINDOW_DAYS = 365;
const STRIDE_DAYS = 90;
const MIN_WINDOW = 300;

interface Window { id: number; startIdx: number; endIdx: number; startDate: string; endDate: string; days: number }

function makeWindows(data: AlignedDay[]): Window[] {
  const windows: Window[] = [];
  let wid = 0;
  for (let start = 0; start + MIN_WINDOW <= data.length; start += STRIDE_DAYS) {
    const end = Math.min(start + WINDOW_DAYS, data.length - 1);
    if (end - start < MIN_WINDOW) break;
    windows.push({ id: ++wid, startIdx: start, endIdx: end, startDate: data[start].date, endDate: data[end].date, days: end - start });
  }
  return windows;
}

// ── Run helpers ─────────────────────────────────────────────────

interface RunResult {
  sharpe: number;
  sortino: number;
  apr: number;
  maxDrawdown: number;
  putSells: number;
  assignments: number;
  fullCycles: number;
  skippedCycles: number;
  skipRate: number;
  premiumCollected: number;
}

function runSim(data: AlignedDay[], startIdx: number, endIdx: number, config: StrategyConfig): RunResult {
  const slice = data.slice(startIdx, endIdx + 1);
  const prices = slice.map(d => d.price);
  const ivPath = slice.map(d => d.iv);
  const rules = defaultRules();
  const result = simulate(prices, rules, config, ivPath);

  const capitalAtRisk = prices[0] * config.contracts;
  const years = slice.length / 365;
  const summary = summarizeRun(0, result, prices, capitalAtRisk, years, config.riskFreeRate, config.contracts);

  const putSells = result.signalLog.filter(e => e.signal.action === "SELL_PUT").length;
  const totalOpportunities = putSells + result.summary.totalSkippedCycles;
  const skipRate = totalOpportunities > 0 ? result.summary.totalSkippedCycles / totalOpportunities : 0;

  return {
    sharpe: summary.sharpe,
    sortino: summary.sortino,
    apr: summary.apr,
    maxDrawdown: summary.maxDrawdown,
    putSells,
    assignments: summary.assignments,
    fullCycles: summary.fullCycles,
    skippedCycles: summary.skippedCycles,
    skipRate,
    premiumCollected: summary.premiumCollected,
  };
}

// ── Formatting ──────────────────────────────────────────────────

function fmt(n: number, dec = 2): string { return n.toFixed(dec); }
function fmtSign(n: number, dec = 2): string { return (n > 0 ? "+" : "") + n.toFixed(dec); }
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

function linearInterp(x1: number, y1: number, x2: number, y2: number, yTarget: number): number | null {
  if ((y1 - yTarget) * (y2 - yTarget) > 0) return null;
  if (y1 === y2) return null;
  return x1 + (yTarget - y1) * (x2 - x1) / (y2 - y1);
}

// ═════════════════════════════════════════════════════════════════
// MAIN
// ═════════════════════════════════════════════════════════════════

console.log("=== Experiment 27: Sized Strategy Cost Sensitivity on Real Data ===");
console.log("Goal: Confirm break-even friction levels for final shipped presets");
console.log("      (Conservative VS+CS, Aggressive VS) on ETH and BTC.\n");

console.log(`ETH data: ${ethData.length} days (${ethData[0].date} → ${ethData[ethData.length - 1].date})`);
console.log(`BTC data: ${btcData.length} days (${btcData[0].date} → ${btcData[btcData.length - 1].date})\n`);

const SPREAD_LEVELS = [0.01, 0.03, 0.05, 0.08, 0.12];   // as decimal fractions
const FEE_LEVELS = [0.25, 0.50, 1.00, 2.00];

interface StrategyMaker { name: string; makeFn: (spread: number, fee: number) => StrategyConfig }
const STRATEGY_MAKERS: StrategyMaker[] = [
  { name: "Conservative", makeFn: makeConservative },
  { name: "Aggressive", makeFn: makeAggressive },
];

interface AssetDef { name: string; data: AlignedDay[] }
const ASSETS: AssetDef[] = [
  { name: "ETH", data: ethData },
  { name: "BTC", data: btcData },
];

// ── Collect all results ─────────────────────────────────────────

interface CostResult {
  asset: string;
  strategy: string;
  spreadPct: number;     // as percentage (1, 3, 5, 8, 12)
  feePerTrade: number;
  scope: string;         // "full-period" or "rolling"
  // full-period metrics
  sharpe: number;
  apr: number;
  maxDrawdown: number;
  putSells: number;
  assignments: number;
  skipRate: number;
  // rolling metrics (only for scope=rolling)
  meanSharpe: number;
  medianSharpe: number;
  stdSharpe: number;
  maxMaxDD: number;
  meanMaxDD: number;
  negSharpeRate: number;
  windowSharpes: number[];
  windowMaxDDs: number[];
}

const allResults: CostResult[] = [];
const t0 = performance.now();
let completed = 0;
const totalCombos = ASSETS.length * STRATEGY_MAKERS.length * SPREAD_LEVELS.length * FEE_LEVELS.length;

for (const asset of ASSETS) {
  const windows = makeWindows(asset.data);

  for (const strat of STRATEGY_MAKERS) {
    for (const spread of SPREAD_LEVELS) {
      for (const fee of FEE_LEVELS) {
        const config = strat.makeFn(spread, fee);
        const spreadDisplay = spread * 100;

        // Full-period
        const fullResult = runSim(asset.data, 0, asset.data.length - 1, config);

        // Rolling windows
        const windowResults: RunResult[] = [];
        for (const w of windows) {
          windowResults.push(runSim(asset.data, w.startIdx, w.endIdx, config));
        }

        const windowSharpes = windowResults.map(r => r.sharpe);
        const windowMaxDDs = windowResults.map(r => r.maxDrawdown);
        const s = stats(windowSharpes);
        const d = stats(windowMaxDDs);
        const negCount = windowSharpes.filter(v => v < 0).length;

        allResults.push({
          asset: asset.name,
          strategy: strat.name,
          spreadPct: spreadDisplay,
          feePerTrade: fee,
          scope: "combined",
          sharpe: fullResult.sharpe,
          apr: fullResult.apr,
          maxDrawdown: fullResult.maxDrawdown,
          putSells: fullResult.putSells,
          assignments: fullResult.assignments,
          skipRate: fullResult.skipRate,
          meanSharpe: s.mean,
          medianSharpe: s.median,
          stdSharpe: s.std,
          maxMaxDD: d.max,
          meanMaxDD: d.mean,
          negSharpeRate: negCount / windows.length,
          windowSharpes,
          windowMaxDDs,
        });

        completed++;
        if (completed % 4 === 0 || completed === totalCombos) {
          process.stdout.write(`  Progress: ${completed}/${totalCombos} (${(completed / totalCombos * 100).toFixed(0)}%)\r`);
        }
      }
    }
  }
}

const elapsed = ((performance.now() - t0) / 1000).toFixed(2);
console.log(`\nSweep complete: ${allResults.length} combos in ${elapsed}s\n`);

// ═════════════════════════════════════════════════════════════════
// SECTION 1: FULL RESULTS TABLE
// ═════════════════════════════════════════════════════════════════

console.log("=".repeat(130));
console.log("=== SECTION 1: FULL RESULTS TABLE ===");
console.log("=".repeat(130));
console.log("Full-period and rolling-window metrics at each cost level.\n");

for (const asset of ASSETS) {
  for (const strat of STRATEGY_MAKERS) {
    console.log(`\n  ${asset.name} | ${strat.name} (sized):`);
    const rows: any[] = [];

    for (const spread of SPREAD_LEVELS) {
      for (const fee of FEE_LEVELS) {
        const r = allResults.find(x =>
          x.asset === asset.name && x.strategy === strat.name
          && x.spreadPct === spread * 100 && x.feePerTrade === fee
        )!;
        rows.push({
          "Spread%": (spread * 100).toFixed(0),
          "Fee$": "$" + fee.toFixed(2),
          "FP Sharpe": fmt(r.sharpe, 3),
          "FP APR%": fmt(r.apr, 1),
          "FP MaxDD%": pct(r.maxDrawdown),
          "Puts": r.putSells,
          "RW Mean Sharpe": fmt(r.meanSharpe, 3),
          "RW MaxMaxDD%": pct(r.maxMaxDD),
          "RW Neg%": pct(r.negSharpeRate),
        });
      }
    }
    console.table(rows);
  }
}

// ═════════════════════════════════════════════════════════════════
// SECTION 2: ROLLING-WINDOW SHARPE HEATMAPS
// ═════════════════════════════════════════════════════════════════

console.log("\n" + "=".repeat(130));
console.log("=== SECTION 2: ROLLING-WINDOW MEAN SHARPE HEATMAPS (Spread × Fee) ===");
console.log("=".repeat(130) + "\n");

for (const asset of ASSETS) {
  for (const strat of STRATEGY_MAKERS) {
    console.log(`--- ${asset.name} | ${strat.name} ---`);
    const header = ["Spread\\Fee", ...FEE_LEVELS.map(f => "$" + f.toFixed(2))];
    console.log("  " + header.map(h => h.padStart(10)).join(""));

    for (const spread of SPREAD_LEVELS) {
      const cells: string[] = [`${(spread * 100).toFixed(0)}%`];
      for (const fee of FEE_LEVELS) {
        const r = allResults.find(x =>
          x.asset === asset.name && x.strategy === strat.name
          && x.spreadPct === spread * 100 && x.feePerTrade === fee
        )!;
        cells.push(fmt(r.meanSharpe, 3));
      }
      console.log("  " + cells.map(c => c.padStart(10)).join(""));
    }
    console.log("");
  }
}

// ═════════════════════════════════════════════════════════════════
// SECTION 3: FULL-PERIOD SHARPE HEATMAPS
// ═════════════════════════════════════════════════════════════════

console.log("=".repeat(130));
console.log("=== SECTION 3: FULL-PERIOD SHARPE HEATMAPS (Spread × Fee) ===");
console.log("=".repeat(130) + "\n");

for (const asset of ASSETS) {
  for (const strat of STRATEGY_MAKERS) {
    console.log(`--- ${asset.name} | ${strat.name} ---`);
    const header = ["Spread\\Fee", ...FEE_LEVELS.map(f => "$" + f.toFixed(2))];
    console.log("  " + header.map(h => h.padStart(10)).join(""));

    for (const spread of SPREAD_LEVELS) {
      const cells: string[] = [`${(spread * 100).toFixed(0)}%`];
      for (const fee of FEE_LEVELS) {
        const r = allResults.find(x =>
          x.asset === asset.name && x.strategy === strat.name
          && x.spreadPct === spread * 100 && x.feePerTrade === fee
        )!;
        cells.push(fmt(r.sharpe, 3));
      }
      console.log("  " + cells.map(c => c.padStart(10)).join(""));
    }
    console.log("");
  }
}

// ═════════════════════════════════════════════════════════════════
// SECTION 4: SHARPE ZERO-CROSSING (Rolling-Window Mean)
// ═════════════════════════════════════════════════════════════════

console.log("=".repeat(130));
console.log("=== SECTION 4: SHARPE ZERO-CROSSING ANALYSIS (Rolling-Window Mean) ===");
console.log("=".repeat(130));
console.log("Find the (spread, fee) boundary where rolling-window mean Sharpe crosses zero.\n");

for (const asset of ASSETS) {
  for (const strat of STRATEGY_MAKERS) {
    console.log(`--- ${asset.name} | ${strat.name} ---`);

    // Vary spread at fixed fee=$0.50
    console.log(`  Varying spread (fee fixed at $0.50):`);
    const fixedFee = SPREAD_LEVELS.map(spread => {
      const r = allResults.find(x =>
        x.asset === asset.name && x.strategy === strat.name
        && x.spreadPct === spread * 100 && x.feePerTrade === 0.50
      )!;
      return { spread: spread * 100, meanSharpe: r.meanSharpe };
    });

    for (const { spread, meanSharpe } of fixedFee) {
      console.log(`    Spread=${spread}%: Mean Sharpe=${fmt(meanSharpe, 3)}`);
    }

    let zeroCrossSpread: number | null = null;
    for (let i = 0; i < fixedFee.length - 1; i++) {
      const cross = linearInterp(fixedFee[i].spread, fixedFee[i].meanSharpe, fixedFee[i + 1].spread, fixedFee[i + 1].meanSharpe, 0);
      if (cross !== null) { zeroCrossSpread = cross; break; }
    }
    if (zeroCrossSpread !== null) {
      console.log(`    → Mean Sharpe crosses zero at ~${fmt(zeroCrossSpread, 1)}% spread.`);
    } else if (fixedFee.every(r => r.meanSharpe > 0)) {
      console.log(`    → Mean Sharpe remains positive across all tested spreads.`);
    } else {
      console.log(`    → Mean Sharpe negative even at lowest spread.`);
    }

    // Vary fee at fixed spread=5%
    console.log(`  Varying fee (spread fixed at 5%):`);
    const fixedSpread = FEE_LEVELS.map(fee => {
      const r = allResults.find(x =>
        x.asset === asset.name && x.strategy === strat.name
        && x.spreadPct === 5 && x.feePerTrade === fee
      )!;
      return { fee, meanSharpe: r.meanSharpe };
    });

    for (const { fee, meanSharpe } of fixedSpread) {
      console.log(`    Fee=$${fee.toFixed(2)}: Mean Sharpe=${fmt(meanSharpe, 3)}`);
    }

    let zeroCrossFee: number | null = null;
    for (let i = 0; i < fixedSpread.length - 1; i++) {
      const cross = linearInterp(fixedSpread[i].fee, fixedSpread[i].meanSharpe, fixedSpread[i + 1].fee, fixedSpread[i + 1].meanSharpe, 0);
      if (cross !== null) { zeroCrossFee = cross; break; }
    }
    if (zeroCrossFee !== null) {
      console.log(`    → Mean Sharpe crosses zero at ~$${fmt(zeroCrossFee, 2)} fee.`);
    } else if (fixedSpread.every(r => r.meanSharpe > 0)) {
      console.log(`    → Mean Sharpe remains positive across all tested fees.`);
    } else {
      console.log(`    → Mean Sharpe negative even at lowest fee.`);
    }

    console.log("");
  }
}

// ═════════════════════════════════════════════════════════════════
// SECTION 5: COST SENSITIVITY COEFFICIENTS
// ═════════════════════════════════════════════════════════════════

console.log("=".repeat(130));
console.log("=== SECTION 5: COST SENSITIVITY (ΔMeanSharpe per 1pp Spread Increase) ===");
console.log("=".repeat(130));
console.log("Linear regression of rolling-window mean Sharpe on spread% (fee fixed at $0.50).\n");

for (const strat of STRATEGY_MAKERS) {
  console.log(`--- ${strat.name} ---`);
  const rows: any[] = [];

  for (const asset of ASSETS) {
    const dataPoints = SPREAD_LEVELS.map(spread => {
      const r = allResults.find(x =>
        x.asset === asset.name && x.strategy === strat.name
        && x.spreadPct === spread * 100 && x.feePerTrade === 0.50
      )!;
      return { x: spread * 100, y: r.meanSharpe };
    });

    const n = dataPoints.length;
    const sumX = dataPoints.reduce((a, d) => a + d.x, 0);
    const sumY = dataPoints.reduce((a, d) => a + d.y, 0);
    const sumXY = dataPoints.reduce((a, d) => a + d.x * d.y, 0);
    const sumX2 = dataPoints.reduce((a, d) => a + d.x * d.x, 0);
    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;

    rows.push({
      "Asset": asset.name,
      "Slope (ΔSharpe/pp)": fmt(slope, 4),
      "Intercept": fmt(intercept, 3),
      "Sharpe@1%": fmt(intercept + slope * 1, 3),
      "Sharpe@5%": fmt(intercept + slope * 5, 3),
      "Sharpe@12%": fmt(intercept + slope * 12, 3),
    });
  }
  console.table(rows);
}

// ═════════════════════════════════════════════════════════════════
// SECTION 6: TRADE FREQUENCY vs COST SENSITIVITY
// ═════════════════════════════════════════════════════════════════

console.log("\n" + "=".repeat(130));
console.log("=== SECTION 6: TRADE FREQUENCY vs COST SENSITIVITY ===");
console.log("=".repeat(130));
console.log("Aggressive does ~34 puts/window vs Conservative ~3. Cost per Sharpe point?\n");

for (const asset of ASSETS) {
  console.log(`--- ${asset.name} ---`);
  const rows: any[] = [];

  for (const strat of STRATEGY_MAKERS) {
    const low = allResults.find(x =>
      x.asset === asset.name && x.strategy === strat.name
      && x.spreadPct === 1 && x.feePerTrade === 0.25
    )!;
    const high = allResults.find(x =>
      x.asset === asset.name && x.strategy === strat.name
      && x.spreadPct === 12 && x.feePerTrade === 2.00
    )!;

    const totalSharpeRange = low.meanSharpe - high.meanSharpe;

    rows.push({
      "Strategy": strat.name,
      "FP Puts": low.putSells,
      "MeanSharpe@Low": fmt(low.meanSharpe, 3),
      "MeanSharpe@High": fmt(high.meanSharpe, 3),
      "Total ΔSharpe": fmtSign(-totalSharpeRange, 3),
      "ΔSharpe/Put": fmt(-totalSharpeRange / (low.putSells || 1), 4),
    });
  }
  console.table(rows);
}

// ═════════════════════════════════════════════════════════════════
// SECTION 7: BREAKEVEN ANALYSIS (Sharpe ≥ 0.20 threshold)
// ═════════════════════════════════════════════════════════════════

console.log("\n" + "=".repeat(130));
console.log("=== SECTION 7: BREAKEVEN ANALYSIS (Rolling Mean Sharpe ≥ 0.20) ===");
console.log("=".repeat(130));
console.log("Maximum cost at which each strategy maintains rolling mean Sharpe ≥ 0.20.\n");

for (const asset of ASSETS) {
  for (const strat of STRATEGY_MAKERS) {
    console.log(`--- ${asset.name} | ${strat.name} ---`);

    const viable: { spread: number; fee: number; meanSharpe: number }[] = [];
    const nonViable: { spread: number; fee: number; meanSharpe: number }[] = [];

    for (const spread of SPREAD_LEVELS) {
      for (const fee of FEE_LEVELS) {
        const r = allResults.find(x =>
          x.asset === asset.name && x.strategy === strat.name
          && x.spreadPct === spread * 100 && x.feePerTrade === fee
        )!;
        if (r.meanSharpe >= 0.20) {
          viable.push({ spread: spread * 100, fee, meanSharpe: r.meanSharpe });
        } else {
          nonViable.push({ spread: spread * 100, fee, meanSharpe: r.meanSharpe });
        }
      }
    }

    if (viable.length === 0) {
      console.log(`  No cost level achieves mean Sharpe ≥ 0.20.`);
      const best = allResults
        .filter(x => x.asset === asset.name && x.strategy === strat.name)
        .sort((a, b) => b.meanSharpe - a.meanSharpe)[0];
      if (best) console.log(`  Best: spread=${best.spreadPct}%, fee=$${best.feePerTrade.toFixed(2)}, Mean Sharpe=${fmt(best.meanSharpe, 3)}`);
    } else {
      const maxCostViable = viable.sort((a, b) => (b.spread + b.fee * 10) - (a.spread + a.fee * 10))[0];
      console.log(`  Viable up to spread=${maxCostViable.spread}%, fee=$${maxCostViable.fee.toFixed(2)} (Mean Sharpe=${fmt(maxCostViable.meanSharpe, 3)})`);
      console.log(`  ${viable.length}/${viable.length + nonViable.length} cost combos achieve mean Sharpe ≥ 0.20.`);
    }
    console.log("");
  }
}

// ═════════════════════════════════════════════════════════════════
// SECTION 8: MaxDD SENSITIVITY
// ═════════════════════════════════════════════════════════════════

console.log("=".repeat(130));
console.log("=== SECTION 8: MAX DRAWDOWN SENSITIVITY ===");
console.log("=".repeat(130));
console.log("Does MaxDD change with friction? (Lower premium collected → less drawdown cushion)\n");

for (const asset of ASSETS) {
  for (const strat of STRATEGY_MAKERS) {
    console.log(`--- ${asset.name} | ${strat.name} ---`);
    const rows: any[] = [];

    for (const spread of SPREAD_LEVELS) {
      for (const fee of FEE_LEVELS) {
        const r = allResults.find(x =>
          x.asset === asset.name && x.strategy === strat.name
          && x.spreadPct === spread * 100 && x.feePerTrade === fee
        )!;
        rows.push({
          "Spread%": (spread * 100).toFixed(0),
          "Fee$": "$" + fee.toFixed(2),
          "FP MaxDD%": pct(r.maxDrawdown),
          "RW Max MaxDD": pct(r.maxMaxDD),
          "RW Mean MaxDD": pct(r.meanMaxDD),
        });
      }
    }
    console.table(rows);
  }
}

// ═════════════════════════════════════════════════════════════════
// SECTION 9: CROSS-ASSET COMPARISON
// ═════════════════════════════════════════════════════════════════

console.log("\n" + "=".repeat(130));
console.log("=== SECTION 9: CROSS-ASSET COMPARISON ===");
console.log("=".repeat(130));
console.log("Compare ETH vs BTC cost sensitivity at realistic Deribit costs.\n");

const realisticCosts = [
  { label: "Optimistic (5%/$0.50)", spread: 0.05, fee: 0.50 },
  { label: "Conservative (8%/$1.00)", spread: 0.08, fee: 1.00 },
  { label: "Worst-case (12%/$2.00)", spread: 0.12, fee: 2.00 },
];

for (const cost of realisticCosts) {
  console.log(`--- ${cost.label} ---`);
  const rows: any[] = [];

  for (const asset of ASSETS) {
    for (const strat of STRATEGY_MAKERS) {
      const r = allResults.find(x =>
        x.asset === asset.name && x.strategy === strat.name
        && x.spreadPct === cost.spread * 100 && x.feePerTrade === cost.fee
      )!;

      rows.push({
        "Asset": asset.name,
        "Strategy": strat.name,
        "FP Sharpe": fmt(r.sharpe, 3),
        "FP APR%": fmt(r.apr, 1),
        "FP MaxDD%": pct(r.maxDrawdown),
        "RW Mean Sharpe": fmt(r.meanSharpe, 3),
        "RW MaxMaxDD%": pct(r.maxMaxDD),
        "Puts": r.putSells,
        "Skip%": pct(r.skipRate),
      });
    }
  }
  console.table(rows);
}

// ═════════════════════════════════════════════════════════════════
// SECTION 10: SIZED vs UNSIZED COMPARISON AT BASELINE COST
// ═════════════════════════════════════════════════════════════════

console.log("\n" + "=".repeat(130));
console.log("=== SECTION 10: SIZING EFFECT AT VARIOUS COST LEVELS ===");
console.log("=".repeat(130));
console.log("Does position sizing interact with execution costs?\n");

// Run unsized baselines at each spread/fee for comparison
const unsizedResults: CostResult[] = [];

function makeConservativeUnsized(spreadPct: number, fee: number): StrategyConfig {
  return {
    impliedVol: 0.80,
    riskFreeRate: 0.05,
    contracts: 1,
    bidAskSpreadPct: spreadPct,
    feePerTrade: fee,
    targetDelta: 0.10,
    cycleLengthDays: 30,
    adaptiveCalls: { minDelta: 0.10, maxDelta: 0.50, skipThresholdPct: 0, minStrikeAtCost: true },
    ivRvSpread: { lookbackDays: 45, minMultiplier: 0.8, maxMultiplier: 1.3, skipBelowRatio: 1.1, skipSide: "put" },
    rollPut: { initialDTE: 30, rollWhenDTEBelow: 14, requireNetCredit: true },
  };
}

function makeAggressiveUnsized(spreadPct: number, fee: number): StrategyConfig {
  return {
    impliedVol: 0.80,
    riskFreeRate: 0.05,
    contracts: 1,
    bidAskSpreadPct: spreadPct,
    feePerTrade: fee,
    targetDelta: 0.20,
    cycleLengthDays: 3,
    ivRvSpread: { lookbackDays: 20, minMultiplier: 0.8, maxMultiplier: 1.3, skipBelowRatio: 1.2, skipSide: "put" },
  };
}

const unsizedMakers: StrategyMaker[] = [
  { name: "Conservative", makeFn: makeConservativeUnsized },
  { name: "Aggressive", makeFn: makeAggressiveUnsized },
];

// Only at representative cost levels for comparison
const compareCosts = [
  { spread: 0.01, fee: 0.25 },
  { spread: 0.05, fee: 0.50 },
  { spread: 0.08, fee: 1.00 },
  { spread: 0.12, fee: 2.00 },
];

for (const asset of ASSETS) {
  const windows = makeWindows(asset.data);

  for (const strat of unsizedMakers) {
    for (const cost of compareCosts) {
      const config = strat.makeFn(cost.spread, cost.fee);
      const fullResult = runSim(asset.data, 0, asset.data.length - 1, config);
      const windowResults: RunResult[] = [];
      for (const w of windows) {
        windowResults.push(runSim(asset.data, w.startIdx, w.endIdx, config));
      }
      const windowSharpes = windowResults.map(r => r.sharpe);
      const windowMaxDDs = windowResults.map(r => r.maxDrawdown);
      const s = stats(windowSharpes);
      const d = stats(windowMaxDDs);
      const negCount = windowSharpes.filter(v => v < 0).length;

      unsizedResults.push({
        asset: asset.name,
        strategy: strat.name,
        spreadPct: cost.spread * 100,
        feePerTrade: cost.fee,
        scope: "combined",
        sharpe: fullResult.sharpe,
        apr: fullResult.apr,
        maxDrawdown: fullResult.maxDrawdown,
        putSells: fullResult.putSells,
        assignments: fullResult.assignments,
        skipRate: fullResult.skipRate,
        meanSharpe: s.mean,
        medianSharpe: s.median,
        stdSharpe: s.std,
        maxMaxDD: d.max,
        meanMaxDD: d.mean,
        negSharpeRate: negCount / windows.length,
        windowSharpes,
        windowMaxDDs,
      });
    }
  }
}

for (const asset of ASSETS) {
  console.log(`--- ${asset.name} ---`);
  const rows: any[] = [];

  for (const strat of STRATEGY_MAKERS) {
    for (const cost of compareCosts) {
      const sized = allResults.find(x =>
        x.asset === asset.name && x.strategy === strat.name
        && x.spreadPct === cost.spread * 100 && x.feePerTrade === cost.fee
      )!;
      const unsized = unsizedResults.find(x =>
        x.asset === asset.name && x.strategy === strat.name
        && x.spreadPct === cost.spread * 100 && x.feePerTrade === cost.fee
      )!;

      rows.push({
        "Strategy": strat.name,
        "Spread%": (cost.spread * 100).toFixed(0),
        "Fee$": "$" + cost.fee.toFixed(2),
        "Unsized MS": fmt(unsized.meanSharpe, 3),
        "Sized MS": fmt(sized.meanSharpe, 3),
        "ΔMS": fmtSign(sized.meanSharpe - unsized.meanSharpe, 3),
        "Unsized MaxDD": pct(unsized.maxMaxDD),
        "Sized MaxDD": pct(sized.maxMaxDD),
        "ΔMaxDD": fmtSign((sized.maxMaxDD - unsized.maxMaxDD) * 100, 1) + "pp",
      });
    }
  }
  console.table(rows);
}

// ═════════════════════════════════════════════════════════════════
// SECTION 11: RECOMMENDATIONS
// ═════════════════════════════════════════════════════════════════

console.log("\n" + "=".repeat(130));
console.log("=== SECTION 11: RECOMMENDATIONS ===");
console.log("=".repeat(130) + "\n");

console.log("--- COST RESILIENCE RANKING (Rolling-Window Mean Sharpe) ---\n");

for (const asset of ASSETS) {
  console.log(`  ${asset.name}:`);
  for (const strat of STRATEGY_MAKERS) {
    console.log(`    ${strat.name}:`);

    for (const cost of realisticCosts) {
      const r = allResults.find(x =>
        x.asset === asset.name && x.strategy === strat.name
        && x.spreadPct === cost.spread * 100 && x.feePerTrade === cost.fee
      )!;
      console.log(`      ${cost.label}: Mean Sharpe=${fmt(r.meanSharpe, 3)}, MaxMaxDD=${pct(r.maxMaxDD)}, FP APR=${fmt(r.apr, 1)}%`);
    }

    // Verdict
    const worstCase = allResults.find(x =>
      x.asset === asset.name && x.strategy === strat.name
      && x.spreadPct === 12 && x.feePerTrade === 2.00
    )!;
    const consCase = allResults.find(x =>
      x.asset === asset.name && x.strategy === strat.name
      && x.spreadPct === 8 && x.feePerTrade === 1.00
    )!;

    if (worstCase.meanSharpe > 0.20) {
      console.log(`      → FULLY RESILIENT: Mean Sharpe ≥ 0.20 even at worst-case costs.\n`);
    } else if (consCase.meanSharpe > 0.20) {
      console.log(`      → RESILIENT: Deployable at conservative costs. Fragile at extreme friction.\n`);
    } else if (consCase.meanSharpe > 0) {
      console.log(`      → MARGINAL: Positive mean Sharpe at conservative costs but below deployment threshold.\n`);
    } else {
      console.log(`      → NON-VIABLE: Edge consumed by friction at conservative cost assumptions.\n`);
    }
  }
}

// Cross-asset summary
console.log("--- KEY FINDINGS ---\n");

// Compare best strategy per asset at conservative costs
for (const cost of [realisticCosts[1]]) {
  console.log(`  At ${cost.label}:`);
  for (const asset of ASSETS) {
    const best = STRATEGY_MAKERS
      .map(s => allResults.find(x =>
        x.asset === asset.name && x.strategy === s.name
        && x.spreadPct === cost.spread * 100 && x.feePerTrade === cost.fee
      )!)
      .sort((a, b) => b.meanSharpe - a.meanSharpe)[0];
    console.log(`    ${asset.name}: Best = ${best.strategy} (Mean Sharpe ${fmt(best.meanSharpe, 3)}, MaxMaxDD ${pct(best.maxMaxDD)})`);
  }
}

// Does sizing amplify cost sensitivity?
console.log("\n  Sizing × Cost Interaction:");
for (const asset of ASSETS) {
  for (const strat of STRATEGY_MAKERS) {
    const sizedLow = allResults.find(x =>
      x.asset === asset.name && x.strategy === strat.name
      && x.spreadPct === 1 && x.feePerTrade === 0.25
    )!;
    const sizedHigh = allResults.find(x =>
      x.asset === asset.name && x.strategy === strat.name
      && x.spreadPct === 12 && x.feePerTrade === 2.00
    )!;
    const unsizedLow = unsizedResults.find(x =>
      x.asset === asset.name && x.strategy === strat.name
      && x.spreadPct === 1 && x.feePerTrade === 0.25
    )!;
    const unsizedHigh = unsizedResults.find(x =>
      x.asset === asset.name && x.strategy === strat.name
      && x.spreadPct === 12 && x.feePerTrade === 2.00
    )!;

    const sizedRange = sizedLow.meanSharpe - sizedHigh.meanSharpe;
    const unsizedRange = unsizedLow.meanSharpe - unsizedHigh.meanSharpe;
    const ratio = unsizedRange !== 0 ? sizedRange / unsizedRange : 0;

    console.log(`    ${asset.name} ${strat.name}: Sized range=${fmt(sizedRange, 3)}, Unsized range=${fmt(unsizedRange, 3)}, Ratio=${fmt(ratio, 2)}×`);
  }
}

console.log("\n\n=== END OF EXPERIMENT 27 ===\n");
