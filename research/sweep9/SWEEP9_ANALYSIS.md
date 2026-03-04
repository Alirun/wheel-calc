# Experiment 9: Model Robustness — Analysis

## Goal

Test whether the Exp 6 optimal strategy configs remain viable across all 4 price models (GBM, Heston, Jump, Heston-Jump). All 8 prior experiments used GBM exclusively. This is the single largest remaining blind spot in the research program.

## Design

**Sweep dimensions:** 4 models × 3 vol levels (40%, 60%, 80%) × 3 drift levels (+5%, 0%, −30%) × 3 strategies × 2 configs (Optimal RF ON, Baseline RF OFF) = **216 combinations × 1,000 paths = 216,000 simulation paths.**

**Strategies tested (Exp 6 optimal configs):**

| Strategy | Features | δ | Cycle | skipBelowRatio |
|---|---|---|---|---|
| Conservative | RF + AC + PR | 0.10 | 30d | 1.0 |
| Moderate | RF + PR | 0.20 | 14d | 1.2 |
| Active | RF only | 0.20 | 3d | 1.2 |

**Model parameters:**
- VRP = 15% (fixed; Exp 8 confirmed robustness)
- Heston: κ=2.0, σ=0.5, ρ=−0.7, θ=vol² (scaled to target vol)
- Jump (Merton): λ=10, μJ=0, σJ=0.05
- GBM/Jump IV: Stochastic OU (κ=5, ξ=0.5, VRP=15%)
- Heston/Heston-Jump IV: derived from variance process (√v), no separate OU

## Results Summary

### Model Ranking by Average Sharpe (all strategies combined)

| Rank | Model | Avg Sharpe | Positive Combos |
|---|---|---|---|
| 1 | GBM | **0.345** | 21/27 (78%) |
| 2 | Jump | **0.272** | 21/27 (78%) |
| 3 | Heston | **−0.216** | 5/27 (19%) |
| 4 | Heston-Jump | **−0.289** | 2/27 (7%) |

### Per-Strategy Model Performance (Optimal configs, averaged over all drift × vol)

**Conservative (δ0.10/30d):**

| Model | Avg Sharpe | Avg APR | Avg MaxDD | Win Rate | Positive |
|---|---|---|---|---|---|
| GBM | **0.248** | 5.05% | 26.0% | 60.3% | 6/9 |
| Jump | **0.216** | 5.32% | 27.4% | 60.8% | 6/9 |
| Heston | **−0.135** | −3.25% | 30.2% | 53.1% | 5/9 |
| Heston-Jump | **−0.204** | −4.76% | 32.4% | 50.7% | 2/9 |

**Moderate (δ0.20/14d):**

| Model | Avg Sharpe | Avg APR | Avg MaxDD | Win Rate | Positive |
|---|---|---|---|---|---|
| GBM | **0.121** | 16.18% | 30.3% | 61.2% | 6/9 |
| Jump | **0.077** | 15.53% | 31.5% | 60.1% | 6/9 |
| Heston | **−0.231** | −0.26% | 31.1% | 48.2% | 0/9 |
| Heston-Jump | **−0.314** | −3.15% | 32.6% | 44.6% | 0/9 |

**Active (δ0.20/3d):**

| Model | Avg Sharpe | Avg APR | Avg MaxDD | Win Rate | Positive |
|---|---|---|---|---|---|
| GBM | **0.666** | 34.21% | 22.2% | 78.0% | 9/9 |
| Jump | **0.524** | 30.82% | 23.4% | 74.5% | 9/9 |
| Heston | **−0.284** | 0.44% | 23.8% | 47.3% | 0/9 |
| Heston-Jump | **−0.350** | −1.59% | 24.4% | 46.3% | 0/9 |

### Sharpe Delta vs GBM

| Strategy | Jump ΔSharpe | Heston ΔSharpe | Heston-Jump ΔSharpe |
|---|---|---|---|
| Conservative | −0.031 (−12.6%) | **−0.382** (−154%) | **−0.451** (−182%) |
| Moderate | −0.044 (−36.5%) | **−0.352** (−291%) | **−0.435** (−360%) |
| Active | −0.143 (−21.4%) | **−0.951** (−143%) | **−1.016** (−153%) |

### Regime Filter Effectiveness by Model

| Model | RF Wins (all strategies) | RF Win Rate |
|---|---|---|
| GBM | 27/27 | **100%** |
| Jump | 27/27 | **100%** |
| Heston-Jump | 25/27 | **93%** |
| Heston | 19/27 | **70%** |

RF breakdown by strategy under Heston:
- Conservative: 1/9 RF wins (RF **hurts** — negative ΔSharpe at 7/9 combos)
- Moderate: 9/9 RF wins (+0.123 mean ΔSharpe)
- Active: 9/9 RF wins (+0.121 mean ΔSharpe)

### Drift Immunity Check

| Model | Active Positive Combos | Drift-Immune? |
|---|---|---|
| GBM | 9/9 | ✓ Yes |
| Jump | 9/9 | ✓ Yes |
| Heston | 0/9 | ✗ Fails at ALL combos |
| Heston-Jump | 0/9 | ✗ Fails at ALL combos |

Active under Heston fails at every single drift × vol combination — including +5% drift / 40% vol (Sharpe = −0.200). This is not a bear market problem; the strategy is fundamentally non-viable under stochastic variance dynamics.

### All-Weather Validation

**Active: 18/36 combos with Sharpe > 0. ALL-WEATHER REQUIRES QUALIFICATION.**

All 18 failures occur under Heston (9) or Heston-Jump (9). Worst: Heston-Jump / drift=−30% / vol=40% → Sharpe = −0.724.

### Drawdown Analysis

Average MaxDD by model (all drift × vol, Optimal):

| Model | Conservative | Moderate | Active |
|---|---|---|---|
| GBM | 26.0% | 30.3% | 22.2% |
| Jump | 27.4% | 31.5% | 23.4% |
| Heston | 30.2% | 31.1% | 23.8% |
| Heston-Jump | 32.4% | 32.6% | 24.4% |

Heston-Jump adds ~6pp MaxDD to Conservative, ~2pp to Active vs GBM. The drawdown increase is moderate — not catastrophic — but combined with negative returns, the risk/reward is unacceptable.

### Cycle Behavior

**Active (Optimal / RF ON):**

| Model | Avg Skip% | Avg Exec Cycles | Avg Win Rate |
|---|---|---|---|
| GBM | 94.4% | 8.4 | 78.0% |
| Jump | 95.1% | 7.9 | 74.5% |
| Heston | 97.4% | 6.0 | 47.3% |
| Heston-Jump | 97.9% | 5.3 | 46.3% |

Under Heston, the regime filter skips more (97.4% vs 94.4%) but the executed cycles have dramatically lower win rates (47.3% vs 78.0%). The filter accepts trades during apparent IV > RV windows, but Heston's variance process can rapidly shift, turning those trades into losers.

## Key Findings

### 1. The IV path source is the critical differentiator, not jump processes.

The results split cleanly into two groups:
- **OU-based IV (GBM, Jump):** Framework works. Positive avg Sharpe, high win rates, RF 100% effective.
- **Variance-based IV (Heston, Heston-Jump):** Framework breaks. Negative avg Sharpe, ~47% win rates, RF partially ineffective.

Jump processes barely affect performance (−12% to −36% Sharpe vs GBM). Heston stochastic variance destroys it (−143% to −360%). Adding jumps to Heston makes it marginally worse but the damage is already done by the variance dynamics alone.

### 2. The regime filter was implicitly calibrated on OU-generated IV/RV signals.

Every experiment from 1–8 used GBM's stochastic OU process for IV, which produces:
- Smooth, normally-distributed IV paths
- Gradual regime transitions
- Predictable IV/RV ratio distributions

Heston's variance process produces:
- Clustered volatility with sudden spikes and slow mean-reversion
- Abrupt regime transitions (the Andersen QE scheme preserves this)
- Fat-tailed IV/RV distributions that confuse the skip threshold

Evidence: under Heston, the filter skips ~3% more cycles (97.4% vs 94.4% for Active) but the cycles it accepts have 30pp lower win rates. The filter's signal is degraded, not just reduced.

### 3. Conservative is partially resilient to Heston — Moderate and Active are not.

Under Heston at drift ≥ 0%:
- Conservative: 5/6 combos with positive Sharpe (0.042–0.146). Marginal but viable.
- Moderate: 0/6 combos positive. Completely broken.
- Active: 0/6 combos positive. Completely broken.

Conservative's low delta (0.10) provides a natural margin against vol misestimation — even when the filter selects poor entry points, the far-OTM puts rarely get assigned. Higher delta strategies don't have this cushion.

### 4. RF is still net-positive under Heston for Moderate/Active (9/9 each), but can't rescue them.

RF under Heston delivers +0.123 and +0.121 mean ΔSharpe for Moderate and Active respectively — comparable to its GBM value. It pushes strategies closer to zero but can't overcome the fundamental mismatch between OU-calibrated thresholds and Heston variance dynamics.

Exception: RF actually **hurts** Conservative under Heston (1/9 wins, −0.018 mean ΔSharpe). At δ0.10 with 99%+ skip rates, the filter's few accepted trades are net-negative under Heston's dynamics. Conservative would be better off with RF disabled under Heston.

### 5. Jump processes are benign — the framework is jump-robust.

| Metric | GBM | Jump | Delta |
|---|---|---|---|
| Avg Sharpe | 0.345 | 0.272 | −0.073 |
| Positive combos | 21/27 | 21/27 | 0 |
| RF wins | 27/27 | 27/27 | 0 |
| Drift immunity (Active) | ✓ | ✓ | — |

Merton jumps (λ=10, μJ=0, σJ=0.05) reduce Sharpe by ~21% for Active but preserve all qualitative properties: drift immunity, RF universality, positive Sharpe at all tested combos. The framework is robust to price discontinuities.

### 6. MaxDD increases are moderate under Heston, not catastrophic.

Heston-Jump adds only +2.2pp avg MaxDD for Active vs GBM. The problem is not excess drawdowns — it's insufficient return. The strategy loses money slowly under stochastic variance, not through sudden blowups.

### 7. The "all-weather" claim requires model qualification.

Active achieves Sharpe > 0 at 18/36 total combos — all 18 failures under Heston-family models. The corrected claim:

> **Active (δ0.20/3d, RF only) is all-weather under diffusion-based price models (GBM, Jump).** Under stochastic variance models (Heston, Heston-Jump), the strategy is non-viable at any drift or vol level. The framework's IV/RV regime signal is calibrated on OU-process dynamics and does not transfer to Heston's variance process.

## Interpretation: What This Means for Live Deployment

The critical question: **which model better represents real crypto markets?**

1. **GBM with stochastic IV (OU)** assumes volatility evolves smoothly with a fixed mean — it's essentially a "noisy vol" model. The regime filter works because IV/RV deviations are transient and mean-reverting on predictable timescales.

2. **Heston** assumes volatility is itself a stochastic process with clustering (vol begets vol) and leverage effects (price drops → vol spikes). This is empirically more realistic for equity and crypto markets.

3. **In practice, crypto vol behavior falls between these models.** Short-term vol exhibits Heston-like clustering, but the OU process captures the medium-term mean-reversion that the regime filter exploits. The 20-day lookback window averages over short-term clusters, making the OU model a reasonable approximation for the filter's decision timescale.

4. **The Heston results represent a worst case** where the vol process is entirely determined by the variance SDE. In reality, implied vol incorporates market expectations and supply/demand that are not pure functions of realized variance — creating the structural VRP that the regime filter exploits.

The practical takeaway is not "the framework doesn't work" but rather "the framework's edge depends on IV/RV dynamics that follow OU-like mean-reversion, not on the specific price model." When vol starts exhibiting strong Heston-style clustering (as during crypto regime changes), the framework's edge degrades.

## Conclusions

1. **The framework is model-dependent, not model-robust.** It works under GBM and Jump (OU-based IV), fails under Heston and Heston-Jump (variance-based IV). This is the most important finding since Experiment 1.

2. **Jump processes are benign.** Price discontinuities reduce Sharpe by ~21% but preserve all qualitative properties. The framework handles jumps well.

3. **Stochastic variance is the framework's Achilles' heel.** The regime filter's IV/RV signal degrades under Heston dynamics: skip rates increase modestly but accepted-trade win rates collapse from 78% to 47%.

4. **The "all-weather" claim must be qualified.** Active is all-weather under GBM/Jump but non-viable under Heston at any drift × vol combination.

5. **RF is still beneficial even under Heston** for Moderate/Active but can't overcome the fundamental signal degradation. Exception: RF hurts Conservative under Heston.

6. **No preset changes needed.** The current presets are correctly optimized for the GBM/OU framework. The issue is not parameter tuning — it's a structural mismatch between the filter's signal and Heston's dynamics.

7. **Implication for future work.** Experiment 11 (Lookback × Cycle Interaction) and Experiment 14 (Vol-Adaptive Skip Threshold) should be tested under both GBM and Heston. If lookback tuning can recover Heston performance, the framework's model-dependence may be solvable without engine changes.

## Deployment Zone Update

### Previous (Exp 7/8)
- Active: Deploy at any drift, VRP ≥ 10%

### Updated (Exp 9)
- Active: Deploy at any drift, VRP ≥ 10%, **when vol dynamics approximate OU mean-reversion** (i.e., IV/RV ratio is stationary over 20-day windows)
- **Monitor IV/RV autocorrelation.** If 5-day rolling IV/RV shows clustering (ACF > 0.5 at lag 1), reduce position sizing or pause — Heston-like dynamics may be present
- Jump risk is tolerable; stochastic variance is not
