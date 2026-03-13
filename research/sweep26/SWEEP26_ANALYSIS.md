# Experiment 26: Cross-Asset Portfolio Analysis

## Goal

Test whether combining ETH and BTC wheel strategies into a portfolio improves risk-adjusted returns and reduces MaxDD below individual-asset levels. Prior experiments established asset-dependent strategy rankings (Conservative dominates ETH, tied with Aggressive on BTC — Exp 24) and complementary win-window patterns (Exp 20). This experiment combines equity curves from both assets under various allocation schemes and measures portfolio-level Sharpe, MaxDD, and diversification benefit.

## Data

- **ETH**: 1,812 aligned days (2021-03-24 → 2026-03-09) — cached from Exp 16
- **BTC**: 1,814 aligned days (2021-03-24 → 2026-03-11) — cached from Exp 24
- **Common dates**: 1,812 days (2021-03-24 → 2026-03-09)

## Approach

1. **Equity curve construction**: Run Conservative and Aggressive (with final shipped sizing configs from Exp 23) on both ETH and BTC, producing 4 daily equity curves normalised to 1.0.
2. **Correlation analysis**: Full-period and rolling 90-day Pearson correlation between all 6 pairs.
3. **Portfolio construction**: 15 portfolio variants:
   - 4 single-asset baselines
   - 4 two-asset equal-weight (EW) combos
   - 4 two-asset inverse-vol-weighted (IV) combos
   - 2 four-leg portfolios (EW and IV)
   - 1 dynamic Sharpe-weighted (ETH-Cons + BTC-Aggr)
4. **Rolling window analysis**: 17 overlapping 365-day windows (stride 90d) for statistical robustness.
5. **Efficient frontier**: Sweep ETH/BTC weights in 10% increments for the two best combos.
6. **Sub-period analysis**: Performance across 5 market regimes (bull, bear, recovery, mixed).

Total: 85 full-period backtests + 289 rolling-window backtests. Execution: 0.12s.

## Results

### Part 1: Return Correlations

**Daily Return Correlation Matrix:**

| | ETH-Cons | ETH-Aggr | BTC-Cons | BTC-Aggr |
|---|---------|----------|----------|----------|
| ETH-Cons | 1.000 | 0.215 | 0.346 | 0.236 |
| ETH-Aggr | 0.215 | 1.000 | 0.219 | 0.632 |
| BTC-Cons | 0.346 | 0.219 | 1.000 | 0.347 |
| BTC-Aggr | 0.236 | 0.632 | 0.347 | 1.000 |

**Key correlations:**
- Cross-asset same-strategy: Conservative 0.346, Aggressive 0.632
- Cross-asset cross-strategy (ETH-Cons ↔ BTC-Aggr): **0.236** — lowest cross-asset pair
- Same-asset cross-strategy: ETH 0.215, BTC 0.347

**Rolling 90-day correlation:**
- Conservative cross-asset: mean 0.361, std 0.389, range [−0.395, 0.915]
- Aggressive cross-asset: mean 0.519, std 0.245, range [0.061, 0.820]

### Part 2: Full-Period Portfolio Results

| Portfolio | Sharpe | Sortino | APR% | MaxDD | Total Return | Ann Vol |
|-----------|--------|---------|------|-------|--------------|---------|
| **IV: ETH-Cons + BTC-Aggr** | **0.690** | 0.699 | 26.70 | **25.2%** | 132.5% | 20.48% |
| EW: ETH-Cons + BTC-Aggr | 0.686 | 0.705 | 27.89 | 25.6% | 138.4% | 21.67% |
| ETH-Conservative | 0.638 | 0.761 | 34.28 | 36.1% | 170.1% | 31.25% |
| EW: All 4 Legs | 0.621 | 0.600 | 22.35 | 26.4% | 110.9% | 19.13% |
| IV: All 4 Legs | 0.606 | 0.578 | 21.03 | 26.2% | 104.4% | 18.31% |
| BTC-Aggressive | 0.558 | 0.601 | 21.51 | 26.0% | 106.7% | 21.48% |
| IV: ETH-Aggr + BTC-Aggr | 0.551 | 0.566 | 22.79 | 26.1% | 113.1% | 23.87% |
| EW: ETH-Cons + BTC-Cons | 0.543 | 0.603 | 21.60 | 27.6% | 107.2% | 22.48% |
| EW: ETH-Aggr + BTC-Aggr | 0.542 | 0.562 | 23.10 | 26.8% | 114.6% | 25.02% |
| ETH-Aggressive | 0.510 | 0.606 | 24.69 | 30.2% | 122.5% | 31.93% |
| IV: ETH-Cons + BTC-Cons | 0.508 | 0.561 | 19.28 | 27.5% | 95.7% | 21.26% |
| Dynamic Sharpe | 0.506 | 0.529 | 26.40 | 39.2% | 131.0% | 36.78% |
| EW: ETH-Aggr + BTC-Cons | 0.440 | 0.453 | 16.82 | 28.6% | 83.4% | 21.96% |
| IV: ETH-Aggr + BTC-Cons | 0.414 | 0.425 | 15.29 | 28.4% | 75.9% | 20.58% |
| BTC-Conservative | 0.219 | 0.245 | 8.91 | 34.0% | 44.2% | 21.58% |

**Best portfolio: IV: ETH-Conservative + BTC-Aggressive** — 0.690 Sharpe, 25.2% MaxDD, 26.70% APR.

### Diversification Benefit (vs Best Single-Asset)

Best single-asset Sharpe: ETH-Conservative (0.638). Best single-asset MaxDD: BTC-Aggressive (26.0%).

| Portfolio | ΔSharpe | ΔMaxDD |
|-----------|---------|--------|
| IV: ETH-Cons + BTC-Aggr | **+0.051** | **−0.8pp** |
| EW: ETH-Cons + BTC-Aggr | +0.048 | −0.4pp |
| All others | negative | positive |

Only ETH-Cons + BTC-Aggr combinations improve *both* Sharpe and MaxDD simultaneously.

### Part 3: Rolling Window Analysis

| Portfolio | Mean Sharpe | Median | Neg% | Max MaxDD |
|-----------|-----------|--------|------|-----------|
| **IV: ETH-Cons + BTC-Aggr** | **0.862** | 0.948 | **11.8%** | 25.2% |
| IV: All 4 Legs | 0.848 | 0.826 | 17.6% | 26.2% |
| BTC-Aggressive | 0.845 | 1.004 | 17.6% | 26.0% |
| IV: ETH-Aggr + BTC-Aggr | 0.829 | 0.839 | 11.8% | 26.1% |
| EW: ETH-Cons + BTC-Aggr | 0.826 | 0.913 | 11.8% | 25.6% |
| EW: All 4 Legs | 0.826 | 0.889 | 11.8% | 26.4% |
| EW: ETH-Aggr + BTC-Aggr | 0.793 | 0.858 | 11.8% | 26.8% |
| ETH-Aggressive | 0.595 | 0.845 | 23.5% | 30.2% |
| ETH-Conservative | 0.642 | 0.814 | 11.8% | 36.1% |
| BTC-Conservative | 0.554 | 0.654 | 29.4% | 34.0% |

**IV: ETH-Cons + BTC-Aggr** has the highest rolling mean Sharpe (0.862) and ties for lowest negative-Sharpe frequency (11.8%).

**Paired comparison (IV ETH-C+B-A vs BTC-Aggressive):**
- Portfolio wins: 6/17, Single wins: 9/17
- Mean ΔSharpe: +0.017 ± 0.381
- t-stat: 0.18 (not significant at p<0.05)
- Despite non-significance, portfolio has lower MaxDD in rolling and full-period analysis.

### Per-Window Winners

| Window Period | Best Strategy |
|---------------|--------------|
| 2021-03 → 2022-03 (Bull) | ETH-Conservative |
| 2021-06 → 2022-06 | ETH-Conservative |
| 2021-09 → 2022-09 | ETH-Conservative |
| 2021-12 → 2022-12 (Bear) | BTC-Aggressive |
| 2022-03 → 2023-03 | ETH-Conservative |
| 2022-06 → 2023-06 (Recovery) | BTC-Aggressive |
| 2022-09 → 2023-09 | BTC-Aggressive |
| 2022-12 → 2023-12 | EW All 4 |
| 2023-03 → 2024-03 | EW All 4 |
| 2023-06 → 2024-06 | IV ETH-C+B-A |
| 2023-09 → 2024-09 | EW All 4 |
| 2023-12 → 2024-12 | EW All 4 |
| 2024-03 → 2025-03 | BTC-Aggressive |
| 2024-06 → 2025-06 | BTC-Aggressive |
| 2024-09 → 2025-09 | BTC-Aggressive |
| 2024-12 → 2025-12 | BTC-Aggressive |
| 2025-03 → 2026-03 | IV ETH-C+B-A |

Complementary pattern confirmed: ETH-Conservative dominates early windows (bull/early bear), BTC-Aggressive dominates late windows (recovery/mixed/recent), portfolios win middle ground.

### Part 4: Sub-Period Analysis

| Period | ETH-Cons Sharpe | BTC-Aggr Sharpe | EW E-C+B-A Sharpe | EW All4 Sharpe |
|--------|----------------|-----------------|--------------------|--------------------|
| 2021 H2 (Bull) | 1.738 | 1.312 | 1.846 | 1.898 |
| 2022 (Bear) | −0.817 | −1.102 | −1.163 | −1.011 |
| 2023 (Recovery) | 1.305 | 1.621 | 1.554 | 1.773 |
| 2024 (Mixed) | 0.788 | 1.124 | 1.179 | 1.256 |
| 2025+ (Bear) | 0.100 | 0.406 | 0.224 | −0.233 |

Bear market (2022): All strategies/portfolios negative. Portfolio does not hedge bear risk.
Bull/recovery: Portfolios match or beat individual assets.
Recent bear (2025+): BTC-Aggressive outperforms; 4-leg portfolio underperforms due to weak legs.

### Part 5: Efficient Frontier

**ETH-Conservative + BTC-Aggressive (best combo):**

| ETH Wt | BTC Wt | Sharpe | MaxDD |
|--------|--------|--------|-------|
| 0% | 100% | 0.558 | 26.0% |
| 30% | 70% | 0.681 | 25.1% |
| **40%** | **60%** | **0.690** | **25.1%** |
| 50% | 50% | 0.686 | 25.6% |
| 100% | 0% | 0.638 | 36.1% |

**Optimal: 40% ETH-Conservative / 60% BTC-Aggressive → 0.690 Sharpe, 25.1% MaxDD.**

The frontier shows a clear minimum-variance point at 30–40% ETH weight where MaxDD is lowest (25.1%) and Sharpe peaks (0.690). Beyond 60% ETH, volatility increases rapidly (ETH annualised vol 31.25% vs BTC 21.48%) with only marginal Sharpe gains.

**ETH-Conservative + BTC-Conservative:** Monotonically increasing Sharpe with ETH weight — no diversification benefit; ETH-Conservative dominates BTC-Conservative at every weight.

## Key Findings

1. **Cross-asset wheel returns have low correlation (0.236–0.346 for Conservative, 0.632 for Aggressive).** Conservative strategies are especially decorrelated because trade timing depends on asset-specific IV/RV dynamics and skip rates (ETH 95% vs BTC 99%). Aggressive strategies are more correlated due to higher trade frequency exposing both to common crypto market beta.

2. **ETH-Conservative + BTC-Aggressive is the optimal portfolio.** It pairs the strongest asset-strategy combinations identified in Exps 20 and 24. Low cross-correlation (0.236) enables both Sharpe improvement (+0.051 vs best single) and MaxDD reduction (−0.8pp vs best single). The effect is small but consistent — the only combo that improves both metrics simultaneously.

3. **Inverse-vol weighting slightly outperforms equal weighting.** IV allocation (41% ETH / 59% BTC) reduces ETH overweight from 50% to 41%, offsetting ETH's higher annualised vol (31.25% vs 21.48%). ΔSharpe: +0.004 vs EW. ΔMaxDD: −0.4pp. The improvement is marginal but costless.

4. **The optimal ETH/BTC weight is 40/60 (Sharpe 0.690, MaxDD 25.1%).** The efficient frontier peaks at this allocation. ETH provides higher absolute returns (34.28% APR) but at much higher vol; BTC provides lower vol and higher Sharpe. 40% ETH captures enough of ETH's return premium while keeping portfolio vol controlled.

5. **Portfolios do not hedge bear market risk.** In 2022 (the only severe bear), all portfolios and individuals are negative. The portfolio's 2022 Sharpe (−1.163) is worse than ETH-Conservative alone (−0.817). Correlation increases during crashes (rolling 90d Cons correlation peaks at 0.915 during 2022 Q3–Q4). Diversification is a fair-weather benefit.

6. **Dynamic Sharpe-weighting is destructive.** Mean Sharpe 0.506 vs 0.690 for static IV weighting. MaxDD 39.2% (worst of all portfolios). The trailing Sharpe signal causes whipsaw: overweighting the recent winner just as regimes change. Static weights dominate.

7. **Four-leg portfolios add noise, not diversification.** EW All 4 Legs mean rolling Sharpe (0.826) matches EW ETH-C+B-A (0.826) despite diluting with two weaker legs (ETH-Aggressive, BTC-Conservative). Adding legs below the quality threshold is dilutive.

8. **Rolling window validation: the portfolio improvement is not statistically significant (t=0.18, p>0.05).** The paired comparison shows the portfolio wins only 6/17 windows vs BTC-Aggressive alone. The diversification benefit is real for full-period metrics but the per-window evidence is weak. This is consistent with N=17 being insufficient power for a 0.017 mean difference.

## Conclusion

**ETH-Conservative + BTC-Aggressive with inverse-vol weighting (41/59) is the optimal two-asset portfolio.** It achieves the highest full-period Sharpe (0.690, +8.1% vs best single), highest rolling mean Sharpe (0.862), and lowest MaxDD (25.2%) of any tested configuration. The improvement comes from low cross-correlation (0.236) between Conservative's selective, low-delta ETH trades and Aggressive's frequent BTC trades.

However, the benefit is **modest and not statistically significant** on per-window comparisons. The portfolio is a small improvement over BTC-Aggressive alone (best single on rolling basis) and ETH-Conservative alone (best single on full-period basis). It does not provide downside protection during bear markets — crash-period correlations spike toward 1.0.

**Recommendation:** Deploy 40% ETH-Conservative / 60% BTC-Aggressive for the smoothest equity curve and lowest MaxDD. Avoid dynamic allocation (Sharpe-weighting destroys value) and avoid four-leg portfolios (dilutive). No engine changes needed — portfolio construction is external to the strategy engine.

## Execution

- Script: `research/sweep26/sweep26.ts`
- Runtime: 0.12s
- Backtests: 374 total (85 full-period + 289 rolling-window)
- No code changes to engine or presets
