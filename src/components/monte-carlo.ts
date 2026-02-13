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
  capitalAtRisk: number,
  yearsElapsed: number,
): RunSummary {
  const lastDay = result.dailyStates[result.dailyStates.length - 1];
  const unrealizedPL = lastDay ? lastDay.unrealizedPL : 0;
  const totalPL = result.summary.totalRealizedPL + unrealizedPL;
  const apr = yearsElapsed > 0
    ? (result.summary.totalRealizedPL / capitalAtRisk) / yearsElapsed * 100
    : 0;
  const maxDrawdown = computeMaxDrawdown(result.dailyStates);

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
  };
}

export function runMonteCarlo(
  market: MarketParams,
  config: StrategyConfig,
  numRuns: number,
): MonteCarloResult {
  const capitalAtRisk = market.startPrice * config.contracts;
  const yearsElapsed = market.days / 365;
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
    runs.push(summarizeRun(seed, result, capitalAtRisk, yearsElapsed));
  }

  const wins = runs.filter((r) => r.isWin).length;
  const aprs = runs.map((r) => r.apr).sort((a, b) => a - b);
  const pls = runs.map((r) => r.totalPL).sort((a, b) => a - b);
  const dds = runs.map((r) => r.maxDrawdown);

  return {
    runs,
    winRate: wins / runs.length,
    meanAPR: aprs.reduce((a, b) => a + b, 0) / aprs.length,
    medianAPR: median(aprs),
    p5APR: percentile(aprs, 5),
    p25APR: percentile(aprs, 25),
    p75APR: percentile(aprs, 75),
    p95APR: percentile(aprs, 95),
    meanPL: pls.reduce((a, b) => a + b, 0) / pls.length,
    medianPL: median(pls),
    meanMaxDrawdown: dds.reduce((a, b) => a + b, 0) / dds.length,
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
