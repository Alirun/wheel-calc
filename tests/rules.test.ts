import {describe, it, expect} from "vitest";
import {defaultRules} from "../src/components/strategy/rules.js";
import type {MarketSnapshot, PortfolioState, StrategyConfig} from "../src/components/strategy/types.js";
import {initialPortfolio} from "../src/components/strategy/state.js";

const baseConfig: StrategyConfig = {
  targetDelta: 0.30,
  impliedVol: 0.92,
  riskFreeRate: 0.05,
  cycleLengthDays: 7,
  contracts: 1,
  bidAskSpreadPct: 0.05,
  feePerTrade: 0.50,
  adaptiveCalls: {minDelta: 0.10, maxDelta: 0.50, skipThresholdPct: 0.001},
};

const market: MarketSnapshot = {day: 0, spot: 2500};

function findRule(name: string) {
  return defaultRules().find((r) => r.name === name)!;
}

describe("BasePutRule", () => {
  const rule = findRule("BasePutRule");

  it("returns SELL_PUT when phase is idle_cash", () => {
    const p = initialPortfolio();
    const sig = rule.evaluate(market, p, baseConfig);
    expect(sig).not.toBeNull();
    expect(sig!.action).toBe("SELL_PUT");
    if (sig!.action === "SELL_PUT") {
      expect(sig!.strike).toBeLessThan(market.spot);
      expect(sig!.delta).toBeGreaterThan(0);
      expect(sig!.premium).toBeGreaterThan(0);
    }
  });

  it("returns null when phase is not idle_cash", () => {
    const p: PortfolioState = {
      ...initialPortfolio(),
      phase: "holding_eth",
      position: {size: 1, entryPrice: 2400},
    };
    expect(rule.evaluate(market, p, baseConfig)).toBeNull();
  });

  it("returns null when phase is short_put", () => {
    const p: PortfolioState = {
      ...initialPortfolio(),
      phase: "short_put",
    };
    expect(rule.evaluate(market, p, baseConfig)).toBeNull();
  });
});

describe("AdaptiveCallRule", () => {
  const rule = findRule("AdaptiveCallRule");

  it("returns SELL_CALL when phase is holding_eth", () => {
    const p: PortfolioState = {
      ...initialPortfolio(),
      phase: "holding_eth",
      position: {size: 1, entryPrice: 2400},
    };
    const sig = rule.evaluate(market, p, baseConfig);
    expect(sig).not.toBeNull();
    expect(sig!.action).toBe("SELL_CALL");
    if (sig!.action === "SELL_CALL") {
      expect(sig!.strike).toBeGreaterThan(market.spot);
      expect(sig!.premium).toBeGreaterThan(0);
    }
  });

  it("returns null when phase is idle_cash", () => {
    const p = initialPortfolio();
    expect(rule.evaluate(market, p, baseConfig)).toBeNull();
  });

  it("uses lower delta when underwater", () => {
    const underwater: PortfolioState = {
      ...initialPortfolio(),
      phase: "holding_eth",
      position: {size: 1, entryPrice: 4000},
    };
    const profitable: PortfolioState = {
      ...initialPortfolio(),
      phase: "holding_eth",
      position: {size: 1, entryPrice: 1500},
    };
    const sigU = rule.evaluate(market, underwater, baseConfig)!;
    const sigP = rule.evaluate(market, profitable, baseConfig)!;
    if (sigU.action === "SELL_CALL" && sigP.action === "SELL_CALL") {
      expect(sigU.strike).toBeGreaterThan(sigP.strike);
    }
  });

  it("falls back to targetDelta when adaptive config is absent", () => {
    const noAdaptive: StrategyConfig = {...baseConfig, adaptiveCalls: undefined};
    const p: PortfolioState = {
      ...initialPortfolio(),
      phase: "holding_eth",
      position: {size: 1, entryPrice: 2400},
    };
    const sig = rule.evaluate(market, p, noAdaptive);
    expect(sig).not.toBeNull();
    expect(sig!.action).toBe("SELL_CALL");
  });
});

describe("LowPremiumSkipRule", () => {
  const rule = findRule("LowPremiumSkipRule");

  it("returns SKIP when net premium is below threshold", () => {
    const p: PortfolioState = {
      ...initialPortfolio(),
      phase: "holding_eth",
      position: {size: 1, entryPrice: 2400},
    };
    const highThreshold: StrategyConfig = {
      ...baseConfig,
      adaptiveCalls: {minDelta: 0.10, maxDelta: 0.50, skipThresholdPct: 99},
    };
    const sig = rule.evaluate(market, p, highThreshold);
    expect(sig).not.toBeNull();
    expect(sig!.action).toBe("SKIP");
  });

  it("returns null when premium is above threshold", () => {
    const p: PortfolioState = {
      ...initialPortfolio(),
      phase: "holding_eth",
      position: {size: 1, entryPrice: 2400},
    };
    const lowThreshold: StrategyConfig = {
      ...baseConfig,
      adaptiveCalls: {minDelta: 0.10, maxDelta: 0.50, skipThresholdPct: 0},
    };
    expect(rule.evaluate(market, p, lowThreshold)).toBeNull();
  });

  it("returns null when phase is not holding_eth", () => {
    const p = initialPortfolio();
    expect(rule.evaluate(market, p, baseConfig)).toBeNull();
  });

  it("returns null when adaptive config is absent", () => {
    const p: PortfolioState = {
      ...initialPortfolio(),
      phase: "holding_eth",
      position: {size: 1, entryPrice: 2400},
    };
    const noAdaptive: StrategyConfig = {...baseConfig, adaptiveCalls: undefined};
    expect(rule.evaluate(market, p, noAdaptive)).toBeNull();
  });
});
