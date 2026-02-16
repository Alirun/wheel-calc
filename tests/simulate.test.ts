import {describe, it, expect} from "vitest";
import {simulate, computeRealizedVol} from "../src/components/strategy/simulate.js";
import {defaultRules} from "../src/components/strategy/rules.js";
import {generatePrices} from "../src/components/price-gen.js";
import type {StrategyConfig} from "../src/components/strategy/types.js";

const config: StrategyConfig = {
  targetDelta: 0.30, impliedVol: 0.92, riskFreeRate: 0.05,
  cycleLengthDays: 7, contracts: 1, bidAskSpreadPct: 0.05, feePerTrade: 0.50,
  adaptiveCalls: {minDelta: 0.10, maxDelta: 0.50, skipThresholdPct: 0.001},
};

function makePrices(seed: number, days: number) {
  return generatePrices({startPrice: 2500, days, annualVol: 0.80, annualDrift: 0, seed}).prices;
}

describe("simulate", () => {
  it("produces deterministic output for the same seed", () => {
    const prices = makePrices(42, 30);
    const rules = defaultRules();
    const r1 = simulate(prices, rules, config);
    const r2 = simulate(prices, rules, config);
    expect(r1.summary.totalRealizedPL).toBe(r2.summary.totalRealizedPL);
    expect(r1.signalLog.length).toBe(r2.signalLog.length);
    expect(r1.dailyStates.length).toBe(r2.dailyStates.length);
  });

  it("dailyStates has one entry per day", () => {
    const prices = makePrices(1, 30);
    const result = simulate(prices, defaultRules(), config);
    expect(result.dailyStates.length).toBe(30);
    expect(result.dailyStates[0].day).toBe(0);
    expect(result.dailyStates[29].day).toBe(29);
  });

  it("signalLog entries have valid structure", () => {
    const prices = makePrices(1, 30);
    const result = simulate(prices, defaultRules(), config);
    expect(result.signalLog.length).toBeGreaterThan(0);
    for (const entry of result.signalLog) {
      expect(entry.day).toBeGreaterThanOrEqual(0);
      expect(entry.market.spot).toBeGreaterThan(0);
      expect(entry.portfolioBefore).toBeDefined();
      expect(entry.portfolioAfter).toBeDefined();
      expect(entry.signal).toBeDefined();
      expect(Array.isArray(entry.events)).toBe(true);
    }
  });

  it("first signal is always a SELL_PUT or HOLD", () => {
    const prices = makePrices(1, 30);
    const result = simulate(prices, defaultRules(), config);
    const firstSignal = result.signalLog.find((e) => e.signal.action !== "HOLD");
    if (firstSignal) {
      expect(firstSignal.signal.action).toBe("SELL_PUT");
    }
  });

  it("summary counters are consistent with signal log", () => {
    const prices = makePrices(7, 60);
    const result = simulate(prices, defaultRules(), config);

    const assignmentEvents = result.signalLog.flatMap((e) =>
      e.events.filter((ev) => ev.type === "OPTION_EXPIRED" && ev.assigned),
    );
    expect(result.summary.totalAssignments).toBe(assignmentEvents.length);

    const skipEvents = result.signalLog.flatMap((e) =>
      e.events.filter((ev) => ev.type === "CYCLE_SKIPPED"),
    );
    expect(result.summary.totalSkippedCycles).toBe(skipEvents.length);
  });

  it("totalPremiumCollected matches sum of PREMIUM_COLLECTED events", () => {
    const prices = makePrices(3, 60);
    const result = simulate(prices, defaultRules(), config);

    const premiumSum = result.signalLog.flatMap((e) => e.events)
      .filter((ev): ev is Extract<typeof ev, {type: "PREMIUM_COLLECTED"}> => ev.type === "PREMIUM_COLLECTED")
      .reduce((sum, ev) => sum + ev.grossPremium, 0);
    expect(result.summary.totalPremiumCollected).toBeCloseTo(premiumSum, 6);
  });

  it("works with short simulations (fewer days than one cycle)", () => {
    const prices = makePrices(1, 3);
    const result = simulate(prices, defaultRules(), config);
    expect(result.dailyStates.length).toBe(3);
  });

  it("populates market.iv from ivPath when provided", () => {
    const prices = makePrices(1, 30);
    const ivPath = prices.map(() => 0.75);
    const result = simulate(prices, defaultRules(), config, ivPath);
    for (const entry of result.signalLog) {
      expect(entry.market.iv).toBe(0.75);
    }
  });

  it("market.iv is undefined when ivPath not provided", () => {
    const prices = makePrices(1, 30);
    const result = simulate(prices, defaultRules(), config);
    for (const entry of result.signalLog) {
      expect(entry.market.iv).toBeUndefined();
    }
  });
});

describe("computeRealizedVol", () => {
  it("returns undefined when day < lookback", () => {
    const prices = [100, 101, 102];
    expect(computeRealizedVol(prices, 2, 5)).toBeUndefined();
    expect(computeRealizedVol(prices, 0, 1)).toBeUndefined();
  });

  it("returns a positive number with sufficient history", () => {
    const prices = makePrices(42, 30);
    const rv = computeRealizedVol(prices, 25, 20);
    expect(rv).toBeDefined();
    expect(rv).toBeGreaterThan(0);
  });

  it("returns 0 for constant prices", () => {
    const prices = Array(30).fill(2500);
    const rv = computeRealizedVol(prices, 25, 20);
    expect(rv).toBe(0);
  });

  it("is deterministic", () => {
    const prices = makePrices(42, 30);
    const rv1 = computeRealizedVol(prices, 25, 20);
    const rv2 = computeRealizedVol(prices, 25, 20);
    expect(rv1).toBe(rv2);
  });
});

describe("simulate with ivRvSpread", () => {
  const ivRvConfig: StrategyConfig = {
    ...config,
    ivRvSpread: {lookbackDays: 5, minMultiplier: 0.8, maxMultiplier: 1.3},
  };

  it("populates realizedVol in MarketSnapshot when config present", () => {
    const prices = makePrices(42, 30);
    const result = simulate(prices, defaultRules(), ivRvConfig);
    const lateEntries = result.signalLog.filter((e) => e.day >= 5);
    for (const entry of lateEntries) {
      expect(entry.market.realizedVol).toBeDefined();
      expect(entry.market.realizedVol).toBeGreaterThan(0);
    }
  });

  it("leaves realizedVol undefined when config absent", () => {
    const prices = makePrices(42, 30);
    const result = simulate(prices, defaultRules(), config);
    for (const entry of result.signalLog) {
      expect(entry.market.realizedVol).toBeUndefined();
    }
  });
});
