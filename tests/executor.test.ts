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
  it("put OTM: emits OPTION_EXPIRED(assigned=false) + PREMIUM_COLLECTED", () => {
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

    const premium = events.find((e) => e.type === "PREMIUM_COLLECTED");
    expect(premium).toBeDefined();
    if (premium!.type === "PREMIUM_COLLECTED") {
      expect(premium!.grossPremium).toBe(50);
      expect(premium!.netAmount).toBe(50 - 0.5);
    }

    expect(events.find((e) => e.type === "ETH_BOUGHT")).toBeUndefined();
  });

  it("put ITM: emits OPTION_EXPIRED(assigned=true) + PREMIUM_COLLECTED + ETH_BOUGHT", () => {
    const p: PortfolioState = {
      ...initialPortfolio(),
      phase: "short_put",
      openOption: {type: "put", strike: 2400, delta: 0.3, premium: 50, openDay: 0, expiryDay: 7},
    };
    const market: MarketSnapshot = {day: 7, spot: 2300};
    const events = executor.resolveExpiration(market, p, config);

    const expired = events.find((e) => e.type === "OPTION_EXPIRED");
    expect(expired!.type === "OPTION_EXPIRED" && expired!.assigned).toBe(true);

    const bought = events.find((e) => e.type === "ETH_BOUGHT");
    expect(bought).toBeDefined();
    if (bought!.type === "ETH_BOUGHT") {
      expect(bought!.price).toBe(2400);
      expect(bought!.size).toBe(1);
    }
  });

  it("call OTM: emits OPTION_EXPIRED(assigned=false) + PREMIUM_COLLECTED", () => {
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
    expect(events.find((e) => e.type === "ETH_SOLD")).toBeUndefined();
  });

  it("call ITM: emits OPTION_EXPIRED(assigned=true) + PREMIUM_COLLECTED + ETH_SOLD", () => {
    const p: PortfolioState = {
      ...initialPortfolio(),
      phase: "short_call",
      position: {size: 1, entryPrice: 2400},
      openOption: {type: "call", strike: 2600, delta: 0.3, premium: 40, openDay: 7, expiryDay: 14},
    };
    const market: MarketSnapshot = {day: 14, spot: 2700};
    const events = executor.resolveExpiration(market, p, config);

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
  it("SELL_PUT emits OPTION_SOLD with correct fields", () => {
    const p = initialPortfolio();
    const market: MarketSnapshot = {day: 0, spot: 2500};
    const events = executor.execute(
      {action: "SELL_PUT", strike: 2400, delta: 0.3, premium: 50, rule: "test", reason: ""},
      market, p, config,
    );
    expect(events.length).toBe(1);
    const e = events[0];
    expect(e.type).toBe("OPTION_SOLD");
    if (e.type === "OPTION_SOLD") {
      expect(e.optionType).toBe("put");
      expect(e.strike).toBe(2400);
      expect(e.openDay).toBe(0);
      expect(e.expiryDay).toBe(7);
    }
  });

  it("SELL_CALL emits OPTION_SOLD for call", () => {
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
    expect(events.length).toBe(1);
    expect(events[0].type === "OPTION_SOLD" && events[0].optionType).toBe("call");
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
});
