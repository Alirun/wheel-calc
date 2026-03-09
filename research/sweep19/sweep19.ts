// Experiment 19: Conservative Parameter Sweep on Real Data
// Optimizes Conservative strategy parameters against historical ETH data (2021–2026).
// Sub-A: 700-combo core parameter sweep. Sub-B: feature ablation on top configs.
// Sub-C: wider delta exploration at best params.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { simulate, computeRealizedVol } from "../../src/components/strategy/simulate.ts";
import { defaultRules } from "../../src/components/strategy/rules.ts";
import { summarizeRun, countFullCycles } from "../../src/components/monte-carlo.ts";
import type { StrategyConfig, AdaptiveCallsConfig, IVRVSpreadConfig, RollPutConfig } from "../../src/components/strategy/types.ts";
import type { RunSummary } from "../../src/components/monte-carlo.ts";

// ─── Load & align data (reused from sweep18) ───

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

// ─── Sub-periods for stability check ───

interface Period { name: string; startDate: string; endDate: string }
const FULL_PERIOD: Period = { name: "Full Period", startDate: "2021-03-24", endDate: "2026-03-09" };

const SUB_PERIODS: Period[] = [
  { name: "2021 H2 (Bull)",    startDate: "2021-03-24", endDate: "2021-12-31" },
  { name: "2022 (Bear)",       startDate: "2022-01-01", endDate: "2022-12-31" },
  { name: "2023 (Recovery)",   startDate: "2023-01-01", endDate: "2023-12-31" },
  { name: "2024-2025",         startDate: "2024-01-01", endDate: "2025-12-31" },
  { name: "2025-2026 H1",      startDate: "2025-01-01", endDate: "2026-03-09" },
];

function slicePeriod(data: AlignedDay[], start: string, end: string): AlignedDay[] {
  return data.filter(d => d.date >= start && d.date <= end);
}

// ─── Backtest runner ───

interface BacktestResult {
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
  isWin: boolean;
  regime: string;
  benchmarkAPR: number;
  alpha: number;
}

function runBacktest(config: StrategyConfig, period: Period): BacktestResult {
  const slice = slicePeriod(aligned, period.startDate, period.endDate);
  if (slice.length < 2) throw new Error(`Period ${period.name}: insufficient data`);

  const prices = slice.map(d => d.price);
  const ivPath = slice.map(d => d.iv);
  const rules = defaultRules();
  const result = simulate(prices, rules, config, ivPath);

  const capitalAtRisk = prices[0] * config.contracts;
  const yearsElapsed = (slice.length - 1) / 365;
  const summary = summarizeRun(0, result, prices, capitalAtRisk, yearsElapsed, config.riskFreeRate, config.contracts);

  const putSells = result.signalLog.filter(e => e.signal.action === "SELL_PUT").length;
  const skipRate = (putSells + result.summary.totalSkippedCycles) > 0
    ? result.summary.totalSkippedCycles / (putSells + result.summary.totalSkippedCycles)
    : 0;

  return {
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
    isWin: summary.isWin,
    regime: summary.regime,
    benchmarkAPR: summary.benchmarkAPR,
    alpha: summary.apr - summary.benchmarkAPR,
  };
}

// ─── Config builders ───

const BASE_CONFIG: Pick<StrategyConfig, "impliedVol" | "riskFreeRate" | "contracts" | "bidAskSpreadPct" | "feePerTrade"> = {
  impliedVol: 0.80,
  riskFreeRate: 0.05,
  contracts: 1,
  bidAskSpreadPct: 0.05,
  feePerTrade: 0.50,
};

function makeConservativeConfig(
  targetDelta: number,
  cycleLengthDays: number,
  skipBelowRatio: number,
  lookbackDays: number,
  features: { ac: boolean; pr: boolean; rf: boolean },
): StrategyConfig {
  const config: StrategyConfig = {
    ...BASE_CONFIG,
    targetDelta,
    cycleLengthDays,
  };

  if (features.rf) {
    config.ivRvSpread = {
      lookbackDays,
      minMultiplier: 0.8,
      maxMultiplier: 1.3,
      skipBelowRatio,
      skipSide: "put",
    };
  } else {
    config.ivRvSpread = {
      lookbackDays,
      minMultiplier: 0.8,
      maxMultiplier: 1.3,
      skipSide: "put",
    };
  }

  if (features.ac) {
    config.adaptiveCalls = {
      minDelta: 0.10,
      maxDelta: 0.50,
      skipThresholdPct: 0,
      minStrikeAtCost: true,
    };
  }

  if (features.pr) {
    config.rollPut = {
      initialDTE: cycleLengthDays,
      rollWhenDTEBelow: Math.max(Math.floor((cycleLengthDays - 1) / 2), 7),
      requireNetCredit: true,
    };
  }

  return config;
}

// ─── Helpers ───

function fmt(n: number, dec = 2): string { return n.toFixed(dec); }
function pct(n: number, dec = 1): string { return (n * 100).toFixed(dec) + "%"; }

// ═══════════════════════════════════════════════════════════════════
// SUB-EXPERIMENT A: Core Parameter Sweep
// ═══════════════════════════════════════════════════════════════════

console.log("═══════════════════════════════════════════════════════════════");
console.log("SUB-EXPERIMENT A: Core Parameter Sweep (700 combos)");
console.log("═══════════════════════════════════════════════════════════════\n");

const DELTAS = [0.05, 0.08, 0.10, 0.12, 0.15];
const CYCLES = [21, 25, 30, 35, 45];
const SKIPS = [0.9, 1.0, 1.05, 1.1, 1.15, 1.2, 1.3];
const LOOKBACKS = [20, 30, 45, 60];

interface SweepAResult {
  delta: number;
  cycle: number;
  skip: number;
  lookback: number;
  result: BacktestResult;
}

const t0 = performance.now();
const sweepA: SweepAResult[] = [];

for (const delta of DELTAS) {
  for (const cycle of CYCLES) {
    for (const skip of SKIPS) {
      for (const lookback of LOOKBACKS) {
        const config = makeConservativeConfig(delta, cycle, skip, lookback, { ac: true, pr: true, rf: true });
        const result = runBacktest(config, FULL_PERIOD);
        sweepA.push({ delta, cycle, skip, lookback, result });
      }
    }
  }
}

const elapsedA = ((performance.now() - t0) / 1000).toFixed(2);
console.log(`Completed ${sweepA.length} backtests in ${elapsedA}s\n`);

// Sort by Sharpe descending
sweepA.sort((a, b) => b.result.sharpe - a.result.sharpe);

// Top 20
console.log("### Top 20 by Sharpe\n");
console.log("| Rank | δ | Cycle | Skip | LB | Sharpe | Sortino | APR% | MaxDD | PutSells | Cycles | Skip% | Rolls | Alpha |");
console.log("|------|-----|-------|------|-----|--------|---------|------|-------|----------|--------|-------|-------|-------|");
for (let i = 0; i < Math.min(20, sweepA.length); i++) {
  const s = sweepA[i];
  const r = s.result;
  console.log(
    `| ${i + 1} | ${s.delta} | ${s.cycle} | ${s.skip} | ${s.lookback} | ${fmt(r.sharpe, 3)} | ${fmt(r.sortino, 3)} | ${fmt(r.apr)} | ${pct(r.maxDrawdown)} | ${r.putSells} | ${r.fullCycles} | ${pct(r.skipRate)} | ${r.putRolls} | ${fmt(r.alpha)} |`
  );
}

// Bottom 5
console.log("\n### Bottom 5 by Sharpe\n");
console.log("| Rank | δ | Cycle | Skip | LB | Sharpe | APR% | MaxDD | PutSells | Skip% |");
console.log("|------|-----|-------|------|-----|--------|------|-------|----------|-------|");
for (let i = Math.max(0, sweepA.length - 5); i < sweepA.length; i++) {
  const s = sweepA[i];
  const r = s.result;
  console.log(
    `| ${i + 1} | ${s.delta} | ${s.cycle} | ${s.skip} | ${s.lookback} | ${fmt(r.sharpe, 3)} | ${fmt(r.apr)} | ${pct(r.maxDrawdown)} | ${r.putSells} | ${pct(r.skipRate)} |`
  );
}

// Current config result
const currentConfig = sweepA.find(s => s.delta === 0.10 && s.cycle === 30 && s.skip === 1.1 && s.lookback === 45);
if (currentConfig) {
  const rank = sweepA.indexOf(currentConfig) + 1;
  console.log(`\n### Current Config Rank: ${rank}/${sweepA.length}`);
  const r = currentConfig.result;
  console.log(`Sharpe=${fmt(r.sharpe, 3)}, APR=${fmt(r.apr)}%, MaxDD=${pct(r.maxDrawdown)}, PutSells=${r.putSells}, Skip=${pct(r.skipRate)}\n`);
}

// Parameter marginal analysis
console.log("### Marginal Effect: Mean Sharpe by Parameter Value\n");

console.log("**Delta:**");
for (const d of DELTAS) {
  const subset = sweepA.filter(s => s.delta === d);
  const meanSharpe = subset.reduce((a, s) => a + s.result.sharpe, 0) / subset.length;
  const meanAPR = subset.reduce((a, s) => a + s.result.apr, 0) / subset.length;
  const meanPuts = subset.reduce((a, s) => a + s.result.putSells, 0) / subset.length;
  console.log(`  δ=${d}: mean Sharpe=${fmt(meanSharpe, 3)}, mean APR=${fmt(meanAPR)}%, mean PutSells=${fmt(meanPuts, 1)}`);
}

console.log("\n**Cycle Length:**");
for (const c of CYCLES) {
  const subset = sweepA.filter(s => s.cycle === c);
  const meanSharpe = subset.reduce((a, s) => a + s.result.sharpe, 0) / subset.length;
  const meanAPR = subset.reduce((a, s) => a + s.result.apr, 0) / subset.length;
  const meanPuts = subset.reduce((a, s) => a + s.result.putSells, 0) / subset.length;
  console.log(`  cycle=${c}d: mean Sharpe=${fmt(meanSharpe, 3)}, mean APR=${fmt(meanAPR)}%, mean PutSells=${fmt(meanPuts, 1)}`);
}

console.log("\n**Skip Threshold:**");
for (const sk of SKIPS) {
  const subset = sweepA.filter(s => s.skip === sk);
  const meanSharpe = subset.reduce((a, s) => a + s.result.sharpe, 0) / subset.length;
  const meanAPR = subset.reduce((a, s) => a + s.result.apr, 0) / subset.length;
  const meanSkip = subset.reduce((a, s) => a + s.result.skipRate, 0) / subset.length;
  console.log(`  skip=${sk}: mean Sharpe=${fmt(meanSharpe, 3)}, mean APR=${fmt(meanAPR)}%, mean SkipRate=${pct(meanSkip)}`);
}

console.log("\n**Lookback:**");
for (const lb of LOOKBACKS) {
  const subset = sweepA.filter(s => s.lookback === lb);
  const meanSharpe = subset.reduce((a, s) => a + s.result.sharpe, 0) / subset.length;
  const meanAPR = subset.reduce((a, s) => a + s.result.apr, 0) / subset.length;
  console.log(`  lb=${lb}d: mean Sharpe=${fmt(meanSharpe, 3)}, mean APR=${fmt(meanAPR)}%`);
}

// Trade frequency vs Sharpe
console.log("\n### Trade Frequency vs Sharpe (bins)\n");
const bins = [0, 5, 10, 15, 20, 30, 50, 100, 200, 500];
for (let i = 0; i < bins.length - 1; i++) {
  const lo = bins[i], hi = bins[i + 1];
  const subset = sweepA.filter(s => s.result.putSells >= lo && s.result.putSells < hi);
  if (subset.length === 0) continue;
  const meanSharpe = subset.reduce((a, s) => a + s.result.sharpe, 0) / subset.length;
  const meanAPR = subset.reduce((a, s) => a + s.result.apr, 0) / subset.length;
  const meanDD = subset.reduce((a, s) => a + s.result.maxDrawdown, 0) / subset.length;
  console.log(`  ${lo}–${hi} puts (n=${subset.length}): mean Sharpe=${fmt(meanSharpe, 3)}, APR=${fmt(meanAPR)}%, MaxDD=${pct(meanDD)}`);
}

// ═══════════════════════════════════════════════════════════════════
// SUB-EXPERIMENT B: Feature Ablation
// ═══════════════════════════════════════════════════════════════════

console.log("\n═══════════════════════════════════════════════════════════════");
console.log("SUB-EXPERIMENT B: Feature Ablation (top 5 configs)");
console.log("═══════════════════════════════════════════════════════════════\n");

const FEATURE_SETS: { name: string; ac: boolean; pr: boolean; rf: boolean }[] = [
  { name: "None",       ac: false, pr: false, rf: false },
  { name: "RF only",    ac: false, pr: false, rf: true },
  { name: "RF+AC",      ac: true,  pr: false, rf: true },
  { name: "RF+PR",      ac: false, pr: true,  rf: true },
  { name: "RF+AC+PR",   ac: true,  pr: true,  rf: true },
];

const top5A = sweepA.slice(0, 5);

console.log("| Config | Features | Sharpe | Sortino | APR% | MaxDD | PutSells | Skip% | Rolls |");
console.log("|--------|----------|--------|---------|------|-------|----------|-------|-------|");

for (const top of top5A) {
  for (const fs of FEATURE_SETS) {
    const config = makeConservativeConfig(top.delta, top.cycle, top.skip, top.lookback, fs);
    const result = runBacktest(config, FULL_PERIOD);
    const label = `δ${top.delta}/c${top.cycle}/s${top.skip}/lb${top.lookback}`;
    console.log(
      `| ${label} | ${fs.name} | ${fmt(result.sharpe, 3)} | ${fmt(result.sortino, 3)} | ${fmt(result.apr)} | ${pct(result.maxDrawdown)} | ${result.putSells} | ${pct(result.skipRate)} | ${result.putRolls} |`
    );
  }
}

// Feature ablation summary: average ΔSharpe vs RF+AC+PR across top 5
console.log("\n### Feature Ablation Summary: Mean ΔSharpe vs RF+AC+PR\n");
for (const fs of FEATURE_SETS) {
  const deltas: number[] = [];
  for (const top of top5A) {
    const configFull = makeConservativeConfig(top.delta, top.cycle, top.skip, top.lookback, { ac: true, pr: true, rf: true });
    const configTest = makeConservativeConfig(top.delta, top.cycle, top.skip, top.lookback, fs);
    const fullResult = runBacktest(configFull, FULL_PERIOD);
    const testResult = runBacktest(configTest, FULL_PERIOD);
    deltas.push(testResult.sharpe - fullResult.sharpe);
  }
  const meanDelta = deltas.reduce((a, b) => a + b, 0) / deltas.length;
  console.log(`  ${fs.name}: mean ΔSharpe = ${meanDelta >= 0 ? "+" : ""}${fmt(meanDelta, 3)}`);
}

// ═══════════════════════════════════════════════════════════════════
// SUB-EXPERIMENT C: Wider Delta Exploration
// ═══════════════════════════════════════════════════════════════════

console.log("\n═══════════════════════════════════════════════════════════════");
console.log("SUB-EXPERIMENT C: Wider Delta Exploration");
console.log("═══════════════════════════════════════════════════════════════\n");

const bestA = sweepA[0];
const WIDE_DELTAS = [0.03, 0.05, 0.08, 0.10, 0.12, 0.15, 0.20];

console.log(`Using best params from A: cycle=${bestA.cycle}, skip=${bestA.skip}, lb=${bestA.lookback}\n`);
console.log("| δ | Sharpe | Sortino | APR% | MaxDD | PutSells | Cycles | Skip% | Rolls | Alpha |");
console.log("|-----|--------|---------|------|-------|----------|--------|-------|-------|-------|");

for (const delta of WIDE_DELTAS) {
  const config = makeConservativeConfig(delta, bestA.cycle, bestA.skip, bestA.lookback, { ac: true, pr: true, rf: true });
  const result = runBacktest(config, FULL_PERIOD);
  console.log(
    `| ${delta} | ${fmt(result.sharpe, 3)} | ${fmt(result.sortino, 3)} | ${fmt(result.apr)} | ${pct(result.maxDrawdown)} | ${result.putSells} | ${result.fullCycles} | ${pct(result.skipRate)} | ${result.putRolls} | ${fmt(result.alpha)} |`
  );
}

// ═══════════════════════════════════════════════════════════════════
// SUB-PERIOD STABILITY: Top 3 configs
// ═══════════════════════════════════════════════════════════════════

console.log("\n═══════════════════════════════════════════════════════════════");
console.log("SUB-PERIOD STABILITY: Top 3 configs across market regimes");
console.log("═══════════════════════════════════════════════════════════════\n");

const top3 = sweepA.slice(0, 3);

for (const top of top3) {
  const label = `δ${top.delta}/c${top.cycle}/s${top.skip}/lb${top.lookback}`;
  console.log(`### ${label}\n`);
  console.log("| Period | Days | ETH Ret | Sharpe | APR% | MaxDD | PutSells | Skip% | Alpha |");
  console.log("|--------|------|---------|--------|------|-------|----------|-------|-------|");

  // Full period first
  const fullConfig = makeConservativeConfig(top.delta, top.cycle, top.skip, top.lookback, { ac: true, pr: true, rf: true });
  const fullResult = runBacktest(fullConfig, FULL_PERIOD);
  const fullSlice = slicePeriod(aligned, FULL_PERIOD.startDate, FULL_PERIOD.endDate);
  const fullRet = (fullSlice[fullSlice.length - 1].price - fullSlice[0].price) / fullSlice[0].price;
  console.log(
    `| Full | ${fullSlice.length - 1} | ${pct(fullRet)} | ${fmt(fullResult.sharpe, 3)} | ${fmt(fullResult.apr)} | ${pct(fullResult.maxDrawdown)} | ${fullResult.putSells} | ${pct(fullResult.skipRate)} | ${fmt(fullResult.alpha)} |`
  );

  for (const period of SUB_PERIODS) {
    const config = makeConservativeConfig(top.delta, top.cycle, top.skip, top.lookback, { ac: true, pr: true, rf: true });
    const result = runBacktest(config, period);
    const slice = slicePeriod(aligned, period.startDate, period.endDate);
    const ethRet = (slice[slice.length - 1].price - slice[0].price) / slice[0].price;
    console.log(
      `| ${period.name} | ${slice.length - 1} | ${pct(ethRet)} | ${fmt(result.sharpe, 3)} | ${fmt(result.apr)} | ${pct(result.maxDrawdown)} | ${result.putSells} | ${pct(result.skipRate)} | ${fmt(result.alpha)} |`
    );
  }
  console.log();
}

// ═══════════════════════════════════════════════════════════════════
// COMPARISON: Best found vs current (Exp 18) config
// ═══════════════════════════════════════════════════════════════════

console.log("═══════════════════════════════════════════════════════════════");
console.log("COMPARISON: Best Found vs Current (Exp 18) Conservative");
console.log("═══════════════════════════════════════════════════════════════\n");

const best = sweepA[0];
const currentIdx = sweepA.findIndex(s => s.delta === 0.10 && s.cycle === 30 && s.skip === 1.1 && s.lookback === 45);
const current = currentIdx >= 0 ? sweepA[currentIdx] : null;

console.log("| Metric | Best Found | Current (δ0.10/c30/s1.1/lb45) | Δ |");
console.log("|--------|-----------|-------------------------------|---|");

if (current) {
  const b = best.result;
  const c = current.result;
  console.log(`| Config | δ${best.delta}/c${best.cycle}/s${best.skip}/lb${best.lookback} | δ0.10/c30/s1.1/lb45 | — |`);
  console.log(`| Sharpe | ${fmt(b.sharpe, 3)} | ${fmt(c.sharpe, 3)} | ${fmt(b.sharpe - c.sharpe, 3)} |`);
  console.log(`| Sortino | ${fmt(b.sortino, 3)} | ${fmt(c.sortino, 3)} | ${fmt(b.sortino - c.sortino, 3)} |`);
  console.log(`| APR% | ${fmt(b.apr)} | ${fmt(c.apr)} | ${fmt(b.apr - c.apr)} |`);
  console.log(`| MaxDD | ${pct(b.maxDrawdown)} | ${pct(c.maxDrawdown)} | ${pct(b.maxDrawdown - c.maxDrawdown)} |`);
  console.log(`| Put Sells | ${b.putSells} | ${c.putSells} | ${b.putSells - c.putSells} |`);
  console.log(`| Assignments | ${b.assignments} | ${c.assignments} | ${b.assignments - c.assignments} |`);
  console.log(`| Full Cycles | ${b.fullCycles} | ${c.fullCycles} | ${b.fullCycles - c.fullCycles} |`);
  console.log(`| Skip Rate | ${pct(b.skipRate)} | ${pct(c.skipRate)} | ${pct(b.skipRate - c.skipRate)} |`);
  console.log(`| Put Rolls | ${b.putRolls} | ${c.putRolls} | ${b.putRolls - c.putRolls} |`);
  console.log(`| Alpha | ${fmt(b.alpha)} | ${fmt(c.alpha)} | ${fmt(b.alpha - c.alpha)} |`);
} else {
  console.log("Current config not found in sweep (unexpected).");
}

const totalElapsed = ((performance.now() - t0) / 1000).toFixed(2);
console.log(`\n---\nTotal execution: ${totalElapsed}s`);
