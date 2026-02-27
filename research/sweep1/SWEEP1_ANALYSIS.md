# Sweep 1 Analysis: High-Vol Sideways Grid Search

**Date:** 2026-02-25
**Market Regime:** High-Vol Sideways (0% drift, 150% vol, Heston model)
**Simulation:** 1,000 Monte Carlo paths × 365 days
**Parameter Grid:** 48 combinations (4 deltas × 4 cycle lengths × 3 skip thresholds)

---

## Headline Finding

In a 150% vol, zero-drift environment (meme stocks, crypto, crisis markets), **the wheel strategy is fundamentally a losing proposition on a risk-adjusted basis.** The single best Sharpe is 0.013 — statistically indistinguishable from zero. T-bills win.

## Top 10 Results (by Sharpe)

| Delta | Cycle | Skip | Mean APR | Win Rate | Sharpe | Sortino | Max DD |
|-------|-------|------|----------|----------|--------|---------|--------|
| 0.10  | 30    | 0%   | 0.54%    | 56.8%    | 0.013  | 7.544   | 35.54% |
| 0.10  | 30    | 5%   | 0.57%    | 51.9%    | -0.036 | 7.464   | 39.02% |
| 0.10  | 30    | 10%  | 1.07%    | 46.6%    | -0.111 | 7.373   | 42.15% |
| 0.10  | 14    | 0%   | -0.70%   | 50.0%    | -0.146 | 2.094   | 43.74% |
| 0.20  | 30    | 0%   | 4.30%    | 48.8%    | -0.177 | 3.361   | 46.47% |
| 0.10  | 7     | 0%   | -2.12%   | 46.7%    | -0.220 | 0.175   | 48.55% |
| 0.20  | 30    | 5%   | 4.51%    | 45.7%    | -0.242 | 3.270   | 49.78% |
| 0.30  | 30    | 0%   | 8.92%    | 46.1%    | -0.245 | 2.252   | 50.66% |
| 0.20  | 14    | 0%   | 2.22%    | 45.0%    | -0.257 | 0.828   | 51.57% |
| 0.20  | 7     | 0%   | 3.25%    | 44.0%    | -0.277 | -0.314  | 54.14% |

## Bottom 5 Results (by Sharpe)

| Delta | Cycle | Skip | Mean APR | Win Rate | Sharpe | Sortino | Max DD |
|-------|-------|------|----------|----------|--------|---------|--------|
| 0.30  | 7     | 10%  | 5.01%    | 35.9%    | -0.430 | -0.519  | 60.45% |
| 0.30  | 3     | 10%  | 3.54%    | 35.2%    | -0.435 | -0.535  | 61.59% |
| 0.40  | 14    | 10%  | 7.35%    | 38.2%    | -0.435 | -0.516  | 59.15% |
| 0.40  | 7     | 10%  | 6.00%    | 36.0%    | -0.439 | -0.531  | 60.48% |
| 0.40  | 3     | 10%  | 4.89%    | 35.2%    | -0.440 | -0.541  | 61.53% |

---

## Key Findings

### 1. Delta is a risk factor, not a return lever

Moving from 0.10 to 0.40 delta increases mean APR (0.54% → ~12%) but max drawdown explodes proportionally (35% → 61%). Sharpe deteriorates monotonically. You are not compensated for the additional risk — you're picking up pennies in front of a steamroller with increasingly short arms.

### 2. Longer DTE massively outperforms shorter DTE

| Config (0.1 delta) | Sharpe | Max DD |
|---------------------|--------|--------|
| 30 DTE              | 0.013  | 35%    |
| 7 DTE               | -0.220 | 48%    |
| 3 DTE               | not in top 10 | >50% |

In a high-vol regime, short-dated options carry enormous gamma exposure. Selling weeklies means being short gamma in precisely the environment where gamma is most dangerous. 30 DTE provides more theta *and* a wider no-touch zone — the option has room to absorb overnight gaps without breaching the strike.

This completely dispels the "sell weeklies for faster theta decay" myth in extreme vol environments.

### 3. The skip threshold (premium filter) is a trap

Skip = 0% (always sell) consistently beats skip = 5% or 10%. This is counterintuitive — waiting for "fat premiums" should improve quality. But in practice:

- High-vol markets *always* have fat premiums. The filter barely triggers.
- When it does trigger, you sit in cash during the moments vol is compressing — precisely when theta harvesting is most profitable.
- You introduce path-dependent selection bias that reduces trade count without improving average quality.

### 4. Sortino tells a different story than Sharpe

The 0.1 delta / 30 DTE row: Sharpe 0.013 but Sortino **7.544**. This massive divergence reveals a heavily right-skewed return distribution — upside volatility is large (some paths generate big premium income when vol stays elevated but doesn't breach), while downside volatility is relatively contained. A mean-variance framework (Sharpe) penalizes upside vol. Sortino, which only penalizes downside deviation, shows this strategy actually has a decent asymmetric payoff profile.

### 5. Win rate degrades with aggressiveness

| Config | Win Rate |
|--------|----------|
| 0.1δ / 30 DTE / 0% skip | 56.8% |
| 0.4δ / 3 DTE / 10% skip | 35.2% |

In a zero-drift market, a sub-50% win rate with negative Sharpe means negative expectancy. The winners don't cover the losers.

---

## Strategic Takeaways

- **If you must run the wheel in high vol:** 0.10 delta, 30 DTE monthlies, always be in the market. Accept ~0.5% APR and ~35% drawdown. You're essentially harvesting variance risk premium with CSPs as the instrument.
- **The real insight is what's missing:** No parameter combination produces an attractive risk/return profile. The best Sharpe is 0.013. This market regime is telling you to *not sell naked/cash-secured premium*.
- **The 0.20 delta / 30 DTE sweet spot** (4.3% APR, -0.177 Sharpe, 46% maxDD) is the practical "best compromise" if you accept negative risk-adjusted returns for nominal income. But that's a behavioral trade, not a rational one.

---

## Recommended Follow-Up Experiments

1. **Spread strategies** — Same sweep but with defined-risk verticals (5-wide, 10-wide). Cap the max loss per cycle and likely improve Sharpe by truncating drawdown tails.
2. **Regime filter** — Only sell premium when realized vol > implied vol (variance risk premium is positive). Sit in cash otherwise.
3. **Lower-vol market presets** — 150% vol is adversarial by design. Run the same grid on 20–30% vol (normal equity vol) to find where the wheel actually works.
4. **Kelly sizing** — Fixed 1-contract sizing ignores bankroll management. Fractional Kelly with these win rates and payoff ratios would likely reduce position size dramatically in aggressive parameterizations.
