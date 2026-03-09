# Sweep 19 Analysis: Conservative Parameter Sweep on Real Data

## Setup

| Parameter | Value |
|-----------|-------|
| **Type** | Historical backtest — parameter optimization |
| **Follows** | Exp 18 (Historical Backtest) |
| **Data** | ETH-PERPETUAL prices + ETH DVOL, 2021-03-24 → 2026-03-09 |
| **Days** | 1,811 trading days (~4.96 years) |
| **Strategy** | Conservative variants (δ0.03–0.20, cycle 21–45d) |
| **Execution** | 700 core combos + 25 ablation + 7 delta + sub-period checks, 1.35s total |
| **Purpose** | Optimize Conservative's parameters on real data. Exp 18 showed Conservative is the best strategy (0.517 Sharpe) but executed only 11 trades in 5 years — find if trade quality/frequency can be improved. |

## Sub-experiment A: Core Parameter Sweep (700 combos)

### Sweep Space

| Parameter | Values | Count |
|-----------|--------|-------|
| `targetDelta` | 0.05, 0.08, 0.10, 0.12, 0.15 | 5 |
| `cycleLengthDays` | 21, 25, 30, 35, 45 | 5 |
| `skipBelowRatio` | 0.9, 1.0, 1.05, 1.1, 1.15, 1.2, 1.3 | 7 |
| `lookbackDays` | 20, 30, 45, 60 | 4 |

All combos run with full feature stack (RF+AC+PR).

### Top 10 Results

| Rank | δ | Cycle | Skip | LB | Sharpe | Sortino | APR% | MaxDD | PutSells | Cycles | Skip% | Alpha |
|------|-----|-------|------|-----|--------|---------|------|-------|----------|--------|-------|-------|
| 1 | 0.15 | 25 | 1.3 | 60 | **0.620** | 0.881 | 52.94 | 57.8% | 9 | 6 | 98.3% | +47.11 |
| 2 | 0.12 | 30 | 1.15 | 60 | **0.617** | 0.852 | 63.51 | 69.4% | 10 | 6 | 97.0% | +57.69 |
| 3 | 0.12 | 25 | 1.05 | 60 | **0.605** | 0.807 | 52.60 | 53.0% | 11 | 6 | 96.3% | +46.77 |
| 4 | 0.10 | 25 | 1.3 | 60 | **0.579** | 0.811 | 39.09 | 48.7% | 10 | 4 | 98.5% | +33.27 |
| 5 | 0.10 | 21 | 1.3 | 45 | **0.556** | 0.775 | 36.20 | 47.3% | 15 | 4 | 98.3% | +30.37 |
| 6 | 0.10 | 30 | 1.15 | 60 | **0.549** | 0.777 | 38.68 | 64.7% | 11 | 4 | 97.8% | +32.85 |
| 7 | 0.10 | 21 | 1.3 | 60 | **0.543** | 0.727 | 21.87 | 21.9% | 17 | 2 | 98.4% | +16.05 |
| 8 | 0.12 | 25 | 1.3 | 60 | **0.540** | 0.746 | 44.33 | 53.0% | 10 | 5 | 98.2% | +38.51 |
| 9 | 0.15 | 25 | 1.15 | 60 | **0.540** | 0.749 | 52.88 | 63.4% | 8 | 6 | 98.8% | +47.05 |
| 10 | 0.15 | 45 | 1.2 | 45 | **0.527** | 0.737 | 44.11 | 64.7% | 7 | 3 | 98.6% | +38.28 |

**Current config (δ0.10/c30/s1.1/lb45): Rank 14/700, Sharpe 0.517**

### Marginal Effects

**Delta** (mean Sharpe across all combos with that delta):
| δ | Mean Sharpe | Mean APR% | Mean PutSells |
|-----|-------------|-----------|---------------|
| 0.05 | 0.217 | 17.66 | 9.8 |
| 0.08 | 0.237 | 22.19 | 9.0 |
| 0.10 | 0.280 | 27.45 | 8.7 |
| 0.12 | **0.282** | 29.72 | 8.1 |
| 0.15 | 0.279 | 31.51 | 7.2 |

**Cycle Length:**
| Cycle | Mean Sharpe | Mean APR% | Mean PutSells |
|-------|-------------|-----------|---------------|
| 21d | **0.303** | 27.35 | 11.1 |
| 25d | 0.293 | 28.90 | 10.5 |
| 30d | 0.249 | 25.35 | 8.3 |
| 35d | 0.222 | 22.98 | 7.4 |
| 45d | 0.229 | 23.96 | 5.5 |

**Skip Threshold:**
| Skip | Mean Sharpe | Mean APR% | Mean Skip% |
|------|-------------|-----------|------------|
| 0.9 | **0.277** | 27.96 | 91.4% |
| 1.0 | 0.271 | 27.46 | 95.5% |
| 1.05 | 0.271 | 27.06 | 96.0% |
| 1.1 | 0.272 | 27.09 | 96.6% |
| 1.15 | 0.276 | 26.84 | 96.9% |
| 1.2 | 0.248 | 24.27 | 97.4% |
| 1.3 | 0.201 | 19.27 | 98.1% |

**Lookback:**
| LB | Mean Sharpe | Mean APR% |
|-----|-------------|-----------|
| 20d | 0.244 | 25.16 |
| 30d | 0.241 | 23.83 |
| 45d | 0.247 | 24.92 |
| 60d | **0.306** | 28.92 |

### Trade Frequency vs Sharpe

| Put Sells | Count | Mean Sharpe | Mean APR% | Mean MaxDD |
|-----------|-------|-------------|-----------|------------|
| 0–5 | 49 | 0.196 | 25.18 | 80.3% |
| 5–10 | 395 | 0.250 | 25.70 | 61.8% |
| 10–15 | 226 | 0.284 | 26.21 | 58.7% |
| 15–20 | 27 | **0.304** | 23.88 | 53.7% |
| 20–30 | 3 | 0.160 | 13.69 | 64.6% |

## Sub-experiment B: Feature Ablation

### Results for Top 5 Configs

| Config | None | RF only | RF+AC | RF+PR | RF+AC+PR |
|--------|------|---------|-------|-------|----------|
| δ0.15/c25/s1.3/lb60 | 0.002 | 0.487 | 0.588 | 0.269 | **0.620** |
| δ0.12/c30/s1.15/lb60 | −0.032 | −0.389 | 0.142 | 0.208 | **0.617** |
| δ0.12/c25/s1.05/lb60 | 0.265 | −0.069 | 0.290 | −0.009 | **0.605** |
| δ0.10/c25/s1.3/lb60 | −0.078 | 0.585 | 0.519 | 0.041 | **0.579** |
| δ0.10/c21/s1.3/lb45 | 0.188 | **1.325** | 1.091 | 0.107 | 0.556 |

### Mean ΔSharpe vs Full Stack (RF+AC+PR)

| Feature Set | Mean ΔSharpe |
|-------------|-------------|
| None | **−0.526** |
| RF only | −0.208 |
| RF+AC | −0.070 |
| RF+PR | **−0.472** |
| RF+AC+PR | 0.000 (baseline) |

### Notable: RF-only can outperform full stack

Config δ0.10/c21/s1.3/lb45 achieves **1.325 Sharpe** with RF only — the highest single-config Sharpe in the entire experiment, far above its RF+AC+PR result (0.556). With 28 put sells (vs 15 with PR enabled), MaxDD is only 6.0% (vs 47.3%). Put rolling reduces trade frequency and actually hurts this config by concentrating risk into fewer, longer-duration positions.

## Sub-experiment C: Wider Delta Exploration

At best params (c25/s1.3/lb60):

| δ | Sharpe | APR% | MaxDD | PutSells | Cycles |
|-----|--------|------|-------|----------|--------|
| 0.03 | −0.300 | 4.50 | 0.0% | 15 | 0 |
| 0.05 | 0.366 | 19.52 | 44.0% | 10 | 2 |
| 0.08 | 0.499 | 31.82 | 46.9% | 10 | 3 |
| 0.10 | 0.579 | 39.09 | 48.7% | 10 | 4 |
| 0.12 | 0.540 | 44.33 | 53.0% | 10 | 5 |
| **0.15** | **0.620** | **52.94** | 57.8% | 9 | 6 |
| 0.20 | 0.511 | 53.28 | 72.3% | 7 | 6 |

Sweet spot: δ0.10–0.15. Ultra-low delta (0.03) sells puts so far OTM that zero full cycles complete — the put never gets assigned, so no covered calls are sold. δ0.20 increases MaxDD disproportionately (72.3%).

## Sub-period Stability

### Best config: δ0.15/c25/s1.3/lb60

| Period | Regime | Sharpe | APR% | MaxDD |
|--------|--------|--------|------|-------|
| Full Period | sideways | **0.620** | 52.94 | 57.8% |
| 2021 H2 | bull | 1.397 | 144.43 | 57.8% |
| 2022 | bear | **−0.998** | −39.94 | 54.8% |
| 2023 | recovery | 2.324 | 25.48 | 0.0% |
| 2024–2025 | sideways | 0.427 | 30.22 | 54.9% |
| 2025–2026 H1 | bear | **0.108** | 11.23 | 37.2% |

### Runner-up: δ0.12/c30/s1.15/lb60

| Period | Regime | Sharpe | APR% | MaxDD |
|--------|--------|--------|------|-------|
| Full Period | sideways | **0.617** | 63.51 | 69.4% |
| 2021 H2 | bull | 1.462 | 207.71 | 69.4% |
| 2022 | bear | **−0.404** | −9.04 | 31.5% |
| 2023 | recovery | 2.745 | 27.41 | 0.0% |
| 2024–2025 | sideways | 0.339 | 23.03 | 44.9% |
| 2025–2026 H1 | bear | **0.357** | 20.04 | 36.8% |

Runner-up δ0.12/c30/s1.15/lb60 has **much better bear-market performance**: 2022 Sharpe −0.404 vs −0.998, and 2025–2026 is positive (0.357 vs 0.108). Higher APR (+63.51% vs +52.94%) but worse MaxDD (69.4% vs 57.8%).

## Comparison: Best Found vs Current Config

| Metric | Best (δ0.15/c25/s1.3/lb60) | Current (δ0.10/c30/s1.1/lb45) | Δ |
|--------|---------------------------|-------------------------------|---|
| **Sharpe** | **0.620** | 0.517 | **+0.103** |
| **Sortino** | **0.881** | 0.704 | **+0.177** |
| **APR%** | 52.94 | 50.19 | +2.75 |
| **MaxDD** | **57.8%** | 71.7% | **−14.0%** |
| Put Sells | 9 | 11 | −2 |
| Assignments | 12 | 9 | +3 |
| Full Cycles | 6 | 4 | +2 |
| Skip Rate | 98.3% | 95.2% | +3.0% |
| Put Rolls | 11 | 19 | −8 |
| Alpha | +47.11 | +44.37 | +2.75 |

## Key Findings

### 1. The current Conservative config is good but not optimal — rank 14/700

The Exp 18 config (δ0.10/c30/s1.1/lb45) ranks 14th out of 700 combinations, achieving 0.517 Sharpe. The best config (δ0.15/c25/s1.3/lb60) achieves 0.620 Sharpe — a +20% improvement with **lower MaxDD** (57.8% vs 71.7%). However, both are within the same competitive cluster: the top 20 configs all achieve 0.50+ Sharpe, and many parameter combinations are within noise given N=1.

### 2. δ0.10–0.15, cycle 21–25d, lookback 60d is the optimal region

Marginal analysis reveals clear directional preferences:
- **Delta 0.10–0.12** is the sweet spot by mean Sharpe (0.280–0.282). δ0.15 trades higher APR for similar Sharpe. δ0.05 is clearly suboptimal (0.217).
- **Cycle 21–25d outperforms 30d** (mean Sharpe 0.293–0.303 vs 0.249). Shorter cycles provide more opportunities for the regime filter to select trades.
- **Lookback 60d dominates** (mean Sharpe 0.306 vs 0.241–0.247). Longer lookback smooths RV estimates for more reliable IV/RV signals.
- **Skip threshold 0.9–1.15 is optimal** (mean Sharpe 0.271–0.277). The current 1.1 is fine; threshold 1.3 over-filters (0.201 mean Sharpe).

### 3. The full feature stack (RF+AC+PR) is the best on average but not universally

Mean ΔSharpe confirms RF+AC+PR is optimal across the top 5 configs on average. However, one config (δ0.10/c21/s1.3/lb45) achieves 1.325 Sharpe with RF only — more than double its RF+AC+PR result (0.556). Put rolling concentrates risk into fewer, longer-duration positions, which can hurt when the trades that are filtered out happened to be winners on this particular path.

### 4. Higher trade frequency correlates with better Sharpe and lower MaxDD

| Put Sells | Mean Sharpe | Mean MaxDD |
|-----------|-------------|------------|
| 0–5 | 0.196 | 80.3% |
| 5–10 | 0.250 | 61.8% |
| 10–15 | 0.284 | 58.7% |
| 15–20 | **0.304** | **53.7%** |

Configs producing 15–20 put sells have the best mean Sharpe (0.304) and lowest MaxDD (53.7%). The current config's 11 trades is reasonable; pushing toward 15+ trades may improve resilience.

### 5. All results are N=1 and highly path-dependent

During debugging, a 1-day difference in `rollWhenDTEBelow` (14 vs 15) caused Sharpe to swing from 0.517 to 0.179 — a butterfly effect cascading through 5 years of deterministic simulation. With only 7–15 put sells in the full period, a single different assignment outcome changes the entire downstream trade sequence. **These rankings should not be interpreted as statistically significant differences** — they represent one historical path. The marginal analysis (averaging across combos) is more reliable than individual config rankings.

### 6. Bear-market resilience varies dramatically across top configs

The top config by Sharpe (δ0.15/c25/s1.3/lb60) has poor bear-market performance (2022: −0.998, 2025 H1: +0.108). The runner-up (δ0.12/c30/s1.15/lb60) is much more bear-resilient (2022: −0.404, 2025 H1: +0.357). Choice depends on whether maximizing full-period Sharpe or minimizing worst-period loss is the priority.

### 7. Ultra-low delta (δ0.03) is non-viable

At δ0.03, puts are sold so far OTM that zero full cycles complete over 5 years — the put never gets assigned, so no covered calls are ever sold. The strategy degenerates into "occasionally sell a put, collect tiny premium, never complete the wheel." Minimum viable delta is ~0.05.

## Summary

### What Improved

1. **Best config improves Sharpe by +20% and reduces MaxDD by 14pp** vs current preset. δ0.15/c25/s1.3/lb60 achieves 0.620 Sharpe (vs 0.517) with 57.8% MaxDD (vs 71.7%).
2. **Shorter cycles (21–25d) outperform 30d** on average — more decision points for the regime filter.
3. **Lookback 60d is clearly superior** to 20–45d for Conservative — longer smoothing window produces better IV/RV signals.
4. **15–20 put sells over 5yr is the optimal trade frequency band** — enough trades for premium income, not so many that quality degrades.

### Caveats

1. **N=1 path dependence.** All results are from one historical path. A 1-day parameter change can swing Sharpe by +0.3. Individual config rankings are not statistically meaningful.
2. **Butterfly effects dominate.** Put rolling, which changes assignment timing by a few days, has outsized impact on downstream trades. The feature ablation results are path-specific.
3. **Overfitting risk is high.** With 700 combos and 1 path, the "best" config is likely overfitted to 2021–2026 ETH dynamics. The marginal analysis (parameter-level averages) is more trustworthy than the top-1 ranking.

### Recommendation

**Do not update the Conservative preset based on this experiment alone.** The improvement (0.620 vs 0.517 Sharpe) is within the noise band of a single-path backtest. Marginal analysis suggests these directional changes are likely beneficial:
- `lookbackDays`: 45 → 60 (strongest signal, +0.06 mean Sharpe)
- `cycleLengthDays`: 30 → 25 (moderate signal, +0.04 mean Sharpe)
- `targetDelta`: 0.10 → 0.12 (weak signal, +0.002 mean Sharpe)

These should be validated via Exp 20 (Rolling Window Backtest) before committing to preset changes. If Exp 20 confirms the directional preferences across multiple overlapping windows, then update the preset.
