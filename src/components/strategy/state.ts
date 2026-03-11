import type {PortfolioState, Event, DailyState, MarketSnapshot} from "./types.js";

export function initialPortfolio(): PortfolioState {
  return {
    phase: "idle_cash",
    position: null,
    openOption: null,
    realizedPL: 0,
    totalPremiumCollected: 0,
    totalAssignments: 0,
    totalSkippedCycles: 0,
    lastStopLossDay: null,
    totalStopLosses: 0,
    totalPutRolls: 0,
  };
}

export function snapshotPortfolio(state: PortfolioState): PortfolioState {
  return {
    ...state,
    position: state.position ? {...state.position} : null,
    openOption: state.openOption ? {...state.openOption} : null,
  };
}

export function applyEvents(state: PortfolioState, events: Event[]): PortfolioState {
  let s: PortfolioState = {
    ...state,
    position: state.position ? {...state.position} : null,
    openOption: state.openOption ? {...state.openOption} : null,
  };

  for (const e of events) {
    switch (e.type) {
      case "OPTION_SOLD":
        s.openOption = {
          type: e.optionType,
          strike: e.strike,
          delta: e.delta,
          premium: e.premium,
          openDay: e.openDay,
          expiryDay: e.expiryDay,
          contracts: e.contracts,
        };
        s.phase = e.optionType === "put" ? "short_put" : "short_call";
        break;

      case "OPTION_EXPIRED":
        s.openOption = null;
        if (e.assigned) {
          if (e.optionType === "put") {
            s.phase = "holding_eth";
            s.totalAssignments++;
          } else {
            s.phase = "idle_cash";
            s.totalAssignments++;
          }
        } else {
          s.phase = s.position ? "holding_eth" : "idle_cash";
        }
        break;

      case "ETH_BOUGHT":
        s.position = {size: e.size, entryPrice: e.price};
        break;

      case "ETH_SOLD":
        s.position = null;
        s.realizedPL += e.pl;
        break;

      case "PREMIUM_COLLECTED":
        s.totalPremiumCollected += e.grossPremium;
        s.realizedPL += e.netAmount;
        break;

      case "CYCLE_SKIPPED":
        s.totalSkippedCycles++;
        break;

      case "POSITION_CLOSED":
        s.position = null;
        s.realizedPL += e.pl;
        s.phase = "idle_cash";
        break;

      case "OPTION_BOUGHT_BACK":
        s.openOption = null;
        s.realizedPL -= (e.cost + e.fees);
        break;

      case "OPTION_ROLLED":
        s.totalPremiumCollected += e.newPremium;
        s.realizedPL += e.newPremium - e.rollCost - e.fees;
        s.openOption = {
          type: e.optionType,
          strike: e.newStrike,
          delta: e.newDelta,
          premium: e.newPremium,
          openDay: e.openDay,
          expiryDay: e.expiryDay,
          contracts: e.contracts,
        };
        if (e.optionType === "put") s.totalPutRolls++;
        break;
    }
  }

  return s;
}

export function toDailyState(
  market: MarketSnapshot,
  portfolio: PortfolioState,
  contracts: number,
): DailyState {
  const holdingETH = portfolio.position !== null;
  const unrealizedPL = holdingETH
    ? (market.spot - portfolio.position!.entryPrice) * contracts
    : 0;

  return {
    day: market.day,
    price: market.spot,
    phase: portfolio.phase,
    cumulativePL: portfolio.realizedPL,
    unrealizedPL,
    holdingETH,
  };
}
