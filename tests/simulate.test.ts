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

  it("realizedPL reflects premium immediately after option sale", () => {
    // Use a short sim: day 0 sells a put, day 1 we check realizedPL is already positive
    const prices = makePrices(1, 10);
    const result = simulate(prices, defaultRules(), config);

    // Find the first SELL_PUT signal
    const sellEntry = result.signalLog.find((e) => e.signal.action === "SELL_PUT");
    expect(sellEntry).toBeDefined();

    // After selling, realizedPL should already include premium minus fees
    const afterSell = sellEntry!.portfolioAfter;
    expect(afterSell.realizedPL).toBeGreaterThan(0);
    expect(afterSell.totalPremiumCollected).toBeGreaterThan(0);
  });

  it("realizedPL does not double-count premium at expiry", () => {
    // Run a full cycle: sell put on day 0, expires OTM on day 7
    // Premium should be counted once (at sale), not again at expiry
    const prices = Array(10).fill(2500); // flat prices, put expires OTM
    const result = simulate(prices, defaultRules(), config);

    const sellEntry = result.signalLog.find((e) => e.signal.action === "SELL_PUT");
    expect(sellEntry).toBeDefined();
    const plAfterSell = sellEntry!.portfolioAfter.realizedPL;
    const premiumAfterSell = sellEntry!.portfolioAfter.totalPremiumCollected;

    // Find expiry resolution (HOLD with OPTION_EXPIRED event)
    const expiryEntry = result.signalLog.find((e) =>
      e.events.some((ev) => ev.type === "OPTION_EXPIRED"),
    );
    expect(expiryEntry).toBeDefined();

    // No PREMIUM_COLLECTED event at expiry
    const premiumAtExpiry = expiryEntry!.events.filter((ev) => ev.type === "PREMIUM_COLLECTED");
    expect(premiumAtExpiry.length).toBe(0);

    // P&L should not have increased from the premium again
    const plAfterExpiry = expiryEntry!.portfolioAfter.realizedPL;
    expect(plAfterExpiry).toBe(plAfterSell);

    // totalPremiumCollected should not have increased either
    expect(expiryEntry!.portfolioAfter.totalPremiumCollected).toBe(premiumAfterSell);
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

describe("simulate with rollCall", () => {
  // Price scenario that reaches short_call then rallies past the call strike:
  // Days 0-6: put sold on day 0, price crashes below put strike for assignment on day 7
  // Day 7: put assigned → holding_eth, call sold
  // Days 8-13: rally sharply above call strike to trigger the roll
  // Day 14+: expiry of the rolled call
  function makeRollPrices(): number[] {
    // Day 0: spot 2500 → put strike ~2392 (delta 0.30, vol 0.92, 7d)
    // Days 1-6: crash well below 2392 so put is ITM at expiry
    // Day 7: spot < put strike → assigned. Now holding_eth at ~2392 entry.
    //         Call sold: with spot ~2100, call strike will be above spot.
    //         At delta 0.30 with spot 2100, call strike ≈ 2200-2300.
    // Days 8-13: rally above call strike * 1.05 to trigger roll.
    const prices: number[] = [
      2500,  // d0: sell put, strike ~2392
      2400, 2300, 2200, 2150, 2100, 2100, // d1-6: crash
      2100,  // d7: put expires ITM (2100 < 2392), assigned → sell call
      2200,  // d8: warming up
      2500,  // d9: likely above call strike * 1.05
      2600,  // d10: definitely above
      2700,  // d11
      2800,  // d12
      2900,  // d13
      3000,  // d14: call expiry
      3000,  // d15: buffer
    ];
    return prices;
  }

  it("produces ROLL signals mid-cycle with requireNetCredit: false", () => {
    const rollConfig: StrategyConfig = {
      ...config,
      rollCall: {itmThresholdPct: 0.05, requireNetCredit: false},
    };

    const result = simulate(makeRollPrices(), defaultRules(), rollConfig);
    const rollSignals = result.signalLog.filter((e) => e.signal.action === "ROLL");
    expect(rollSignals.length).toBeGreaterThan(0);

    for (const entry of rollSignals) {
      const openOpt = entry.portfolioBefore.openOption;
      expect(openOpt).not.toBeNull();
      expect(entry.day).toBeLessThan(openOpt!.expiryDay);
    }

    const rollEvents = rollSignals.flatMap((e) => e.events.filter((ev) => ev.type === "OPTION_ROLLED"));
    expect(rollEvents.length).toBeGreaterThan(0);
  });

  it("requireNetCredit: true blocks rolls when buyback exceeds new premium", () => {
    const rollConfig: StrategyConfig = {
      ...config,
      rollCall: {itmThresholdPct: 0.05, requireNetCredit: true},
    };

    const result = simulate(makeRollPrices(), defaultRules(), rollConfig);
    const rollSignals = result.signalLog.filter((e) => e.signal.action === "ROLL");
    expect(rollSignals.length).toBe(0);
  });

  it("totalPremiumCollected includes newPremium from rolls (not originalPremium)", () => {
    const rollConfig: StrategyConfig = {
      ...config,
      rollCall: {itmThresholdPct: 0.05, requireNetCredit: false},
    };

    const result = simulate(makeRollPrices(), defaultRules(), rollConfig);

    const premiumFromCollected = result.signalLog.flatMap((e) => e.events)
      .filter((ev): ev is Extract<typeof ev, {type: "PREMIUM_COLLECTED"}> => ev.type === "PREMIUM_COLLECTED")
      .reduce((sum, ev) => sum + ev.grossPremium, 0);
    const premiumFromRolls = result.signalLog.flatMap((e) => e.events)
      .filter((ev): ev is Extract<typeof ev, {type: "OPTION_ROLLED"}> => ev.type === "OPTION_ROLLED")
      .reduce((sum, ev) => sum + ev.newPremium, 0);
    expect(result.summary.totalPremiumCollected).toBeCloseTo(premiumFromCollected + premiumFromRolls, 6);
  });

  it("realizedPL increases by netCredit on each roll", () => {
    const rollConfig: StrategyConfig = {
      ...config,
      rollCall: {itmThresholdPct: 0.05, requireNetCredit: false},
    };

    const result = simulate(makeRollPrices(), defaultRules(), rollConfig);
    const rollEntries = result.signalLog.filter((e) => e.signal.action === "ROLL");
    expect(rollEntries.length).toBeGreaterThan(0);

    for (const entry of rollEntries) {
      const rolled = entry.events.find((ev) => ev.type === "OPTION_ROLLED");
      expect(rolled).toBeDefined();
      if (rolled && rolled.type === "OPTION_ROLLED") {
        const expectedChange = rolled.newPremium - rolled.rollCost - rolled.fees;
        const actualChange = entry.portfolioAfter.realizedPL - entry.portfolioBefore.realizedPL;
        expect(actualChange).toBeCloseTo(expectedChange, 6);
      }
    }
  });
});

describe("simulate with stopLoss", () => {
  const stopLossConfig: StrategyConfig = {
    ...config,
    stopLoss: {drawdownPct: 0.20, cooldownDays: 5},
  };

  function makeStopLossPrices(): number[] {
    // Day 0: sell put, strike ~2200 (spot 2500, delta 0.30)
    // Days 1-7: crash well below 2200 for assignment on day 7
    // Day 7: put assigned → holding_eth at entry ~2200
    //         holding_eth phase — spot must now drop 20% from ~2200 = ~1760 for stop-loss
    // Day 8: sell call, then on day 9 crash far below entry to trigger stop-loss mid-cycle
    const prices: number[] = [
      2500,               // d0: sell put
      2400, 2300, 2200, 2100, 2050, 2000, // d1-6: crash
      2000,               // d7: put expires assigned (~2200 strike), holding_eth
      2000,               // d8: sell call (decision point)
      1700,               // d9: spot drops 32% from ~2200 entry → stop-loss fires
      1700, 1700, 1700, 1700, 1700, 1700, // d10-15: buffer
    ];
    return prices;
  }

  it("stop-loss fires mid-cycle on steep price drop", () => {
    const result = simulate(makeStopLossPrices(), defaultRules(), stopLossConfig);
    const stopLossSignals = result.signalLog.filter(
      (e) => e.signal.action === "CLOSE_POSITION" && e.signal.rule === "StopLossRule",
    );
    expect(stopLossSignals.length).toBeGreaterThan(0);
    expect(result.summary.totalStopLosses).toBeGreaterThan(0);
  });

  it("no stop-loss fires without config (backward compat)", () => {
    const result = simulate(makeStopLossPrices(), defaultRules(), config);
    const stopLossSignals = result.signalLog.filter(
      (e) => e.signal.action === "CLOSE_POSITION" && e.signal.rule === "StopLossRule",
    );
    expect(stopLossSignals.length).toBe(0);
    expect(result.summary.totalStopLosses).toBe(0);
  });

  it("identical results without stopLoss config (backward compat)", () => {
    const prices = makePrices(42, 30);
    const r1 = simulate(prices, defaultRules(), config);
    const r2 = simulate(prices, defaultRules(), config);
    expect(r1.summary.totalRealizedPL).toBe(r2.summary.totalRealizedPL);
    expect(r1.summary.totalStopLosses).toBe(0);
    expect(r2.summary.totalStopLosses).toBe(0);
  });

  it("open call is bought back before position close", () => {
    const result = simulate(makeStopLossPrices(), defaultRules(), stopLossConfig);
    const stopLossSignals = result.signalLog.filter(
      (e) => e.signal.action === "CLOSE_POSITION" && e.signal.rule === "StopLossRule",
    );
    // For any stop-loss that fires when a call is open, OPTION_BOUGHT_BACK precedes POSITION_CLOSED
    for (const entry of stopLossSignals) {
      const hasBuyback = entry.events.some((e) => e.type === "OPTION_BOUGHT_BACK");
      const hasClose = entry.events.some((e) => e.type === "POSITION_CLOSED");
      if (hasBuyback) {
        expect(hasClose).toBe(true);
        const buybackIdx = entry.events.findIndex((e) => e.type === "OPTION_BOUGHT_BACK");
        const closeIdx = entry.events.findIndex((e) => e.type === "POSITION_CLOSED");
        expect(buybackIdx).toBeLessThan(closeIdx);
      }
    }
  });

  it("cooldown prevents immediate re-entry after stop-loss", () => {
    const result = simulate(makeStopLossPrices(), defaultRules(), stopLossConfig);
    const stopLossEntries = result.signalLog.filter(
      (e) => e.signal.action === "CLOSE_POSITION" && e.signal.rule === "StopLossRule",
    );
    if (stopLossEntries.length === 0) return;

    const stopDay = stopLossEntries[0].day;
    const cooldownDays = stopLossConfig.stopLoss!.cooldownDays;

    // Any SELL_PUT within cooldown window must not exist
    const earlyPuts = result.signalLog.filter(
      (e) => e.signal.action === "SELL_PUT" && e.day > stopDay && e.day < stopDay + cooldownDays,
    );
    expect(earlyPuts.length).toBe(0);
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

describe("simulate with rollPut", () => {
  const rollPutConfig: StrategyConfig = {
    ...config,
    cycleLengthDays: 7,
    rollPut: {initialDTE: 30, rollWhenDTEBelow: 14, requireNetCredit: false},
  };

  // Flat prices: put stays OTM the whole time. The put is sold at initialDTE=30.
  // When 14 DTE remain (day 16), the rule should roll since spot > strike.
  function makeFlatPrices(days: number): number[] {
    return Array(days).fill(2500);
  }

  it("put rolls mid-cycle when DTE drops below threshold (flat prices)", () => {
    const prices = makeFlatPrices(60);
    const result = simulate(prices, defaultRules(), rollPutConfig);
    const rollSignals = result.signalLog.filter((e) => e.signal.action === "ROLL" && e.signal.rule === "RollPutRule");
    expect(rollSignals.length).toBeGreaterThan(0);
    expect(result.summary.totalPutRolls).toBeGreaterThan(0);
  });

  it("rolled put uses initialDTE for new expiryDay", () => {
    const prices = makeFlatPrices(60);
    const result = simulate(prices, defaultRules(), rollPutConfig);
    const rollEntries = result.signalLog.filter((e) => e.signal.action === "ROLL" && e.signal.rule === "RollPutRule");
    for (const entry of rollEntries) {
      const rolled = entry.events.find((ev) => ev.type === "OPTION_ROLLED");
      expect(rolled).toBeDefined();
      if (rolled && rolled.type === "OPTION_ROLLED") {
        expect(rolled.expiryDay).toBe(entry.day + rollPutConfig.rollPut!.initialDTE);
      }
    }
  });

  it("no roll when put is ITM (crashed prices)", () => {
    // Prices crash below put strike immediately — put is always ITM, should not roll
    const prices = [2500, ...Array(59).fill(1500)];
    const result = simulate(prices, defaultRules(), rollPutConfig);
    const rollSignals = result.signalLog.filter((e) => e.signal.action === "ROLL" && e.signal.rule === "RollPutRule");
    expect(rollSignals.length).toBe(0);
  });

  it("no put rolling without rollPut config (backward compat)", () => {
    const prices = makeFlatPrices(60);
    const result = simulate(prices, defaultRules(), config);
    const rollSignals = result.signalLog.filter((e) => e.signal.action === "ROLL" && e.signal.rule === "RollPutRule");
    expect(rollSignals.length).toBe(0);
    expect(result.summary.totalPutRolls).toBe(0);
  });

  it("totalPutRolls tracked in summary", () => {
    const prices = makeFlatPrices(100);
    const result = simulate(prices, defaultRules(), rollPutConfig);
    const putRollEvents = result.signalLog.flatMap((e) => e.events)
      .filter((ev) => ev.type === "OPTION_ROLLED" && ev.optionType === "put");
    expect(result.summary.totalPutRolls).toBe(putRollEvents.length);
  });
});
