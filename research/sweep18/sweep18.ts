// Experiment 18: Historical Backtest
// Runs strategies against real ETH price + DVOL data (2021–2026).
// No Monte Carlo, no model — one actual market path per strategy × period.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { simulate, computeRealizedVol } from "../../src/components/strategy/simulate.ts";
import { defaultRules } from "../../src/components/strategy/rules.ts";
import { summarizeRun, computeSharpe, computeSortino, computeBenchmarkMaxDD } from "../../src/components/monte-carlo.ts";
import type { StrategyConfig } from "../../src/components/strategy/types.ts";
import type { RunSummary } from "../../src/components/monte-carlo.ts";

// ─── Load data ───

const BASE = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(BASE, "..", "sweep16", "data");

interface DataRecord { date: string; close: number }

const rawPrices: DataRecord[] = JSON.parse(readFileSync(path.join(DATA_DIR, "prices.json"), "utf-8"));
const rawDvol: DataRecord[] = JSON.parse(readFileSync(path.join(DATA_DIR, "dvol.json"), "utf-8"));

// ─── Align data by date (inner join) ───

const dvolMap = new Map(rawDvol.map(d => [d.date, d.close / 100])); // % → decimal
interface AlignedDay { date: string; price: number; iv: number }
const aligned: AlignedDay[] = rawPrices
  .filter(p => dvolMap.has(p.date))
  .map(p => ({ date: p.date, price: p.close, iv: dvolMap.get(p.date)! }));

console.log(`Aligned data: ${aligned.length} days (${aligned[0].date} → ${aligned[aligned.length - 1].date})\n`);

// ─── Sub-periods ───

interface Period { name: string; startDate: string; endDate: string }

const PERIODS: Period[] = [
  { name: "Full Period",   startDate: "2021-03-24", endDate: "2026-03-09" },
  { name: "2021 H2 (Bull)", startDate: "2021-03-24", endDate: "2021-12-31" },
  { name: "2022 (Bear)",    startDate: "2022-01-01", endDate: "2022-12-31" },
  { name: "2023 (Recovery)", startDate: "2023-01-01", endDate: "2023-12-31" },
  { name: "2024-2025",       startDate: "2024-01-01", endDate: "2025-12-31" },
  { name: "2025-2026 H1",    startDate: "2025-01-01", endDate: "2026-03-09" },
];

function slicePeriod(data: AlignedDay[], start: string, end: string): AlignedDay[] {
  return data.filter(d => d.date >= start && d.date <= end);
}

// ─── Strategy configs ───

const BASE_CONFIG: Omit<StrategyConfig, "targetDelta" | "cycleLengthDays" | "adaptiveCalls" | "ivRvSpread" | "rollPut"> = {
  impliedVol: 0.80, // fallback — never used when ivPath provided
  riskFreeRate: 0.05,
  contracts: 1,
  bidAskSpreadPct: 0.05, // 5%
  feePerTrade: 0.50,
};

const STRATEGIES: { name: string; config: StrategyConfig }[] = [
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
    name: "Moderate",
    config: {
      ...BASE_CONFIG,
      targetDelta: 0.20,
      cycleLengthDays: 14,
      ivRvSpread: { lookbackDays: 20, minMultiplier: 0.8, maxMultiplier: 1.3, skipBelowRatio: 1.3, skipSide: "put" },
      rollPut: { initialDTE: 14, rollWhenDTEBelow: 7, requireNetCredit: true },
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

// ─── Run simulation for a period ───

interface BacktestResult {
  strategy: string;
  period: string;
  days: number;
  startPrice: number;
  endPrice: number;
  underlyingReturn: number;
  summary: RunSummary;
  skipRate: number;
  executedCycles: number;
  ivStats: { mean: number; std: number; min: number; max: number };
  ivrvStats: { mean: number; std: number; aboveThreshold: number };
}

function computeIVRVStats(
  prices: number[],
  ivs: number[],
  lookback: number,
): { mean: number; std: number; aboveThreshold: number } {
  const ratios: number[] = [];
  for (let day = lookback; day < prices.length; day++) {
    const rv = computeRealizedVol(prices, day, lookback);
    if (rv !== undefined && rv > 0.01) {
      ratios.push(ivs[day] / rv);
    }
  }
  if (ratios.length === 0) return { mean: 0, std: 0, aboveThreshold: 0 };
  const mean = ratios.reduce((a, b) => a + b, 0) / ratios.length;
  const variance = ratios.reduce((s, r) => s + (r - mean) ** 2, 0) / (ratios.length - 1);
  const aboveThreshold = ratios.filter(r => r > 1.2).length / ratios.length;
  return { mean, std: Math.sqrt(variance), aboveThreshold };
}

function runBacktest(strategy: { name: string; config: StrategyConfig }, period: Period): BacktestResult {
  const slice = slicePeriod(aligned, period.startDate, period.endDate);
  if (slice.length < 2) throw new Error(`Period ${period.name}: insufficient data (${slice.length} days)`);

  const prices = slice.map(d => d.price);
  const ivPath = slice.map(d => d.iv);

  const rules = defaultRules();
  const result = simulate(prices, rules, strategy.config, ivPath);

  const capitalAtRisk = prices[0] * strategy.config.contracts;
  const yearsElapsed = (slice.length - 1) / 365;

  const summary = summarizeRun(0, result, prices, capitalAtRisk, yearsElapsed, strategy.config.riskFreeRate, strategy.config.contracts);

  const totalAttempted = result.summary.totalSkippedCycles
    + result.summary.totalAssignments
    + summary.fullCycles
    + (result.signalLog.filter(e => e.signal.action === "SELL_PUT" || e.signal.action === "SELL_CALL").length
       - result.summary.totalAssignments - summary.fullCycles);

  // Skip rate: skipped / (skipped + executed puts)
  const putSells = result.signalLog.filter(e => e.signal.action === "SELL_PUT").length;
  const skipRate = (putSells + result.summary.totalSkippedCycles) > 0
    ? result.summary.totalSkippedCycles / (putSells + result.summary.totalSkippedCycles)
    : 0;

  const executedCycles = putSells;

  // IV stats
  const ivVals = ivPath;
  const ivMean = ivVals.reduce((a, b) => a + b, 0) / ivVals.length;
  const ivVar = ivVals.reduce((s, v) => s + (v - ivMean) ** 2, 0) / (ivVals.length - 1);
  const ivStats = {
    mean: ivMean,
    std: Math.sqrt(ivVar),
    min: Math.min(...ivVals),
    max: Math.max(...ivVals),
  };

  const lookback = strategy.config.ivRvSpread?.lookbackDays ?? 20;
  const ivrvStats = computeIVRVStats(prices, ivPath, lookback);

  return {
    strategy: strategy.name,
    period: period.name,
    days: slice.length - 1,
    startPrice: prices[0],
    endPrice: prices[prices.length - 1],
    underlyingReturn: (prices[prices.length - 1] - prices[0]) / prices[0],
    summary,
    skipRate,
    executedCycles,
    ivStats,
    ivrvStats,
  };
}

// ─── Run all combos ───

console.log("Running historical backtests...\n");
const t0 = performance.now();

const results: BacktestResult[] = [];
for (const strategy of STRATEGIES) {
  for (const period of PERIODS) {
    results.push(runBacktest(strategy, period));
  }
}

const elapsed = ((performance.now() - t0) / 1000).toFixed(2);
console.log(`Completed ${results.length} backtests in ${elapsed}s\n`);

// ─── Output: Full-period results ───

function fmt(n: number, dec = 2): string { return n.toFixed(dec); }
function pct(n: number, dec = 1): string { return (n * 100).toFixed(dec) + "%"; }

console.log("## Full-Period Results (2021-03-24 → 2026-03-09)\n");

const fullResults = results.filter(r => r.period === "Full Period");
console.log("| Metric | Conservative | Moderate | Active |");
console.log("|--------|-------------|----------|--------|");

const metrics: [string, (r: BacktestResult) => string][] = [
  ["Days", r => `${r.days}`],
  ["Start Price", r => `$${fmt(r.startPrice, 0)}`],
  ["End Price", r => `$${fmt(r.endPrice, 0)}`],
  ["Underlying Return", r => pct(r.underlyingReturn)],
  ["**Sharpe**", r => fmt(r.summary.sharpe, 3)],
  ["**Sortino**", r => fmt(r.summary.sortino, 3)],
  ["**APR (%)**", r => fmt(r.summary.apr)],
  ["Total P/L ($)", r => fmt(r.summary.totalPL, 0)],
  ["Premium Collected", r => `$${fmt(r.summary.premiumCollected, 0)}`],
  ["Max Drawdown", r => pct(r.summary.maxDrawdown)],
  ["Win", r => r.summary.isWin ? "✓" : "✗"],
  ["Assignments", r => `${r.summary.assignments}`],
  ["Full Cycles", r => `${r.summary.fullCycles}`],
  ["Executed Put Sells", r => `${r.executedCycles}`],
  ["Skipped Cycles", r => `${r.summary.skippedCycles}`],
  ["**Skip Rate**", r => pct(r.skipRate)],
  ["Stop Losses", r => `${r.summary.totalStopLosses}`],
  ["Put Rolls", r => `${r.summary.totalPutRolls}`],
  ["Regime", r => r.summary.regime],
  ["Benchmark APR", r => fmt(r.summary.benchmarkAPR)],
  ["Benchmark Sharpe", r => fmt(r.summary.benchmarkSharpe, 3)],
  ["Alpha (APR)", r => fmt(r.summary.apr - r.summary.benchmarkAPR)],
  ["Mean IV", r => pct(r.ivStats.mean)],
  ["IV Std", r => pct(r.ivStats.std)],
  ["IV Range", r => `${pct(r.ivStats.min)}–${pct(r.ivStats.max)}`],
  ["Mean IV/RV Ratio", r => fmt(r.ivrvStats.mean, 3)],
  ["IV/RV Std", r => fmt(r.ivrvStats.std, 3)],
  ["IV/RV > 1.2 %", r => pct(r.ivrvStats.aboveThreshold)],
];

for (const [label, fn] of metrics) {
  const vals = fullResults.map(fn);
  console.log(`| ${label} | ${vals.join(" | ")} |`);
}

// ─── Output: Sub-period breakdown ───

console.log("\n## Sub-Period Breakdown\n");

for (const strategy of STRATEGIES) {
  console.log(`### ${strategy.name} (δ${strategy.config.targetDelta}/${strategy.config.cycleLengthDays}d)\n`);
  console.log("| Period | Days | ETH Ret | Sharpe | APR% | MaxDD | Skip% | Puts | Cycles | Regime | BM APR | Alpha |");
  console.log("|--------|------|---------|--------|------|-------|-------|------|--------|--------|--------|-------|");

  for (const period of PERIODS) {
    const r = results.find(x => x.strategy === strategy.name && x.period === period.name)!;
    console.log(
      `| ${r.period} | ${r.days} | ${pct(r.underlyingReturn)} | ${fmt(r.summary.sharpe, 3)} | ${fmt(r.summary.apr)} | ${pct(r.summary.maxDrawdown)} | ${pct(r.skipRate)} | ${r.executedCycles} | ${r.summary.fullCycles} | ${r.summary.regime} | ${fmt(r.summary.benchmarkAPR)} | ${fmt(r.summary.apr - r.summary.benchmarkAPR)} |`
    );
  }
  console.log();
}

// ─── Output: Skip rate comparison vs Exp 16/17 predictions ───

console.log("## Skip Rate Comparison\n");
console.log("| Strategy | Threshold | Real Skip% | Exp 16 Predicted | Exp 17 Simulated |");
console.log("|----------|-----------|-----------|-----------------|------------------|");

for (const strategy of STRATEGIES) {
  const r = results.find(x => x.strategy === strategy.name && x.period === "Full Period")!;
  const threshold = strategy.config.ivRvSpread?.skipBelowRatio ?? 0;
  const exp16 = threshold === 1.2 ? "61.8%" : "—";
  const exp17Vals: Record<string, string> = {
    "Conservative": "99.3–99.8%",
    "Moderate": "95.1–98.7%",
    "Active": "90.6–97.4%",
  };
  console.log(`| ${strategy.name} | ${threshold} | ${pct(r.skipRate)} | ${exp16} | ${exp17Vals[strategy.name] ?? "—"} |`);
}

// ─── Output: Comparison with Exp 17 predictions ───

console.log("\n## Comparison vs Exp 17 Calibrated Predictions\n");
console.log("| Strategy | Exp 17 Sharpe (40%vol/VRP=6%) | Real Sharpe | Exp 17 Sharpe (60%vol/VRP=6%) |");
console.log("|----------|------------------------------|-------------|------------------------------|");

const exp17_40: Record<string, number> = { Conservative: 0.505, Moderate: 0.414, Active: 1.031 };
const exp17_60: Record<string, number> = { Conservative: 0.303, Moderate: 0.190, Active: 0.523 };

for (const r of fullResults) {
  console.log(`| ${r.strategy} | ${fmt(exp17_40[r.strategy], 3)} | **${fmt(r.summary.sharpe, 3)}** | ${fmt(exp17_60[r.strategy], 3)} |`);
}

// ─── Output: IV/RV diagnostics ───

console.log("\n## IV/RV Ratio Diagnostics (Full Period)\n");
console.log("| Strategy | Lookback | Mean IV/RV | Std IV/RV | % Days IV/RV > 1.2 |");
console.log("|----------|----------|-----------|-----------|---------------------|");

for (const r of fullResults) {
  const lb = STRATEGIES.find(s => s.name === r.strategy)!.config.ivRvSpread?.lookbackDays ?? 20;
  console.log(`| ${r.strategy} | ${lb}d | ${fmt(r.ivrvStats.mean, 3)} | ${fmt(r.ivrvStats.std, 3)} | ${pct(r.ivrvStats.aboveThreshold)} |`);
}

console.log("\n---\nDone.");
