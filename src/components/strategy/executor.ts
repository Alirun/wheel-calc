import type {MarketSnapshot, PortfolioState, StrategyConfig, Signal, Event} from "./types.js";
import {bsCallPrice, bsPutPrice} from "../black-scholes.js";

export interface Executor {
  resolveExpiration(
    market: MarketSnapshot,
    portfolio: PortfolioState,
    config: StrategyConfig,
  ): Event[];

  execute(
    signal: Signal,
    market: MarketSnapshot,
    portfolio: PortfolioState,
    config: StrategyConfig,
  ): Event[];
}

export class SimExecutor implements Executor {
  resolveExpiration(
    market: MarketSnapshot,
    portfolio: PortfolioState,
    config: StrategyConfig,
  ): Event[] {
    const opt = portfolio.openOption;
    if (!opt) return [];

    const events: Event[] = [];

    if (opt.type === "put") {
      const assigned = market.spot < opt.strike;
      events.push({
        type: "OPTION_EXPIRED",
        optionType: "put",
        strike: opt.strike,
        spot: market.spot,
        assigned,
      });
      if (assigned) {
        events.push({
          type: "ETH_BOUGHT",
          price: opt.strike,
          size: config.contracts,
        });
      }
    } else {
      const assigned = market.spot >= opt.strike;
      events.push({
        type: "OPTION_EXPIRED",
        optionType: "call",
        strike: opt.strike,
        spot: market.spot,
        assigned,
      });

      if (assigned) {
        const entryPrice = portfolio.position!.entryPrice;
        const ethPL = (opt.strike - entryPrice) * config.contracts;
        events.push({
          type: "ETH_SOLD",
          price: opt.strike,
          size: config.contracts,
          pl: ethPL,
        });
      }
    }

    return events;
  }

  execute(
    signal: Signal,
    market: MarketSnapshot,
    portfolio: PortfolioState,
    config: StrategyConfig,
  ): Event[] {
    switch (signal.action) {
      case "SELL_PUT": {
        const fees = config.feePerTrade * config.contracts;
        const grossPremium = signal.premium * config.contracts;
        const putDTE = config.rollPut?.initialDTE ?? config.cycleLengthDays;
        return [{
          type: "OPTION_SOLD",
          optionType: "put",
          strike: signal.strike,
          premium: signal.premium,
          delta: signal.delta,
          fees,
          openDay: market.day,
          expiryDay: market.day + putDTE,
        }, {
          type: "PREMIUM_COLLECTED",
          grossPremium,
          fees,
          netAmount: grossPremium - fees,
        }];
      }

      case "SELL_CALL": {
        const fees = config.feePerTrade * config.contracts;
        const grossPremium = signal.premium * config.contracts;
        return [{
          type: "OPTION_SOLD",
          optionType: "call",
          strike: signal.strike,
          premium: signal.premium,
          delta: signal.delta,
          fees,
          openDay: market.day,
          expiryDay: market.day + config.cycleLengthDays,
        }, {
          type: "PREMIUM_COLLECTED",
          grossPremium,
          fees,
          netAmount: grossPremium - fees,
        }];
      }

      case "SKIP":
        return [{
          type: "CYCLE_SKIPPED",
          reason: signal.reason,
        }];

      case "CLOSE_POSITION": {
        if (!portfolio.position) return [];
        const events: Event[] = [];
        if (portfolio.openOption) {
          const opt = portfolio.openOption;
          const vol = market.iv ?? config.impliedVol;
          const T = Math.max((opt.expiryDay - market.day) / 365, 1 / 365);
          const price = opt.type === "call"
            ? bsCallPrice(market.spot, opt.strike, T, config.riskFreeRate, vol)
            : bsPutPrice(market.spot, opt.strike, T, config.riskFreeRate, vol);
          const cost = price * (1 + config.bidAskSpreadPct) * config.contracts;
          const fees = config.feePerTrade * config.contracts;
          events.push({type: "OPTION_BOUGHT_BACK", optionType: opt.type, strike: opt.strike, cost, fees});
        }
        const pl = (market.spot - portfolio.position.entryPrice) * portfolio.position.size;
        events.push({
          type: "POSITION_CLOSED",
          price: market.spot,
          size: portfolio.position.size,
          pl,
          reason: signal.reason,
        });
        return events;
      }

      case "ROLL": {
        if (!portfolio.openOption) return [];
        const opt = portfolio.openOption;
        const originalPremium = opt.premium * config.contracts;
        const rollCostGross = signal.rollCost * config.contracts;
        const fees = 2 * config.feePerTrade * config.contracts;
        const rollDTE = (opt.type === "put" && config.rollPut)
          ? config.rollPut.initialDTE
          : config.cycleLengthDays;
        return [{
          type: "OPTION_ROLLED",
          optionType: opt.type,
          oldStrike: opt.strike,
          newStrike: signal.newStrike,
          newDelta: signal.newDelta,
          originalPremium,
          rollCost: rollCostGross,
          newPremium: signal.newPremium,
          fees,
          openDay: market.day,
          expiryDay: market.day + rollDTE,
        }];
      }

      case "HOLD":
        return [];
    }
  }
}
