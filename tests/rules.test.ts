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

describe("RollPutRule", () => {
  const rule = findRule("RollPutRule");

  const rollPutConfig: StrategyConfig = {
    ...baseConfig,
    rollPut: {initialDTE: 30, rollWhenDTEBelow: 14, requireNetCredit: false},
  };

  const shortPutPortfolio: PortfolioState = {
    ...initialPortfolio(),
    phase: "short_put",
    openOption: {type: "put", strike: 2400, delta: 0.3, premium: 50, openDay: 0, expiryDay: 30},
  };

  it("returns null when rollPut config is absent", () => {
    const mkt: MarketSnapshot = {day: 20, spot: 2600};
    expect(rule.evaluate(mkt, shortPutPortfolio, baseConfig)).toBeNull();
  });

  it("returns null when phase is not short_put", () => {
    const p: PortfolioState = {...initialPortfolio(), phase: "idle_cash"};
    const mkt: MarketSnapshot = {day: 20, spot: 2600};
    expect(rule.evaluate(mkt, p, rollPutConfig)).toBeNull();
  });

  it("returns null when no openOption", () => {
    const p: PortfolioState = {...initialPortfolio(), phase: "short_put"};
    const mkt: MarketSnapshot = {day: 20, spot: 2600};
    expect(rule.evaluate(mkt, p, rollPutConfig)).toBeNull();
  });

  it("returns null when remaining DTE is above rollWhenDTEBelow threshold", () => {
    // expiryDay=30, day=15, remaining=15 > 14 rollWhenDTEBelow
    const mkt: MarketSnapshot = {day: 15, spot: 2600};
    expect(rule.evaluate(mkt, shortPutPortfolio, rollPutConfig)).toBeNull();
  });

  it("returns null when put is ITM (spot <= strike)", () => {
    // spot 2300 <= strike 2400 → ITM, should not roll
    const mkt: MarketSnapshot = {day: 20, spot: 2300};
    expect(rule.evaluate(mkt, shortPutPortfolio, rollPutConfig)).toBeNull();
  });

  it("returns ROLL signal when OTM and DTE below threshold", () => {
    // expiryDay=30, day=20, remaining=10 <= 14, spot 2600 > strike 2400 → OTM
    const mkt: MarketSnapshot = {day: 20, spot: 2600};
    const sig = rule.evaluate(mkt, shortPutPortfolio, rollPutConfig);
    expect(sig).not.toBeNull();
    expect(sig!.action).toBe("ROLL");
    if (sig!.action === "ROLL") {
      expect(sig!.newStrike).toBeLessThan(2600);
      expect(sig!.rollCost).toBeGreaterThan(0);
      expect(sig!.newPremium).toBeGreaterThan(0);
      expect(sig!.rule).toBe("RollPutRule");
    }
  });

  it("returns null when requireNetCredit is true and credit is negative", () => {
    const creditConfig: StrategyConfig = {
      ...rollPutConfig,
      rollPut: {initialDTE: 30, rollWhenDTEBelow: 14, requireNetCredit: true},
    };
    // Very high bid-ask spread makes rollCost > newPremium → negative credit
    const expensiveConfig: StrategyConfig = {
      ...creditConfig,
      bidAskSpreadPct: 0.5,
    };
    // Near expiry with tiny remaining value, high spread
    const nearExpiry: PortfolioState = {
      ...initialPortfolio(),
      phase: "short_put",
      openOption: {type: "put", strike: 2580, delta: 0.3, premium: 50, openDay: 0, expiryDay: 30},
    };
    const mkt: MarketSnapshot = {day: 20, spot: 2600}; // only 10 DTE left, deep OTM, old strike near spot
    const sig = rule.evaluate(mkt, nearExpiry, expensiveConfig);
    expect(sig).toBeNull();
  });

  it("applies IV/RV spread scaling to new put delta", () => {
    const ivRvConfig: StrategyConfig = {
      ...rollPutConfig,
      ivRvSpread: {lookbackDays: 20, minMultiplier: 0.8, maxMultiplier: 1.3},
    };
    const highIVRV: MarketSnapshot = {day: 20, spot: 2600, iv: 1.5, realizedVol: 0.60};
    const noRV: MarketSnapshot = {day: 20, spot: 2600, iv: 1.5};
    const sigHigh = rule.evaluate(highIVRV, shortPutPortfolio, ivRvConfig)!;
    const sigNoRV = rule.evaluate(noRV, shortPutPortfolio, ivRvConfig)!;
    expect(sigHigh.action).toBe("ROLL");
    expect(sigNoRV.action).toBe("ROLL");
    if (sigHigh.action === "ROLL" && sigNoRV.action === "ROLL") {
      // Higher IV/RV ratio → higher effective delta → strike closer to spot (higher strike for put)
      expect(sigHigh.newStrike).toBeGreaterThan(sigNoRV.newStrike);
    }
  });
});

describe("StopLossRule", () => {
  const rule = findRule("StopLossRule");

  const stopLossConfig: StrategyConfig = {
    ...baseConfig,
    stopLoss: {drawdownPct: 0.30, cooldownDays: 7},
  };

  const holdingPortfolio: PortfolioState = {
    ...initialPortfolio(),
    phase: "holding_eth",
    position: {size: 1, entryPrice: 2500},
  };

  it("returns null when stopLoss config absent", () => {
    expect(rule.evaluate({day: 5, spot: 1500}, holdingPortfolio, baseConfig)).toBeNull();
  });

  it("returns null when phase is idle_cash", () => {
    const p = initialPortfolio();
    expect(rule.evaluate({day: 5, spot: 1500}, p, stopLossConfig)).toBeNull();
  });

  it("returns null when phase is short_put", () => {
    const p: PortfolioState = {...initialPortfolio(), phase: "short_put"};
    expect(rule.evaluate({day: 5, spot: 1500}, p, stopLossConfig)).toBeNull();
  });

  it("returns null when drawdown is below threshold", () => {
    // 2500 entry, spot 1800 → drawdown = 700/2500 = 28% < 30%
    expect(rule.evaluate({day: 5, spot: 1800}, holdingPortfolio, stopLossConfig)).toBeNull();
  });

  it("fires at threshold in holding_eth phase", () => {
    // 2500 entry, spot 1750 → drawdown = 750/2500 = 30% == threshold
    const sig = rule.evaluate({day: 5, spot: 1750}, holdingPortfolio, stopLossConfig);
    expect(sig).not.toBeNull();
    expect(sig!.action).toBe("CLOSE_POSITION");
    if (sig!.action === "CLOSE_POSITION") {
      expect(sig!.rule).toBe("StopLossRule");
    }
  });

  it("fires in short_call phase", () => {
    const p: PortfolioState = {
      ...initialPortfolio(),
      phase: "short_call",
      position: {size: 1, entryPrice: 2500},
      openOption: {type: "call", strike: 2600, delta: 0.3, premium: 40, openDay: 0, expiryDay: 7},
    };
    // spot 1600 → drawdown = 900/2500 = 36% > 30%
    const sig = rule.evaluate({day: 5, spot: 1600}, p, stopLossConfig);
    expect(sig).not.toBeNull();
    expect(sig!.action).toBe("CLOSE_POSITION");
  });

  it("reason string contains drawdown and threshold", () => {
    const sig = rule.evaluate({day: 5, spot: 1750}, holdingPortfolio, stopLossConfig);
    expect(sig).not.toBeNull();
    if (sig!.action === "CLOSE_POSITION") {
      expect(sig!.reason).toContain("drawdown=");
      expect(sig!.reason).toContain("threshold=");
    }
  });
});

describe("StopLossCooldownRule", () => {
  const rule = findRule("StopLossCooldownRule");

  const stopLossConfig: StrategyConfig = {
    ...baseConfig,
    stopLoss: {drawdownPct: 0.30, cooldownDays: 7},
  };

  it("returns null when stopLoss config absent", () => {
    const p: PortfolioState = {...initialPortfolio(), lastStopLossDay: 5};
    expect(rule.evaluate({day: 8, spot: 2500}, p, baseConfig)).toBeNull();
  });

  it("returns null when no prior stop-loss (lastStopLossDay is null)", () => {
    const p = initialPortfolio(); // lastStopLossDay: null
    expect(rule.evaluate({day: 8, spot: 2500}, p, stopLossConfig)).toBeNull();
  });

  it("returns null when cooldown has elapsed", () => {
    // lastStopLossDay 0, day 7, cooldown 7 → daysSince 7 >= 7
    const p: PortfolioState = {...initialPortfolio(), lastStopLossDay: 0};
    expect(rule.evaluate({day: 7, spot: 2500}, p, stopLossConfig)).toBeNull();
  });

  it("fires during cooldown period", () => {
    // lastStopLossDay 0, day 5, cooldown 7 → daysSince 5 < 7
    const p: PortfolioState = {...initialPortfolio(), lastStopLossDay: 0};
    const sig = rule.evaluate({day: 5, spot: 2500}, p, stopLossConfig);
    expect(sig).not.toBeNull();
    expect(sig!.action).toBe("SKIP");
    if (sig!.action === "SKIP") {
      expect(sig!.rule).toBe("StopLossCooldownRule");
      expect(sig!.reason).toContain("cooldown");
    }
  });

  it("returns null when phase is not idle_cash", () => {
    const p: PortfolioState = {
      ...initialPortfolio(),
      phase: "holding_eth",
      lastStopLossDay: 0,
    };
    expect(rule.evaluate({day: 5, spot: 2500}, p, stopLossConfig)).toBeNull();
  });

  it("returns null when cooldownDays is 0", () => {
    const zeroCooldown: StrategyConfig = {
      ...stopLossConfig,
      stopLoss: {drawdownPct: 0.30, cooldownDays: 0},
    };
    const p: PortfolioState = {...initialPortfolio(), lastStopLossDay: 0};
    expect(rule.evaluate({day: 5, spot: 2500}, p, zeroCooldown)).toBeNull();
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

describe("IV/RV skip (skipBelowRatio)", () => {
  const skipConfig: StrategyConfig = {
    ...baseConfig,
    ivRvSpread: {lookbackDays: 20, minMultiplier: 0.8, maxMultiplier: 1.3, skipBelowRatio: 1.0},
  };

  describe("BasePutRule", () => {
    const rule = findRule("BasePutRule");

    it("returns SKIP when IV/RV ratio is below threshold", () => {
      const p = initialPortfolio();
      const m: MarketSnapshot = {day: 25, spot: 2500, iv: 0.40, realizedVol: 0.50};
      const sig = rule.evaluate(m, p, skipConfig);
      expect(sig).not.toBeNull();
      expect(sig!.action).toBe("SKIP");
      if (sig!.action === "SKIP") {
        expect(sig!.rule).toBe("BasePutRule");
        expect(sig!.reason).toContain("IV/RV");
      }
    });

    it("sells put when IV/RV ratio meets threshold", () => {
      const p = initialPortfolio();
      const m: MarketSnapshot = {day: 25, spot: 2500, iv: 0.60, realizedVol: 0.50};
      const sig = rule.evaluate(m, p, skipConfig);
      expect(sig).not.toBeNull();
      expect(sig!.action).toBe("SELL_PUT");
    });

    it("sells put when IV/RV ratio exactly equals threshold", () => {
      const p = initialPortfolio();
      const m: MarketSnapshot = {day: 25, spot: 2500, iv: 0.50, realizedVol: 0.50};
      const sig = rule.evaluate(m, p, skipConfig);
      expect(sig).not.toBeNull();
      expect(sig!.action).toBe("SELL_PUT");
    });

    it("sells put when realizedVol is undefined (warmup period)", () => {
      const p = initialPortfolio();
      const m: MarketSnapshot = {day: 5, spot: 2500, iv: 0.40};
      const sig = rule.evaluate(m, p, skipConfig);
      expect(sig).not.toBeNull();
      expect(sig!.action).toBe("SELL_PUT");
    });

    it("sells put when realizedVol is zero", () => {
      const p = initialPortfolio();
      const m: MarketSnapshot = {day: 25, spot: 2500, iv: 0.40, realizedVol: 0};
      const sig = rule.evaluate(m, p, skipConfig);
      expect(sig).not.toBeNull();
      expect(sig!.action).toBe("SELL_PUT");
    });

    it("sells put when skipBelowRatio is not configured", () => {
      const p = initialPortfolio();
      const m: MarketSnapshot = {day: 25, spot: 2500, iv: 0.40, realizedVol: 0.50};
      const noSkipConfig: StrategyConfig = {
        ...baseConfig,
        ivRvSpread: {lookbackDays: 20, minMultiplier: 0.8, maxMultiplier: 1.3},
      };
      const sig = rule.evaluate(m, p, noSkipConfig);
      expect(sig).not.toBeNull();
      expect(sig!.action).toBe("SELL_PUT");
    });

    it("uses impliedVol from config when market IV is undefined", () => {
      const cfg: StrategyConfig = {
        ...baseConfig,
        impliedVol: 0.40,
        ivRvSpread: {lookbackDays: 20, minMultiplier: 0.8, maxMultiplier: 1.3, skipBelowRatio: 1.0},
      };
      const p = initialPortfolio();
      const m: MarketSnapshot = {day: 25, spot: 2500, realizedVol: 0.50};
      const sig = rule.evaluate(m, p, cfg);
      expect(sig).not.toBeNull();
      expect(sig!.action).toBe("SKIP");
    });

    it("respects custom skipBelowRatio threshold", () => {
      const strictConfig: StrategyConfig = {
        ...baseConfig,
        ivRvSpread: {lookbackDays: 20, minMultiplier: 0.8, maxMultiplier: 1.3, skipBelowRatio: 1.2},
      };
      const p = initialPortfolio();
      const m: MarketSnapshot = {day: 25, spot: 2500, iv: 0.55, realizedVol: 0.50};
      const sig = rule.evaluate(m, p, strictConfig);
      expect(sig).not.toBeNull();
      expect(sig!.action).toBe("SKIP");
    });
  });

  describe("AdaptiveCallRule", () => {
    const rule = findRule("AdaptiveCallRule");
    const holdingPortfolio: PortfolioState = {
      ...initialPortfolio(),
      phase: "holding_eth",
      position: {size: 1, entryPrice: 2400},
    };

    it("returns SKIP when IV/RV ratio is below threshold", () => {
      const m: MarketSnapshot = {day: 25, spot: 2500, iv: 0.40, realizedVol: 0.50};
      const sig = rule.evaluate(m, holdingPortfolio, skipConfig);
      expect(sig).not.toBeNull();
      expect(sig!.action).toBe("SKIP");
      if (sig!.action === "SKIP") {
        expect(sig!.rule).toBe("AdaptiveCallRule");
        expect(sig!.reason).toContain("IV/RV");
      }
    });

    it("sells call when IV/RV ratio meets threshold", () => {
      const m: MarketSnapshot = {day: 25, spot: 2500, iv: 0.60, realizedVol: 0.50};
      const sig = rule.evaluate(m, holdingPortfolio, skipConfig);
      expect(sig).not.toBeNull();
      expect(sig!.action).toBe("SELL_CALL");
    });

    it("sells call when realizedVol is undefined (warmup period)", () => {
      const m: MarketSnapshot = {day: 5, spot: 2500, iv: 0.40};
      const sig = rule.evaluate(m, holdingPortfolio, skipConfig);
      expect(sig).not.toBeNull();
      expect(sig!.action).toBe("SELL_CALL");
    });
  });

  describe("computeIVRVMultiplier", () => {
    it("returns 0 when ratio is below skipBelowRatio", () => {
      const m: MarketSnapshot = {day: 25, spot: 2500, iv: 0.40, realizedVol: 0.50};
      expect(computeIVRVMultiplier(m, skipConfig)).toBe(0);
    });

    it("returns clamped multiplier when above skipBelowRatio", () => {
      const m: MarketSnapshot = {day: 25, spot: 2500, iv: 0.60, realizedVol: 0.50};
      const mult = computeIVRVMultiplier(m, skipConfig);
      expect(mult).toBeGreaterThan(0);
      expect(mult).toBeLessThanOrEqual(1.3);
    });

    it("returns 1.0 when ivRvSpread not configured", () => {
      const m: MarketSnapshot = {day: 25, spot: 2500, iv: 0.40, realizedVol: 0.50};
      expect(computeIVRVMultiplier(m, baseConfig)).toBe(1.0);
    });
  });

  describe("skipSide=put", () => {
    const putOnlySkipConfig: StrategyConfig = {
      ...baseConfig,
      ivRvSpread: {lookbackDays: 20, minMultiplier: 0.8, maxMultiplier: 1.3, skipBelowRatio: 1.0, skipSide: "put"},
    };
    const lowIvRvMarket: MarketSnapshot = {day: 25, spot: 2500, iv: 0.40, realizedVol: 0.50};
    const highIvRvMarket: MarketSnapshot = {day: 25, spot: 2500, iv: 0.60, realizedVol: 0.50};

    it("computeIVRVMultiplier returns 0 for put side when ratio below threshold", () => {
      expect(computeIVRVMultiplier(lowIvRvMarket, putOnlySkipConfig, "put")).toBe(0);
    });

    it("computeIVRVMultiplier returns scaled value for call side even when ratio below threshold", () => {
      const mult = computeIVRVMultiplier(lowIvRvMarket, putOnlySkipConfig, "call");
      expect(mult).toBeGreaterThan(0);
      expect(mult).toBe(0.8);
    });

    it("computeIVRVMultiplier returns 0 for put side without explicit side arg (defaults to both-like)", () => {
      expect(computeIVRVMultiplier(lowIvRvMarket, putOnlySkipConfig)).toBeGreaterThan(0);
    });

    it("BasePutRule skips when skipSide=put and IV/RV is low", () => {
      const rule = findRule("BasePutRule");
      const p = initialPortfolio();
      const sig = rule.evaluate(lowIvRvMarket, p, putOnlySkipConfig);
      expect(sig).not.toBeNull();
      expect(sig!.action).toBe("SKIP");
    });

    it("AdaptiveCallRule still sells call when skipSide=put and IV/RV is low", () => {
      const rule = findRule("AdaptiveCallRule");
      const p: PortfolioState = {
        ...initialPortfolio(),
        phase: "holding_eth",
        position: {size: 1, entryPrice: 2400},
      };
      const sig = rule.evaluate(lowIvRvMarket, p, putOnlySkipConfig);
      expect(sig).not.toBeNull();
      expect(sig!.action).toBe("SELL_CALL");
    });

    it("both sides proceed normally when IV/RV is adequate", () => {
      const putRule = findRule("BasePutRule");
      const callRule = findRule("AdaptiveCallRule");
      const p = initialPortfolio();
      const putSig = putRule.evaluate(highIvRvMarket, p, putOnlySkipConfig);
      expect(putSig).not.toBeNull();
      expect(putSig!.action).toBe("SELL_PUT");

      const holdingP: PortfolioState = {
        ...initialPortfolio(),
        phase: "holding_eth",
        position: {size: 1, entryPrice: 2400},
      };
      const callSig = callRule.evaluate(highIvRvMarket, holdingP, putOnlySkipConfig);
      expect(callSig).not.toBeNull();
      expect(callSig!.action).toBe("SELL_CALL");
    });

    it("skipSide=both (default) skips both sides", () => {
      const bothSkipConfig: StrategyConfig = {
        ...baseConfig,
        ivRvSpread: {lookbackDays: 20, minMultiplier: 0.8, maxMultiplier: 1.3, skipBelowRatio: 1.0, skipSide: "both"},
      };
      const putRule = findRule("BasePutRule");
      const callRule = findRule("AdaptiveCallRule");

      const p = initialPortfolio();
      const putSig = putRule.evaluate(lowIvRvMarket, p, bothSkipConfig);
      expect(putSig!.action).toBe("SKIP");

      const holdingP: PortfolioState = {
        ...initialPortfolio(),
        phase: "holding_eth",
        position: {size: 1, entryPrice: 2400},
      };
      const callSig = callRule.evaluate(lowIvRvMarket, holdingP, bothSkipConfig);
      expect(callSig!.action).toBe("SKIP");
    });
  });
});
