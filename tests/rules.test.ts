import {describe, it, expect} from "vitest";
import {defaultRules, computeIVRVMultiplier} from "../src/components/strategy/rules.js";
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

describe("market.iv override", () => {
  it("BasePutRule uses market.iv over config.impliedVol", () => {
    const rule = findRule("BasePutRule");
    const p = initialPortfolio();
    const marketWithIv: MarketSnapshot = {day: 0, spot: 2500, iv: 1.5};
    const sig1 = rule.evaluate(marketWithIv, p, baseConfig)!;
    const sig2 = rule.evaluate(market, p, baseConfig)!;
    expect(sig1.action).toBe("SELL_PUT");
    expect(sig2.action).toBe("SELL_PUT");
    if (sig1.action === "SELL_PUT" && sig2.action === "SELL_PUT") {
      expect(sig1.premium).not.toBeCloseTo(sig2.premium, 2);
    }
  });

  it("AdaptiveCallRule uses market.iv over config.impliedVol", () => {
    const rule = findRule("AdaptiveCallRule");
    const p: PortfolioState = {
      ...initialPortfolio(),
      phase: "holding_eth",
      position: {size: 1, entryPrice: 2400},
    };
    const marketWithIv: MarketSnapshot = {day: 0, spot: 2500, iv: 1.5};
    const sig1 = rule.evaluate(marketWithIv, p, baseConfig)!;
    const sig2 = rule.evaluate(market, p, baseConfig)!;
    expect(sig1.action).toBe("SELL_CALL");
    expect(sig2.action).toBe("SELL_CALL");
    if (sig1.action === "SELL_CALL" && sig2.action === "SELL_CALL") {
      expect(sig1.premium).not.toBeCloseTo(sig2.premium, 2);
    }
  });
});

describe("minStrikeAtCost", () => {
  const adaptiveRule = findRule("AdaptiveCallRule");
  const skipRule = findRule("LowPremiumSkipRule");

  const deepDrawdownMarket: MarketSnapshot = {day: 0, spot: 1500};
  const underwaterPortfolio: PortfolioState = {
    ...initialPortfolio(),
    phase: "holding_eth",
    position: {size: 1, entryPrice: 3000},
  };

  const configOn: StrategyConfig = {
    ...baseConfig,
    adaptiveCalls: {minDelta: 0.10, maxDelta: 0.50, skipThresholdPct: 0.001, minStrikeAtCost: true},
  };
  const configOff: StrategyConfig = {
    ...baseConfig,
    adaptiveCalls: {minDelta: 0.10, maxDelta: 0.50, skipThresholdPct: 0.001, minStrikeAtCost: false},
  };

  it("clamps strike to entry price when spot < entry and flag is on", () => {
    const sig = adaptiveRule.evaluate(deepDrawdownMarket, underwaterPortfolio, configOn)!;
    expect(sig.action).toBe("SELL_CALL");
    if (sig.action === "SELL_CALL") {
      expect(sig.strike).toBeGreaterThanOrEqual(underwaterPortfolio.position!.entryPrice);
      expect(sig.reason).toContain("clamped");
    }
  });

  it("does NOT clamp strike when flag is off", () => {
    const sig = adaptiveRule.evaluate(deepDrawdownMarket, underwaterPortfolio, configOff)!;
    expect(sig.action).toBe("SELL_CALL");
    if (sig.action === "SELL_CALL") {
      expect(sig.strike).toBeLessThan(underwaterPortfolio.position!.entryPrice);
      expect(sig.reason).not.toContain("clamped");
    }
  });

  it("recalculates premium at the clamped strike", () => {
    const sigOn = adaptiveRule.evaluate(deepDrawdownMarket, underwaterPortfolio, configOn)!;
    const sigOff = adaptiveRule.evaluate(deepDrawdownMarket, underwaterPortfolio, configOff)!;
    if (sigOn.action === "SELL_CALL" && sigOff.action === "SELL_CALL") {
      expect(sigOn.premium).toBeLessThan(sigOff.premium);
    }
  });

  it("clamped strike + low premium triggers skip rule", () => {
    const highSkipConfig: StrategyConfig = {
      ...baseConfig,
      adaptiveCalls: {minDelta: 0.10, maxDelta: 0.50, skipThresholdPct: 99, minStrikeAtCost: true},
    };
    const sig = skipRule.evaluate(deepDrawdownMarket, underwaterPortfolio, highSkipConfig);
    expect(sig).not.toBeNull();
    expect(sig!.action).toBe("SKIP");
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

describe("computeIVRVMultiplier", () => {
  const ivRvConfig: StrategyConfig = {
    ...baseConfig,
    ivRvSpread: {lookbackDays: 20, minMultiplier: 0.8, maxMultiplier: 1.3},
  };

  it("returns 1.0 when config absent", () => {
    expect(computeIVRVMultiplier(market, baseConfig)).toBe(1.0);
  });

  it("returns IV/RV ratio when within bounds", () => {
    const m: MarketSnapshot = {day: 25, spot: 2500, iv: 0.92, realizedVol: 0.80};
    const result = computeIVRVMultiplier(m, ivRvConfig);
    expect(result).toBeCloseTo(0.92 / 0.80, 6);
  });

  it("clamps to maxMultiplier", () => {
    const m: MarketSnapshot = {day: 25, spot: 2500, iv: 2.0, realizedVol: 0.50};
    expect(computeIVRVMultiplier(m, ivRvConfig)).toBe(1.3);
  });

  it("clamps to minMultiplier", () => {
    const m: MarketSnapshot = {day: 25, spot: 2500, iv: 0.30, realizedVol: 0.92};
    expect(computeIVRVMultiplier(m, ivRvConfig)).toBe(0.8);
  });

  it("returns 1.0 when realizedVol is undefined", () => {
    const m: MarketSnapshot = {day: 5, spot: 2500, iv: 0.92};
    expect(computeIVRVMultiplier(m, ivRvConfig)).toBe(1.0);
  });

  it("returns 1.0 when realizedVol is 0", () => {
    const m: MarketSnapshot = {day: 25, spot: 2500, iv: 0.92, realizedVol: 0};
    expect(computeIVRVMultiplier(m, ivRvConfig)).toBe(1.0);
  });

  it("uses config.impliedVol when market.iv is undefined", () => {
    const m: MarketSnapshot = {day: 25, spot: 2500, realizedVol: 0.80};
    const result = computeIVRVMultiplier(m, ivRvConfig);
    expect(result).toBeCloseTo(ivRvConfig.impliedVol / 0.80, 6);
  });
});

describe("RollCallRule", () => {
  const rule = findRule("RollCallRule");

  const shortCallPortfolio: PortfolioState = {
    ...initialPortfolio(),
    phase: "short_call",
    position: {size: 1, entryPrice: 2400},
    openOption: {type: "call", strike: 2600, delta: 0.3, premium: 40, openDay: 0, expiryDay: 7},
  };

  // requireNetCredit: false so deep-ITM buyback cost doesn't block the signal
  const rollConfig: StrategyConfig = {
    ...baseConfig,
    rollCall: {itmThresholdPct: 0.05, requireNetCredit: false},
  };

  it("returns null when rollCall config is absent", () => {
    const marketITM: MarketSnapshot = {day: 3, spot: 2800};
    expect(rule.evaluate(marketITM, shortCallPortfolio, baseConfig)).toBeNull();
  });

  it("returns null when spot is below threshold", () => {
    // strike 2600 * 1.05 = 2730; spot 2720 is below
    const marketOTM: MarketSnapshot = {day: 3, spot: 2720};
    expect(rule.evaluate(marketOTM, shortCallPortfolio, rollConfig)).toBeNull();
  });

  it("returns ROLL signal when spot exceeds threshold", () => {
    const marketITM: MarketSnapshot = {day: 3, spot: 2800};
    const sig = rule.evaluate(marketITM, shortCallPortfolio, rollConfig);
    expect(sig).not.toBeNull();
    expect(sig!.action).toBe("ROLL");
    if (sig!.action === "ROLL") {
      expect(sig!.newStrike).toBeGreaterThan(0);
      expect(sig!.rollCost).toBeGreaterThan(0);
      expect(sig!.newPremium).toBeGreaterThan(0);
      expect(sig!.rule).toBe("RollCallRule");
    }
  });

  it("returns null when net credit is negative and requireNetCredit is true", () => {
    // Deep ITM call buyback (spot >> strike) is always more expensive than new OTM premium
    const configRequireCredit: StrategyConfig = {
      ...baseConfig,
      rollCall: {itmThresholdPct: 0.05, requireNetCredit: true},
    };
    const marketITM: MarketSnapshot = {day: 3, spot: 2800};
    const sig = rule.evaluate(marketITM, shortCallPortfolio, configRequireCredit);
    expect(sig).toBeNull();
  });

  it("newStrike is always >= current spot", () => {
    const marketITM: MarketSnapshot = {day: 3, spot: 2800};
    const sig = rule.evaluate(marketITM, shortCallPortfolio, rollConfig);
    expect(sig).not.toBeNull();
    if (sig!.action === "ROLL") {
      expect(sig!.newStrike).toBeGreaterThanOrEqual(2800);
    }
  });

  it("returns null when phase is not short_call", () => {
    const p: PortfolioState = {...initialPortfolio(), phase: "holding_eth"};
    const marketITM: MarketSnapshot = {day: 3, spot: 2800};
    expect(rule.evaluate(marketITM, p, rollConfig)).toBeNull();
  });

  it("returns null when no openOption", () => {
    const p: PortfolioState = {...initialPortfolio(), phase: "short_call"};
    const marketITM: MarketSnapshot = {day: 3, spot: 2800};
    expect(rule.evaluate(marketITM, p, rollConfig)).toBeNull();
  });
});

describe("IV/RV spread delta scaling", () => {
  const ivRvConfig: StrategyConfig = {
    ...baseConfig,
    ivRvSpread: {lookbackDays: 20, minMultiplier: 0.8, maxMultiplier: 1.3},
  };

  it("BasePutRule uses higher delta (strike closer to spot) when IV >> RV", () => {
    const rule = findRule("BasePutRule");
    const p = initialPortfolio();
    const highIVRV: MarketSnapshot = {day: 25, spot: 2500, iv: 1.2, realizedVol: 0.60};
    const noRV: MarketSnapshot = {day: 25, spot: 2500, iv: 1.2};
    const sigHigh = rule.evaluate(highIVRV, p, ivRvConfig)!;
    const sigNone = rule.evaluate(noRV, p, ivRvConfig)!;
    expect(sigHigh.action).toBe("SELL_PUT");
    expect(sigNone.action).toBe("SELL_PUT");
    if (sigHigh.action === "SELL_PUT" && sigNone.action === "SELL_PUT") {
      expect(sigHigh.strike).toBeGreaterThan(sigNone.strike);
    }
  });

  it("AdaptiveCallRule uses higher delta when IV >> RV", () => {
    const rule = findRule("AdaptiveCallRule");
    const p: PortfolioState = {
      ...initialPortfolio(),
      phase: "holding_eth",
      position: {size: 1, entryPrice: 2400},
    };
    const highIVRV: MarketSnapshot = {day: 25, spot: 2500, iv: 1.2, realizedVol: 0.60};
    const noRV: MarketSnapshot = {day: 25, spot: 2500, iv: 1.2};
    const sigHigh = rule.evaluate(highIVRV, p, ivRvConfig)!;
    const sigNone = rule.evaluate(noRV, p, ivRvConfig)!;
    expect(sigHigh.action).toBe("SELL_CALL");
    expect(sigNone.action).toBe("SELL_CALL");
    if (sigHigh.action === "SELL_CALL" && sigNone.action === "SELL_CALL") {
      expect(sigHigh.strike).toBeLessThan(sigNone.strike);
    }
  });
});
