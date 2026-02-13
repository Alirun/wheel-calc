import type {MonteCarloResult} from "./monte-carlo.js";
import type {StrategyConfig} from "./strategy/types.js";

export interface Insight {
  level: "positive" | "neutral" | "warning" | "negative";
  title: string;
  message: string;
  suggestion?: string;
}

export function generateInsights(mc: MonteCarloResult, config: StrategyConfig): Insight[] {
  const insights: Insight[] = [];
  const alpha = mc.meanAPR - mc.meanBenchmarkAPR;

  evaluatePerformance(mc, insights);
  evaluateAlpha(alpha, insights);
  evaluateDownsideProfile(mc, insights);
  evaluateRegimeVulnerability(mc, insights);
  evaluateRisk(mc, config, insights);
  evaluateAssignmentRate(mc, insights);

  return insights;
}

function evaluatePerformance(mc: MonteCarloResult, insights: Insight[]): void {
  if (mc.meanSharpe < 0) {
    insights.push({
      level: "negative",
      title: "Poor Risk-Adjusted Returns",
      message: `Wheel Sharpe (${mc.meanSharpe.toFixed(2)}) is negative — strategy is losing money on a risk-adjusted basis.`,
      suggestion: "Consider reducing contracts or reviewing strategy parameters."
    });
  } else if (mc.meanSharpe < mc.benchmarkMeanSharpe) {
    insights.push({
      level: "warning",
      title: "Underperforming Benchmark",
      message: `Wheel Sharpe (${mc.meanSharpe.toFixed(2)}) trails B&H Sharpe (${mc.benchmarkMeanSharpe.toFixed(2)}).`,
      suggestion: "Try lowering target delta to reduce assignment risk."
    });
  } else {
    insights.push({
      level: "positive",
      title: "Strong Risk-Adjusted Returns",
      message: `Wheel Sharpe (${mc.meanSharpe.toFixed(2)}) exceeds B&H (${mc.benchmarkMeanSharpe.toFixed(2)}).`
    });
  }
}

function evaluateAlpha(alpha: number, insights: Insight[]): void {
  if (alpha > 5) {
    insights.push({
      level: "positive",
      title: "Significant Alpha",
      message: `Wheel generates +${alpha.toFixed(1)}% alpha over buy-and-hold.`,
      suggestion: "Consider increasing contracts to scale this edge."
    });
  } else if (alpha < -5) {
    insights.push({
      level: "negative",
      title: "Negative Alpha",
      message: `Wheel destroys ${alpha.toFixed(1)}% alpha vs holding.`,
      suggestion: "Review strategy parameters — delta, cycle length, or skip threshold may need adjustment."
    });
  } else {
    insights.push({
      level: "neutral",
      title: "Similar to Buy & Hold",
      message: `Alpha is ${alpha >= 0 ? "+" : ""}${alpha.toFixed(1)}% — Wheel performs similarly to buy-and-hold.`
    });
  }
}

function evaluateDownsideProfile(mc: MonteCarloResult, insights: Insight[]): void {
  if (mc.meanSharpe > 0 && mc.meanSortino > mc.meanSharpe * 1.5) {
    insights.push({
      level: "positive",
      title: "Downside Well Contained",
      message: `Sortino (${mc.meanSortino.toFixed(2)}) significantly exceeds Sharpe (${mc.meanSharpe.toFixed(2)}) — premium income is cushioning losses.`
    });
  } else if (mc.meanSharpe < 0 && mc.meanSortino > mc.meanSharpe * 1.2) {
    insights.push({
      level: "warning",
      title: "High Downside Volatility",
      message: `Sortino (${mc.meanSortino.toFixed(2)}) is close to Sharpe (${mc.meanSharpe.toFixed(2)}) — premiums aren't providing enough cushion.`,
      suggestion: "Consider increasing skip threshold or lowering target delta."
    });
  }
}

function evaluateRegimeVulnerability(mc: MonteCarloResult, insights: Insight[]): void {
  const suggestions: Record<string, string> = {
    bull: "Consider lowering max call delta to retain more upside.",
    bear: "Consider lowering target delta to reduce assignment risk.",
    sideways: "Consider adjusting cycle length to capture more premium."
  };

  for (const rb of mc.regimeBreakdown) {
    if (rb.count > 0 && rb.meanAlpha < -10) {
      const label = rb.regime === "bull" ? "Bull" : rb.regime === "bear" ? "Bear" : "Sideways";
      insights.push({
        level: "warning",
        title: `Weak in ${label} Regimes`,
        message: `Wheel loses ${Math.abs(rb.meanAlpha).toFixed(1)}% alpha in ${label.toLowerCase()} regimes.`,
        suggestion: suggestions[rb.regime]
      });
    }
  }
}

function evaluateRisk(mc: MonteCarloResult, config: StrategyConfig, insights: Insight[]): void {
  const capitalAtRisk = mc.runs.length > 0 ? mc.runs[0].seed : 0;
  const meanCapital = mc.runs.length > 0
    ? mc.runs.reduce((sum, r) => sum + Math.abs(r.totalPL) + r.premiumCollected, 0) / mc.runs.length
    : 0;

  if (mc.meanMaxDrawdown > 0 && mc.runs.length > 0) {
    const avgStartExposure = mc.runs[0].benchmarkPL !== undefined
      ? Math.abs(mc.meanBenchmarkPL / (mc.meanBenchmarkAPR / 100 || 1))
      : 0;

    if (mc.meanMaxDrawdown > avgStartExposure * 0.5 && avgStartExposure > 0) {
      insights.push({
        level: "negative",
        title: "Large Average Drawdown",
        message: `Average max drawdown ($${mc.meanMaxDrawdown.toFixed(0)}) exceeds 50% of estimated capital at risk.`,
        suggestion: "Consider reducing contracts to limit downside exposure."
      });
    }
  }

  if (mc.winRate < 0.4) {
    insights.push({
      level: "warning",
      title: "Low Win Rate",
      message: `Win rate is ${(mc.winRate * 100).toFixed(1)}% — fewer than 40% of simulations are profitable.`,
      suggestion: "Consider adjusting delta or cycle length to improve consistency."
    });
  }
}

function evaluateAssignmentRate(mc: MonteCarloResult, insights: Insight[]): void {
  if (mc.runs.length === 0) return;

  const meanAssignments = mc.runs.reduce((sum, r) => sum + r.assignments, 0) / mc.runs.length;
  const meanFullCycles = mc.runs.reduce((sum, r) => sum + r.fullCycles, 0) / mc.runs.length;

  if (meanFullCycles === 0 || meanAssignments < 3) return;

  // Each full cycle requires exactly one put assignment + one call assignment.
  // Assignments beyond 2 * fullCycles indicate incomplete cycles (put assigned
  // but simulation ended before call assignment).
  // A ratio near 2.0 means nearly every put assignment completes the cycle.
  // A ratio well above 2.0 means many puts assign without completing.
  const assignmentsPerCycle = meanAssignments / meanFullCycles;

  if (assignmentsPerCycle > 3) {
    insights.push({
      level: "warning",
      title: "High Assignment Frequency",
      message: `Average ${meanAssignments.toFixed(1)} assignments across ${meanFullCycles.toFixed(1)} completed cycles per simulation — many puts assign without completing a full wheel cycle.`,
      suggestion: "Consider lowering target delta to reduce put assignment frequency."
    });
  } else if (meanAssignments >= 2) {
    insights.push({
      level: "neutral",
      title: "Assignment Activity",
      message: `Average ${meanAssignments.toFixed(1)} assignments and ${meanFullCycles.toFixed(1)} completed wheel cycles per simulation.`
    });
  }
}
