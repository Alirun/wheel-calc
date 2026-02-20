import type {MarketSnapshot, PortfolioState, StrategyConfig, Signal, Event} from "./types.js";

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
        return [{
          type: "OPTION_SOLD",
          optionType: "put",
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
        const pl = (market.spot - portfolio.position.entryPrice) * portfolio.position.size;
        return [{
          type: "POSITION_CLOSED",
          price: market.spot,
          size: portfolio.position.size,
          pl,
          reason: signal.reason,
        }];
      }

      case "ROLL": {
        if (!portfolio.openOption) return [];
        const opt = portfolio.openOption;
        const originalPremium = opt.premium * config.contracts;
        const rollCostGross = signal.rollCost * config.contracts;
        const fees = 2 * config.feePerTrade * config.contracts;
        return [{
          type: "OPTION_ROLLED",
          oldStrike: opt.strike,
          newStrike: signal.newStrike,
          newDelta: signal.newDelta,
          originalPremium,
          rollCost: rollCostGross,
          newPremium: signal.newPremium,
          fees,
          openDay: market.day,
          expiryDay: market.day + config.cycleLengthDays,
        }];
      }

      case "HOLD":
        return [];
    }
  }
}
