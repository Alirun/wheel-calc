# Insights Engine

## Overview

- Purpose: Automatically evaluate Monte Carlo results and surface actionable observations with parameter suggestions.
- Source: `src/components/insights.ts`
- Related docs: [simulation.md](simulation.md) (MonteCarloResult, RunSummary, RegimeBreakdown), [strategy.md](strategy.md) (StrategyConfig)

## Architecture

```
MonteCarloResult + StrategyConfig
  ↓
generateInsights(mc, config) → Insight[]
  ↓
UI renders insight cards (simulator.md)
```

`insights.ts` is a pure computation module — no framework imports. It consumes `MonteCarloResult` and `StrategyConfig`, so changes to either type may require updating insight rules.

## Contract

### Insight Interface

```typescript
interface Insight {
  level: "positive" | "neutral" | "warning" | "negative";
  title: string;
  message: string;
  suggestion?: string;
}
```

### Entry Point

```typescript
generateInsights(mc: MonteCarloResult, config: StrategyConfig): Insight[]
```

Always returns at least 2 insights (performance + alpha). Other rules fire conditionally.

## Rules

Rules are evaluated in order. Each either fires (pushes one or more insights) or doesn't. The function returns all fired insights.

### 1. Overall Performance (always fires one)

| Condition | Level | Title |
|-----------|-------|-------|
| `meanSharpe < 0` | negative | Poor Risk-Adjusted Returns |
| `meanSharpe >= 0 && meanSharpe < benchmarkMeanSharpe` | warning | Underperforming Benchmark |
| `meanSharpe >= benchmarkMeanSharpe` | positive | Strong Risk-Adjusted Returns |

### 2. Alpha (always fires one)

Alpha = `meanAPR - meanBenchmarkAPR`.

| Condition | Level | Title |
|-----------|-------|-------|
| `alpha > 5` | positive | Significant Alpha |
| `alpha < -5` | negative | Negative Alpha |
| `-5 <= alpha <= 5` | neutral | Similar to Buy & Hold |

Thresholds are in APR percentage points (not decimal).

### 3. Downside Profile (fires at most one)

| Condition | Level | Title |
|-----------|-------|-------|
| `meanSharpe > 0 && meanSortino > meanSharpe * 1.5` | positive | Downside Well Contained |
| `meanSharpe < 0 && meanSortino > meanSharpe * 1.2` | warning | High Downside Volatility |

The second condition uses the property that `sharpe * 1.2` is more negative than `sharpe` when `sharpe < 0`, so `sortino > sharpe * 1.2` means sortino is close to (or worse than) sharpe.

### 4. Regime Vulnerability (fires per regime)

For each regime in `regimeBreakdown` where `count > 0` and `meanAlpha < -10`:

| Regime | Suggestion |
|--------|------------|
| Bull | Lower max call delta to retain upside |
| Bear | Lower target delta to reduce assignment risk |
| Sideways | Adjust cycle length to capture more premium |

### 5. Risk (fires independently)

| Condition | Level | Title |
|-----------|-------|-------|
| `meanMaxDrawdown > estimatedCapital * 0.5` | negative | Large Average Drawdown |
| `winRate < 0.4` | warning | Low Win Rate |

Capital at risk is estimated from benchmark metrics: `|meanBenchmarkPL / (meanBenchmarkAPR / 100)|`.

### 6. Assignment Rate (fires at most one)

Assignment rate = total assignments / total full cycles across all runs.

| Condition | Level | Title |
|-----------|-------|-------|
| `rate > 0.5` | warning | High Assignment Rate |
| `0.3 < rate <= 0.5` | neutral | Moderate Assignment Rate |
| `rate <= 0.3` | — | No insight |

Silently skipped when there are zero runs or zero cycles.

## UI Rendering

Insight cards appear in `simulator.md` between the benchmark summary cards and "Outcome Distribution".

Card styling:
- Left border colored by level: green (`#2ca02c`), gray (`#888`), orange (`#e68a00`), red (`#d62728`)
- Title in bold, message below, suggestion in muted text

## When to Update Insights

Update `insights.ts` (and this doc) when any of the following change:

| Change | Action required |
|--------|----------------|
| New field added to `MonteCarloResult` | Evaluate whether a new rule should use it |
| Field removed or renamed in `MonteCarloResult` | Fix any rules that reference it (build will break) |
| New field added to `StrategyConfig` | Evaluate whether suggestions should reference it |
| New rule added to strategy (e.g. `StopLossRule`, `RollRule`) | Consider adding an insight that evaluates the new rule's effect |
| Regime classification thresholds change | Review regime vulnerability thresholds (`meanAlpha < -10`) |
| New metric added to `RunSummary` or `RegimeBreakdown` | Evaluate whether an insight rule should use it |
| Insight thresholds need tuning | Update both the code and the rule tables in this doc |

Tests: `tests/insights.test.ts` — must cover every rule branch. Target >= 95% statement coverage on `insights.ts`.
