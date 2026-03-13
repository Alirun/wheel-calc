# Experiment 25: Additional Asset Validation (SOL)

## Goal
Extend multi-asset validation to SOL before portfolio analysis (Exp 26). Test whether SOL's IV dynamics match OU model assumptions and whether strategy performance generalizes.

## Critical Finding: Insufficient Data

**SOL DVOL was discontinued after November 2022.** Only 206 daily records exist (2022-05-04 → 2022-11-25). This is 11.4% of ETH's 1,812 DVOL records and covers exclusively the May–November 2022 bear market (Terra/Luna collapse, 3AC contagion, FTX collapse).

| Data Source | Records | Date Range | Status |
|---|---|---|---|
| SOL DVOL | 206 | 2022-05-04 → 2022-11-25 | **Discontinued** |
| SOL_USDC-PERPETUAL | 1,460 | 2022-03-15 → 2026-03-13 | Active |
| ETH DVOL | 1,812 | 2021-03-24 → 2026-03-09 | Active |
| BTC DVOL | 1,814 | 2021-03-24 → 2026-03-11 | Active |

**Impact on analysis:**
- Rolling window backtest (365d windows): **Impossible** — only 206 aligned days (56% of minimum)
- IV dynamics: **Severely underpowered** — small-sample statistics unreliable for κ, kurtosis
- Historical backtest: **Period-biased** — covers only the worst 7-month bear market in crypto history (~84% SOL drawdown)

## Part 1: IV Dynamics Analysis

### SOL IV Summary (206 days, May–Nov 2022)

| Metric | SOL | ETH (same period) | BTC (same period) | ETH (full 5yr) | BTC (full 5yr) |
|---|---|---|---|---|---|
| N days | 206 | 206 | 206 | 1,812 | 1,814 |
| Mean IV | 128.0% | 101.7% | 78.2% | 75.7% | 61.9% |
| IV Std | 26.9% | 15.3% | 12.4% | 23.0% | 18.7% |
| ΔIV Std | 8.56% | 7.41% | 6.12% | 3.93% | 3.45% |
| ΔIV Kurtosis | 11.3 | 14.2 | 14.2 | 27.1 | 27.0 |
| IV ACF(1) | 0.942 | 0.869 | 0.871 | 0.985 | 0.982 |
| Sq ΔIV ACF(1) | 0.199 | 0.360 | 0.373 | 0.351 | 0.358 |
| κ (annual) | **19.73** | 49.20 | 48.45 | **5.55** | **6.60** |
| Mean VRP | 5.50% | 11.03% | 14.16% | 6.35% | 9.64% |
| Skip rate t=1.2 | 59.7% | 61.8% | 38.7% | 61.8% | 45.3% |

### Key IV Dynamics Observations

1. **κ = 19.73 → NOT OU-compatible for SOL.** Framework expects κ=2–10. SOL's mean-reversion is 2–3× faster than ETH/BTC full-period estimates.

   **BUT:** Same-period ETH shows κ=49.2, BTC κ=48.5 — also far outside the OU range. The May–Nov 2022 crash period produces artificially high κ for ALL assets due to the violent regime transitions. SOL's κ=19.73 is actually *slower* (more persistent) than ETH and BTC during this same period, suggesting SOL IV may actually be more OU-compatible over longer horizons.

2. **SOL IV is higher but more persistent.** ACF(1)=0.942 vs ETH 0.869 / BTC 0.871 during the same period. Higher persistence in SOL IV is favorable for the regime filter — the IV/RV signal is more stable over longer horizons.

3. **Lower ARCH effects.** Sq ΔIV ACF(1) = 0.199 vs ETH 0.360 / BTC 0.373. Less vol clustering suggests SOL IV dynamics *may be more OU-compatible* than ETH/BTC during this period. However, the 206-day sample is too short for confident ARCH assessment.

4. **VRP = 5.50% — marginal.** Above the Active floor (5%) but below the Conservative floor (10%). SOL VRP is lower than ETH and BTC during this same bear period (ETH 11.0%, BTC 14.2%), suggesting SOL options may be less systematically overpriced.

5. **OU simulation mismatch 3/4.** Real ΔIV std (8.56) is 3× simulated (2.81). Real kurtosis (11.3) is 4× simulated (2.9). Only ACF(1) matches — same pattern as ETH/BTC, confirming the OU model is universally too smooth.

### SOL vs OU Compatibility Assessment

The κ estimate is unreliable — the 206-day crash period produces extreme κ values for all assets. The fairer comparison is relative: SOL has *slower* mean-reversion and *less* ARCH clustering than ETH/BTC in the same period. If ETH and BTC are OU-compatible at full scale, SOL would likely be too.

**Verdict: Inconclusive.** Need multi-year DVOL to assess true κ.

## Part 2: Limited Historical Backtest (May–Nov 2022)

### Cross-Asset Performance (7-month bear period)

| Metric | SOL Cons | ETH Cons | BTC Cons | SOL Aggr | ETH Aggr | BTC Aggr |
|---|---|---|---|---|---|---|
| Sharpe | −1.869 | −1.496 | −2.307 | −2.708 | −0.977 | −1.591 |
| APR% | −53.2 | −31.7 | −33.0 | −104.6 | −25.1 | −47.7 |
| MaxDD | 31.9% | 24.0% | 20.0% | 61.6% | 30.1% | 37.1% |
| Alpha | +97.2 | +72.4 | +70.6 | +45.9 | +79.0 | +55.9 |
| Skip Rate | 98.9% | 0.0% | 0.0% | 87.5% | 78.8% | 56.1% |
| Put Sells | 1 | 1 | 1 | 11 | 14 | 18 |
| Underlying Return | −84.5% | −58.5% | −58.2% | −84.5% | −58.5% | −58.2% |

### Key Backtest Observations

1. **All strategies negative — expected in an extreme bear.** SOL fell 84.5% during this period (vs ETH −58.5%, BTC −58.2%). No parameterization can produce positive Sharpe during an asset's worst-ever drawdown.

2. **SOL Aggressive is worst across all assets** (−2.708 Sharpe, −104.6% APR, 61.6% MaxDD). Higher base vol + deeper crash = more severe assignment losses.

3. **Conservative generates massive alpha on SOL** (+97.2%, vs ETH +72.4%, BTC +70.6%). The regime filter's extreme skip rate (98.9%) avoided nearly all crash trades, limiting losses to a single assignment.

4. **SOL Conservative MaxDD controlled at 31.9%** — below the 40% target even in the worst crypto bear. Position sizing (cold-start + vol-scaled) worked as designed.

5. **Results are NOT predictive.** This is one 7-month bear period. ETH/BTC backtested over 5 years showed very different dynamics (Conservative Sharpe +0.537/+0.127 for ETH/BTC). SOL's performance over multiple regimes is unknown.

## Part 3: Long-Term SOL Price Dynamics

Since DVOL is unavailable, realized vol from SOL_USDC-PERPETUAL (1,460 days) provides partial insight.

### Cross-Asset Realized Vol Comparison

| Asset | Ann RV | 20d RV Mean | 20d RV Std | RV P5 | RV P95 | Records |
|---|---|---|---|---|---|---|
| **SOL** | **98.5%** | **91.4%** | **36.5%** | 47.0% | 170.8% | 1,460 |
| ETH | 79.2% | 72.8% | 30.6% | 33.1% | 124.5% | 2,261 |
| BTC | 61.1% | 55.4% | 25.5% | 24.8% | 98.9% | 2,263 |

### Year-by-Year SOL RV

| Year | RV | Return | Days |
|---|---|---|---|
| 2022 | 123.6% | −88.2% | 292 |
| 2023 | 102.7% | +826.4% | 365 |
| 2024 | 82.9% | +65.4% | 366 |
| 2025 | 85.7% | −39.7% | 365 |
| 2026 | 82.4% | −26.9% | 72 |

### Key Price Dynamics Observations

1. **SOL is ~25% more volatile than ETH and ~60% more volatile than BTC.** Mean 20d RV: SOL 91.4% vs ETH 72.8% vs BTC 55.4%. This is consistent with SOL's smaller market cap and lower liquidity.

2. **SOL RV persistence is similar to ETH/BTC.** RV(20d) ACF(1): SOL 0.976, ETH 0.980, BTC 0.981. Vol dynamics appear structurally similar across assets — just at different magnitude levels.

3. **SOL's year-by-year RV is declining.** 123.6% (2022) → 82.4% (2026). Consistent with maturing asset that's gaining institutional adoption and deeper liquidity. The 2024–2026 RV (~83%) is in the framework's tested range (Exp 3: vol sweet spot 55–65%, Exp 15: Active viable ≤100%).

4. **SOL's extreme return variance** (+826% in 2023, −88% in 2022) suggests the wheel strategy would experience even more volatile outcomes than ETH/BTC, with larger dispersions in per-window Sharpe.

## Conclusions

### SOL Validation Status: **BLOCKED — Insufficient DVOL Data**

SOL DVOL was discontinued after 206 days (Nov 2022). This makes a proper multi-asset validation impossible:

| Analysis | Minimum Required | SOL Available | Status |
|---|---|---|---|
| IV dynamics (reliable κ) | 500+ days | 206 | ❌ Insufficient |
| Full-period backtest | 365+ days | 206 | ❌ Insufficient |
| Rolling window (5+ windows) | 730+ days | 206 | ❌ Impossible |
| Cross-regime validation | Multiple regimes | 1 (bear only) | ❌ Biased |

### What We Learned Despite Data Limitations

1. **SOL IV dynamics are not clearly incompatible with the OU model.** The high κ=19.73 is likely a sample artifact (ETH/BTC also show anomalous κ in the same period). SOL actually has *less* ARCH clustering and *more* IV persistence than ETH/BTC in the same 206-day window.

2. **SOL is significantly more volatile** (RV ~91% vs ETH ~73% vs BTC ~55%). This places SOL at the upper end of the framework's tested range but not outside it (Active viable ≤100% per Exp 15).

3. **Position sizing controls work on SOL.** Even in an 84.5% crash, Conservative MaxDD was 31.9% (below 40% target). The cold-start cap and vol-scaling contained drawdown effectively.

4. **SOL VRP is marginal (5.5%).** Above Active's floor (5%) but with high uncertainty due to small sample and period bias.

### Impact on Experiment 26 (Portfolio Analysis)

**SOL cannot be included in Exp 26.** Without multi-year DVOL data, there is no reliable historical backtest to combine with ETH and BTC for portfolio-level analysis. Exp 26 should proceed with **ETH + BTC only** (2-asset portfolio).

If Deribit reinstates SOL DVOL in the future, this experiment should be re-run with the expanded dataset.

## Action Items

- No code changes needed
- No preset changes needed
- SOL data cached in `research/sweep25/data/` for future use if DVOL becomes available
- Exp 26 scope narrowed to ETH + BTC only
