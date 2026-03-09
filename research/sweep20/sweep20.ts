// Experiment 20: Rolling Window Backtest
// Runs 1-year rolling windows (stride 90d) across 5yr historical ETH data.
// Produces distributions of Sharpe/APR/MaxDD per strategy, addressing the N=1
// limitation from Experiments 18–19.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { simulate } from "../../src/components/strategy/simulate.ts";
import { defaultRules } from "../../src/components/strategy/rules.ts";
import { summarizeRun } from "../../src/components/monte-carlo.ts";
import type { StrategyConfig } from "../../src/components/strategy/types.ts";

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
  const days = end - start;
  if (days < MIN_WINDOW) break;
  windows.push({
    id: ++wid,
    startIdx: start,
    endIdx: end,
    startDate: aligned[start].date,
    endDate: aligned[end].date,
    days,
  });
}

console.log(`Generated ${windows.length} windows (${WINDOW_DAYS}d, stride ${STRIDE_DAYS}d, min ${MIN_WINDOW}d)\n`);

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
    name: "Cons-Current",
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
    name: "Cons-Cand1",
    config: {
      ...BASE_CONFIG,
      targetDelta: 0.12,
      cycleLengthDays: 25,
      adaptiveCalls: { minDelta: 0.10, maxDelta: 0.50, skipThresholdPct: 0, minStrikeAtCost: true },
      ivRvSpread: { lookbackDays: 60, minMultiplier: 0.8, maxMultiplier: 1.3, skipBelowRatio: 1.15, skipSide: "put" },
      rollPut: { initialDTE: 25, rollWhenDTEBelow: 12, requireNetCredit: true },
    },
  },
  {
    name: "Cons-Cand2",
    config: {
      ...BASE_CONFIG,
      targetDelta: 0.15,
      cycleLengthDays: 25,
      adaptiveCalls: { minDelta: 0.10, maxDelta: 0.50, skipThresholdPct: 0, minStrikeAtCost: true },
      ivRvSpread: { lookbackDays: 60, minMultiplier: 0.8, maxMultiplier: 1.3, skipBelowRatio: 1.3, skipSide: "put" },
      rollPut: { initialDTE: 25, rollWhenDTEBelow: 12, requireNetCredit: true },
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

// ─── Backtest runner ───

interface WindowResult {
  strategy: string;
  windowId: number;
  startDate: string;
  endDate: string;
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
  isWin: boolean;
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
    isWin: summary.isWin,
    alpha: summary.apr - benchmarkAPR,
  };
}

// ─── Helpers ───

function fmt(n: number, dec = 2): string { return n.toFixed(dec); }
function pct(n: number, dec = 1): string { return (n * 100).toFixed(dec) + "%"; }

function stats(arr: number[]): { mean: number; median: number; std: number; min: number; max: number; p25: number; p75: number } {
  const sorted = [...arr].sort((a, b) => a - b);
  const n = sorted.length;
  const mean = arr.reduce((a, b) => a + b, 0) / n;
  const variance = arr.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1);
  return {
    mean,
    median: n % 2 === 1 ? sorted[Math.floor(n / 2)] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2,
    std: Math.sqrt(variance),
    min: sorted[0],
    max: sorted[n - 1],
    p25: sorted[Math.floor(n * 0.25)],
    p75: sorted[Math.floor(n * 0.75)],
  };
}

// ═══════════════════════════════════════════════════════════════════
// RUN ALL BACKTESTS
// ═══════════════════════════════════════════════════════════════════

console.log("Running rolling window backtests...\n");
const t0 = performance.now();

const allResults: WindowResult[] = [];
for (const strategy of STRATEGIES) {
  for (const window of windows) {
    allResults.push(runWindow(strategy, window));
  }
}

const elapsed = ((performance.now() - t0) / 1000).toFixed(2);
console.log(`Completed ${allResults.length} backtests (${STRATEGIES.length} strategies × ${windows.length} windows) in ${elapsed}s\n`);

// ─── Window overview ───

console.log("### Windows\n");
console.log("| # | Start | End | Days | Start$ | End$ | ETH Ret |");
console.log("|---|-------|-----|------|--------|------|---------|");
for (const w of windows) {
  const sp = aligned[w.startIdx].price;
  const ep = aligned[w.endIdx].price;
  const ret = (ep - sp) / sp;
  console.log(`| ${w.id} | ${w.startDate} | ${w.endDate} | ${w.days} | ${fmt(sp, 0)} | ${fmt(ep, 0)} | ${pct(ret)} |`);
}

// ═══════════════════════════════════════════════════════════════════
// ANALYSIS A: Distribution Statistics
// ═══════════════════════════════════════════════════════════════════

console.log("\n═══════════════════════════════════════════════════════════════");
console.log("ANALYSIS A: Distribution Statistics");
console.log("═══════════════════════════════════════════════════════════════\n");

for (const metric of ["sharpe", "apr", "maxDrawdown"] as const) {
  const label = metric === "sharpe" ? "Sharpe" : metric === "apr" ? "APR%" : "MaxDD";
  const isBad = metric === "maxDrawdown";

  console.log(`### ${label} Distribution\n`);
  console.log("| Strategy | Mean | Median | Std | Min | Max | P25 | P75 |");
  console.log("|----------|------|--------|-----|-----|-----|-----|-----|");

  for (const strategy of STRATEGIES) {
    const vals = allResults
      .filter(r => r.strategy === strategy.name)
      .map(r => r[metric]);
    const s = stats(vals);
    const f = metric === "maxDrawdown" ? (v: number) => pct(v) : (v: number) => fmt(v, 3);
    console.log(
      `| ${strategy.name} | ${f(s.mean)} | ${f(s.median)} | ${f(s.std)} | ${f(s.min)} | ${f(s.max)} | ${f(s.p25)} | ${f(s.p75)} |`
    );
  }
  console.log();
}

// ═══════════════════════════════════════════════════════════════════
// ANALYSIS B: Negative Sharpe Frequency
// ═══════════════════════════════════════════════════════════════════

console.log("═══════════════════════════════════════════════════════════════");
console.log("ANALYSIS B: Negative Sharpe Frequency & Win Rates");
console.log("═══════════════════════════════════════════════════════════════\n");

console.log("| Strategy | Windows | Sharpe>0 | Sharpe>0 % | Sharpe>0.3 | PL Win% | Mean PutSells | Mean Skip% |");
console.log("|----------|---------|----------|-----------|------------|---------|---------------|------------|");

for (const strategy of STRATEGIES) {
  const results = allResults.filter(r => r.strategy === strategy.name);
  const n = results.length;
  const pos = results.filter(r => r.sharpe > 0).length;
  const strong = results.filter(r => r.sharpe > 0.3).length;
  const wins = results.filter(r => r.isWin).length;
  const meanPuts = results.reduce((a, r) => a + r.putSells, 0) / n;
  const meanSkip = results.reduce((a, r) => a + r.skipRate, 0) / n;
  console.log(
    `| ${strategy.name} | ${n} | ${pos} | ${pct(pos / n)} | ${strong} | ${pct(wins / n)} | ${fmt(meanPuts, 1)} | ${pct(meanSkip)} |`
  );
}

// ═══════════════════════════════════════════════════════════════════
// ANALYSIS C: Paired Parameter Comparison
// ═══════════════════════════════════════════════════════════════════

console.log("\n═══════════════════════════════════════════════════════════════");
console.log("ANALYSIS C: Paired Window-by-Window Comparison");
console.log("═══════════════════════════════════════════════════════════════\n");

function pairedComparison(nameA: string, nameB: string): void {
  const resA = allResults.filter(r => r.strategy === nameA);
  const resB = allResults.filter(r => r.strategy === nameB);

  const diffs: number[] = [];
  let aWins = 0;
  let bWins = 0;

  console.log(`### ${nameA} vs ${nameB}\n`);
  console.log("| Window | Start | ETH Ret | ${nameA} | ${nameB} | Δ Sharpe | Winner |");
  console.log("|--------|-------|---------|---------|---------|----------|--------|");

  for (let i = 0; i < resA.length; i++) {
    const a = resA[i];
    const b = resB[i];
    const diff = a.sharpe - b.sharpe;
    diffs.push(diff);
    const winner = diff > 0.01 ? nameA : diff < -0.01 ? nameB : "Tie";
    if (diff > 0.01) aWins++;
    if (diff < -0.01) bWins++;
    console.log(
      `| ${a.windowId} | ${a.startDate} | ${pct(a.underlyingReturn)} | ${fmt(a.sharpe, 3)} | ${fmt(b.sharpe, 3)} | ${diff >= 0 ? "+" : ""}${fmt(diff, 3)} | ${winner} |`
    );
  }

  const meanDiff = diffs.reduce((a, b) => a + b, 0) / diffs.length;
  const stdDiff = Math.sqrt(diffs.reduce((s, d) => s + (d - meanDiff) ** 2, 0) / (diffs.length - 1));
  const tStat = meanDiff / (stdDiff / Math.sqrt(diffs.length));

  console.log(`\n**Summary:** ${nameA} wins ${aWins}/${resA.length}, ${nameB} wins ${bWins}/${resA.length}, Ties ${resA.length - aWins - bWins}`);
  console.log(`Mean ΔSharpe: ${meanDiff >= 0 ? "+" : ""}${fmt(meanDiff, 3)} ± ${fmt(stdDiff, 3)}, t-stat: ${fmt(tStat, 2)}`);
  console.log();
}

pairedComparison("Cons-Current", "Cons-Cand1");
pairedComparison("Cons-Current", "Cons-Cand2");
pairedComparison("Cons-Cand1", "Cons-Cand2");
pairedComparison("Cons-Current", "Active");
pairedComparison("Cons-Current", "Moderate");

// ═══════════════════════════════════════════════════════════════════
// ANALYSIS D: Walk-Forward Validation
// ═══════════════════════════════════════════════════════════════════

console.log("═══════════════════════════════════════════════════════════════");
console.log("ANALYSIS D: Walk-Forward (First Half vs Second Half)");
console.log("═══════════════════════════════════════════════════════════════\n");

const midWindow = Math.floor(windows.length / 2);

console.log("| Strategy | 1st Half Mean Sharpe | 2nd Half Mean Sharpe | Δ | Consistent? |");
console.log("|----------|---------------------|---------------------|---|-------------|");

for (const strategy of STRATEGIES) {
  const results = allResults.filter(r => r.strategy === strategy.name);
  const firstHalf = results.filter(r => r.windowId <= windows[midWindow - 1].id);
  const secondHalf = results.filter(r => r.windowId > windows[midWindow - 1].id);

  const meanFirst = firstHalf.reduce((a, r) => a + r.sharpe, 0) / firstHalf.length;
  const meanSecond = secondHalf.reduce((a, r) => a + r.sharpe, 0) / secondHalf.length;
  const delta = meanSecond - meanFirst;
  const signFirst = meanFirst > 0 ? "+" : "-";
  const signSecond = meanSecond > 0 ? "+" : "-";
  const consistent = signFirst === signSecond ? "Yes" : "NO";

  console.log(
    `| ${strategy.name} | ${fmt(meanFirst, 3)} (n=${firstHalf.length}) | ${fmt(meanSecond, 3)} (n=${secondHalf.length}) | ${delta >= 0 ? "+" : ""}${fmt(delta, 3)} | ${consistent} |`
  );
}

// ═══════════════════════════════════════════════════════════════════
// ANALYSIS E: Pairwise Strategy Dominance
// ═══════════════════════════════════════════════════════════════════

console.log("\n═══════════════════════════════════════════════════════════════");
console.log("ANALYSIS E: Per-Window Best Strategy");
console.log("═══════════════════════════════════════════════════════════════\n");

console.log("| Window | Start | ETH Ret | Best Strategy | Sharpe | 2nd Best | Sharpe |");
console.log("|--------|-------|---------|---------------|--------|----------|--------|");

const stratWins: Record<string, number> = {};
for (const s of STRATEGIES) stratWins[s.name] = 0;

for (const window of windows) {
  const wResults = allResults
    .filter(r => r.windowId === window.id)
    .sort((a, b) => b.sharpe - a.sharpe);

  const best = wResults[0];
  const second = wResults[1];
  stratWins[best.strategy]++;

  console.log(
    `| ${window.id} | ${window.startDate} | ${pct(best.underlyingReturn)} | ${best.strategy} | ${fmt(best.sharpe, 3)} | ${second.strategy} | ${fmt(second.sharpe, 3)} |`
  );
}

console.log("\n**Win counts:**");
for (const [name, count] of Object.entries(stratWins)) {
  console.log(`  ${name}: ${count}/${windows.length} (${pct(count / windows.length)})`);
}

// ═══════════════════════════════════════════════════════════════════
// ANALYSIS F: Structural Break / Sharpe Over Time
// ═══════════════════════════════════════════════════════════════════

console.log("\n═══════════════════════════════════════════════════════════════");
console.log("ANALYSIS F: Sharpe Over Time (Structural Break Detection)");
console.log("═══════════════════════════════════════════════════════════════\n");

console.log("| Window | Start | " + STRATEGIES.map(s => s.name).join(" | ") + " |");
console.log("|--------|-------|-" + STRATEGIES.map(() => "------").join("-|-") + "-|");

for (const window of windows) {
  const row = STRATEGIES.map(s => {
    const r = allResults.find(r => r.strategy === s.name && r.windowId === window.id)!;
    return fmt(r.sharpe, 3);
  });
  const ethRet = allResults.find(r => r.windowId === window.id)!;
  console.log(`| ${window.id} | ${window.startDate} | ${row.join(" | ")} |`);
}

// Correlation of Sharpe with window start index
console.log("\n### Sharpe vs Time Correlation (Spearman rank)\n");
for (const strategy of STRATEGIES) {
  const results = allResults.filter(r => r.strategy === strategy.name);
  const n = results.length;

  const sharpes = results.map(r => r.sharpe);
  const indices = results.map((_, i) => i);

  const rankArr = (arr: number[]) => {
    const sorted = arr.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
    const ranks = new Array(arr.length);
    sorted.forEach((s, rank) => { ranks[s.i] = rank + 1; });
    return ranks;
  };

  const rSharpe = rankArr(sharpes);
  const rIndex = rankArr(indices);
  const meanRS = rSharpe.reduce((a, b) => a + b, 0) / n;
  const meanRI = rIndex.reduce((a, b) => a + b, 0) / n;
  let num = 0, denS = 0, denI = 0;
  for (let i = 0; i < n; i++) {
    num += (rSharpe[i] - meanRS) * (rIndex[i] - meanRI);
    denS += (rSharpe[i] - meanRS) ** 2;
    denI += (rIndex[i] - meanRI) ** 2;
  }
  const spearman = denS > 0 && denI > 0 ? num / Math.sqrt(denS * denI) : 0;
  const trend = spearman > 0.3 ? "Improving" : spearman < -0.3 ? "Degrading" : "Stable";
  console.log(`  ${strategy.name}: ρ = ${fmt(spearman, 3)} → ${trend}`);
}

// ═══════════════════════════════════════════════════════════════════
// ANALYSIS G: Per-Window Detail Table
// ═══════════════════════════════════════════════════════════════════

console.log("\n═══════════════════════════════════════════════════════════════");
console.log("ANALYSIS G: Full Per-Window Detail (Conservative Current)");
console.log("═══════════════════════════════════════════════════════════════\n");

console.log("| Window | Start | End | ETH Ret | Sharpe | APR% | MaxDD | PutSells | Assign | Cycles | Skip% | Alpha |");
console.log("|--------|-------|-----|---------|--------|------|-------|----------|--------|--------|-------|-------|");

for (const r of allResults.filter(r => r.strategy === "Cons-Current")) {
  console.log(
    `| ${r.windowId} | ${r.startDate} | ${r.endDate} | ${pct(r.underlyingReturn)} | ${fmt(r.sharpe, 3)} | ${fmt(r.apr)} | ${pct(r.maxDrawdown)} | ${r.putSells} | ${r.assignments} | ${r.fullCycles} | ${pct(r.skipRate)} | ${fmt(r.alpha)} |`
  );
}

// ═══════════════════════════════════════════════════════════════════
// SUMMARY
// ═══════════════════════════════════════════════════════════════════

console.log("\n═══════════════════════════════════════════════════════════════");
console.log("SUMMARY");
console.log("═══════════════════════════════════════════════════════════════\n");

const totalElapsed = ((performance.now() - t0) / 1000).toFixed(2);

// Strategy rankings by mean Sharpe
const rankings = STRATEGIES.map(s => {
  const results = allResults.filter(r => r.strategy === s.name);
  const sharpes = results.map(r => r.sharpe);
  const s_ = stats(sharpes);
  const negPct = results.filter(r => r.sharpe < 0).length / results.length;
  return { name: s.name, ...s_, negPct };
}).sort((a, b) => b.mean - a.mean);

console.log("### Strategy Rankings by Mean Sharpe\n");
console.log("| Rank | Strategy | Mean Sharpe | Median | Std | Neg% | Min | Max |");
console.log("|------|----------|-------------|--------|-----|------|-----|-----|");
for (let i = 0; i < rankings.length; i++) {
  const r = rankings[i];
  console.log(
    `| ${i + 1} | ${r.name} | ${fmt(r.mean, 3)} | ${fmt(r.median, 3)} | ${fmt(r.std, 3)} | ${pct(r.negPct)} | ${fmt(r.min, 3)} | ${fmt(r.max, 3)} |`
  );
}

console.log(`\nTotal execution: ${totalElapsed}s`);
