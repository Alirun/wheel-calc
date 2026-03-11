// Experiment 22: Cold-Start Sizing Cap
// Goal: Reduce Conservative's window-1 MaxDD from 71.7% to <45% using a cold-start
// sizing cap that limits exposure before vol-scaling has accumulated enough data.
// Phase 1: Rolling window backtest with cold-start variants (step & ramp).
// No MC needed — the effect is about the first N days of each window.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { simulate } from "../../src/components/strategy/simulate.ts";
import { defaultRules } from "../../src/components/strategy/rules.ts";
import { summarizeRun } from "../../src/components/monte-carlo.ts";
import type { StrategyConfig, PositionSizingConfig } from "../../src/components/strategy/types.ts";

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

const COLD_START_DAYS = [30, 45, 60, 90];
const COLD_START_SIZES = [0.10, 0.25, 0.50, 0.75];

const SIZING_VARIANTS: SizingVariant[] = [
  // 1. Baseline: no sizing at all
  { name: "Baseline", sizing: undefined },

  // 2. VS-40/45 only (Exp 21 winner, no cold-start cap)
  { name: "VS-40/45", sizing: { mode: "volScaled", volTarget: 0.40, volLookbackDays: 45, minSize: 0.10 } },
];

// 3. Cold-start cap WITH VS-40/45
for (const csDays of COLD_START_DAYS) {
  for (const csSize of COLD_START_SIZES) {
    SIZING_VARIANTS.push({
      name: `VS+CS-${csSize*100}/${csDays}`,
      sizing: {
        mode: "volScaled", volTarget: 0.40, volLookbackDays: 45, minSize: 0.10,
        coldStartDays: csDays, coldStartSize: csSize,
      },
    });
  }
}

// 4. Cold-start cap STANDALONE (no vol-scaling — full size after ramp)
//    Implemented as volScaled with volTarget=999 so it always returns 1.0,
//    and coldStart provides the cap during early days.
for (const csDays of COLD_START_DAYS) {
  for (const csSize of COLD_START_SIZES) {
    SIZING_VARIANTS.push({
      name: `CS-only-${csSize*100}/${csDays}`,
      sizing: {
        mode: "volScaled", volTarget: 9.99, volLookbackDays: 45, minSize: 0.10,
        coldStartDays: csDays, coldStartSize: csSize,
      },
    });
  }
}

console.log(`Total sizing variants: ${SIZING_VARIANTS.length}\n`);

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
console.log("PHASE 1: Rolling Window Cold-Start Sizing Sweep");
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
console.log(`Phase 1: ${allResults.length} backtests (${STRATEGIES.length} strategies × ${SIZING_VARIANTS.length} sizing × ${windows.length} windows) in ${elapsed1}s\n`);

// ─── Analysis per strategy ───

for (const strategy of STRATEGIES) {
  console.log(`\n${"═".repeat(70)}`);
  console.log(`STRATEGY: ${strategy.name}`);
  console.log(`${"═".repeat(70)}\n`);

  const stratResults = allResults.filter(r => r.strategy === strategy.name);

  // Baseline stats
  const baselineResults = stratResults.filter(r => r.sizingName === "Baseline");
  const baselineSharpes = baselineResults.map(r => r.sharpe);
  const baselineMaxDDs = baselineResults.map(r => r.maxDrawdown);
  const baseStats = {
    sharpe: stats(baselineSharpes),
    maxDD: stats(baselineMaxDDs),
  };

  // VS-40/45 stats (Exp 21 reference)
  const vsResults = stratResults.filter(r => r.sizingName === "VS-40/45");
  const vsStats = {
    sharpe: stats(vsResults.map(r => r.sharpe)),
    maxDD: stats(vsResults.map(r => r.maxDrawdown)),
  };

  console.log(`Baseline:  Mean Sharpe ${fmt(baseStats.sharpe.mean, 3)}, Mean MaxDD ${pct(baseStats.maxDD.mean)}, Max MaxDD ${pct(baseStats.maxDD.max)}`);
  console.log(`VS-40/45:  Mean Sharpe ${fmt(vsStats.sharpe.mean, 3)}, Mean MaxDD ${pct(vsStats.maxDD.mean)}, Max MaxDD ${pct(vsStats.maxDD.max)}\n`);

  // ─── Analysis A: All variants ranked ───

  interface SizingSummary {
    name: string;
    meanSharpe: number;
    meanMaxDD: number;
    maxMaxDD: number;
    meanAPR: number;
    negSharpeRate: number;
    dSharpe: number;
    dMaxDD: number;
    dMaxMaxDD: number;
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
      meanMaxDD: sStats.maxDD.mean,
      maxMaxDD: sStats.maxDD.max,
      meanAPR: sStats.apr.mean,
      negSharpeRate: negCount / sharpes.length,
      dSharpe: sStats.sharpe.mean - baseStats.sharpe.mean,
      dMaxDD: sStats.maxDD.mean - baseStats.maxDD.mean,
      dMaxMaxDD: sStats.maxDD.max - baseStats.maxDD.max,
      sharpePreservation: baseStats.sharpe.mean !== 0
        ? sStats.sharpe.mean / baseStats.sharpe.mean
        : 1,
    });
  }

  // Sort by max MaxDD (primary goal: reduce worst-case)
  const ranked = [...summaries].sort((a, b) => a.maxMaxDD - b.maxMaxDD);

  console.log("### A. All Variants Ranked by Max MaxDD (worst-case reduction)\n");
  console.log("| Rank | Sizing | Mean Sharpe | ΔSharpe | Sharpe% | Mean MaxDD | Max MaxDD | ΔMax MaxDD | Mean APR | Neg% |");
  console.log("|------|--------|-------------|---------|---------|------------|-----------|------------|----------|------|");
  ranked.forEach((s, i) => {
    console.log(`| ${i + 1} | ${s.name} | ${fmt(s.meanSharpe, 3)} | ${fmt(s.dSharpe, 3)} | ${pct(s.sharpePreservation)} | ${pct(s.meanMaxDD)} | ${pct(s.maxMaxDD)} | ${pct(s.dMaxMaxDD)} | ${fmt(s.meanAPR, 1)}% | ${pct(s.negSharpeRate)} |`);
  });

  // ─── Analysis B: Filter to configs meeting target ───

  const TARGET_MAX_DD = 0.45;
  const MIN_SHARPE_PCT = 0.90;
  const candidates = ranked.filter(s =>
    s.maxMaxDD < TARGET_MAX_DD && s.sharpePreservation >= MIN_SHARPE_PCT
  );

  console.log(`\n### B. Configs Meeting Target (Max MaxDD < ${pct(TARGET_MAX_DD, 0)}, Sharpe ≥ ${pct(MIN_SHARPE_PCT, 0)} of baseline)\n`);
  if (candidates.length === 0) {
    console.log("**No configs meet both targets simultaneously.**\n");

    // Relax: show best on each dimension
    const bestDD = ranked[0];
    const bestSharpe = [...summaries].sort((a, b) => b.meanSharpe - a.meanSharpe)[0];
    console.log(`Best max MaxDD: ${bestDD.name} → ${pct(bestDD.maxMaxDD)} (Sharpe ${fmt(bestDD.meanSharpe, 3)}, ${pct(bestDD.sharpePreservation)} preserved)`);
    console.log(`Best mean Sharpe: ${bestSharpe.name} → ${fmt(bestSharpe.meanSharpe, 3)} (max MaxDD ${pct(bestSharpe.maxMaxDD)})`);

    // Show Pareto front
    console.log("\n**Pareto front (max MaxDD vs Sharpe):**\n");
    console.log("| Sizing | Max MaxDD | Mean Sharpe | Sharpe% | Mean APR |");
    console.log("|--------|-----------|-------------|---------|----------|");
    let bestSharpeSeenOnPareto = -Infinity;
    for (const s of ranked) {
      if (s.meanSharpe > bestSharpeSeenOnPareto) {
        bestSharpeSeenOnPareto = s.meanSharpe;
        console.log(`| ${s.name} | ${pct(s.maxMaxDD)} | ${fmt(s.meanSharpe, 3)} | ${pct(s.sharpePreservation)} | ${fmt(s.meanAPR, 1)}% |`);
      }
    }
  } else {
    console.log("| Rank | Sizing | Mean Sharpe | Sharpe% | Mean MaxDD | Max MaxDD | Mean APR |");
    console.log("|------|--------|-------------|---------|------------|-----------|----------|");
    candidates.forEach((s, i) => {
      console.log(`| ${i + 1} | ${s.name} | ${fmt(s.meanSharpe, 3)} | ${pct(s.sharpePreservation)} | ${pct(s.meanMaxDD)} | ${pct(s.maxMaxDD)} | ${fmt(s.meanAPR, 1)}% |`);
    });
  }

  // ─── Analysis C: VS+CS vs CS-only comparison ───

  console.log("\n### C. VS+CS vs CS-only (Does vol-scaling add value on top of cold-start?)\n");
  console.log("| Days | Size | VS+CS MaxMaxDD | CS-only MaxMaxDD | VS+CS Sharpe | CS-only Sharpe | VS+CS wins? |");
  console.log("|------|------|----------------|------------------|--------------|----------------|-------------|");

  for (const csDays of COLD_START_DAYS) {
    for (const csSize of COLD_START_SIZES) {
      const vscsName = `VS+CS-${csSize*100}/${csDays}`;
      const csName = `CS-only-${csSize*100}/${csDays}`;
      const vscs = summaries.find(s => s.name === vscsName);
      const cs = summaries.find(s => s.name === csName);
      if (!vscs || !cs) continue;
      const vscsWins = vscs.maxMaxDD < cs.maxMaxDD || (vscs.maxMaxDD === cs.maxMaxDD && vscs.meanSharpe > cs.meanSharpe);
      console.log(`| ${csDays} | ${pct(csSize, 0)} | ${pct(vscs.maxMaxDD)} | ${pct(cs.maxMaxDD)} | ${fmt(vscs.meanSharpe, 3)} | ${fmt(cs.meanSharpe, 3)} | ${vscsWins ? "✓" : "✗"} |`);
    }
  }

  // ─── Analysis D: Window-by-window for top 3 configs ───

  const top3 = ranked.filter(s => s.name !== "Baseline").slice(0, 3);

  console.log(`\n### D. Window-by-Window Detail: Top 3 vs Baseline\n`);

  for (const topConfig of top3) {
    console.log(`\n**${topConfig.name}** (Max MaxDD ${pct(topConfig.maxMaxDD)}, Mean Sharpe ${fmt(topConfig.meanSharpe, 3)}):\n`);
    console.log("| Window | Start | End | Base Sharpe | Sized Sharpe | Base MaxDD | Sized MaxDD | ΔMaxDD |");
    console.log("|--------|-------|-----|-------------|--------------|------------|-------------|--------|");

    let winsDD = 0;
    let winsSharpe = 0;
    for (const w of windows) {
      const bw = baselineResults.find(r => r.windowId === w.id)!;
      const sw = stratResults.find(r => r.sizingName === topConfig.name && r.windowId === w.id)!;
      const dDD = sw.maxDrawdown - bw.maxDrawdown;
      if (dDD < -0.001) winsDD++;
      if (sw.sharpe > bw.sharpe + 0.001) winsSharpe++;
      console.log(`| ${w.id} | ${w.startDate} | ${w.endDate} | ${fmt(bw.sharpe, 3)} | ${fmt(sw.sharpe, 3)} | ${pct(bw.maxDrawdown)} | ${pct(sw.maxDrawdown)} | ${pct(dDD)} |`);
    }
    console.log(`\nMaxDD wins: ${winsDD}/${windows.length}. Sharpe wins: ${winsSharpe}/${windows.length}.`);
  }

  // ─── Analysis E: coldStartDays sensitivity (fixed csSize=0.50, VS+CS) ───

  console.log("\n### E. Cold-Start Days Sensitivity (fixed coldStartSize=0.50, VS+CS)\n");
  console.log("| Days | Max MaxDD | Mean MaxDD | Mean Sharpe | ΔSharpe vs VS-40/45 |");
  console.log("|------|-----------|------------|-------------|---------------------|");

  for (const csDays of COLD_START_DAYS) {
    const name = `VS+CS-50/${csDays}`;
    const s = summaries.find(x => x.name === name);
    if (!s) continue;
    const dSVsVS = s.meanSharpe - vsStats.sharpe.mean;
    console.log(`| ${csDays} | ${pct(s.maxMaxDD)} | ${pct(s.meanMaxDD)} | ${fmt(s.meanSharpe, 3)} | ${fmt(dSVsVS, 3)} |`);
  }

  // ─── Analysis F: coldStartSize sensitivity (fixed csDays=45, VS+CS) ───

  console.log("\n### F. Cold-Start Size Sensitivity (fixed coldStartDays=45, VS+CS)\n");
  console.log("| Size | Max MaxDD | Mean MaxDD | Mean Sharpe | ΔSharpe vs VS-40/45 |");
  console.log("|------|-----------|------------|-------------|---------------------|");

  for (const csSize of COLD_START_SIZES) {
    const name = `VS+CS-${csSize*100}/45`;
    const s = summaries.find(x => x.name === name);
    if (!s) continue;
    const dSVsVS = s.meanSharpe - vsStats.sharpe.mean;
    console.log(`| ${pct(csSize, 0)} | ${pct(s.maxMaxDD)} | ${pct(s.meanMaxDD)} | ${fmt(s.meanSharpe, 3)} | ${fmt(dSVsVS, 3)} |`);
  }
}

// ─── Full-period backtest with best config ───

console.log(`\n${"═".repeat(70)}`);
console.log("FULL-PERIOD VALIDATION");
console.log(`${"═".repeat(70)}\n`);

const fullPrices = aligned.map(d => d.price);
const fullIV = aligned.map(d => d.iv);
const fullYears = aligned.length / 365;

for (const strategy of STRATEGIES) {
  console.log(`\n### ${strategy.name}\n`);
  console.log("| Config | Sharpe | APR | MaxDD | PutSells | Assignments | Skips |");
  console.log("|--------|--------|-----|-------|----------|-------------|-------|");

  const configs: { name: string; cfg: StrategyConfig }[] = [
    { name: "Baseline", cfg: strategy.config },
    { name: "VS-40/45", cfg: { ...strategy.config, positionSizing: { mode: "volScaled", volTarget: 0.40, volLookbackDays: 45, minSize: 0.10 } } },
    { name: "VS+CS-50/45", cfg: { ...strategy.config, positionSizing: { mode: "volScaled", volTarget: 0.40, volLookbackDays: 45, minSize: 0.10, coldStartDays: 45, coldStartSize: 0.50 } } },
    { name: "VS+CS-25/45", cfg: { ...strategy.config, positionSizing: { mode: "volScaled", volTarget: 0.40, volLookbackDays: 45, minSize: 0.10, coldStartDays: 45, coldStartSize: 0.25 } } },
    { name: "VS+CS-50/60", cfg: { ...strategy.config, positionSizing: { mode: "volScaled", volTarget: 0.40, volLookbackDays: 45, minSize: 0.10, coldStartDays: 60, coldStartSize: 0.50 } } },
    { name: "CS-only-50/45", cfg: { ...strategy.config, positionSizing: { mode: "volScaled", volTarget: 9.99, volLookbackDays: 45, minSize: 0.10, coldStartDays: 45, coldStartSize: 0.50 } } },
  ];

  for (const { name, cfg } of configs) {
    const rules = defaultRules();
    const result = simulate(fullPrices, rules, cfg, fullIV);
    const capitalAtRisk = fullPrices[0] * cfg.contracts;
    const summary = summarizeRun(0, result, fullPrices, capitalAtRisk, fullYears, cfg.riskFreeRate, cfg.contracts);
    const putSells = result.signalLog.filter(e => e.signal.action === "SELL_PUT").length;
    console.log(`| ${name} | ${fmt(summary.sharpe, 3)} | ${fmt(summary.apr, 1)}% | ${pct(summary.maxDrawdown)} | ${putSells} | ${summary.assignments} | ${summary.skippedCycles} |`);
  }
}

const totalElapsed = ((performance.now() - t0) / 1000).toFixed(2);
console.log(`\nTotal execution time: ${totalElapsed}s`);
