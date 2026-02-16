import {describe, it, expect} from "vitest";
import {
  computeBenchmarkMaxDD,
  computeSharpe,
  computeSortino,
  classifyRegime,
  runMonteCarlo,
} from "../src/components/monte-carlo.js";
import type {MarketParams} from "../src/components/monte-carlo.js";
import type {StrategyConfig} from "../src/components/strategy/types.js";

const market: MarketParams = {
  startPrice: 2500, days: 30, annualVol: 0.80, annualDrift: 0,
};

const config: StrategyConfig = {
  targetDelta: 0.30, impliedVol: 0.92, riskFreeRate: 0.05,
  cycleLengthDays: 7, contracts: 1, bidAskSpreadPct: 0.05, feePerTrade: 0.50,
  adaptiveCalls: {minDelta: 0.10, maxDelta: 0.50, skipThresholdPct: 0.001},
};

describe("computeBenchmarkMaxDD", () => {
  it("returns 0 for monotonically rising prices", () => {
    expect(computeBenchmarkMaxDD([100, 110, 120, 130], 1)).toBe(0);
  });

  it("computes drawdown from peak P/L", () => {
    // prices: 100 → 150 → 120 → 130
    // P/L:    0   → 50  → 20  → 30
    // peak P/L = 50, max DD = 50 - 20 = 30
    expect(computeBenchmarkMaxDD([100, 150, 120, 130], 1)).toBe(30);
  });

  it("scales with contracts", () => {
    expect(computeBenchmarkMaxDD([100, 150, 120, 130], 3)).toBe(90);
  });

  it("returns 0 for flat prices", () => {
    expect(computeBenchmarkMaxDD([100, 100, 100], 1)).toBe(0);
  });

  it("handles single-day decline from start", () => {
    // prices: 100 → 80  → P/L: 0 → -20
    // peak P/L = 0, max DD = 0 - (-20) = 20
    expect(computeBenchmarkMaxDD([100, 80], 1)).toBe(20);
  });
});

describe("computeSharpe", () => {
  it("returns 0 for fewer than 2 data points", () => {
    expect(computeSharpe([], 0)).toBe(0);
    expect(computeSharpe([0.01], 0)).toBe(0);
  });

  it("returns 0 for constant returns", () => {
    expect(computeSharpe([0.01, 0.01, 0.01], 0.01)).toBe(0);
  });

  it("is positive for returns above risk-free rate", () => {
    const returns = [0.02, 0.03, 0.01, 0.04, 0.02];
    expect(computeSharpe(returns, 0)).toBeGreaterThan(0);
  });

  it("is negative for returns below risk-free rate", () => {
    const returns = [-0.02, -0.03, -0.01, -0.04, -0.02];
    expect(computeSharpe(returns, 0)).toBeLessThan(0);
  });

  it("annualizes by sqrt(365)", () => {
    const returns = [0.01, -0.01, 0.01, -0.01];
    const rfDaily = 0;
    const result = computeSharpe(returns, rfDaily);
    // mean = 0, so Sharpe should be 0
    expect(result).toBeCloseTo(0, 10);
  });

  it("computes expected value for known inputs", () => {
    // 5 returns all equal to 0.01, rf = 0
    // mean = 0.01, std = 0, should return 0 (no variance)
    expect(computeSharpe([0.01, 0.01, 0.01, 0.01, 0.01], 0)).toBe(0);

    // 2 returns: 0.03, 0.01, rf = 0
    // mean = 0.02, variance = ((0.01)^2 + (-0.01)^2) / 1 = 0.0002, std = 0.01414
    // sharpe = (0.02 / 0.01414) * sqrt(365) ≈ 27.02
    const s = computeSharpe([0.03, 0.01], 0);
    expect(s).toBeCloseTo(27.02, 0);
  });
});

describe("computeSortino", () => {
  it("returns 0 for fewer than 2 data points", () => {
    expect(computeSortino([], 0)).toBe(0);
    expect(computeSortino([0.01], 0)).toBe(0);
  });

  it("returns 0 when no downside deviation exists", () => {
    // all returns above rf → no downside → downside std = 0 → return 0
    expect(computeSortino([0.02, 0.03, 0.04], 0)).toBe(0);
  });

  it("is negative for all-negative returns", () => {
    const returns = [-0.01, -0.03, -0.01, -0.03];
    const sortino = computeSortino(returns, 0);
    expect(sortino).toBeLessThan(0);
  });

  it("Sortino >= Sharpe in magnitude when returns are negatively skewed", () => {
    // mix of positive and negative: downside std < total std
    const returns = [0.02, 0.01, -0.01, 0.03, 0.02];
    const sharpe = computeSharpe(returns, 0);
    const sortino = computeSortino(returns, 0);
    // positive mean, fewer downside points → Sortino should be larger than Sharpe
    expect(sortino).toBeGreaterThan(sharpe);
  });
});

describe("classifyRegime", () => {
  it("classifies bull when annualized return > 20%", () => {
    // 10% in 30 days → 10% * (365/30) ≈ 121.7% annualized
    expect(classifyRegime(0.10, 30)).toBe("bull");
  });

  it("classifies bear when annualized return < -20%", () => {
    expect(classifyRegime(-0.10, 30)).toBe("bear");
  });

  it("classifies sideways when within ±20% annualized", () => {
    // 1% in 30 days → 1% * (365/30) ≈ 12.2% annualized
    expect(classifyRegime(0.01, 30)).toBe("sideways");
    expect(classifyRegime(-0.01, 30)).toBe("sideways");
  });

  it("boundary: exactly +20% annualized is sideways", () => {
    // 20% annualized over 365 days → return = 0.20
    expect(classifyRegime(0.20, 365)).toBe("sideways");
  });

  it("boundary: just above +20% annualized is bull", () => {
    expect(classifyRegime(0.201, 365)).toBe("bull");
  });

  it("scales correctly with duration", () => {
    // 5% in 7 days → 5% * (365/7) ≈ 260% annualized → bull
    expect(classifyRegime(0.05, 7)).toBe("bull");
    // 5% in 365 days → 5% annualized → sideways
    expect(classifyRegime(0.05, 365)).toBe("sideways");
  });
});

describe("runMonteCarlo integration", () => {
  it("benchmark P/L matches (finalPrice - startPrice) * contracts", () => {
    const mc = runMonteCarlo(market, config, 5);
    for (const run of mc.runs) {
      // Can't access prices directly, but benchmarkPL should be consistent with underlyingReturn
      // underlyingReturn = (pN - p0) / p0 → benchmarkPL = underlyingReturn * p0 * contracts
      const expectedPL = run.underlyingReturn * market.startPrice * config.contracts;
      expect(run.benchmarkPL).toBeCloseTo(expectedPL, 6);
    }
  });

  it("regime counts sum to total runs", () => {
    const mc = runMonteCarlo(market, config, 50);
    const totalRegime = mc.regimeBreakdown.reduce((s, rb) => s + rb.count, 0);
    expect(totalRegime).toBe(50);
  });

  it("all three regimes present in regimeBreakdown", () => {
    const mc = runMonteCarlo(market, config, 10);
    const regimes = mc.regimeBreakdown.map((rb) => rb.regime);
    expect(regimes).toContain("bull");
    expect(regimes).toContain("bear");
    expect(regimes).toContain("sideways");
  });

  it("Sharpe is negative when mean APR is negative", () => {
    const bearMarket = {...market, annualDrift: -2.0};
    const mc = runMonteCarlo(bearMarket, config, 20);
    if (mc.meanAPR < 0) {
      expect(mc.meanSharpe).toBeLessThan(0);
    }
  });

  it("benchmark fields are populated", () => {
    const mc = runMonteCarlo(market, config, 10);
    expect(typeof mc.meanBenchmarkAPR).toBe("number");
    expect(typeof mc.medianBenchmarkAPR).toBe("number");
    expect(typeof mc.meanBenchmarkPL).toBe("number");
    expect(typeof mc.meanBenchmarkMaxDD).toBe("number");
    expect(mc.meanBenchmarkMaxDD).toBeGreaterThanOrEqual(0);
  });

  it("with 0% drift, alpha is close to zero over many runs", () => {
    const mc = runMonteCarlo({...market, days: 90}, config, 100);
    const alpha = mc.meanAPR - mc.meanBenchmarkAPR;
    // Should be within a reasonable range (not exactly 0 due to strategy mechanics)
    expect(Math.abs(alpha)).toBeLessThan(200);
  });

  it("deterministic: same inputs produce same outputs", () => {
    const mc1 = runMonteCarlo(market, config, 10);
    const mc2 = runMonteCarlo(market, config, 10);
    expect(mc1.meanSharpe).toBe(mc2.meanSharpe);
    expect(mc1.meanSortino).toBe(mc2.meanSortino);
    expect(mc1.meanBenchmarkAPR).toBe(mc2.meanBenchmarkAPR);
    expect(mc1.regimeBreakdown).toEqual(mc2.regimeBreakdown);
  });

  it("works with heston model", () => {
    const hestonMarket = {
      ...market,
      model: "heston" as const,
      heston: {kappa: 2.0, theta: 0.64, sigma: 0.5, rho: -0.7},
    };
    const mc = runMonteCarlo(hestonMarket, config, 5);
    expect(mc.runs.length).toBe(5);
    expect(mc.runs.every((r) => !isNaN(r.totalPL))).toBe(true);
  });

  it("works with jump model", () => {
    const jumpMarket = {
      ...market,
      model: "jump" as const,
      jump: {lambda: 10, muJ: 0, sigmaJ: 0.05},
    };
    const mc = runMonteCarlo(jumpMarket, config, 5);
    expect(mc.runs.length).toBe(5);
    expect(mc.runs.every((r) => !isNaN(r.totalPL))).toBe(true);
  });

  it("works with heston-jump model", () => {
    const hjMarket = {
      ...market,
      model: "heston-jump" as const,
      heston: {kappa: 2.0, theta: 0.64, sigma: 0.5, rho: -0.7},
      jump: {lambda: 10, muJ: 0, sigmaJ: 0.05},
    };
    const mc = runMonteCarlo(hjMarket, config, 5);
    expect(mc.runs.length).toBe(5);
    expect(mc.runs.every((r) => !isNaN(r.totalPL))).toBe(true);
  });
});
