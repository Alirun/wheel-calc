import {describe, it, expect} from "vitest";
import {initialPortfolio, applyEvents, snapshotPortfolio} from "../src/components/strategy/state.js";
import type {PortfolioState, Event} from "../src/components/strategy/types.js";

describe("initialPortfolio", () => {
  it("starts in idle_cash with all counters at zero", () => {
    const p = initialPortfolio();
    expect(p.phase).toBe("idle_cash");
    expect(p.position).toBeNull();
    expect(p.openOption).toBeNull();
    expect(p.realizedPL).toBe(0);
    expect(p.totalPremiumCollected).toBe(0);
    expect(p.totalAssignments).toBe(0);
    expect(p.totalSkippedCycles).toBe(0);
  });
});

describe("snapshotPortfolio", () => {
  it("creates a deep copy", () => {
    const p = initialPortfolio();
    p.position = {size: 1, entryPrice: 2000};
    const snap = snapshotPortfolio(p);
    snap.position!.entryPrice = 9999;
    expect(p.position.entryPrice).toBe(2000);
  });
});

describe("applyEvents", () => {
  it("OPTION_SOLD sets openOption and transitions to short_put", () => {
    const p = initialPortfolio();
    const events: Event[] = [{
      type: "OPTION_SOLD", optionType: "put", strike: 2400, premium: 50,
      delta: 0.3, fees: 0.5, openDay: 0, expiryDay: 7,
    }];
    const next = applyEvents(p, events);
    expect(next.phase).toBe("short_put");
    expect(next.openOption).not.toBeNull();
    expect(next.openOption!.strike).toBe(2400);
    expect(next.openOption!.expiryDay).toBe(7);
  });

  it("OPTION_SOLD (call) transitions to short_call", () => {
    const p: PortfolioState = {
      ...initialPortfolio(),
      phase: "holding_eth",
      position: {size: 1, entryPrice: 2400},
    };
    const events: Event[] = [{
      type: "OPTION_SOLD", optionType: "call", strike: 2600, premium: 40,
      delta: 0.3, fees: 0.5, openDay: 7, expiryDay: 14,
    }];
    const next = applyEvents(p, events);
    expect(next.phase).toBe("short_call");
    expect(next.openOption!.type).toBe("call");
  });

  it("OPTION_EXPIRED (OTM put) clears option and returns to idle_cash", () => {
    const p: PortfolioState = {
      ...initialPortfolio(),
      phase: "short_put",
      openOption: {type: "put", strike: 2400, delta: 0.3, premium: 50, openDay: 0, expiryDay: 7},
    };
    const events: Event[] = [{
      type: "OPTION_EXPIRED", optionType: "put", strike: 2400, spot: 2500, assigned: false,
    }];
    const next = applyEvents(p, events);
    expect(next.openOption).toBeNull();
    expect(next.phase).toBe("idle_cash");
  });

  it("OPTION_EXPIRED (assigned put) + ETH_BOUGHT transitions to holding_eth", () => {
    const p: PortfolioState = {
      ...initialPortfolio(),
      phase: "short_put",
      openOption: {type: "put", strike: 2400, delta: 0.3, premium: 50, openDay: 0, expiryDay: 7},
    };
    const events: Event[] = [
      {type: "OPTION_EXPIRED", optionType: "put", strike: 2400, spot: 2300, assigned: true},
      {type: "ETH_BOUGHT", price: 2400, size: 1},
    ];
    const next = applyEvents(p, events);
    expect(next.phase).toBe("holding_eth");
    expect(next.position).toEqual({size: 1, entryPrice: 2400});
    expect(next.totalAssignments).toBe(1);
    expect(next.openOption).toBeNull();
  });

  it("OPTION_EXPIRED (assigned call) + ETH_SOLD transitions to idle_cash", () => {
    const p: PortfolioState = {
      ...initialPortfolio(),
      phase: "short_call",
      position: {size: 1, entryPrice: 2400},
      openOption: {type: "call", strike: 2600, delta: 0.3, premium: 40, openDay: 7, expiryDay: 14},
    };
    const events: Event[] = [
      {type: "OPTION_EXPIRED", optionType: "call", strike: 2600, spot: 2700, assigned: true},
      {type: "ETH_SOLD", price: 2600, size: 1, pl: 200},
    ];
    const next = applyEvents(p, events);
    expect(next.phase).toBe("idle_cash");
    expect(next.position).toBeNull();
    expect(next.totalAssignments).toBe(1);
    expect(next.realizedPL).toBe(200);
  });

  it("PREMIUM_COLLECTED increments totalPremiumCollected and realizedPL", () => {
    const p = initialPortfolio();
    const events: Event[] = [{
      type: "PREMIUM_COLLECTED", grossPremium: 50, fees: 0.5, netAmount: 49.5,
    }];
    const next = applyEvents(p, events);
    expect(next.totalPremiumCollected).toBe(50);
    expect(next.realizedPL).toBe(49.5);
  });

  it("CYCLE_SKIPPED increments totalSkippedCycles", () => {
    const p = initialPortfolio();
    const events: Event[] = [{type: "CYCLE_SKIPPED", reason: "low premium"}];
    const next = applyEvents(p, events);
    expect(next.totalSkippedCycles).toBe(1);
  });

  it("POSITION_CLOSED clears position and transitions to idle_cash", () => {
    const p: PortfolioState = {
      ...initialPortfolio(),
      phase: "holding_eth",
      position: {size: 1, entryPrice: 2400},
    };
    const events: Event[] = [{
      type: "POSITION_CLOSED", price: 2200, size: 1, pl: -200, reason: "stop-loss",
    }];
    const next = applyEvents(p, events);
    expect(next.phase).toBe("idle_cash");
    expect(next.position).toBeNull();
    expect(next.realizedPL).toBe(-200);
  });

  it("does not mutate the original state", () => {
    const p = initialPortfolio();
    const events: Event[] = [{type: "CYCLE_SKIPPED", reason: "test"}];
    applyEvents(p, events);
    expect(p.totalSkippedCycles).toBe(0);
  });
});
