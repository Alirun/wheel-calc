import {generatePrices} from "./price-gen.js";
import {simulate} from "./strategy/simulate.js";
import {defaultRules} from "./strategy/rules.js";
import type {StrategyConfig, SimulationResult, SignalLogEntry} from "./strategy/types.js";

export interface MarketParams {
  startPrice: number;
  days: number;
  annualVol: number;
  annualDrift: number;
}

export interface RunSummary {
  seed: number;
  totalPL: number;
  realizedPL: number;
  unrealizedPL: number;
  premiumCollected: number;
  assignments: number;
  fullCycles: number;
  apr: number;
  maxDrawdown: number;
  skippedCycles: number;
  isWin: boolean;
  benchmarkPL: number;
  benchmarkAPR: number;
  benchmarkMaxDD: number;
  sharpe: number;
  sortino: number;
  benchmarkSharpe: number;
  benchmarkSortino: number;
  regime: "bull" | "bear" | "sideways";
  underlyingReturn: number;
}

export interface RegimeBreakdown {
  regime: "bull" | "bear" | "sideways";
  count: number;
  meanAPR: number;
  meanBenchmarkAPR: number;
  meanAlpha: number;
  meanSharpe: number;
  winRate: number;
  meanMaxDrawdown: number;
}

export interface MonteCarloResult {
  runs: RunSummary[];
  winRate: number;
  meanAPR: number;
  medianAPR: number;
  p5APR: number;
  p25APR: number;
  p75APR: number;
  p95APR: number;
  meanPL: number;
  medianPL: number;
  meanMaxDrawdown: number;
  meanBenchmarkAPR: number;
  medianBenchmarkAPR: number;
  meanBenchmarkPL: number;
  meanBenchmarkMaxDD: number;
  meanSharpe: number;
  meanSortino: number;
  benchmarkMeanSharpe: number;
  benchmarkMeanSortino: number;
  regimeBreakdown: RegimeBreakdown[];
}

function percentile(sorted: number[], p: number): number {
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function median(sorted: number[]): number {
  return percentile(sorted, 50);
}

function computeMaxDrawdown(dailyStates: {cumulativePL: number; unrealizedPL: number}[]): number {
  let peak = -Infinity;
  let maxDD = 0;
  for (const d of dailyStates) {
    const totalPL = d.cumulativePL + d.unrealizedPL;
    if (totalPL > peak) peak = totalPL;
    const dd = peak - totalPL;
    if (dd > maxDD) maxDD = dd;
  }
  return maxDD;
}

export function computeBenchmarkMaxDD(prices: number[], contracts: number): number {
  let peak = -Infinity;
  let maxDD = 0;
  const p0 = prices[0];
  for (const p of prices) {
    const pl = (p - p0) * contracts;
    if (pl > peak) peak = pl;
    const dd = peak - pl;
    if (dd > maxDD) maxDD = dd;
  }
  return maxDD;
}

export function computeSharpe(dailyReturns: number[], rfDaily: number): number {
  if (dailyReturns.length < 2) return 0;
  const n = dailyReturns.length;
  const mean = dailyReturns.reduce((a, b) => a + b, 0) / n;
  const variance = dailyReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / (n - 1);
  const std = Math.sqrt(variance);
  if (std === 0) return 0;
  return ((mean - rfDaily) / std) * Math.sqrt(365);
}

export function computeSortino(dailyReturns: number[], rfDaily: number): number {
  if (dailyReturns.length < 2) return 0;
  const n = dailyReturns.length;
  const mean = dailyReturns.reduce((a, b) => a + b, 0) / n;
  const downsideVariance = dailyReturns.reduce((s, r) => {
    const diff = r - rfDaily;
    return diff < 0 ? s + diff ** 2 : s;
  }, 0) / (n - 1);
  const downsideStd = Math.sqrt(downsideVariance);
  if (downsideStd === 0) return 0;
  return ((mean - rfDaily) / downsideStd) * Math.sqrt(365);
}

export function classifyRegime(underlyingReturn: number, days: number): "bull" | "bear" | "sideways" {
  const annualizedReturn = underlyingReturn * (365 / days);
  if (annualizedReturn > 0.20) return "bull";
  if (annualizedReturn < -0.20) return "bear";
  return "sideways";
}

function countFullCycles(signalLog: SignalLogEntry[]): number {
  return signalLog.filter(
    (entry) => entry.events.some(
      (e) => e.type === "OPTION_EXPIRED" && e.optionType === "call" && e.assigned,
    ),
  ).length;
}

function summarizeRun(
  seed: number,
  result: SimulationResult,
  prices: number[],
  capitalAtRisk: number,
  yearsElapsed: number,
  rfAnnual: number,
  contracts: number,
): RunSummary {
  const lastDay = result.dailyStates[result.dailyStates.length - 1];
  const unrealizedPL = lastDay ? lastDay.unrealizedPL : 0;
  const totalPL = result.summary.totalRealizedPL + unrealizedPL;
  const apr = yearsElapsed > 0
    ? (result.summary.totalRealizedPL / capitalAtRisk) / yearsElapsed * 100
    : 0;
  const maxDrawdown = computeMaxDrawdown(result.dailyStates);

  const p0 = prices[0];
  const pN = prices[prices.length - 1];
  const benchmarkPL = (pN - p0) * contracts;
  const benchmarkAPR = yearsElapsed > 0
    ? (benchmarkPL / capitalAtRisk) / yearsElapsed * 100
    : 0;
  const benchmarkMaxDD = computeBenchmarkMaxDD(prices, contracts);

  const underlyingReturn = (pN - p0) / p0;
  const days = prices.length - 1;
  const regime = classifyRegime(underlyingReturn, days > 0 ? days : 1);

  const rfDaily = rfAnnual / 365;

  const wheelDailyReturns: number[] = [];
  for (let i = 1; i < result.dailyStates.length; i++) {
    const prev = result.dailyStates[i - 1];
    const curr = result.dailyStates[i];
    const prevTotal = prev.cumulativePL + prev.unrealizedPL;
    const currTotal = curr.cumulativePL + curr.unrealizedPL;
    wheelDailyReturns.push((currTotal - prevTotal) / capitalAtRisk);
  }

  const benchDailyReturns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    benchDailyReturns.push((prices[i] - prices[i - 1]) / p0);
  }

  const sharpe = computeSharpe(wheelDailyReturns, rfDaily);
  const sortino = computeSortino(wheelDailyReturns, rfDaily);
  const benchmarkSharpe = computeSharpe(benchDailyReturns, rfDaily);
  const benchmarkSortino = computeSortino(benchDailyReturns, rfDaily);

  return {
    seed,
    totalPL,
    realizedPL: result.summary.totalRealizedPL,
    unrealizedPL,
    premiumCollected: result.summary.totalPremiumCollected,
    assignments: result.summary.totalAssignments,
    fullCycles: countFullCycles(result.signalLog),
    apr,
    maxDrawdown,
    skippedCycles: result.summary.totalSkippedCycles,
    isWin: totalPL > 0,
    benchmarkPL,
    benchmarkAPR,
    benchmarkMaxDD,
    sharpe,
    sortino,
    benchmarkSharpe,
    benchmarkSortino,
    regime,
    underlyingReturn,
  };
}

export function runMonteCarlo(
  market: MarketParams,
  config: StrategyConfig,
  numRuns: number,
): MonteCarloResult {
  const capitalAtRisk = market.startPrice * config.contracts;
  const yearsElapsed = market.days / 365;
  const rfAnnual = config.riskFreeRate ?? 0;
  const rules = defaultRules();
  const runs: RunSummary[] = [];

  for (let seed = 1; seed <= numRuns; seed++) {
    const prices = generatePrices({
      startPrice: market.startPrice,
      days: market.days,
      annualVol: market.annualVol,
      annualDrift: market.annualDrift,
      seed,
    });

    const result = simulate(prices, rules, config);
    runs.push(summarizeRun(seed, result, prices, capitalAtRisk, yearsElapsed, rfAnnual, config.contracts));
  }

  const mean = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;

  const wins = runs.filter((r) => r.isWin).length;
  const aprs = runs.map((r) => r.apr).sort((a, b) => a - b);
  const pls = runs.map((r) => r.totalPL).sort((a, b) => a - b);
  const dds = runs.map((r) => r.maxDrawdown);
  const benchAprs = runs.map((r) => r.benchmarkAPR).sort((a, b) => a - b);
  const benchPLs = runs.map((r) => r.benchmarkPL);
  const benchDDs = runs.map((r) => r.benchmarkMaxDD);

  const regimeGroups: Record<string, RunSummary[]> = {bull: [], bear: [], sideways: []};
  for (const r of runs) regimeGroups[r.regime].push(r);

  const regimeBreakdown: RegimeBreakdown[] = (["bull", "bear", "sideways"] as const).map((regime) => {
    const group = regimeGroups[regime];
    if (group.length === 0) {
      return {regime, count: 0, meanAPR: 0, meanBenchmarkAPR: 0, meanAlpha: 0, meanSharpe: 0, winRate: 0, meanMaxDrawdown: 0};
    }
    return {
      regime,
      count: group.length,
      meanAPR: mean(group.map((r) => r.apr)),
      meanBenchmarkAPR: mean(group.map((r) => r.benchmarkAPR)),
      meanAlpha: mean(group.map((r) => r.apr - r.benchmarkAPR)),
      meanSharpe: mean(group.map((r) => r.sharpe)),
      winRate: group.filter((r) => r.isWin).length / group.length,
      meanMaxDrawdown: mean(group.map((r) => r.maxDrawdown)),
    };
  });

  return {
    runs,
    winRate: wins / runs.length,
    meanAPR: mean(aprs),
    medianAPR: median(aprs),
    p5APR: percentile(aprs, 5),
    p25APR: percentile(aprs, 25),
    p75APR: percentile(aprs, 75),
    p95APR: percentile(aprs, 95),
    meanPL: mean(pls),
    medianPL: median(pls),
    meanMaxDrawdown: mean(dds),
    meanBenchmarkAPR: mean(benchAprs),
    medianBenchmarkAPR: median(benchAprs),
    meanBenchmarkPL: mean(benchPLs),
    meanBenchmarkMaxDD: mean(benchDDs),
    meanSharpe: mean(runs.map((r) => r.sharpe)),
    meanSortino: mean(runs.map((r) => r.sortino)),
    benchmarkMeanSharpe: mean(runs.map((r) => r.benchmarkSharpe)),
    benchmarkMeanSortino: mean(runs.map((r) => r.benchmarkSortino)),
    regimeBreakdown,
  };
}

export function rerunSingle(
  market: MarketParams,
  config: StrategyConfig,
  seed: number,
): {prices: number[]; result: SimulationResult} {
  const prices = generatePrices({
    startPrice: market.startPrice,
    days: market.days,
    annualVol: market.annualVol,
    annualDrift: market.annualDrift,
    seed,
  });
  const rules = defaultRules();
  const result = simulate(prices, rules, config);
  return {prices, result};
}
