import {describe, it, expect} from "vitest";
import {generateInsights} from "../src/components/insights.js";
import type {Insight} from "../src/components/insights.js";
import type {MonteCarloResult, RunSummary, RegimeBreakdown} from "../src/components/monte-carlo.js";
import type {StrategyConfig} from "../src/components/strategy/types.js";

const baseConfig: StrategyConfig = {
  targetDelta: 0.30, impliedVol: 0.92, riskFreeRate: 0.05,
  cycleLengthDays: 7, contracts: 1, bidAskSpreadPct: 0.05, feePerTrade: 0.50,
  adaptiveCalls: {minDelta: 0.10, maxDelta: 0.50, skipThresholdPct: 0.001},
};

function makeRun(overrides: Partial<RunSummary> = {}): RunSummary {
  return {
    seed: 1, totalPL: 100, realizedPL: 80, unrealizedPL: 20,
    premiumCollected: 50, assignments: 2, fullCycles: 4, apr: 15,
    maxDrawdown: 200, skippedCycles: 0, isWin: true,
    benchmarkPL: 80, benchmarkAPR: 10, benchmarkMaxDD: 300,
    sharpe: 1.2, sortino: 1.8, benchmarkSharpe: 0.8, benchmarkSortino: 1.0,
    regime: "sideways" as const, underlyingReturn: 0.05,
    ...overrides,
  };
}

function makeRegime(overrides: Partial<RegimeBreakdown> = {}): RegimeBreakdown {
  return {
    regime: "sideways", count: 10, meanAPR: 15, meanBenchmarkAPR: 10,
    meanAlpha: 5, meanSharpe: 1.2, winRate: 0.7, meanMaxDrawdown: 200,
    ...overrides,
  };
}

function makeMC(overrides: Partial<MonteCarloResult> = {}): MonteCarloResult {
  return {
    runs: [makeRun()],
    winRate: 0.7, meanAPR: 15, medianAPR: 14, p5APR: -5, p25APR: 5,
    p75APR: 25, p95APR: 40, meanPL: 100, medianPL: 90,
    meanMaxDrawdown: 200, meanBenchmarkAPR: 10, medianBenchmarkAPR: 9,
    meanBenchmarkPL: 80, meanBenchmarkMaxDD: 300,
    meanSharpe: 1.2, meanSortino: 1.8,
    benchmarkMeanSharpe: 0.8, benchmarkMeanSortino: 1.0,
    regimeBreakdown: [
      makeRegime({regime: "bull", count: 3, meanAlpha: 2}),
      makeRegime({regime: "bear", count: 3, meanAlpha: -3}),
      makeRegime({regime: "sideways", count: 4, meanAlpha: 5}),
    ],
    ...overrides,
  };
}

function findInsight(insights: Insight[], title: string): Insight | undefined {
  return insights.find((i) => i.title === title);
}

describe("generateInsights", () => {
  describe("overall performance", () => {
    it("returns positive when Sharpe exceeds benchmark", () => {
      const insights = generateInsights(makeMC({meanSharpe: 1.5, benchmarkMeanSharpe: 0.8}), baseConfig);
      const i = findInsight(insights, "Strong Risk-Adjusted Returns");
      expect(i).toBeDefined();
      expect(i!.level).toBe("positive");
      expect(i!.message).toContain("1.50");
      expect(i!.message).toContain("0.80");
    });

    it("returns warning when Sharpe is positive but below benchmark", () => {
      const insights = generateInsights(makeMC({meanSharpe: 0.5, benchmarkMeanSharpe: 1.0}), baseConfig);
      const i = findInsight(insights, "Underperforming Benchmark");
      expect(i).toBeDefined();
      expect(i!.level).toBe("warning");
      expect(i!.suggestion).toBeDefined();
    });

    it("returns negative when Sharpe is negative", () => {
      const insights = generateInsights(makeMC({meanSharpe: -0.5}), baseConfig);
      const i = findInsight(insights, "Poor Risk-Adjusted Returns");
      expect(i).toBeDefined();
      expect(i!.level).toBe("negative");
      expect(i!.suggestion).toContain("reducing contracts");
    });
  });

  describe("alpha", () => {
    it("returns positive for alpha > 5%", () => {
      const insights = generateInsights(makeMC({meanAPR: 20, meanBenchmarkAPR: 10}), baseConfig);
      const i = findInsight(insights, "Significant Alpha");
      expect(i).toBeDefined();
      expect(i!.level).toBe("positive");
      expect(i!.message).toContain("10.0%");
    });

    it("returns negative for alpha < -5%", () => {
      const insights = generateInsights(makeMC({meanAPR: 5, meanBenchmarkAPR: 15}), baseConfig);
      const i = findInsight(insights, "Negative Alpha");
      expect(i).toBeDefined();
      expect(i!.level).toBe("negative");
    });

    it("returns neutral for small alpha", () => {
      const insights = generateInsights(makeMC({meanAPR: 12, meanBenchmarkAPR: 10}), baseConfig);
      const i = findInsight(insights, "Similar to Buy & Hold");
      expect(i).toBeDefined();
      expect(i!.level).toBe("neutral");
    });

    it("returns neutral at exactly 5% boundary", () => {
      const insights = generateInsights(makeMC({meanAPR: 15, meanBenchmarkAPR: 10}), baseConfig);
      const i = findInsight(insights, "Similar to Buy & Hold");
      expect(i).toBeDefined();
      expect(i!.level).toBe("neutral");
    });

    it("returns positive just above 5% boundary", () => {
      const insights = generateInsights(makeMC({meanAPR: 15.1, meanBenchmarkAPR: 10}), baseConfig);
      const i = findInsight(insights, "Significant Alpha");
      expect(i).toBeDefined();
    });
  });

  describe("downside profile", () => {
    it("returns positive when Sortino significantly exceeds Sharpe", () => {
      const insights = generateInsights(makeMC({meanSharpe: 1.0, meanSortino: 2.0}), baseConfig);
      const i = findInsight(insights, "Downside Well Contained");
      expect(i).toBeDefined();
      expect(i!.level).toBe("positive");
    });

    it("returns warning when Sortino close to Sharpe and Sharpe negative", () => {
      const insights = generateInsights(makeMC({meanSharpe: -0.5, meanSortino: -0.5}), baseConfig);
      const i = findInsight(insights, "High Downside Volatility");
      expect(i).toBeDefined();
      expect(i!.level).toBe("warning");
      expect(i!.suggestion).toContain("skip threshold");
    });

    it("does not fire downside warning when Sharpe is positive", () => {
      const insights = generateInsights(makeMC({meanSharpe: 0.5, meanSortino: 0.5}), baseConfig);
      const i = findInsight(insights, "High Downside Volatility");
      expect(i).toBeUndefined();
    });

    it("does not fire when neither condition is met", () => {
      const insights = generateInsights(makeMC({meanSharpe: 1.0, meanSortino: 1.3}), baseConfig);
      expect(findInsight(insights, "Downside Well Contained")).toBeUndefined();
      expect(findInsight(insights, "High Downside Volatility")).toBeUndefined();
    });
  });

  describe("regime vulnerability", () => {
    it("warns about bull regime with heavy alpha loss", () => {
      const mc = makeMC({
        regimeBreakdown: [
          makeRegime({regime: "bull", count: 5, meanAlpha: -15}),
          makeRegime({regime: "bear", count: 3, meanAlpha: 5}),
          makeRegime({regime: "sideways", count: 2, meanAlpha: 3}),
        ],
      });
      const insights = generateInsights(mc, baseConfig);
      const i = findInsight(insights, "Weak in Bull Regimes");
      expect(i).toBeDefined();
      expect(i!.level).toBe("warning");
      expect(i!.suggestion).toContain("call delta");
    });

    it("warns about bear regime with heavy alpha loss", () => {
      const mc = makeMC({
        regimeBreakdown: [
          makeRegime({regime: "bull", count: 3, meanAlpha: 5}),
          makeRegime({regime: "bear", count: 5, meanAlpha: -20}),
          makeRegime({regime: "sideways", count: 2, meanAlpha: 3}),
        ],
      });
      const insights = generateInsights(mc, baseConfig);
      const i = findInsight(insights, "Weak in Bear Regimes");
      expect(i).toBeDefined();
      expect(i!.suggestion).toContain("target delta");
    });

    it("does not warn for regimes with count 0", () => {
      const mc = makeMC({
        regimeBreakdown: [
          makeRegime({regime: "bull", count: 0, meanAlpha: -50}),
          makeRegime({regime: "bear", count: 5, meanAlpha: 5}),
          makeRegime({regime: "sideways", count: 5, meanAlpha: 3}),
        ],
      });
      const insights = generateInsights(mc, baseConfig);
      expect(findInsight(insights, "Weak in Bull Regimes")).toBeUndefined();
    });

    it("does not warn when alpha loss is mild", () => {
      const mc = makeMC({
        regimeBreakdown: [
          makeRegime({regime: "bull", count: 5, meanAlpha: -5}),
          makeRegime({regime: "bear", count: 5, meanAlpha: -8}),
          makeRegime({regime: "sideways", count: 5, meanAlpha: 3}),
        ],
      });
      const insights = generateInsights(mc, baseConfig);
      expect(findInsight(insights, "Weak in Bull Regimes")).toBeUndefined();
      expect(findInsight(insights, "Weak in Bear Regimes")).toBeUndefined();
    });
  });

  describe("risk", () => {
    it("warns when win rate is below 40%", () => {
      const insights = generateInsights(makeMC({winRate: 0.35}), baseConfig);
      const i = findInsight(insights, "Low Win Rate");
      expect(i).toBeDefined();
      expect(i!.level).toBe("warning");
      expect(i!.message).toContain("35.0%");
    });

    it("does not warn when win rate is 40% or above", () => {
      const insights = generateInsights(makeMC({winRate: 0.4}), baseConfig);
      expect(findInsight(insights, "Low Win Rate")).toBeUndefined();
    });
  });

  describe("assignment frequency", () => {
    it("warns when assignments per cycle ratio is high (>3)", () => {
      // 10 assignments / 2 fullCycles = 5.0 ratio → many incomplete cycles
      const runs = [makeRun({assignments: 10, fullCycles: 2})];
      const insights = generateInsights(makeMC({runs}), baseConfig);
      const i = findInsight(insights, "High Assignment Frequency");
      expect(i).toBeDefined();
      expect(i!.level).toBe("warning");
      expect(i!.suggestion).toContain("delta");
    });

    it("returns neutral for moderate assignment activity", () => {
      // 4 assignments / 2 fullCycles = 2.0 ratio, and >= 3 mean assignments
      const runs = [makeRun({assignments: 4, fullCycles: 2})];
      const insights = generateInsights(makeMC({runs}), baseConfig);
      const i = findInsight(insights, "Assignment Activity");
      expect(i).toBeDefined();
      expect(i!.level).toBe("neutral");
    });

    it("does not fire for very low assignment counts", () => {
      const runs = [makeRun({assignments: 2, fullCycles: 1})];
      const insights = generateInsights(makeMC({runs}), baseConfig);
      expect(findInsight(insights, "High Assignment Frequency")).toBeUndefined();
      expect(findInsight(insights, "Assignment Activity")).toBeUndefined();
    });

    it("does not fire warning when ratio is high but activity is low", () => {
      // ratio = 2/0.5 = 4 > 3, but mean assignments < 3 so skip
      const runs = [
        makeRun({assignments: 3, fullCycles: 1}),
        makeRun({assignments: 1, fullCycles: 0}),
      ];
      const insights = generateInsights(makeMC({runs}), baseConfig);
      expect(findInsight(insights, "High Assignment Frequency")).toBeUndefined();
    });

    it("handles zero cycles gracefully", () => {
      const runs = [makeRun({assignments: 0, fullCycles: 0})];
      const insights = generateInsights(makeMC({runs}), baseConfig);
      expect(findInsight(insights, "High Assignment Frequency")).toBeUndefined();
    });

    it("handles empty runs", () => {
      const insights = generateInsights(makeMC({runs: []}), baseConfig);
      expect(findInsight(insights, "High Assignment Frequency")).toBeUndefined();
    });
  });

  describe("combined scenarios", () => {
    it("generates multiple insights for a struggling strategy", () => {
      const mc = makeMC({
        meanSharpe: -0.3, meanSortino: -0.25, benchmarkMeanSharpe: 0.5,
        meanAPR: 2, meanBenchmarkAPR: 12, winRate: 0.35,
        runs: [makeRun({assignments: 10, fullCycles: 2})],
        regimeBreakdown: [
          makeRegime({regime: "bull", count: 5, meanAlpha: -15}),
          makeRegime({regime: "bear", count: 3, meanAlpha: 5}),
          makeRegime({regime: "sideways", count: 2, meanAlpha: 3}),
        ],
      });
      const insights = generateInsights(mc, baseConfig);

      expect(findInsight(insights, "Poor Risk-Adjusted Returns")).toBeDefined();
      expect(findInsight(insights, "Negative Alpha")).toBeDefined();
      expect(findInsight(insights, "High Downside Volatility")).toBeDefined();
      expect(findInsight(insights, "Weak in Bull Regimes")).toBeDefined();
      expect(findInsight(insights, "Low Win Rate")).toBeDefined();
      expect(findInsight(insights, "High Assignment Frequency")).toBeDefined();
    });

    it("generates positive insights for a strong strategy", () => {
      const mc = makeMC({
        meanSharpe: 1.5, meanSortino: 3.0, benchmarkMeanSharpe: 0.8,
        meanAPR: 25, meanBenchmarkAPR: 10, winRate: 0.8,
        runs: [makeRun({assignments: 1, fullCycles: 10})],
      });
      const insights = generateInsights(mc, baseConfig);

      expect(findInsight(insights, "Strong Risk-Adjusted Returns")).toBeDefined();
      expect(findInsight(insights, "Significant Alpha")).toBeDefined();
      expect(findInsight(insights, "Downside Well Contained")).toBeDefined();
    });

    it("always returns at least performance and alpha insights", () => {
      const insights = generateInsights(makeMC(), baseConfig);
      expect(insights.length).toBeGreaterThanOrEqual(2);
    });
  });
});
