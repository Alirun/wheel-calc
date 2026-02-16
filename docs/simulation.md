# Simulation

## Overview

- Purpose: Define price generation and Monte Carlo analysis.
- Sources: `src/components/price-gen.ts`, `src/components/monte-carlo.ts`, `src/components/black-scholes.ts`, `src/components/strategy/simulate.ts`

## Price Generation

Source: `price-gen.ts`

Four models available, selected via `config.model` (default `"gbm"`). All models return `PriceGenResult: { prices: number[], ivPath?: number[] }`.

### Models

#### GBM (Geometric Brownian Motion)

Constant-volatility log-normal model. The baseline.

```
price[t+1] = price[t] * exp((μ - σ²/2) * dt + σ * √dt * Z)
```

Returns `{ prices }` (no `ivPath`).

#### Heston (Stochastic Volatility)

Andersen Quadratic-Exponential (QE) discretization. Variance follows a mean-reverting CIR process with correlated Brownian motions.

```
variance process: v[t+1] ~ QE(m, s²)  where m = θ + (v[t] - θ)·e^(-κ·dt)
price Brownian:   z_S = ρ·z₁ + √(1-ρ²)·z₂
price step:       price[t+1] = price[t] * exp((μ - v̄/2) * dt + √v̄ * √dt * z_S)
  where v̄ = (v[t] + v[t+1]) / 2
```

QE scheme guarantees non-negative variance. Returns `{ prices, ivPath }` where `ivPath[i] = √v[i]`.

| Parameter | Default | Description |
|-----------|---------|-------------|
| `kappa` | 2.0 | Mean-reversion speed |
| `theta` | 0.64 | Long-run variance (σ²) |
| `sigma` | 0.5 | Vol-of-vol |
| `rho` | -0.7 | Price-variance correlation |
| `v0` | theta | Initial variance |

#### Jump Diffusion (Merton)

GBM with Poisson jump arrivals. Drift-compensated to preserve expected return.

```
jump compensator: k = λ·(e^(μ_J + σ_J²/2) - 1)
price[t+1] = price[t] * exp((μ - σ²/2 - k) * dt + σ * √dt * Z + J)
  where J = μ_J + σ_J * z_J  with probability λ·dt, else 0
```

Returns `{ prices }` (no `ivPath`).

| Parameter | Default | Description |
|-----------|---------|-------------|
| `lambda` | 10 | Expected jumps per year |
| `muJ` | 0 | Mean of log-jump size |
| `sigmaJ` | 0.05 | Std dev of log-jump size |

#### Heston + Jump (Combined)

Heston variance process with Merton jump component on price. Returns `{ prices, ivPath }`.

### PRNG

Splitmix32, seeded. Produces uniform [0, 1) values. Box-Muller converts pairs of uniforms to standard normals. Single PRNG stream per model call — deterministic draw order.

Invariant: `generatePrices({..., seed: 42})` always returns the same series.

### PriceGenConfig

| Parameter | Type | Description |
|-----------|------|-------------|
| `startPrice` | number | Initial price (USD) |
| `days` | number | Number of daily prices to generate |
| `annualVol` | number | Annualized volatility (0.80 = 80%). Used by GBM and jump models. |
| `annualDrift` | number | Annualized drift (0.0 = martingale) |
| `seed` | number | PRNG seed |
| `model` | `PriceModel?` | `"gbm"` (default), `"heston"`, `"jump"`, `"heston-jump"` |
| `heston` | `HestonParams?` | Required when model includes "heston" |
| `jump` | `JumpParams?` | Required when model includes "jump" |

### IV Path Threading

When a model produces `ivPath` (Heston, Heston-Jump), it is passed through:

```
generatePrices() → { prices, ivPath }
  ↓
runMonteCarlo / rerunSingle → simulate(prices, rules, config, ivPath)
  ↓
simulate() → MarketSnapshot.iv = ivPath[day]
  ↓
rules → vol = market.iv ?? config.impliedVol  (used in all BS calls)
```

When `ivPath` is absent (GBM, Jump), `market.iv` is undefined and rules fall back to `config.impliedVol`.

## Black-Scholes Pricing

Source: `black-scholes.ts`

### Exported Functions

| Function | Purpose |
|----------|---------|
| `bsCallPrice(S, K, T, r, sigma)` | European call price |
| `bsPutPrice(S, K, T, r, sigma)` | European put price |
| `bsCallDelta(S, K, T, r, sigma)` | Call delta: N(d1) |
| `bsPutDelta(S, K, T, r, sigma)` | Put delta: N(d1) - 1 |
| `findStrikeForDelta(targetAbsDelta, spot, T, r, sigma, type)` | Binary search for strike at target delta |
| `cdf(x)` | Standard normal CDF (rational approximation, ~1e-7 accuracy) |

### Parameters (all functions)

`S` = spot, `K` = strike, `T` = time to expiry in years, `r` = risk-free rate, `sigma` = annualized vol.

## Monte Carlo

Source: `monte-carlo.ts`

### Entry Points

| Function | Purpose |
|----------|---------|
| `runMonteCarlo(market, config, numRuns)` | Run N simulations with `defaultRules()`, return aggregated stats |
| `rerunSingle(market, config, seed)` | Re-run one seed with `defaultRules()`, return prices + full SimulationResult |

Both functions accept `StrategyConfig` (was `WheelConfig`) and internally call `simulate(prices, rules, config)` from `strategy/simulate.ts`.

### MarketParams

| Parameter | Type | Description |
|-----------|------|-------------|
| `startPrice` | number | Initial ETH price |
| `days` | number | Simulation length |
| `annualVol` | number | Realized volatility (IV = RV * (1 + ivPremiumPct/100), computed in UI) |
| `annualDrift` | number | Expected annual drift |
| `model` | `PriceModel?` | Price model selection (default `"gbm"`) |
| `heston` | `HestonParams?` | Heston model parameters |
| `jump` | `JumpParams?` | Jump diffusion parameters |

### Per-Run Metrics (RunSummary)

| Metric | Computation |
|--------|------------|
| `totalPL` | realizedPL + unrealizedPL at last day |
| `realizedPL` | Sum of all trade P/Ls |
| `unrealizedPL` | (lastSpot - entryPrice) * contracts, or 0 if not holding |
| `apr` | (realizedPL / capitalAtRisk) / yearsElapsed * 100 |
| `maxDrawdown` | Peak-to-trough of (cumulativePL + unrealizedPL) over daily states |
| `fullCycles` | Count of call assignments (put→call→put completed), derived from `signalLog` |
| `skippedCycles` | Count of SKIP signals |
| `isWin` | totalPL > 0 |
| `benchmarkPL` | (finalPrice - startPrice) * contracts |
| `benchmarkAPR` | Same APR formula applied to benchmarkPL |
| `benchmarkMaxDD` | Peak-to-trough of buy-and-hold P/L over the price series |
| `sharpe` | Annualized Sharpe ratio: (mean(dailyReturns) - rf_daily) / std(dailyReturns) * sqrt(365) |
| `sortino` | Annualized Sortino ratio: same as Sharpe but denominator uses only downside deviation (returns below rf) |
| `benchmarkSharpe` | Sharpe ratio of the buy-and-hold daily returns |
| `benchmarkSortino` | Sortino ratio of the buy-and-hold daily returns |
| `regime` | `"bull"` / `"bear"` / `"sideways"` — classified by annualized underlying return (>+20%, <-20%, or in between) |
| `underlyingReturn` | (finalPrice - startPrice) / startPrice |

Daily returns for Sharpe/Sortino are computed as daily change in total P/L (realized + unrealized) divided by capital at risk. Benchmark daily returns use `(prices[i] - prices[i-1]) / prices[0]`.

### Aggregated Metrics (MonteCarloResult)

| Metric | Description |
|--------|-------------|
| `winRate` | Fraction of runs with totalPL > 0 |
| `meanAPR`, `medianAPR` | Central tendency of APR |
| `p5APR`, `p25APR`, `p75APR`, `p95APR` | APR distribution percentiles |
| `meanPL`, `medianPL` | P/L distribution |
| `meanMaxDrawdown` | Average worst drawdown across runs |
| `meanBenchmarkAPR`, `medianBenchmarkAPR` | Buy-and-hold APR distribution |
| `meanBenchmarkPL` | Average buy-and-hold P/L |
| `meanBenchmarkMaxDD` | Average buy-and-hold max drawdown |
| `meanSharpe`, `meanSortino` | Average risk-adjusted ratios (wheel) |
| `benchmarkMeanSharpe`, `benchmarkMeanSortino` | Average risk-adjusted ratios (buy-and-hold) |
| `regimeBreakdown` | Per-regime stats: count, meanAPR, meanBenchmarkAPR, meanAlpha, meanSharpe, winRate, meanMaxDrawdown |

### Regime Classification

Each run is classified by the annualized return of the underlying price path:

| Regime | Condition |
|--------|-----------|
| Bull | annualized return > +20% |
| Bear | annualized return < -20% |
| Sideways | between -20% and +20% |

Annualized return = `underlyingReturn * (365 / days)`. This makes classification duration-independent.
