# Sweep 21 Analysis: Dynamic Position Sizing

## Setup

| Parameter | Value |
|-----------|-------|
| **Type** | Historical backtest (rolling windows) + Monte Carlo validation |
| **Follows** | Exps 18 (Historical Backtest), 20 (Rolling Window Validation) |
| **Data** | ETH-PERPETUAL prices + ETH DVOL, 2021-03-24 → 2026-03-09 |
| **Windows** | 17 overlapping 365-day windows, stride 90 days |
| **Strategies** | 2: Conservative (δ0.10/c30/s1.1/lb45, RF+AC+PR), Active (δ0.20/c3/s1.2/lb20, RF) |
| **Sizing Modes** | 3: Fractional Kelly, Trailing Return Gate (TRG), Vol-Scaled (VS) |
| **Total Phase 1** | 850 backtests (2 strategies × 25 sizing variants × 17 windows), 0.34s |
| **Total Phase 2** | 108,000 MC paths (3 top configs/strategy × 3 vols × 3 drifts × 2 horizons × 1000 paths), 173.7s |
| **Purpose** | Reduce MaxDD below 40% (currently 72% Conservative, 65% Active) without destroying Sharpe. Top deployment blocker from Exp 20. |

## Engine Changes

Three position sizing modes were added to `simulate.ts` via a `PositionSizingConfig` on `StrategyConfig`:

1. **Fractional Kelly** — Size based on trailing cycle win rate and average win/loss. `f* = kellyFraction × (p·W − q·L) / W`. Lookback over last N completed cycles. Cold start: full size until sufficient history.
2. **Trailing Return Gate (TRG)** — Reduce size when trailing N-day portfolio return is in drawdown. Tiered thresholds with linear interpolation.
3. **Vol-Scaled (VS)** — `multiplier = min(1, volTarget / trailingRV)`. Higher realized vol → smaller position → capped loss per cycle.

All modes enforce a `minSize` floor (default 0.10) to prevent complete withdrawal.

### Parameter Grid (25 variants)

| Mode | Variant | Key Parameters |
|------|---------|----------------|
| Baseline | — | No sizing (multiplier = 1.0) |
| Kelly | 6 variants | kellyFraction ∈ {0.125, 0.25, 0.50} × lookbackTrades ∈ {5, 10, 20} |
| TRG | 9 variants | lookbackDays ∈ {30, 60, 90} × aggressiveness ∈ {mild, moderate, aggressive} |
| VS | 9 variants | volTarget ∈ {40%, 60%, 80%} × lookbackDays ∈ {20, 30, 45} |

TRG threshold tiers:
- Mild: 50% at −15%, 25% at −30%
- Moderate: 50% at −10%, 25% at −20%, 10% at −30%
- Aggressive: 50% at −5%, 25% at −10%, 10% at −20%

## Phase 1: Historical Rolling Window Results

### Conservative

**Baseline:** Mean Sharpe 0.846, Mean MaxDD 26.0%, Max MaxDD 71.7%

| Sizing Mode | Avg ΔSharpe | Avg ΔMaxDD | Best Variant | Best ΔMaxDD |
|-------------|-------------|------------|--------------|-------------|
| Fractional Kelly | 0.000 | 0.0% | — | 0.0% |
| Trailing Return Gate | 0.000 | 0.0% | — | 0.0% |
| **Vol-Scaled** | **+0.013** | **−1.4%** | **VS-40/45** | **−3.9%** |

**Kelly and TRG have zero effect on Conservative.** Conservative executes only ~3 put sells per 365-day window with a 90%+ skip rate. There is virtually no trailing P/L history for Kelly to estimate from, and no sustained drawdown period for TRG to detect — each cycle is separated by months of inactivity.

**Vol-Scaled is the only effective mode.** VS-40/45 (volTarget=40%, lookback=45d):
- Mean Sharpe: 0.887 (+0.040, 104.7% preserved)
- Mean MaxDD: 22.1% (−3.9pp)
- Max MaxDD: 71.7% (unchanged — worst window driven by 2021 crash initialization)
- MaxDD wins: **9/17 windows**, Sharpe wins: **10/17 windows**

Window-by-window analysis shows VS-40/45 reduces MaxDD by 5–14pp in bear/drawdown windows (windows 3–5, 10–14, 17) while having zero effect in zero-drawdown windows (6–9, 15–16). The worst single window (window 1, 2021-03 → 2022-03) is unchanged at 71.7% because the crash occurs before sufficient vol history accumulates.

### Active

**Baseline:** Mean Sharpe 0.657, Mean MaxDD 27.7%, Max MaxDD 65.1%

| Sizing Mode | Avg ΔSharpe | Avg ΔMaxDD | Best Variant | Best ΔMaxDD |
|-------------|-------------|------------|--------------|-------------|
| **Fractional Kelly** | **−0.422** | **−7.5%** | Kelly-0.125/5 | −7.5% |
| Trailing Return Gate | −0.022 | −0.3% | TRG-90d-agg | −2.1% |
| **Vol-Scaled** | **−0.034** | **−3.1%** | **VS-40/45** | **−7.7%** |

**Kelly is destructive.** All Kelly variants reduce MaxDD by 7.5pp but destroy Sharpe (33–41% preservation, well below the 50% threshold). The cold-start problem is fatal: Kelly uses full size for the first N trades (no history), then permanently undersizes based on early volatile outcomes. With only ~5 cycles per window, Kelly never accumulates enough history to produce calibrated sizing.

**TRG is marginal.** Best TRG (90d-agg) achieves only −2.1pp MaxDD reduction with negligible Sharpe cost. The trailing return gate triggers too infrequently — Active's premium income partially offsets drawdowns within the lookback window, so the gate rarely activates at moderate thresholds.

**Vol-Scaled dominates.** VS-40/45:
- Mean Sharpe: 0.601 (−0.056, 91.4% preserved)
- Mean MaxDD: 20.0% (−7.7pp)
- **Max MaxDD: 38.0%** (down from 65.1% — **meets the <40% target**)
- MaxDD wins: **13/17 windows**, Sharpe wins: 4/17

Window-by-window highlights:
- Window 1 (2021 crash): **65.1% → 26.5% (−38.5pp)** — vol-scaling aggressively sizes down during the crash
- Window 3 (deep bear): 31.8% → 20.0% (−11.8pp)
- Window 4 (deepest bear): 33.0% → 20.0% (−13.0pp)
- Window 17 (recent bear): 43.4% → 38.0% (−5.4pp) — this is the new worst-case window
- Windows 8–10 (bull): slight MaxDD increase (+0.2–0.9pp) — vol-scaling is unnecessary in calm markets but causes minor noise

### Phase 1 Summary

| Strategy | Best Sizing | Mean Sharpe | Sharpe% | Mean MaxDD | ΔMaxDD | Max MaxDD | ΔMax MaxDD |
|----------|-------------|-------------|---------|------------|--------|-----------|------------|
| Conservative | VS-40/45 | 0.887 | 104.7% | 22.1% | −3.9% | 71.7% | 0.0% |
| Active | VS-40/45 | 0.601 | 91.4% | 20.0% | −7.7% | 38.0% | −27.1% |

**Key finding:** Vol-Scaled (volTarget=40%, lookback=45d) is the dominant sizing mode for both strategies. It is the only mode that meaningfully reduces MaxDD while preserving >90% of Sharpe.

**Active meets the MaxDD < 40% target** (38.0% max across all 17 windows). Conservative does not — its worst window (71.7%) is driven by a 2021 crash that occurs before vol-scaling has enough data to activate.

## Phase 2: Monte Carlo Validation

Top configs from Phase 1 tested under GBM + OU+Jump IV (calibrated model from Exp 17: κ=5.0, ξ=0.50, λ=10, σJ=0.15). 1000 MC paths per condition.

### Conservative MC

| Vol | Drift | Horizon | VS-40/45 ΔSharpe | VS-40/45 ΔMaxDD | Kelly ΔSharpe | TRG ΔSharpe |
|-----|-------|---------|-------------------|------------------|---------------|-------------|
| 40% | 0% | 1yr | +0.005 | −0.1% | 0.000 | 0.000 |
| 40% | 0% | 5yr | +0.005 | −0.7% | 0.000 | +0.001 |
| 60% | 0% | 1yr | +0.045 | −2.3% | 0.000 | −0.000 |
| 60% | 0% | 5yr | +0.060 | **−11.0%** | 0.000 | +0.001 |
| 80% | 0% | 1yr | +0.083 | −4.8% | 0.000 | 0.000 |
| 80% | 0% | 5yr | +0.089 | **−19.4%** | 0.000 | +0.001 |
| 60% | 5% | 5yr | +0.072 | **−11.1%** | 0.000 | +0.000 |
| 80% | 5% | 5yr | +0.099 | **−19.7%** | 0.000 | +0.000 |
| 60% | −30% | 5yr | +0.018 | −10.2% | 0.000 | +0.001 |
| 80% | −30% | 5yr | +0.037 | **−16.7%** | 0.000 | +0.001 |

**MC confirms Phase 1 findings for Conservative:**
- VS-40/45 consistently improves both Sharpe and MaxDD across all conditions
- Benefit scales with vol level and horizon: +0.005 ΔSharpe at 40%/1yr → +0.099 at 80%/5yr
- MaxDD reduction is dramatic at higher vol × longer horizon: **−19.7pp at 80% vol / 5yr**
- Kelly and TRG remain inert (confirming the low-trade-frequency explanation)
- VS-40/45 actually *increases* Sharpe (not just preserves it) — by reducing vol-of-returns more than it reduces mean return

### Active MC

| Vol | Drift | Horizon | VS-40/45 ΔSharpe | VS-40/45 ΔMaxDD | TRG-90d-agg ΔSharpe | TRG-90d-agg ΔMaxDD |
|-----|-------|---------|-------------------|------------------|----------------------|---------------------|
| 40% | 0% | 1yr | −0.017 | −0.2% | −0.055 | −0.3% |
| 40% | 0% | 5yr | −0.018 | −0.2% | −0.024 | −0.5% |
| 60% | 0% | 1yr | −0.102 | **−3.4%** | −0.073 | −0.6% |
| 60% | 0% | 5yr | −0.114 | **−4.2%** | −0.038 | −0.8% |
| 80% | 0% | 1yr | −0.125 | **−6.8%** | −0.080 | −1.0% |
| 80% | 0% | 5yr | −0.159 | **−8.7%** | −0.043 | −1.0% |
| 60% | 5% | 5yr | −0.109 | −4.2% | −0.039 | −0.8% |
| 80% | 5% | 5yr | −0.156 | **−8.8%** | −0.044 | −0.9% |
| 60% | −30% | 5yr | −0.132 | −4.1% | −0.040 | −1.0% |
| 80% | −30% | 5yr | −0.166 | **−8.2%** | −0.042 | −1.5% |

**MC confirms Phase 1 findings for Active but reveals a tradeoff:**
- VS-40/45 reduces MaxDD substantially (up to −8.8pp at 80%/5yr) but at meaningful Sharpe cost (−0.102 to −0.166)
- At 40% vol, VS-40/45 has negligible effect — vol is already below the 40% target, so sizing stays near 1.0
- At 80% vol, the MaxDD reduction is large (−6.8% to −8.8%) but Sharpe cost is also large (22–43% of Sharpe)
- TRG is weaker on MaxDD but also cheaper in Sharpe terms
- The Sharpe cost is higher in MC than on historical data (91.4% preserved → ~70–85% in MC at 60–80% vol). Historical data's regime structure (concentrated crashes followed by long recoveries) is more favorable to vol-scaling than MC's smoother paths.

### Phase 2 Key Insight: Asymmetric Benefit by Strategy

Vol-scaling produces opposite Sharpe effects for the two strategies:
- **Conservative: VS-40/45 *improves* Sharpe** (+0.005 to +0.099). By reducing position size during high-vol periods, it avoids large losses while sacrificing little premium (at δ0.10, premium is small anyway). Net effect: lower return variance with minimal mean return loss.
- **Active: VS-40/45 *costs* Sharpe** (−0.017 to −0.166). Active's higher δ0.20 generates substantial premium that vol-scaling sacrifices. The Sharpe cost grows with vol level because VS-40/45 reduces sizing more aggressively at higher vol.

This asymmetry means VS-40/45 is an **unambiguous win for Conservative** and a **MaxDD-vs-Sharpe tradeoff for Active**.

## Conclusions

### 1. Vol-Scaled sizing is the only effective dynamic sizing mode

Kelly and TRG are ineffective for both strategies:
- **Kelly fails** due to insufficient trade history (cold-start problem) and permanent undersizing from early volatile outcomes
- **TRG fails** because Conservative trades too infrequently for the gate to activate, and Active's premium income partially masks drawdowns within the lookback window
- **Vol-Scaled works** because it uses a forward-looking signal (current realized vol) that is independent of trade history or portfolio performance

### 2. VS-40/45 is the recommended sizing configuration

`volTarget=0.40, volLookbackDays=45, minSize=0.10`

- Conservative: +4.7% Sharpe improvement, −3.9pp mean MaxDD, −0.0pp max MaxDD
- Active: −8.6% Sharpe cost, −7.7pp mean MaxDD, **−27.1pp max MaxDD (65.1% → 38.0%)**

### 3. The MaxDD < 40% target is achieved for Active

Active with VS-40/45 achieves 38.0% max MaxDD across all 17 rolling windows — below the 40% target. This is driven by aggressive sizing reduction during the 2021 crash (window 1: −38.5pp) and consistent 5–13pp reductions during bear windows.

### 4. Conservative's worst-case MaxDD is not reducible by sizing alone

Conservative's 71.7% max MaxDD occurs in window 1 (2021-03 → 2022-03), where the May 2021 crash happens before vol-scaling has accumulated enough lookback data. This is a cold-start problem: no dynamic sizing can help when the crash occurs in the first weeks. Wider approaches (defined-risk spreads from Exp 22) may be needed.

However, Conservative's **mean MaxDD drops from 26.0% to 22.1%**, and the benefit scales dramatically in MC: up to −19.7pp at higher vol levels and longer horizons. For deployment at realistic ETH vol (60–80%), VS-40/45 substantially improves Conservative's risk profile.

### 5. Strategy ranking is preserved

Conservative remains the real-data winner:
- Conservative + VS-40/45: Sharpe 0.887, mean MaxDD 22.1%
- Active + VS-40/45: Sharpe 0.601, mean MaxDD 20.0%

The Sharpe ranking (Conservative > Active) and MaxDD ranking (Active ≈ Conservative) are preserved. Active gains the most from sizing in absolute MaxDD reduction terms, but Conservative's already-lower trade frequency makes it inherently more robust.

### 6. Deployment recommendation

| Strategy | Sizing Config | Rationale |
|----------|---------------|-----------|
| Conservative | VS-40/45 | Unambiguous win: improves Sharpe AND reduces MaxDD |
| Active | VS-40/45 | MaxDD < 40% target achieved; 91.4% Sharpe preservation acceptable |

Both presets should include `positionSizing: { mode: "volScaled", volTarget: 0.40, volLookbackDays: 45, minSize: 0.10 }`.

## Open Questions

1. **Conservative cold-start mitigation.** Can a fixed initial sizing (e.g., 50% for first 45 days) prevent the window-1 blowup? Or is Exp 22 (defined-risk spreads) the right path?
2. **Optimal volTarget for MC conditions.** Phase 2 shows VS-40/45 has higher Sharpe cost at 80% vol in MC than on historical data. Would volTarget=50% or 60% be better for high-vol MC environments? A volTarget sweep within MC would answer this.
3. **Preset integration.** Should VS-40/45 be added to presets now, or wait for further validation?
