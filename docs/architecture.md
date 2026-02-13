# Architecture

## Overview

- Purpose: Simulate the Wheel options strategy on ETH with Monte Carlo analysis.
- Two layers: **computation** (pure TypeScript, framework-agnostic) and **UI** (Observable Framework).

## Layers

### Computation (`src/components/`)

Pure TypeScript modules. No framework imports. Designed for reuse in a production execution engine.

```
black-scholes.ts       ← option pricing, delta, strike-finding (zero deps)
price-gen.ts           ← seeded GBM price series (zero deps)
monte-carlo.ts         ← MC runner (imports price-gen, strategy/)
insights.ts            ← insight engine: evaluates MC results into actionable observations (imports monte-carlo, strategy/types)
deribit.ts             ← Deribit public API fetch wrappers (zero deps)
strategy/
  types.ts             ← Signal, Event, MarketSnapshot, PortfolioState, Phase, Config
  rules.ts             ← Rule interface + BasePutRule, AdaptiveCallRule, LowPremiumSkipRule
  strategy.ts          ← evaluateRules (priority-ordered), isDecisionPoint
  executor.ts          ← Executor interface + SimExecutor (sim-specific pricing/assignment)
  state.ts             ← applyEvents reducer, initialPortfolio, toDailyState
  simulate.ts          ← Main simulation loop (orchestrator)
```

Dependency graph:

```
monte-carlo → strategy/simulate → strategy/strategy → strategy/rules → black-scholes
                                → strategy/executor → black-scholes (via rules)
                                → strategy/state
            → price-gen
insights → monte-carlo (types only), strategy/types (types only)
deribit (standalone)
```

### UI (`src/*.md`)

Observable Framework reactive Markdown pages. Import computation modules via `./components/*.js`.

| Page | Path | Purpose |
|------|------|---------|
| `simulator.md` | `/simulator` | Main simulator: market/strategy/cost inputs, MC summary, distribution charts, per-run detail with price chart + trade log |
| `index.md` | `/` | Static short call/put payout diagrams |
| `volatility.md` | `/volatility` | Live Deribit data: index prices, historical vol |

Page navigation is configured in `observablehq.config.js` (`pages` array).

## Data Flow

```
UI inputs (sliders/toggles)
  ↓
marketParams + wheelConfig
  ↓
runMonteCarlo(market, config, numRuns)
  ├── rules = defaultRules()
  ├── for seed 1..N:
  │     generatePrices(seed) → prices[]
  │     simulate(prices, rules, config) → SimulationResult
  │       ├── signalLog: SignalLogEntry[] (every decision with before/after state)
  │       ├── dailyStates: DailyState[] (per-day portfolio snapshot)
  │       └── summary: { totalRealizedPL, totalPremiumCollected, totalAssignments, totalSkippedCycles }
  │     → RunSummary (totalPL, apr, drawdown, benchmark, sharpe/sortino, regime, ...)
  ↓
MonteCarloResult (winRate, APR distribution, mean P/L, drawdown, benchmark stats, risk-adjusted ratios, regime breakdown)
  ├─→ generateInsights(mc, config) → Insight[] (actionable observations with suggestions)
  ↓
rerunSingle(market, config, selectedSeed) → detail view
```

## Key Invariants

- Computation modules never import from Observable Framework or any UI code.
- All randomness is seeded. Same seed + same config = identical output.
- Prices are daily granularity. Options expire at cycle boundaries (checked daily).
- Strategy logic (rules) is executor-agnostic. Rules produce Signals; the Executor turns Signals into Events. Swapping `SimExecutor` for a live executor requires no changes to rules or the simulation loop.
- Portfolio state is updated only through the `applyEvents` reducer. No direct mutation.