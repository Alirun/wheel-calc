# Sweep 2 Analysis: Normal-Vol Regime Grid Search

**Date:** 2026-02-27
**Market Regime:** GBM with stochastic IV (OU process), 5% annual drift (mild uptrend), tested at **25%** and **50%** annual vol
**Simulation:** 1,000 Monte Carlo paths × 365 days
**Parameter Grid:** 180 combinations (6 deltas × 5 cycle lengths × 3 skip thresholds × 2 vol levels)
**IV Model:** Ornstein-Uhlenbeck process — IV mean-reverts around `annualVol + vrpOffset` with κ=5.0 (mean-reversion speed), ξ=0.5 (vol-of-vol), VRP=15%

---

## Headline Finding

**The wheel strategy generates genuine alpha in normal-volatility environments, even with realistic stochastic IV.** At 50% vol with mild positive drift, the best parameterization delivers a 0.417 Sharpe with +2.82% annualized alpha over buy-and-hold. At 25% vol, stochastic IV reshuffles the rankings: short-cycle strategies (3-day) now dominate because IV variability creates more premium capture opportunities at high frequency.

43.3% of all parameter combos produced positive Sharpe. 100% had positive mean APR.

---

## Top 15 Results (by Sharpe)

| Vol | Delta | Cycle | Skip | Mean APR | Median APR | P5 APR  | Win Rate | Sharpe | Sortino | Max DD | Bench APR | Alpha   |
|-----|-------|-------|------|----------|------------|---------|----------|--------|---------|--------|-----------|---------|
| 50% | 0.10  | 30    | 0%   | 6.68%    | 13.32%     | -40.08% | 71.7%    | 0.417  | 8.501   | 20.69% | 3.86%     | +2.82%  |
| 50% | 0.10  | 21    | 0%   | 6.84%    | 15.43%     | -43.63% | 67.9%    | 0.361  | 6.867   | 24.10% | 3.86%     | +2.98%  |
| 25% | 0.20  | 3     | 0%   | 13.17%   | 10.24%     | -29.71% | 62.1%    | 0.352  | 0.620   | 21.06% | 4.50%     | +8.67%  |
| 25% | 0.15  | 3     | 0%   | 10.69%   | 9.12%      | -29.62% | 62.9%    | 0.351  | 0.629   | 20.13% | 4.50%     | +6.18%  |
| 25% | 0.25  | 3     | 0%   | 14.83%   | 9.64%      | -30.04% | 63.4%    | 0.344  | 0.609   | 21.57% | 4.50%     | +10.33% |
| 50% | 0.10  | 30    | 5%   | 6.86%    | 11.29%     | -43.64% | 62.6%    | 0.331  | 8.248   | 24.45% | 3.86%     | +3.00%  |
| 25% | 0.30  | 3     | 0%   | 15.45%   | 10.00%     | -30.38% | 63.4%    | 0.320  | 0.570   | 21.98% | 4.50%     | +10.95% |
| 50% | 0.10  | 14    | 0%   | 8.15%    | 16.83%     | -45.51% | 66.0%    | 0.319  | 4.672   | 26.36% | 3.86%     | +4.29%  |
| 25% | 0.20  | 7     | 0%   | 11.19%   | 10.81%     | -29.12% | 65.3%    | 0.294  | 0.536   | 19.97% | 4.50%     | +6.68%  |
| 25% | 0.15  | 7     | 0%   | 8.75%    | 10.70%     | -29.03% | 66.3%    | 0.293  | 0.903   | 18.88% | 4.50%     | +4.25%  |
| 25% | 0.10  | 3     | 0%   | 6.85%    | 8.98%      | -29.20% | 64.3%    | 0.283  | 0.581   | 18.79% | 4.50%     | +2.34%  |
| 25% | 0.40  | 3     | 0%   | 16.07%   | 10.30%     | -30.80% | 63.2%    | 0.281  | 0.506   | 22.45% | 4.50%     | +11.57% |
| 25% | 0.15  | 21    | 0%   | 6.57%    | 11.19%     | -26.10% | 69.6%    | 0.271  | 3.261   | 15.99% | 4.50%     | +2.07%  |
| 50% | 0.15  | 30    | 0%   | 9.76%    | 16.84%     | -44.59% | 66.4%    | 0.270  | 7.751   | 26.71% | 3.86%     | +5.91%  |
| 25% | 0.25  | 7     | 0%   | 12.34%   | 10.01%     | -29.64% | 63.8%    | 0.267  | 0.492   | 20.72% | 4.50%     | +7.84%  |

## Top 10 by Nominal APR

| Vol | Delta | Cycle | Skip | Mean APR | Win Rate | Sharpe | Max DD | Alpha    |
|-----|-------|-------|------|----------|----------|--------|--------|----------|
| 50% | 0.40  | 3     | 0%   | 21.70%   | 55.0%    | 0.051  | 40.18% | +17.84%  |
| 50% | 0.40  | 7     | 0%   | 20.88%   | 55.4%    | 0.038  | 39.23% | +17.02%  |
| 50% | 0.40  | 14    | 0%   | 20.62%   | 57.5%    | 0.027  | 37.96% | +16.76%  |
| 50% | 0.40  | 21    | 0%   | 20.20%   | 57.3%    | 0.011  | 37.33% | +16.34%  |
| 50% | 0.30  | 3     | 0%   | 19.74%   | 54.7%    | 0.069  | 39.60% | +15.88%  |
| 50% | 0.40  | 30    | 0%   | 19.57%   | 58.2%    | -0.009 | 36.53% | +15.71%  |
| 50% | 0.25  | 3     | 0%   | 18.75%   | 54.9%    | 0.088  | 39.09% | +14.89%  |
| 50% | 0.30  | 7     | 0%   | 18.11%   | 54.8%    | 0.056  | 38.41% | +14.26%  |
| 50% | 0.30  | 14    | 0%   | 17.37%   | 57.9%    | 0.055  | 36.70% | +13.51%  |
| 50% | 0.30  | 21    | 0%   | 17.19%   | 58.0%    | 0.064  | 35.72% | +13.33%  |

## Bottom 5 Results (by Sharpe)

| Vol | Delta | Cycle | Skip | Mean APR | Median APR | Win Rate | Sharpe | Max DD | Alpha  |
|-----|-------|-------|------|----------|------------|----------|--------|--------|--------|
| 50% | 0.40  | 21    | 10%  | 9.84%    | -3.50%     | 47.0%    | -0.266 | 42.16% | +5.98% |
| 50% | 0.40  | 14    | 10%  | 8.61%    | -4.58%     | 46.4%    | -0.269 | 43.02% | +4.75% |
| 50% | 0.30  | 3     | 10%  | 4.88%    | -7.15%     | 43.9%    | -0.271 | 44.65% | +1.02% |
| 50% | 0.40  | 7     | 10%  | 6.54%    | -6.28%     | 44.1%    | -0.277 | 44.06% | +2.69% |
| 50% | 0.40  | 3     | 10%  | 5.22%    | -7.05%     | 44.0%    | -0.279 | 44.67% | +1.36% |

## Best Per Vol Level

### 25% Vol — Top 5

| Delta | Cycle | Skip | Mean APR | Win Rate | Sharpe | Max DD | Alpha   |
|-------|-------|------|----------|----------|--------|--------|---------|
| 0.20  | 3     | 0%   | 13.17%   | 62.1%    | 0.352  | 21.06% | +8.67%  |
| 0.15  | 3     | 0%   | 10.69%   | 62.9%    | 0.351  | 20.13% | +6.18%  |
| 0.25  | 3     | 0%   | 14.83%   | 63.4%    | 0.344  | 21.57% | +10.33% |
| 0.30  | 3     | 0%   | 15.45%   | 63.4%    | 0.320  | 21.98% | +10.95% |
| 0.20  | 7     | 0%   | 11.19%   | 65.3%    | 0.294  | 19.97% | +6.68%  |

### 50% Vol — Top 5

| Delta | Cycle | Skip | Mean APR | Win Rate | Sharpe | Max DD | Alpha  |
|-------|-------|------|----------|----------|--------|--------|--------|
| 0.10  | 30    | 0%   | 6.68%    | 71.7%    | 0.417  | 20.69% | +2.82% |
| 0.10  | 21    | 0%   | 6.84%    | 67.9%    | 0.361  | 24.10% | +2.98% |
| 0.10  | 30    | 5%   | 6.86%    | 62.6%    | 0.331  | 24.45% | +3.00% |
| 0.10  | 14    | 0%   | 8.15%    | 66.0%    | 0.319  | 26.36% | +4.29% |
| 0.15  | 30    | 0%   | 9.76%    | 66.4%    | 0.270  | 26.71% | +5.91% |

---

## Key Findings

### 1. The wheel generates genuine alpha in normal vol — confirmed with stochastic IV

At 50% vol: best Sharpe is 0.417, best alpha is +2.82% over buy-and-hold, and 71.7% of simulation paths end profitable. At 25% vol the edge is stronger than previously measured (best Sharpe 0.352, best alpha +10.33%) with short cycles dominating. 43.3% of all combos had positive Sharpe — up from 38.9% in the static-IV version.

The variance risk premium — the difference between implied vol (what you sell) and realized vol (what you experience) — is the source of edge. The OU IV model makes this premium time-varying: IV mean-reverts toward `annualVol * 1.15` (the 15% VRP), but stochastic fluctuations create periods of both elevated and compressed premium. This is more realistic than a fixed-premium model.

**Stochastic IV impact vs. static IV:**
- 50% vol best Sharpe: 0.468 → 0.417 (−11%) — IV variability erodes some of the "free" premium
- 50% vol best alpha: +3.77% → +2.82% (−25%) — realistic IV pricing deflates inflated returns
- Positive Sharpe combos: 38.9% → 43.3% (+4.4pp) — more combos benefit from IV fluctuations
- **25% vol rankings completely reshuffled** — short cycles (3-day) now dominate because time-varying IV rewards frequent premium capture

### 2. Stochastic IV reveals divergent optimal strategies by vol level

This is the most striking finding. With static IV, both vol levels favored `delta: 0.10, cycle: 30` — low delta, long DTE. With stochastic IV:

- **50% vol** still favors `delta: 0.10, cycle: 30` — long DTE smooths through IV fluctuations. The high base premium level means you don't need to trade frequently.
- **25% vol** now favors `delta: 0.15–0.25, cycle: 3` — short, frequent trades. At lower vol, the OU process creates proportionally larger IV swings relative to the premium level. Frequent entry lets you capture these swings.

This is a structural result: **optimal cycle length should scale with volatility level.** High vol → long cycles (let theta work). Low vol → short cycles (capture IV variability).

### 3. 50% vol is still the sweet spot for conservative strategies

The top 50% vol strategies deliver the clearest risk-adjusted edge:
- **Fatter premiums** at 50% vol collect 2–3x more per cycle than 25%.
- **Long DTE** smooths IV noise and maximizes theta decay.
- **Win rate of 71.7%** — highest across all top strategies.

But 25% vol now competes on Sharpe (0.352 vs 0.417) by using a different mechanism: high-frequency premium collection rather than patient theta harvesting.

### 4. Short cycles at 25% vol are the best approach — with caveats

The 25% vol 3-day strategies are the top-ranked strategies for this vol level, delivering 0.34–0.35 Sharpe with +6–11% alpha. This is a genuine finding, not a fluke — stochastic IV creates proportionally larger swings at low vol, and frequent entry captures them.

However, the tail risk profile is meaningfully worse than the conservative 50% vol strategies:
- **P5 APR is worse** (-29.7% vs -26.1% for the 25% vol longer-cycle strategies)
- **Win rate is lower** (62–63% vs 69–74% for longer cycles at 25% vol)
- **Max DD is higher** (20–22% vs 14–16% for longer cycles at 25% vol)
- **Sortino is low** (0.5–0.6 vs 2.3–4.0 for longer cycles)

The high Sharpe comes from mean APR being lifted significantly (13% vs 4% for longer cycles). The low Sortino confirms the downside risk is proportionally higher — these strategies win more often on average but the losses are larger when they come.

### 5. Low delta + long DTE remains king at 50% vol

The #1 Sharpe strategy at 50% vol is `delta: 0.10, cycle: 30, skip: 0` — unchanged from the static-IV result and from Experiment 1. The mechanism is consistent:

- **Low delta** = high probability of expiring OTM = more winning cycles.
- **Long DTE** = lower gamma = position absorbs daily price moves without delta blowing up.
- **Together**, they maximize the theta/gamma ratio while riding out IV fluctuations.

### 6. Skip threshold consistently destroys value

Every single top strategy uses `skip: 0`. Adding a 5% or 10% skip filter:
- Reduces win rate (71.7% → 62.6% for the best 50% vol combo with 5% skip)
- Reduces Sharpe (0.417 → 0.331)
- Increases max drawdown (20.69% → 24.45%)

With stochastic IV, the skip filter is even more counterproductive: it may skip entries right when IV spikes above the mean — exactly when selling premium is most profitable.

### 7. High delta is regime-dependent — trap at 50% vol, viable at 25% vol

At **50% vol**, high delta is a classic return trap. The highest nominal APR (21.70% at delta 0.4, cycle 3) looks attractive until you check:
- Sharpe collapses to 0.051 (barely positive)
- Max drawdown is 40.18%
- Win rate drops to 55.0%
- P5 APR is -54.87% — catastrophic left tail

But at **25% vol**, higher deltas with short cycles are competitive:
- Delta 0.25, cycle 3: 0.344 Sharpe, +10.33% alpha — ranked #5 overall
- Delta 0.30, cycle 3: 0.320 Sharpe, +10.95% alpha — ranked #7 overall
- Even delta 0.40, cycle 3: 0.281 Sharpe, +11.57% alpha — ranked #12 overall

This contradicts Experiment 1's universal finding that "delta is a risk factor, not a return lever." At 150% vol with Heston, that was true — higher delta monotonically destroyed Sharpe. At 25% vol with positive drift and stochastic IV, the premium collected at higher deltas is not fully consumed by assignments because the underlying isn't whipsawing as violently. **The delta-as-risk relationship is non-linear and vol-dependent.**

### 8. Mean vs. median divergence flags tail risk

The #1 strategy shows 6.68% mean APR but 13.32% median APR. The mean is dragged down by a left tail of bad paths (P5 APR is -40.08%). This tells us:

- **The typical outcome is ~13% APR** — better than the mean suggests.
- **But 5% of the time you lose 40%+** — the strategy has fat left tails even in benign markets.
- Win rate of 71.7% means you win ~3 out of 4 times, but the losses are proportionally larger.

This is the classic short-volatility payoff profile: many small wins, occasional large losses.

### 9. The wheel outperforms buy-and-hold on a risk-adjusted basis

| Metric | Wheel (best 50%) | Buy & Hold |
|--------|-----------------|------------|
| Mean APR | 6.68% | 3.86% |
| Win Rate | 71.7% | ~50% (drift-dependent) |
| Sharpe | 0.417 | N/A (single path) |
| Max DD | 20.69% | Market-dependent |
| Alpha | +2.82% | 0% (benchmark) |

The wheel nearly doubles the return of buy-and-hold at 50% vol with 5% drift. The alpha comes from the variance risk premium — you're being compensated for selling insurance.

---

## Comparison: Experiment 1 vs. Experiment 2

| Metric | Exp 1 (150% vol, 0% drift) | Exp 2 Best (50% vol, 5% drift) |
|--------|---------------------------|-------------------------------|
| Best Sharpe | 0.013 | **0.417** |
| Best Win Rate | 56.8% | **71.7%** |
| Best Alpha | ~0% | **+2.82%** |
| Best Max DD | 35.5% | **20.7%** |
| % combos positive Sharpe | 0% | **43.3%** |
| % combos positive APR | ~50% | **100%** |

The difference is stark. The wheel's profitability is entirely regime-dependent.

---

## Preset Candidates

Two strong candidates for built-in strategy presets:

### "Conservative Income" (50% vol optimized)
- `targetDelta: 0.10, cycleLengthDays: 30, skipThresholdPct: 0`
- 6.68% APR, 71.7% win rate, 20.69% max DD, 0.417 Sharpe
- Best for: Moderate-vol crypto/growth environments, balanced accounts

### "Active Premium" (25% vol optimized)
- `targetDelta: 0.15, cycleLengthDays: 3, skipThresholdPct: 0`
- 10.69% APR, 62.9% win rate, 20.13% max DD, 0.351 Sharpe
- Best for: Low-vol equity environments, active traders comfortable with frequent rolling

---

## Strategic Takeaways

- **Vol regime determines not just WHETHER to deploy, but HOW.** At 50% vol, conservative parameterization (low delta, long DTE) is optimal. At 25% vol, aggressive parameterization (moderate delta, short DTE) wins. At 150% vol, no parameterization works. The "best strategy" is entirely regime-specific.
- **Both delta and cycle length should scale with vol.** At 50% vol: low delta (0.10), long cycle (30 days). At 25% vol: moderate delta (0.15–0.25), short cycle (3 days). This is a structural finding enabled by stochastic IV — static IV masked the divergence.
- **The absolute alpha numbers are more trustworthy now.** Stochastic IV deflated 50% vol alpha by 25% (from +3.77% to +2.82%), removing the "free lunch" from static IV pricing. The remaining edge is genuine variance risk premium harvesting.
- **Never use skip filters in trending markets.** Premium filtering has negative selection: it removes you from exactly the periods when selling puts is most profitable.
- **Respect the left tail.** Even the best strategy has -40% P5 APR at 50% vol and -30% at 25% vol. Position sizing and portfolio allocation should account for this.

---

## Recommended Follow-Up Experiments

See the consolidated experiment queue in [research/README.md](../README.md#recommended-next-experiments).
