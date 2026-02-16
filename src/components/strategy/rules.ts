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

export function computeIVRVMultiplier(market: MarketSnapshot, config: StrategyConfig): number {
  if (!config.ivRvSpread) return 1.0;
  if (market.realizedVol === undefined || market.realizedVol <= 0) return 1.0;
  const iv = market.iv ?? config.impliedVol;
  const ratio = iv / market.realizedVol;
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

    const T = config.cycleLengthDays / 365;
    const vol = market.iv ?? config.impliedVol;
    const ivRvMult = computeIVRVMultiplier(market, config);
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
  const ivRvMult = computeIVRVMultiplier(market, config);
  return Math.min(baseDelta * ivRvMult, 0.50);
}

const adaptiveCallRule: Rule = {
  name: "AdaptiveCallRule",
  description: "Sell OTM call with delta scaled by unrealized P/L. Underwater → low delta (protect position), profitable → high delta (collect more premium).",
  phase: "holding_eth",
  priority: 100,
  evaluate(market, portfolio, config) {
    if (portfolio.phase !== "holding_eth") return null;

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

export function defaultRules(): Rule[] {
  return [lowPremiumSkipRule, basePutRule, adaptiveCallRule];
}
