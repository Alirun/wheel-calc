# Wheel Strategy

## Overview

- Purpose: Define the Wheel strategy logic — phases, configuration, trade lifecycle.
- Source: `src/components/wheel.ts`

## Text Representations

The algorithm has two text representations that **must stay in sync** when strategy logic changes:

| Location | Format | What it shows |
|----------|--------|---------------|
| `src/simulator.md` (lines 60-78) | Reactive HTML (`rulesHtml`) | Step-by-step rules with live parameter values (delta, DTE, IV, skip threshold) |
| `docs/strategy.md` (this file) | Markdown | Authoritative spec: phases, formulas, config, lifecycle |

When modifying strategy logic: update both. This file is the source of truth for behavior; the simulator panel is a derived visualization.

## Phases

Two phases, cycling between cash and ETH:

```
selling_put ──(assigned)──→ selling_call
     ↑                           │
     └────(assigned)─────────────┘
```

- **selling_put**: Hold cash. Sell OTM put. If assigned, buy ETH at strike → move to selling_call.
- **selling_call**: Hold ETH. Sell OTM call. If assigned, sell ETH at strike → move to selling_put.

## Configuration

### WheelConfig

| Parameter | Type | Example | Description |
|-----------|------|---------|-------------|
| `targetDelta` | number | 0.30 | Target absolute delta for puts (and calls when adaptive is off) |
| `impliedVol` | number | 0.92 | Annualized IV for BS pricing |
| `riskFreeRate` | number | 0.05 | Risk-free rate |
| `cycleLengthDays` | number | 7 | Days per option cycle |
| `contracts` | number | 1 | ETH per contract |
| `bidAskSpreadPct` | number | 0.05 | Premium haircut (5% = multiply raw premium by 0.95) |
| `feePerTrade` | number | 0.50 | USD per contract per trade |
| `adaptiveCalls` | optional | — | Adaptive call delta config (see below) |

### AdaptiveCallsConfig

| Parameter | Type | Example | Description |
|-----------|------|---------|-------------|
| `minDelta` | number | 0.10 | Call delta when deep underwater |
| `maxDelta` | number | 0.50 | Call delta when profitable |
| `skipThresholdPct` | number | 0.001 | Skip call if net premium < this fraction of position value |

## Adaptive Call Delta

When enabled, call delta is computed from unrealized P/L on the ETH position:

```
pnlPct = (spot - entryPrice) / entryPrice
t = clamp((pnlPct + 1) / 2, 0, 1)
callDelta = minDelta + (maxDelta - minDelta) * t
```

Effect:
- Underwater (pnlPct ~ -100%) → delta ~ minDelta (deep OTM, low assignment risk)
- Breakeven (pnlPct ~ 0%) → delta ~ midpoint
- Profitable (pnlPct ~ +100%) → delta ~ maxDelta (closer ATM, higher premium)

## Cycle Skip

When adaptive calls is enabled, a call cycle is skipped if:

```
netPremium = premium * contracts - fees
positionValue = entryPrice * contracts
skip if netPremium < skipThresholdPct * positionValue
```

Skipped cycles are counted in `totalSkippedCycles`.

## Strike Selection

Uses binary search (`findStrikeForDelta`) to find the strike producing the target absolute delta:
- Puts: search range `[spot * 0.5, spot]` (below spot, OTM)
- Calls: search range `[spot, spot * 1.5]` (above spot, OTM)
- Convergence: 100 iterations or strike range < $0.01

## Premium Calculation

```
rawPremium = bsPutPrice(spot, strike, T, r, iv)  // or bsCallPrice
premium = rawPremium * (1 - bidAskSpreadPct)
```

## Trade Lifecycle

1. **Open**: Compute strike and premium via BS. Record `spotAtOpen`, `delta`, `IV`.
2. **Hold**: Option is open for `cycleLengthDays` days.
3. **Expire**: Check assignment at cycle end:
   - Put: assigned if `spot < strike`
   - Call: assigned if `spot >= strike`
4. **Settle**: Compute realized P/L. Transition phase if assigned.
5. **Next**: Immediately open next cycle (or skip if threshold not met).

## Output

### TradeRecord (per cycle)

`type`, `strike`, `premium`, `startDay`, `endDay`, `assigned`, `pl`, `spotAtOpen`, `spotAtExpiration`, `entryPrice`, `impliedVol`, `delta`

### DailyState (per day)

`day`, `price`, `phase`, `cumulativePL`, `unrealizedPL`, `holdingETH`

### SimulationResult (aggregate)

`trades[]`, `dailyState[]`, `totalRealizedPL`, `totalPremiumCollected`, `totalAssignments`, `totalSkippedCycles`
