// Experiment 23: Preset Integration & Final Validation
// Re-runs Exp 20 rolling-window backtest + Exp 18 full-period validation
// with position sizing enabled (VS-40/45 + cold-start for Conservative,
// VS-40/45 for Active). Confirms final deployed Sharpe/MaxDD numbers.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { simulate } from "../../src/components/strategy/simulate.ts";
import { defaultRules } from "../../src/components/strategy/rules.ts";
import { summarizeRun } from "../../src/components/monte-carlo.ts";
import type { StrategyConfig } from "../../src/components/strategy/types.ts";

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

interface Window {
  id: number;
  startIdx: number;
  endIdx: number;
  startDate: string;
  endDate: string;
  days: number;
}

const windows: Window[] = [];
let wid = 0;
for (let start = 0; start + MIN_WINDOW <= aligned.length; start += STRIDE_DAYS) {
  const end = Math.min(start + WINDOW_DAYS, aligned.length - 1);
  if (end - start < MIN_WINDOW) break;
  windows.push({
    id: ++wid,
    startIdx: start,
    endIdx: end,
    startDate: aligned[start].date,
    endDate: aligned[end].date,
    days: end - start,
  });
}

console.log(`Generated ${windows.length} windows (${WINDOW_DAYS}d, stride ${STRIDE_DAYS}d)\n`);

// ─── Strategy definitions ───

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
    name: "Cons-Baseline",
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
    name: "Active-Baseline",
    config: {
      ...BASE_CONFIG,
      targetDelta: 0.20,
      cycleLengthDays: 3,
      ivRvSpread: { lookbackDays: 20, minMultiplier: 0.8, maxMultiplier: 1.3, skipBelowRatio: 1.2, skipSide: "put" },
    },
  },
  {
    name: "Active-Sized",
    config: {
      ...BASE_CONFIG,
      targetDelta: 0.20,
      cycleLengthDays: 3,
      ivRvSpread: { lookbackDays: 20, minMultiplier: 0.8, maxMultiplier: 1.3, skipBelowRatio: 1.2, skipSide: "put" },
      positionSizing: { mode: "volScaled", volTarget: 0.40, volLookbackDays: 45, minSize: 0.10 },
    },
  },
];

// ─── Window runner ───

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

function runWindow(strategy: StrategyDef, window: Window): WindowResult {
  const prices = aligned.slice(window.startIdx, window.endIdx + 1).map(d => d.price);
  const ivPath = aligned.slice(window.startIdx, window.endIdx + 1).map(d => d.iv);

  const rules = defaultRules();
  const result = simulate(prices, rules, strategy.config, ivPath);

  const capitalAtRisk = prices[0] * strategy.config.contracts;
  const yearsElapsed = window.days / 365;
  const summary = summarizeRun(0, result, prices, capitalAtRisk, yearsElapsed, strategy.config.riskFreeRate, strategy.config.contracts);

  const putSells = result.signalLog.filter(e => e.signal.action === "SELL_PUT").length;
  const skipRate = (putSells + result.summary.totalSkippedCycles) > 0
    ? result.summary.totalSkippedCycles / (putSells + result.summary.totalSkippedCycles)
    : 0;

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
// PART A: ROLLING WINDOW BACKTEST
// ═══════════════════════════════════════════════════════════════════

console.log("═══════════════════════════════════════════════════════════════════");
console.log("PART A: Rolling Window Validation (17 windows × 4 strategies)");
console.log("═══════════════════════════════════════════════════════════════════\n");

const t0 = performance.now();
const allResults: WindowResult[] = [];

for (const strategy of STRATEGIES) {
  for (const window of windows) {
    allResults.push(runWindow(strategy, window));
  }
}

const elapsed = ((performance.now() - t0) / 1000).toFixed(2);
console.log(`Part A: ${allResults.length} backtests in ${elapsed}s\n`);

// ─── Summary per strategy ───

for (const strategy of STRATEGIES) {
  const results = allResults.filter(r => r.strategy === strategy.name);
  const sharpes = results.map(r => r.sharpe);
  const maxDDs = results.map(r => r.maxDrawdown);
  const aprs = results.map(r => r.apr);

  const s = stats(sharpes);
  const d = stats(maxDDs);
  const a = stats(aprs);
  const negCount = sharpes.filter(v => v < 0).length;

  console.log(`${strategy.name}:`);
  console.log(`  Sharpe:  mean=${fmt(s.mean, 3)}, median=${fmt(s.median, 3)}, std=${fmt(s.std, 3)}, min=${fmt(s.min, 3)}, max=${fmt(s.max, 3)}`);
  console.log(`  MaxDD:   mean=${pct(d.mean)}, max=${pct(d.max)}`);
  console.log(`  APR:     mean=${fmt(a.mean, 1)}%, max=${fmt(a.max, 1)}%`);
  console.log(`  Neg Sharpe windows: ${negCount}/${results.length} (${pct(negCount / results.length)})`);
  console.log();
}

// ─── Paired comparisons ───

const pairs: [string, string][] = [
  ["Cons-Baseline", "Cons-Sized"],
  ["Active-Baseline", "Active-Sized"],
];

for (const [baselineName, sizedName] of pairs) {
  console.log(`\n─── ${baselineName} vs ${sizedName} (window-by-window) ───\n`);
  console.log("| Window | Start      | End        | Base Sharpe | Sized Sharpe | ΔSharpe | Base MaxDD | Sized MaxDD | ΔMaxDD |");
  console.log("|--------|------------|------------|-------------|--------------|---------|------------|-------------|--------|");

  let sharpeWins = 0, maxDDWins = 0;
  const deltaSharpes: number[] = [];

  for (const w of windows) {
    const base = allResults.find(r => r.strategy === baselineName && r.windowId === w.id)!;
    const sized = allResults.find(r => r.strategy === sizedName && r.windowId === w.id)!;
    const dS = sized.sharpe - base.sharpe;
    const dDD = sized.maxDrawdown - base.maxDrawdown;
    deltaSharpes.push(dS);

    if (sized.sharpe > base.sharpe) sharpeWins++;
    if (sized.maxDrawdown < base.maxDrawdown) maxDDWins++;

    console.log(`| ${w.id.toString().padStart(6)} | ${w.startDate} | ${w.endDate} | ${fmt(base.sharpe, 3).padStart(11)} | ${fmt(sized.sharpe, 3).padStart(12)} | ${(dS >= 0 ? "+" : "") + fmt(dS, 3)} | ${pct(base.maxDrawdown).padStart(10)} | ${pct(sized.maxDrawdown).padStart(11)} | ${(dDD <= 0 ? "" : "+") + pct(dDD)} |`);
  }

  const meanDS = deltaSharpes.reduce((a, b) => a + b, 0) / deltaSharpes.length;
  console.log(`\nSharpe wins: ${sharpeWins}/${windows.length}. MaxDD wins: ${maxDDWins}/${windows.length}. Mean ΔSharpe: ${(meanDS >= 0 ? "+" : "")}${fmt(meanDS, 3)}`);
}

// ═══════════════════════════════════════════════════════════════════
// PART B: FULL PERIOD BACKTEST
// ═══════════════════════════════════════════════════════════════════

console.log("\n\n═══════════════════════════════════════════════════════════════════");
console.log("PART B: Full Period Validation (~5yr)");
console.log("═══════════════════════════════════════════════════════════════════\n");

const fullPrices = aligned.map(d => d.price);
const fullIV = aligned.map(d => d.iv);
const fullYears = aligned.length / 365;

console.log(`Period: ${aligned[0].date} → ${aligned[aligned.length - 1].date} (${aligned.length} days, ${fmt(fullYears, 2)} years)\n`);

console.log("| Strategy       | Sharpe | APR     | MaxDD   | Put Sells | Assignments | Full Cycles | Skip Rate |");
console.log("|----------------|--------|---------|---------|-----------|-------------|-------------|-----------|");

for (const strategy of STRATEGIES) {
  const rules = defaultRules();
  const result = simulate(fullPrices, rules, strategy.config, fullIV);

  const capitalAtRisk = fullPrices[0] * strategy.config.contracts;
  const summary = summarizeRun(0, result, fullPrices, capitalAtRisk, fullYears, strategy.config.riskFreeRate, strategy.config.contracts);

  const putSells = result.signalLog.filter(e => e.signal.action === "SELL_PUT").length;
  const skipRate = (putSells + result.summary.totalSkippedCycles) > 0
    ? result.summary.totalSkippedCycles / (putSells + result.summary.totalSkippedCycles)
    : 0;

  console.log(`| ${strategy.name.padEnd(14)} | ${fmt(summary.sharpe, 3).padStart(6)} | ${fmt(summary.apr, 1).padStart(6)}% | ${pct(summary.maxDrawdown).padStart(7)} | ${String(putSells).padStart(9)} | ${String(summary.assignments).padStart(11)} | ${String(summary.fullCycles).padStart(11)} | ${pct(skipRate).padStart(9)} |`);
}

// ─── Sub-period analysis (same windows as Exp 18) ───

console.log("\n\n─── Sub-period analysis ───\n");

interface SubPeriod { name: string; startDate: string; endDate: string }
const subPeriods: SubPeriod[] = [
  { name: "2021 H2 (bull)", startDate: "2021-03-24", endDate: "2021-11-09" },
  { name: "2022 (bear)", startDate: "2021-11-10", endDate: "2022-11-21" },
  { name: "2023 (recovery)", startDate: "2022-11-22", endDate: "2023-12-31" },
  { name: "2024 (mixed)", startDate: "2024-01-01", endDate: "2024-12-31" },
  { name: "2025 H1 (bear)", startDate: "2025-01-01", endDate: "2026-03-09" },
];

for (const strategy of STRATEGIES) {
  console.log(`\n${strategy.name}:`);
  console.log("| Period             | Sharpe | APR     | MaxDD   | Puts | Assigns |");
  console.log("|--------------------|--------|---------|---------|------|---------|");

  for (const period of subPeriods) {
    const startIdx = aligned.findIndex(d => d.date >= period.startDate);
    const endIdx = aligned.findIndex(d => d.date > period.endDate);
    const actualEnd = endIdx === -1 ? aligned.length - 1 : endIdx - 1;
    if (startIdx < 0 || startIdx >= actualEnd) continue;

    const prices = aligned.slice(startIdx, actualEnd + 1).map(d => d.price);
    const iv = aligned.slice(startIdx, actualEnd + 1).map(d => d.iv);
    const years = prices.length / 365;

    const rules = defaultRules();
    const result = simulate(prices, rules, strategy.config, iv);
    const capitalAtRisk = prices[0] * strategy.config.contracts;
    const summary = summarizeRun(0, result, prices, capitalAtRisk, years, strategy.config.riskFreeRate, strategy.config.contracts);
    const putSells = result.signalLog.filter(e => e.signal.action === "SELL_PUT").length;

    console.log(`| ${period.name.padEnd(18)} | ${fmt(summary.sharpe, 3).padStart(6)} | ${fmt(summary.apr, 1).padStart(6)}% | ${pct(summary.maxDrawdown).padStart(7)} | ${String(putSells).padStart(4)} | ${String(summary.assignments).padStart(7)} |`);
  }
}

console.log("\n\nDone.");
