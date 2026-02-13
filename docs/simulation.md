# Simulation

## Overview

- Purpose: Define price generation and Monte Carlo analysis.
- Sources: `src/components/price-gen.ts`, `src/components/monte-carlo.ts`, `src/components/black-scholes.ts`, `src/components/strategy/simulate.ts`

## Price Generation

Geometric Brownian Motion with seeded PRNG.

Source: `price-gen.ts`

### Model

```
dailyReturn = exp(driftTerm + volTerm * Z)
  where:
    driftTerm = (annualDrift - sigma^2/2) * (1/365)
    volTerm = sigma * sqrt(1/365)
    Z ~ N(0,1) via Box-Muller transform

price[t+1] = price[t] * dailyReturn
```

### PRNG

Splitmix32, seeded. Produces uniform [0, 1) values. Box-Muller converts pairs of uniforms to standard normals.

Invariant: `generatePrices({..., seed: 42})` always returns the same series.

### PriceGenConfig

| Parameter | Type | Description |
|-----------|------|-------------|
| `startPrice` | number | Initial price (USD) |
| `days` | number | Number of daily prices to generate |
| `annualVol` | number | Annualized volatility (0.80 = 80%) |
| `annualDrift` | number | Annualized drift (0.0 = martingale) |
| `seed` | number | PRNG seed |

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

### Aggregated Metrics (MonteCarloResult)

| Metric | Description |
|--------|-------------|
| `winRate` | Fraction of runs with totalPL > 0 |
| `meanAPR`, `medianAPR` | Central tendency of APR |
| `p5APR`, `p25APR`, `p75APR`, `p95APR` | APR distribution percentiles |
| `meanPL`, `medianPL` | P/L distribution |
| `meanMaxDrawdown` | Average worst drawdown across runs |
