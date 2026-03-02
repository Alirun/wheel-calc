import type {MarketSnapshot, PortfolioState, StrategyConfig, Signal} from "./types.js";
import {
  bsPutPrice,
  bsCallPrice,
  bsPutDelta,
  bsCallDelta,
  findStrikeForDelta,
} from "../black-scholes.js";

export interface Rule {
  name: string;
  description: string;
  phase: string;
  priority: number;
  evaluate(
    market: MarketSnapshot,
    portfolio: PortfolioState,
    config: StrategyConfig,
  ): Signal | null;
}

export function computeIVRVMultiplier(market: MarketSnapshot, config: StrategyConfig, side?: "put" | "call"): number {
  if (!config.ivRvSpread) return 1.0;
  if (market.realizedVol === undefined || market.realizedVol <= 0) return 1.0;
  const iv = market.iv ?? config.impliedVol;
  const ratio = iv / market.realizedVol;
  if (config.ivRvSpread.skipBelowRatio && ratio < config.ivRvSpread.skipBelowRatio) {
    const skipSide = config.ivRvSpread.skipSide ?? "both";
    if (skipSide === "both" || side === "put") return 0;
  }
  const {minMultiplier, maxMultiplier} = config.ivRvSpread;
  return Math.max(minMultiplier, Math.min(maxMultiplier, ratio));
}

const basePutRule: Rule = {
  name: "BasePutRule",
  description: "Sell OTM put at target delta. Collects premium while waiting to buy ETH at a discount.",
  phase: "idle_cash",
  priority: 100,
  evaluate(market, portfolio, config) {
    if (portfolio.phase !== "idle_cash") return null;

    const ivRvMult = computeIVRVMultiplier(market, config, "put");
    if (ivRvMult === 0) {
      const iv = market.iv ?? config.impliedVol;
      const ratio = iv / market.realizedVol!;
      return {
        action: "SKIP",
        rule: "BasePutRule",
        reason: `IV/RV=${ratio.toFixed(2)} < ${config.ivRvSpread!.skipBelowRatio!.toFixed(2)}, no VRP`,
      };
    }

    const T = (config.rollPut?.initialDTE ?? config.cycleLengthDays) / 365;
    const vol = market.iv ?? config.impliedVol;
    const effectiveDelta = Math.min(config.targetDelta * ivRvMult, 0.50);
    const strike = findStrikeForDelta(
      effectiveDelta, market.spot, T, config.riskFreeRate, vol, "put",
    );
    const rawPremium = bsPutPrice(market.spot, strike, T, config.riskFreeRate, vol);
    const premium = rawPremium * (1 - config.bidAskSpreadPct);
    const delta = bsPutDelta(market.spot, strike, T, config.riskFreeRate, vol);

    const ivRvNote = ivRvMult !== 1.0 ? `, ivRvMult=${ivRvMult.toFixed(2)}` : "";
    return {
      action: "SELL_PUT",
      strike,
      delta: Math.abs(delta),
      premium,
      rule: "BasePutRule",
      reason: `delta=${Math.abs(delta).toFixed(2)}, strike=${strike.toFixed(2)}${ivRvNote}`,
    };
  },
};

function computeCallDelta(market: MarketSnapshot, portfolio: PortfolioState, config: StrategyConfig): number {
  let baseDelta: number;
  if (config.adaptiveCalls && portfolio.position) {
    const pnlPct = (market.spot - portfolio.position.entryPrice) / portfolio.position.entryPrice;
    const t = Math.max(0, Math.min(1, (pnlPct + 1) / 2));
    const {minDelta, maxDelta} = config.adaptiveCalls;
    baseDelta = minDelta + (maxDelta - minDelta) * t;
  } else {
    baseDelta = config.targetDelta;
  }
  const ivRvMult = computeIVRVMultiplier(market, config, "call");
  return Math.min(baseDelta * ivRvMult, 0.50);
}

const adaptiveCallRule: Rule = {
  name: "AdaptiveCallRule",
  description: "Sell OTM call with delta scaled by unrealized P/L. Underwater → low delta (protect position), profitable → high delta (collect more premium).",
  phase: "holding_eth",
  priority: 100,
  evaluate(market, portfolio, config) {
    if (portfolio.phase !== "holding_eth") return null;

    const ivRvMult = computeIVRVMultiplier(market, config, "call");
    if (ivRvMult === 0) {
      const iv = market.iv ?? config.impliedVol;
      const ratio = iv / market.realizedVol!;
      return {
        action: "SKIP",
        rule: "AdaptiveCallRule",
        reason: `IV/RV=${ratio.toFixed(2)} < ${config.ivRvSpread!.skipBelowRatio!.toFixed(2)}, no VRP`,
      };
    }

    const T = config.cycleLengthDays / 365;
    const vol = market.iv ?? config.impliedVol;
    const effectiveDelta = computeCallDelta(market, portfolio, config);
    const rawStrike = findStrikeForDelta(
      effectiveDelta, market.spot, T, config.riskFreeRate, vol, "call",
    );
    const minStrike = config.adaptiveCalls?.minStrikeAtCost && portfolio.position
      ? portfolio.position.entryPrice
      : 0;
    const strike = Math.max(rawStrike, minStrike);
    const clamped = strike !== rawStrike;
    const rawPremium = bsCallPrice(market.spot, strike, T, config.riskFreeRate, vol);
    const premium = rawPremium * (1 - config.bidAskSpreadPct);
    const delta = bsCallDelta(market.spot, strike, T, config.riskFreeRate, vol);

    return {
      action: "SELL_CALL",
      strike,
      delta,
      premium,
      rule: "AdaptiveCallRule",
      reason: `effectiveDelta=${effectiveDelta.toFixed(2)}, strike=${strike.toFixed(2)}${clamped ? ` (clamped from ${rawStrike.toFixed(2)} to cost basis)` : ""}`,
    };
  },
};

const lowPremiumSkipRule: Rule = {
  name: "LowPremiumSkipRule",
  description: "Skip call cycle when net premium is below a threshold percentage of position value. Avoids selling cheap options that risk assignment for minimal income.",
  phase: "holding_eth",
  priority: 50,
  evaluate(market, portfolio, config) {
    if (portfolio.phase !== "holding_eth") return null;
    if (!config.adaptiveCalls || !portfolio.position) return null;

    const T = config.cycleLengthDays / 365;
    const vol = market.iv ?? config.impliedVol;
    const effectiveDelta = computeCallDelta(market, portfolio, config);
    const rawStrike = findStrikeForDelta(
      effectiveDelta, market.spot, T, config.riskFreeRate, vol, "call",
    );
    const minStrike = config.adaptiveCalls.minStrikeAtCost && portfolio.position
      ? portfolio.position.entryPrice
      : 0;
    const strike = Math.max(rawStrike, minStrike);
    const rawPremium = bsCallPrice(market.spot, strike, T, config.riskFreeRate, vol);
    const premium = rawPremium * (1 - config.bidAskSpreadPct);

    const netPremium = premium * config.contracts - config.feePerTrade * config.contracts;
    const positionValue = portfolio.position.entryPrice * config.contracts;

    if (netPremium < config.adaptiveCalls.skipThresholdPct * positionValue) {
      return {
        action: "SKIP",
        rule: "LowPremiumSkipRule",
        reason: `netPremium=$${netPremium.toFixed(2)} < ${(config.adaptiveCalls.skipThresholdPct * 100).toFixed(2)}% of position`,
      };
    }

    return null;
  },
};

const rollCallRule: Rule = {
  name: "RollCallRule",
  description: "Roll short call up and out when spot exceeds strike by ITM threshold. Closes old call and opens a new one at a higher strike for a fresh cycle.",
  phase: "short_call",
  priority: 100,
  evaluate(market, portfolio, config) {
    if (portfolio.phase !== "short_call") return null;
    if (!config.rollCall || !portfolio.openOption) return null;

    const opt = portfolio.openOption;
    const {itmThresholdPct, requireNetCredit} = config.rollCall;
    if (market.spot < opt.strike * (1 + itmThresholdPct)) return null;

    const vol = market.iv ?? config.impliedVol;
    const remainingT = Math.max((opt.expiryDay - market.day) / 365, 1 / 365);
    const newT = config.cycleLengthDays / 365;

    const rollCostPerContract =
      bsCallPrice(market.spot, opt.strike, remainingT, config.riskFreeRate, vol) *
      (1 + config.bidAskSpreadPct);

    const effectiveDelta = computeCallDelta(market, portfolio, config);
    const rawNewStrike = findStrikeForDelta(
      effectiveDelta, market.spot, newT, config.riskFreeRate, vol, "call",
    );
    const minStrike = config.adaptiveCalls?.minStrikeAtCost && portfolio.position
      ? portfolio.position.entryPrice : 0;
    const newStrike = Math.max(rawNewStrike, minStrike, market.spot);

    const rawNewPremium = bsCallPrice(market.spot, newStrike, newT, config.riskFreeRate, vol);
    const newPremiumPerContract = rawNewPremium * (1 - config.bidAskSpreadPct);

    const fees = 2 * config.feePerTrade * config.contracts;
    const grossCredit = (newPremiumPerContract - rollCostPerContract) * config.contracts;
    const netCredit = grossCredit - fees;

    if (requireNetCredit && netCredit <= 0) return null;

    const newDelta = bsCallDelta(market.spot, newStrike, newT, config.riskFreeRate, vol);

    return {
      action: "ROLL",
      newStrike,
      newDelta,
      rollCost: rollCostPerContract,
      newPremium: newPremiumPerContract,
      credit: netCredit,
      rule: "RollCallRule",
      reason: `spot=${market.spot.toFixed(0)} > strike=${opt.strike.toFixed(0)}, roll to ${newStrike.toFixed(0)}, netCredit=${netCredit.toFixed(2)}`,
    };
  },
};

const stopLossRule: Rule = {
  name: "StopLossRule",
  description: "Close ETH position when drawdown from entry exceeds threshold. Cuts unbounded losses during the holding phase.",
  phase: "holding_eth | short_call",
  priority: 1,
  evaluate(market, portfolio, config) {
    if (portfolio.phase !== "holding_eth" && portfolio.phase !== "short_call") return null;
    if (!config.stopLoss || !portfolio.position) return null;
    const drawdown = (portfolio.position.entryPrice - market.spot) / portfolio.position.entryPrice;
    if (drawdown < config.stopLoss.drawdownPct) return null;
    return {
      action: "CLOSE_POSITION",
      rule: "StopLossRule",
      reason: `drawdown=${(drawdown * 100).toFixed(1)}% >= threshold=${(config.stopLoss.drawdownPct * 100).toFixed(1)}%`,
    };
  },
};

const stopLossCooldownRule: Rule = {
  name: "StopLossCooldownRule",
  description: "Block put-selling for N days after a stop-loss. Prevents immediately re-entering a falling market.",
  phase: "idle_cash",
  priority: 2,
  evaluate(market, portfolio, config) {
    if (portfolio.phase !== "idle_cash") return null;
    if (!config.stopLoss || config.stopLoss.cooldownDays <= 0 || portfolio.lastStopLossDay === null) return null;
    const daysSince = market.day - portfolio.lastStopLossDay;
    if (daysSince >= config.stopLoss.cooldownDays) return null;
    return {
      action: "SKIP",
      rule: "StopLossCooldownRule",
      reason: `cooldown: ${daysSince}d since stop-loss, need ${config.stopLoss.cooldownDays}d`,
    };
  },
};

const rollPutRule: Rule = {
  name: "RollPutRule",
  description: "Roll short put forward when DTE drops below threshold and put is OTM. Re-sells at fresh initialDTE to stay in the theta sweet spot (21-45 DTE).",
  phase: "short_put",
  priority: 100,
  evaluate(market, portfolio, config) {
    if (portfolio.phase !== "short_put") return null;
    if (!config.rollPut || !portfolio.openOption) return null;

    const opt = portfolio.openOption;
    const {initialDTE, rollWhenDTEBelow, requireNetCredit} = config.rollPut;
    const remainingDTE = opt.expiryDay - market.day;
    if (remainingDTE > rollWhenDTEBelow) return null;

    if (market.spot <= opt.strike) return null;

    const vol = market.iv ?? config.impliedVol;
    const remainingT = Math.max(remainingDTE / 365, 1 / 365);
    const newT = initialDTE / 365;

    const rollCostPerContract =
      bsPutPrice(market.spot, opt.strike, remainingT, config.riskFreeRate, vol) *
      (1 + config.bidAskSpreadPct);

    const ivRvMult = computeIVRVMultiplier(market, config, "put");
    const effectiveDelta = Math.min(config.targetDelta * ivRvMult, 0.50);
    const newStrike = findStrikeForDelta(
      effectiveDelta, market.spot, newT, config.riskFreeRate, vol, "put",
    );

    const rawNewPremium = bsPutPrice(market.spot, newStrike, newT, config.riskFreeRate, vol);
    const newPremiumPerContract = rawNewPremium * (1 - config.bidAskSpreadPct);

    const fees = 2 * config.feePerTrade * config.contracts;
    const grossCredit = (newPremiumPerContract - rollCostPerContract) * config.contracts;
    const netCredit = grossCredit - fees;

    if (requireNetCredit && netCredit <= 0) return null;

    const newDelta = bsPutDelta(market.spot, newStrike, newT, config.riskFreeRate, vol);

    return {
      action: "ROLL",
      newStrike,
      newDelta: Math.abs(newDelta),
      rollCost: rollCostPerContract,
      newPremium: newPremiumPerContract,
      credit: netCredit,
      rule: "RollPutRule",
      reason: `remainingDTE=${remainingDTE} <= ${rollWhenDTEBelow}, roll to ${newStrike.toFixed(0)}, netCredit=${netCredit.toFixed(2)}`,
    };
  },
};

export function defaultRules(): Rule[] {
  return [stopLossRule, stopLossCooldownRule, lowPremiumSkipRule, basePutRule, adaptiveCallRule, rollCallRule, rollPutRule];
}
