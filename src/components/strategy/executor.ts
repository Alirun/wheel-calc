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
    const fees = config.feePerTrade * config.contracts;
    const grossPremium = opt.premium * config.contracts;

    if (opt.type === "put") {
      const assigned = market.spot < opt.strike;
      events.push({
        type: "OPTION_EXPIRED",
        optionType: "put",
        strike: opt.strike,
        spot: market.spot,
        assigned,
      });
      events.push({
        type: "PREMIUM_COLLECTED",
        grossPremium,
        fees,
        netAmount: grossPremium - fees,
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
          type: "PREMIUM_COLLECTED",
          grossPremium,
          fees,
          netAmount: grossPremium - fees,
        });
        events.push({
          type: "ETH_SOLD",
          price: opt.strike,
          size: config.contracts,
          pl: ethPL,
        });
      } else {
        events.push({
          type: "PREMIUM_COLLECTED",
          grossPremium,
          fees,
          netAmount: grossPremium - fees,
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
      case "SELL_PUT":
        return [{
          type: "OPTION_SOLD",
          optionType: "put",
          strike: signal.strike,
          premium: signal.premium,
          delta: signal.delta,
          fees: config.feePerTrade * config.contracts,
          openDay: market.day,
          expiryDay: market.day + config.cycleLengthDays,
        }];

      case "SELL_CALL":
        return [{
          type: "OPTION_SOLD",
          optionType: "call",
          strike: signal.strike,
          premium: signal.premium,
          delta: signal.delta,
          fees: config.feePerTrade * config.contracts,
          openDay: market.day,
          expiryDay: market.day + config.cycleLengthDays,
        }];

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

      case "ROLL":
        return [];

      case "HOLD":
        return [];
    }
  }
}
