# Wheel Strategy

## Overview

- Purpose: Define the Wheel strategy logic — phases, rules, configuration, trade lifecycle.
- Sources: `src/components/strategy/` (types, rules, strategy, executor, state, simulate)

## Text Representations

The algorithm has two text representations that **must stay in sync** when strategy logic changes:

| Location | Format | What it shows |
|----------|--------|---------------|
| `src/simulator.md` (rules panel) | Reactive HTML (`rulesHtml`) | Step-by-step rules with live parameter values (delta, DTE, IV, skip threshold) |
| `docs/strategy.md` (this file) | Markdown | Authoritative spec: phases, rules, formulas, config, lifecycle |

When modifying strategy logic: update both. This file is the source of truth for behavior; the simulator panel is a derived visualization.

## State Machine

Four phases with explicit intermediate states:

```
IDLE_CASH ───SELL_PUT───→ SHORT_PUT
                              │
                   expired OTM│assigned
                   ┌──────────┘──────────┐
                   ↓                     ↓
             IDLE_CASH            HOLDING_ETH ←──────────────┐
                                      │                      │
                           SELL_CALL  │  CLOSE_POSITION      │ expired OTM
                                      ↓                      │
                                 SHORT_CALL ─────────────────┘
                                      │
                                 assigned
                                      ↓
                                 IDLE_CASH
```

Phase type: `"idle_cash" | "short_put" | "holding_eth" | "short_call"`

- **idle_cash**: No position, no open option. Strategy evaluates `BasePutRule`.
- **short_put**: Short put open. Waiting for expiry.
- **holding_eth**: Assigned on put, holding ETH. Strategy evaluates `LowPremiumSkipRule` then `AdaptiveCallRule`.
- **short_call**: Short call open. Waiting for expiry.

The `holding_eth` state enables decision-making between cycles: sell a call, skip, or close the position.

## Signal-Based Architecture

### Flow

```
MarketSnapshot → Rules → Signal → Executor → Events → State reducer → PortfolioState
```

1. **Rules** are pure functions: `(market, portfolio, config) → Signal | null`
2. **Strategy evaluator** runs rules in priority order; first non-null Signal wins, default `HOLD`
3. **Executor** converts Signals into Events (sim uses BS pricing; a future live executor uses real fills)
4. **State reducer** (`applyEvents`) applies Events to produce new `PortfolioState`

### Signals (strategy intent)

| Action | Produced by | Fields |
|--------|-------------|--------|
| `SELL_PUT` | `BasePutRule` | strike, delta, premium, rule, reason |
| `SELL_CALL` | `AdaptiveCallRule` | strike, delta, premium, rule, reason |
| `SKIP` | `LowPremiumSkipRule` | rule, reason |
| `CLOSE_POSITION` | (future rules) | rule, reason |
| `ROLL` | (future rules) | newStrike, newDelta, credit, rule, reason |
| `HOLD` | default | (no fields) |

### Events (execution facts)

| Event | When |
|-------|------|
| `OPTION_SOLD` | Signal executed: put or call sold |
| `OPTION_EXPIRED` | Expiry resolved: assigned or OTM |
| `ETH_BOUGHT` | Put assigned |
| `ETH_SOLD` | Call assigned |
| `PREMIUM_COLLECTED` | Option expired (always collected) |
| `CYCLE_SKIPPED` | SKIP signal executed |
| `POSITION_CLOSED` | CLOSE_POSITION signal executed |

## Rules

Each rule has a name, priority (lower = evaluated first), and a phase guard.

| Rule | Priority | Phase | Signal | Description |
|------|----------|-------|--------|-------------|
| `LowPremiumSkipRule` | 50 | `holding_eth` | `SKIP` | Skip call cycle when net premium < `skipThresholdPct` of position value |
| `BasePutRule` | 100 | `idle_cash` | `SELL_PUT` | Sell OTM put at `targetDelta` |
| `AdaptiveCallRule` | 100 | `holding_eth` | `SELL_CALL` | Sell OTM call with delta scaled by unrealized P/L |

Priority ordering: safety/skip rules (50) preempt selection rules (100). A `SKIP` at priority 50 prevents `SELL_CALL` at priority 100 from firing.

### Planned rules (from IMPROVEMENTS.md)

| Rule | Priority | Signal |
|------|----------|--------|
| `StopLossRule` | 10 | `CLOSE_POSITION` |
| `MinStrikeRule` | 20 | `SKIP` or adjusts strike |
| `RollRule` | 30 | `ROLL` |
| `TrendFilterRule` | 40 | `SKIP` |
| `IVRankDeltaRule` | 90 | `SELL_PUT` / `SELL_CALL` |

## Configuration

### StrategyConfig

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

1. **Decision point**: No open option, or open option has expired (day >= expiryDay).
2. **Resolve expiration** (if option open): Check assignment, emit `OPTION_EXPIRED` + `PREMIUM_COLLECTED` + assignment events.
3. **Evaluate rules**: Run rules in priority order → produce Signal.
4. **Execute signal**: Executor converts Signal to Events (BS pricing for sim).
5. **Update state**: `applyEvents` reducer applies Events → new PortfolioState.
6. **Log**: `SignalLogEntry` records market, signal, events, and before/after portfolio snapshots.

## Output

### SignalLogEntry (per decision)

Every decision point produces a log entry with: `day`, `market`, `portfolioBefore`, `signal`, `events[]`, `portfolioAfter`.

Replaces the old `TradeRecord`. Contains the signal (with rule name and reason), execution events (premium, fees, assignment), and full state snapshots.

### DailyState (per day)

`day`, `price`, `phase`, `cumulativePL`, `unrealizedPL`, `holdingETH`

### SimulationResult (aggregate)

```typescript
{
  signalLog: SignalLogEntry[];
  dailyStates: DailyState[];
  summary: {
    totalRealizedPL: number;
    totalPremiumCollected: number;
    totalAssignments: number;
    totalSkippedCycles: number;
  };
}
```