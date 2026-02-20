import {describe, it, expect} from "vitest";
import {SimExecutor} from "../src/components/strategy/executor.js";
import {initialPortfolio} from "../src/components/strategy/state.js";
import type {PortfolioState, StrategyConfig, MarketSnapshot} from "../src/components/strategy/types.js";

const config: StrategyConfig = {
  targetDelta: 0.30, impliedVol: 0.92, riskFreeRate: 0.05,
  cycleLengthDays: 7, contracts: 1, bidAskSpreadPct: 0.05, feePerTrade: 0.50,
};

const executor = new SimExecutor();

describe("resolveExpiration", () => {
  it("put OTM: emits OPTION_EXPIRED only (no PREMIUM_COLLECTED)", () => {
    const p: PortfolioState = {
      ...initialPortfolio(),
      phase: "short_put",
      openOption: {type: "put", strike: 2400, delta: 0.3, premium: 50, openDay: 0, expiryDay: 7},
    };
    const market: MarketSnapshot = {day: 7, spot: 2500};
    const events = executor.resolveExpiration(market, p, config);

    const expired = events.find((e) => e.type === "OPTION_EXPIRED");
    expect(expired).toBeDefined();
    expect(expired!.type === "OPTION_EXPIRED" && expired!.assigned).toBe(false);

    expect(events.find((e) => e.type === "PREMIUM_COLLECTED")).toBeUndefined();
    expect(events.find((e) => e.type === "ETH_BOUGHT")).toBeUndefined();
  });

  it("put ITM: emits OPTION_EXPIRED + ETH_BOUGHT (no PREMIUM_COLLECTED)", () => {
    const p: PortfolioState = {
      ...initialPortfolio(),
      phase: "short_put",
      openOption: {type: "put", strike: 2400, delta: 0.3, premium: 50, openDay: 0, expiryDay: 7},
    };
    const market: MarketSnapshot = {day: 7, spot: 2300};
    const events = executor.resolveExpiration(market, p, config);

    expect(events.find((e) => e.type === "PREMIUM_COLLECTED")).toBeUndefined();

    const expired = events.find((e) => e.type === "OPTION_EXPIRED");
    expect(expired!.type === "OPTION_EXPIRED" && expired!.assigned).toBe(true);

    const bought = events.find((e) => e.type === "ETH_BOUGHT");
    expect(bought).toBeDefined();
    if (bought!.type === "ETH_BOUGHT") {
      expect(bought!.price).toBe(2400);
      expect(bought!.size).toBe(1);
    }
  });

  it("call OTM: emits OPTION_EXPIRED only (no PREMIUM_COLLECTED)", () => {
    const p: PortfolioState = {
      ...initialPortfolio(),
      phase: "short_call",
      position: {size: 1, entryPrice: 2400},
      openOption: {type: "call", strike: 2600, delta: 0.3, premium: 40, openDay: 7, expiryDay: 14},
    };
    const market: MarketSnapshot = {day: 14, spot: 2500};
    const events = executor.resolveExpiration(market, p, config);

    const expired = events.find((e) => e.type === "OPTION_EXPIRED");
    expect(expired!.type === "OPTION_EXPIRED" && expired!.assigned).toBe(false);
    expect(events.find((e) => e.type === "PREMIUM_COLLECTED")).toBeUndefined();
    expect(events.find((e) => e.type === "ETH_SOLD")).toBeUndefined();
  });

  it("call ITM: emits OPTION_EXPIRED + ETH_SOLD (no PREMIUM_COLLECTED)", () => {
    const p: PortfolioState = {
      ...initialPortfolio(),
      phase: "short_call",
      position: {size: 1, entryPrice: 2400},
      openOption: {type: "call", strike: 2600, delta: 0.3, premium: 40, openDay: 7, expiryDay: 14},
    };
    const market: MarketSnapshot = {day: 14, spot: 2700};
    const events = executor.resolveExpiration(market, p, config);

    expect(events.find((e) => e.type === "PREMIUM_COLLECTED")).toBeUndefined();

    const expired = events.find((e) => e.type === "OPTION_EXPIRED");
    expect(expired!.type === "OPTION_EXPIRED" && expired!.assigned).toBe(true);

    const sold = events.find((e) => e.type === "ETH_SOLD");
    expect(sold).toBeDefined();
    if (sold!.type === "ETH_SOLD") {
      expect(sold!.price).toBe(2600);
      expect(sold!.pl).toBe(200);
    }
  });

  it("returns empty when no open option", () => {
    const p = initialPortfolio();
    const events = executor.resolveExpiration({day: 7, spot: 2500}, p, config);
    expect(events).toEqual([]);
  });
});

describe("execute", () => {
  it("SELL_PUT emits OPTION_SOLD + PREMIUM_COLLECTED", () => {
    const p = initialPortfolio();
    const market: MarketSnapshot = {day: 0, spot: 2500};
    const events = executor.execute(
      {action: "SELL_PUT", strike: 2400, delta: 0.3, premium: 50, rule: "test", reason: ""},
      market, p, config,
    );
    expect(events.length).toBe(2);
    expect(events[0].type).toBe("OPTION_SOLD");
    if (events[0].type === "OPTION_SOLD") {
      expect(events[0].optionType).toBe("put");
      expect(events[0].strike).toBe(2400);
      expect(events[0].openDay).toBe(0);
      expect(events[0].expiryDay).toBe(7);
    }
    const premium = events[1];
    expect(premium.type).toBe("PREMIUM_COLLECTED");
    if (premium.type === "PREMIUM_COLLECTED") {
      expect(premium.grossPremium).toBe(50 * config.contracts);
      expect(premium.fees).toBe(config.feePerTrade * config.contracts);
      expect(premium.netAmount).toBe(50 * config.contracts - config.feePerTrade * config.contracts);
    }
  });

  it("SELL_CALL emits OPTION_SOLD + PREMIUM_COLLECTED", () => {
    const p: PortfolioState = {
      ...initialPortfolio(),
      phase: "holding_eth",
      position: {size: 1, entryPrice: 2400},
    };
    const market: MarketSnapshot = {day: 7, spot: 2500};
    const events = executor.execute(
      {action: "SELL_CALL", strike: 2600, delta: 0.3, premium: 40, rule: "test", reason: ""},
      market, p, config,
    );
    expect(events.length).toBe(2);
    expect(events[0].type).toBe("OPTION_SOLD");
    expect(events[0].type === "OPTION_SOLD" && events[0].optionType).toBe("call");
    const premium = events[1];
    expect(premium.type).toBe("PREMIUM_COLLECTED");
    if (premium.type === "PREMIUM_COLLECTED") {
      expect(premium.grossPremium).toBe(40 * config.contracts);
      expect(premium.netAmount).toBe(40 * config.contracts - config.feePerTrade * config.contracts);
    }
  });

  it("SKIP emits CYCLE_SKIPPED", () => {
    const events = executor.execute(
      {action: "SKIP", rule: "test", reason: "low premium"},
      {day: 0, spot: 2500}, initialPortfolio(), config,
    );
    expect(events.length).toBe(1);
    expect(events[0].type).toBe("CYCLE_SKIPPED");
  });

  it("CLOSE_POSITION emits POSITION_CLOSED with P/L", () => {
    const p: PortfolioState = {
      ...initialPortfolio(),
      phase: "holding_eth",
      position: {size: 1, entryPrice: 2400},
    };
    const events = executor.execute(
      {action: "CLOSE_POSITION", rule: "test", reason: "stop-loss"},
      {day: 10, spot: 2200}, p, config,
    );
    expect(events.length).toBe(1);
    if (events[0].type === "POSITION_CLOSED") {
      expect(events[0].pl).toBe(-200);
      expect(events[0].price).toBe(2200);
    }
  });

  it("HOLD emits no events", () => {
    const events = executor.execute(
      {action: "HOLD"},
      {day: 0, spot: 2500}, initialPortfolio(), config,
    );
    expect(events).toEqual([]);
  });

  it("ROLL emits OPTION_ROLLED with correct fields", () => {
    const p: PortfolioState = {
      ...initialPortfolio(),
      phase: "short_call",
      position: {size: 1, entryPrice: 2400},
      openOption: {type: "call", strike: 2600, delta: 0.3, premium: 40, openDay: 0, expiryDay: 7},
    };
    const market: MarketSnapshot = {day: 3, spot: 2800};
    const events = executor.execute(
      {action: "ROLL", newStrike: 2900, newDelta: 0.25, rollCost: 55, newPremium: 60, credit: 3, rule: "RollCallRule", reason: "test"},
      market, p, config,
    );
    expect(events.length).toBe(1);
    const e = events[0];
    expect(e.type).toBe("OPTION_ROLLED");
    if (e.type === "OPTION_ROLLED") {
      expect(e.oldStrike).toBe(2600);
      expect(e.newStrike).toBe(2900);
      expect(e.newDelta).toBe(0.25);
      expect(e.originalPremium).toBe(40 * config.contracts);
      expect(e.rollCost).toBe(55 * config.contracts);
      expect(e.newPremium).toBe(60);
      expect(e.fees).toBe(2 * config.feePerTrade * config.contracts);
      expect(e.openDay).toBe(3);
      expect(e.expiryDay).toBe(3 + config.cycleLengthDays);
    }
  });

  it("ROLL with no openOption returns empty array", () => {
    const p = initialPortfolio();
    const events = executor.execute(
      {action: "ROLL", newStrike: 2900, newDelta: 0.25, rollCost: 55, newPremium: 60, credit: 3, rule: "RollCallRule", reason: "test"},
      {day: 3, spot: 2800}, p, config,
    );
    expect(events).toEqual([]);
  });
});
