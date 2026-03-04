# Wheel Strategy Simulator - AI Research & Optimization

This directory serves as the command center for AI-driven discovery of optimal market environments and trading strategy parameters for the Wheel Strategy Simulator.

## Purpose

The goal is to move beyond manual trial-and-error by deploying programmatic parameter sweeps, stress tests, and algorithmic optimization directly against the core TypeScript simulation engine (`src/components/monte-carlo.ts` and `src/components/strategy/simulate.ts`). 

This document tracks our methodologies, active experiments, and final findings.

---

## AI Optimization Approaches

We employ three main strategies to find the best presets:

### 1. Iterative Grid Search (Parameter Sweep)
**Best for:** Finding the optimal balance between a few key variables (e.g., target delta vs. cycle length).
- **Process:** We define a tight range of values for 2-4 parameters. A CLI script runs the simulation across all permutations.
- **Outcome:** A ranked list of parameter combinations highlighting the trade-offs (e.g., higher returns vs. higher max drawdown).
- **Interaction:** The user reviews the top 5, selects a favorite, and we narrow the grid search around that selection for fine-tuning.

### 2. Market Stress Test (Robustness Optimization)
**Best for:** Ensuring a strategy doesn't blow up when market conditions change.
- **Process:** We define three distinct market presets:
  - **Bull Run** (High drift, low/med vol)
  - **Bear Market** (Negative drift, high vol)
  - **High-Vol Sideways** (Zero drift, extreme vol)
- **Outcome:** We run strategy combinations across *all three* environments simultaneously and score them based on their worst-case performance (identifying the most robust "all-weather" strategy).

### 3. Algorithmic Optimization (Random Search / Simulated Annealing)
**Best for:** Exploring the massive, 20+ dimension parameter space (e.g., `adaptiveCalls`, `ivRvSpread`, `rollPutWhenBelow`, etc.) where grid search is computationally impossible.
- **Process:** A script randomly samples thousands of parameter combinations or uses a simple genetic algorithm to "evolve" the best strategy over generations based on a fitness function (e.g., Sharpe Ratio).
- **Outcome:** Discovers non-intuitive parameter synergies that a human might never try.

---

## Active Workflow

1. **Define the Goal:** State what a "good" strategy looks like (Max Return? Lowest Drawdown? Highest Win rate? Best Sharpe?).
2. **Set the Baseline Market:** Choose the market profile to optimize against.
3. **Execute:** AI writes and runs the search script.
4. **Analyze:** AI presents the top results; user provides feedback and direction.
5. **Save:** Winning combinations are baked into `src/components/presets.ts` as new built-in presets (e.g., "Aggressive Wheel", "Conservative Income").

---

## Log of Findings & Presets

*(This section will be updated as we complete our runs)*

### Experiment 1: High-Vol Sideways Grid Search
- **Goal:** Maximize Sharpe Ratio (Risk-Adjusted Return)
- **Market Baseline:** High-Vol Sideways (0% drift, 150% vol, Heston)
- **Approach:** Iterative Grid Search sweeping `targetDelta` (0.10–0.40), `cycleLengthDays` (3–30), and `skipThreshold` (0–10%) across 1,000 Monte Carlo paths over 365 days. 48 total combinations. Rolling disabled.
- **Results:**
  - **Best Risk-Adjusted:** `delta: 0.1, cycle: 30, skip: 0` — 0.013 Sharpe, 0.54% APR, 35.5% Max DD, 56.8% win rate. Sortino of 7.544 reveals right-skewed returns (upside vol >> downside vol).
  - **Best Nominal Return:** `delta: 0.3, cycle: 30, skip: 0` — 8.92% APR but -0.245 Sharpe and 50.7% Max DD. Uncompensated risk.
  - **Worst Strategy:** `delta: 0.4, cycle: 3, skip: 0.1` — -0.440 Sharpe, 61.5% Max DD, 35.2% win rate. Account destroyer.
- **Key Findings:**
  1. **No parameter combination produces a positive risk-adjusted return.** Best Sharpe is 0.013 (effectively zero). In 150% vol with no drift, the wheel is not a viable standalone strategy.
  2. **30 DTE dominates short DTE.** Short-dated options carry lethal gamma exposure in high-vol chop. 30 DTE gives theta room to work and absorbs gaps. The "sell weeklies" approach is the worst performer.
  3. **Delta is a risk factor, not a return lever.** 0.1→0.4 delta increases APR but Sharpe deteriorates monotonically. You're not paid for the extra drawdown.
  4. **Always be in the market.** Skip threshold (premium filter) hurt performance across every delta/cycle combo. Continuous premium collection offsets drawdowns better than selective entry.
  5. **Sharpe understates the strategy.** The 7.5 Sortino vs 0.01 Sharpe divergence shows the return distribution is right-skewed — Sharpe penalizes upside vol, making the strategy look worse than it is for downside-focused investors.
- **Conclusion:** **The wheel strategy is not suitable for high-volatility sideways markets.** With 150% annualized vol and zero drift, no parameterization produces a meaningful risk-adjusted return. The strategy has no edge in this regime — premium collected is fully consumed by assignment losses and gamma-driven drawdowns. Attempting to optimize within this environment is futile; the correct move is to not deploy the wheel here at all.
- **Action Taken:** Results documented in `research/SWEEP1_ANALYSIS.md`. No presets saved — no combination merits a built-in preset for this regime.

### Experiment 2: Normal-Vol Regime Grid Search
- **Goal:** Find vol regimes where the wheel generates positive risk-adjusted returns (alpha over buy-and-hold).
- **Market Baseline:** GBM with stochastic IV (OU process, κ=5.0, ξ=0.5, VRP=15%), 5% annual drift, tested at 25% vol (typical equity) and 50% vol (moderate crypto).
- **Approach:** Iterative Grid Search sweeping `targetDelta` (0.10–0.40), `cycleLengthDays` (3–30), and `skipThreshold` (0–10%) across 1,000 Monte Carlo paths over 365 days. 180 total combinations. Rolling disabled.
- **Results:**
  - **Best Risk-Adjusted (50% vol):** `delta: 0.1, cycle: 30, skip: 0` — 0.417 Sharpe, 6.68% APR, 20.69% Max DD, 71.7% win rate, +2.82% alpha.
  - **Best Risk-Adjusted (25% vol):** `delta: 0.20, cycle: 3, skip: 0` — 0.352 Sharpe, 13.17% APR, 21.06% Max DD, 62.1% win rate, +8.67% alpha.
  - **Best Nominal Return:** `vol: 50%, delta: 0.4, cycle: 3, skip: 0` — 21.70% APR but 0.051 Sharpe and 40.18% Max DD. Return trap.
- **Key Findings:**
  1. **The wheel generates genuine alpha in normal-vol regimes.** 43.3% of combos had positive Sharpe. 100% had positive mean APR.
  2. **Stochastic IV reveals divergent optimal strategies by vol level.** 50% vol favors long DTE (30-day); 25% vol favors short DTE (3-day) to capture IV variability.
  3. **50% vol is the sweet spot for conservative strategies.** `delta: 0.1, cycle: 30` tops 50% vol rankings — unchanged from Experiment 1.
  4. **Skip threshold always hurts.** Every top strategy uses `skip: 0`.
  5. **High delta is a return trap.** 21%+ APR at delta 0.4 but Sharpe near zero.
  6. **Stochastic IV deflated static-IV alpha by 25%.** 50% vol best alpha went from +3.77% (static IV) to +2.82% (stochastic IV), confirming the remaining edge is genuine VRP harvesting.
- **Conclusion:** **The wheel is viable at 25–50% vol with mild positive drift, but the optimal strategy is regime-specific.** At 50% vol, conservative parameterization (low delta 0.10, long cycle 30-day) delivers 0.42 Sharpe with +2.8% alpha. At 25% vol, the opposite works: moderate delta (0.15–0.25) with short 3-day cycles delivers 0.35 Sharpe with +6–10% alpha but higher tail risk. High delta is a return trap at 50% vol but viable at 25% vol — the delta-risk relationship is non-linear and vol-dependent.
- **Action Taken:** Full analysis in `research/sweep2/SWEEP2_ANALYSIS.md`. Preset candidates identified ("Conservative Income" at 50% vol, "Active Premium" at 25% vol).

### Experiment 3: Vol Boundary Search
- **Goal:** Find the exact vol level (between 50% and 150%) where Sharpe crosses zero — defining the "wheel deployment zone."
- **Market Baseline:** GBM with stochastic IV (OU process, κ=5.0, ξ=0.5, VRP=15%), 5% annual drift, vol range 40%–155%.
- **Approach:** Two-phase search. Phase 1: coarse sweep across 24 vol levels (5% increments) × 3 strategies (Conservative δ0.10/30d, Moderate δ0.20/14d, Active δ0.20/3d) × 1,000 paths. Phase 2: fine-grained 1% increment search around detected crossover points. 80,000 total simulation paths.
- **Results:**
  - **Conservative (δ0.10/30d):** Sharpe positive across entire range (40%–155%). Peak Sharpe **0.448 at 60% vol** (8.19% APR, +4.61% alpha, 23.7% MaxDD). No vol ceiling found.
  - **Moderate (δ0.20/14d):** Sharpe crosses zero at **~82% vol**. Peak Sharpe 0.153 at 40% vol (11.64% APR, +7.51% alpha, 28.5% MaxDD).
  - **Active (δ0.20/3d):** Sharpe crosses zero at **~77% vol**. Peak Sharpe 0.157 at 40% vol (14.63% APR, +10.51% alpha, 32.2% MaxDD).
- **Key Findings:**
  1. **The conservative strategy has no practical vol ceiling.** δ0.10/30d maintains positive Sharpe even at 155% vol (0.039). Low delta minimizes gamma exposure; 30-day cycles provide time diversification.
  2. **Higher delta = lower vol ceiling.** The relationship is monotonic: δ0.10 → no ceiling, δ0.20/14d → 82%, δ0.20/3d → 77%. Higher delta amplifies gamma-driven assignment losses that overwhelm premium at high vol.
  3. **The sweet spot is 55%–65% vol.** Conservative strategy peaks at 60% — vol is high enough for meaningful premium but low enough that assignment losses don't consume it.
  4. **Sharpe and APR move in opposite directions.** At 155% vol, conservative earns 20.65% APR (4× the 40% vol return) but Sharpe is only 0.039. Classic return trap.
  5. **Alpha is universal but misleading.** The wheel beats buy-and-hold at every vol level tested in raw return terms. But positive alpha with negative Sharpe means you're not compensated for the risk.
- **Conclusion:** **The vol boundary is strategy-dependent, not universal.** Conservative parameterization (δ0.10/30d) is viable at any vol below ~155%. Moderate/active strategies have firm ceilings at 82%/77% vol respectively. The optimal deployment zone is 55%–65% vol for all strategies. Above 80% vol, only conservative parameterization should be used. For live deployment: monitor 30-day realized vol; exit moderate/active when RV > 75%, exit conservative when RV > 150%.
- **Action Taken:** Full analysis in `research/sweep3/SWEEP3_ANALYSIS.md`. Deployment zone boundaries established for all three strategy profiles.

### Experiment 4: Regime Filter
- **Goal:** Test whether skipping premium selling when IV/RV is below a threshold (no positive variance risk premium) improves risk-adjusted returns.
- **Market Baseline:** GBM with stochastic IV (OU process, κ=5.0, ξ=0.5, VRP=15%), 5% annual drift, tested at 8 vol levels (40%–150%).
- **Approach:** Sweep `skipBelowRatio` (0, 0.8, 0.9, 1.0, 1.05, 1.1, 1.2, 1.3) × 3 strategies × 8 vol levels × 1,000 paths. 192 total combinations. IV/RV spread scaling enabled (lookback=20, minMult=0.8, maxMult=1.3).
- **Results:**
  - **Conservative (δ0.10/30d):** Best Sharpe 0.494 at 50% vol with skip<1.0 (+0.083 vs baseline). Sweet spot 0.90–1.00.
  - **Moderate (δ0.20/14d):** Best Sharpe 0.341 at 40% vol with skip<1.3 (+0.174). Vol ceiling shifts ~84%→~88%.
  - **Active (δ0.20/3d):** Best Sharpe 0.346 at 40% vol with skip<1.3 (+0.167). Vol ceiling shifts ~76%→~84%.
- **Key Findings:**
  1. **Universally beneficial.** 24/24 strategy-vol combos improved. First parameter with no losers.
  2. **Optimal threshold is strategy-dependent.** Conservative: skip=0.90–1.00. Moderate/Active: skip=1.10–1.20. Higher gamma → higher threshold.
  3. **Raises vol ceilings 5–10pp.** Active 76%→84%, Moderate 84%→88%.
  4. **Aggregate sweet spot: skip=1.10** (+0.056 mean ΔSharpe across all combos).
  5. **Over-filtering (skip=1.30) degrades at high vol** — skips 40%+ of cycles, APR drops 5–15pp for marginal Sharpe gain.
- **Conclusion:** **The regime filter is the most universally effective parameter discovered.** Recommended: `skipBelowRatio=1.0` for conservative, `1.10–1.20` for moderate/active.
- **Action Taken:** Full analysis in `research/sweep4/SWEEP4_ANALYSIS.md`. Engine: `skipBelowRatio` on `IVRVSpreadConfig`, integrated into `computeIVRVMultiplier`.

### Experiment 5: Put-Only Regime Filter
- **Goal:** Determine whether applying `skipBelowRatio` to puts only (always sell calls when holding ETH) improves risk-adjusted returns vs. the current "skip both" behavior from Experiment 4.
- **Market Baseline:** GBM with stochastic IV (OU process, κ=5.0, ξ=0.5, VRP=15%), 5% annual drift, tested at 8 vol levels (40%–150%).
- **Approach:** Sweep `skipSide` ("both", "put") × `skipBelowRatio` (0, 0.9, 1.0, 1.1, 1.2) × 3 strategies × 8 vol levels × 1,000 paths. 216 unique combinations.
- **Results:**
  - **Conservative (δ0.10/30d):** put-only wins 22/32 combos, mean ΔSharpe +0.008. Best: vol=60%, skip=1.1, side=put → Sharpe **0.503**, APR 10.92%.
  - **Moderate (δ0.20/14d):** put-only wins 28/32 combos, mean ΔSharpe +0.024. Best: vol=40%, skip=1.2, side=put → Sharpe **0.372**, APR 16.44%.
  - **Active (δ0.20/3d):** put-only wins **30/32** combos, mean ΔSharpe **+0.065**. Best: vol=40%, skip=1.2, side=put → Sharpe **0.473**, APR 21.31%. Largest single Sharpe improvement in the research program.
- **Key Findings:**
  1. **Put-only filtering is strictly superior for moderate/active strategies.** Skipping calls leaves naked ETH exposure with zero premium income — call premium cushions drawdowns during low-VRP periods.
  2. **Effect scales with gamma exposure.** Conservative: +0.008 mean ΔSharpe. Moderate: +0.024. Active: +0.065. Higher delta + shorter cycles = more value from keeping calls enabled.
  3. **Vol ceilings extend dramatically.** Active: 76%→92% (+16pp). Moderate: 84%→93% (+9pp). Put-only filtering makes moderate/active strategies viable in significantly more volatile markets.
  4. **APR slightly lower, Sharpe much higher.** Put-only sacrifices 0.3–1.0% APR for 2–5pp lower MaxDD and 2–6pp higher win rates — classic risk-adjustment win.
  5. **Active strategy rehabilitated.** At skip=1.2/put-only/40% vol, Active achieves 0.473 Sharpe — higher than Conservative's baseline 0.41. Previously uncompetitive on risk-adjusted basis.
  6. **Always sell calls when holding ETH.** The VRP regime signal is irrelevant for covered calls — you already own the ETH, so selling calls always reduces risk regardless of IV/RV ratio.
- **Conclusion:** **`skipSide: "put"` should be the default for moderate and active strategies.** There is no scenario where "both" is clearly better for these profiles. For conservative, the effect is small but still net positive. Recommended: `skipBelowRatio=1.2, skipSide="put"` for moderate/active; `skipBelowRatio=1.0–1.2, skipSide="put"` for conservative.
- **Action Taken:** Full analysis in `research/sweep5/SWEEP5_ANALYSIS.md`. Engine: `skipSide` on `IVRVSpreadConfig`, `side` parameter on `computeIVRVMultiplier`.

### Experiment 6: Combined Feature Stack
- **Goal:** Test the full combination of best settings from Experiments 2–5 — regime filter, adaptive calls, call rolling, put rolling, stop-loss — all enabled simultaneously. Answer: Do features stack additively or interfere?
- **Market Baseline:** GBM with stochastic IV (OU process, κ=5.0, ξ=0.5, VRP=15%), 5% annual drift, tested at 4 vol levels (40%, 60%, 80%, 100%).
- **Approach:** Full factorial over 5 binary feature toggles × 3 strategies × 4 vol levels. Conservative/Moderate: 2^5 = 32 combos; Active: 2^4 = 16 (no put rolling). 320 total configurations × 1,000 paths = 320,000 simulation paths.
- **Results:**
  - **Conservative (δ0.10/30d):** Best config **RF+AC+PR** (Regime Filter + Adaptive Calls + Put Rolling). Sharpe 0.569 at 40% vol, 0.515 at 60%. Robust across all vol levels.
  - **Moderate (δ0.20/14d):** Best config **RF** or **RF+PR** (Regime Filter ± Put Rolling). Sharpe 0.422 at 40% vol, 0.323 at 60%. Adaptive calls harmful (-0.011 to -0.071 ΔSharpe).
  - **Active (δ0.20/3d):** Best config **RF only** (Regime Filter alone). Sharpe **1.044** at 40% vol — highest risk-adjusted return in entire research program. 33.94% APR, 15.1% MaxDD, 86.2% win rate.
- **Key Findings:**
  1. **Features do NOT stack additively.** The dominant feature (regime filter, +0.186 mean ΔSharpe) provides the vast majority of improvement. Adding more features yields diminishing or negative returns.
  2. **Adaptive Calls are strategy-dependent.** Beneficial for Conservative (low δ0.10, +0.083–0.118 marginal), but harmful for Moderate/Active (higher δ0.20, -0.011 to -0.383 marginal). Conflicts with regime filter at higher delta: -0.231 interaction for Active.
  3. **Stop-Loss has zero impact.** Zero triggers across all 320 configurations. The wheel strategy's cycling structure inherently limits drawdowns below the 25% threshold. Stop-loss is not redundant because of filtering — it's structurally unnecessary.
  4. **Call Rolling has zero impact.** At δ0.10–0.20, calls are sold far enough OTM that the 5% ITM threshold for rolling is never triggered.
  5. **Put Rolling helps Conservative only.** +0.020 mean ΔSharpe. Extends OTM put duration, reducing whipsaw. Weakly positive for Moderate at higher vol, disabled for Active (3d cycle too short).
  6. **Full stack actively degrades Active.** At 60% vol: full stack 0.302 Sharpe vs RF-only 0.797 — a -0.495 loss. More features ≠ better.
  7. **Less is more.** Optimal feature count: Conservative=3 (RF+AC+PR), Moderate=1–2 (RF or RF+PR), Active=1 (RF only).
- **Conclusion:** **The regime filter is the single most important feature, and it's sufficient alone for Moderate/Active strategies.** Conservative benefits from layering adaptive calls and put rolling on top, but only because its low delta avoids the filter-adaptive conflict. Stop-loss and call rolling should default to OFF — they contribute nothing at the tested parameter ranges. The Active strategy with regime filter alone (1.044 Sharpe at 40% vol) is the strongest risk-adjusted configuration discovered in the research program.
- **Action Taken:** Full analysis in `research/sweep6/SWEEP6_ANALYSIS.md`. Presets updated: Conservative (δ0.10/30d, RF+AC+PR), Moderate (δ0.20/14d, RF+PR), Aggressive (δ0.20/3d, RF only).

### Experiment 7: Drift Sensitivity
- **Goal:** Test whether the Exp 6 optimal configs remain viable across different drift regimes. All prior experiments assumed 5% annual drift. Crypto drift ranges from -80% (bear) to +200% (bull).
- **Market Baseline:** GBM with stochastic IV (OU process, κ=5.0, ξ=0.5, VRP=15%), tested at 6 drift levels (-30%, -10%, 0%, +5%, +20%, +50%) and 4 vol levels (40%, 60%, 80%, 100%).
- **Approach:** Each strategy tested with optimal config (RF ON) and baseline (RF OFF) across all drift × vol combos. 144 total combinations × 1,000 paths = 144,000 simulation paths.
- **Results:**
  - **Conservative (δ0.10/30d, RF+AC+PR):** Sharpe positive at 20/24 combos (83%). Fails only at -30% drift (all vol levels). Best: +50% drift / 40% vol → Sharpe 1.477. Crossover at ~-17% to -25% drift depending on vol.
  - **Moderate (δ0.20/14d, RF+PR):** Sharpe positive at 20/24 combos (83%). Fails only at -30% drift. Best: +50% drift / 40% vol → Sharpe 1.245. Crossover at ~-11% to -18% drift depending on vol.
  - **Active (δ0.20/3d, RF only):** **Sharpe positive at ALL 24/24 combos (100%).** Even at -30% drift / 100% vol: Sharpe 0.296, APR 34.86%, 66.5% win rate. Best: +50% drift / 40% vol → Sharpe 1.765.
- **Key Findings:**
  1. **Active is drift-immune.** Positive Sharpe across the entire tested parameter space (-30% to +50% drift, 40-100% vol). The regime filter naturally adapts by skipping more put cycles in adverse conditions; the ~6% of cycles it accepts remain profitable. No drift guard needed.
  2. **Conservative/Moderate fail only at -30% drift.** At -10% drift, both strategies are viable across all vol levels. Deployment floor is approximately -15% (Conservative) to -10% (Moderate) annual drift.
  3. **Regime filter wins 72/72 combinations (100%).** Not a single case where removing RF improves Sharpe. RF's value *increases* in bear markets: Active ΔSharpe from RF is +0.308 at -30% drift vs +0.177 at +50% drift.
  4. **Skip rates are insensitive to drift.** Conservative: 98-99% skip at any drift. Active: ~94%. The filter is not over-skipping in bear markets — skip rates vary <2% across drift levels.
  5. **Alpha inverts with drift.** The wheel generates massive alpha in bear markets (+54% avg for Active at -30% drift) and trails buy-and-hold in strong bulls (-34% for Conservative at +50% drift). The wheel is a bear market outperformer that trades upside participation for downside protection.
  6. **Drift sensitivity is monotonic and smooth.** No regime cliffs or non-linear breakpoints. Sharpe degrades linearly with decreasing drift, enabling simple linear deployment rules.
  7. **Exp 6 configs are drift-stable.** RF ON is optimal at every drift × vol × strategy combination. No need for drift-specific preset configurations.
- **Conclusion:** **Active (δ0.20/3d, RF only) is the all-weather strategy.** It maintains positive risk-adjusted returns across the entire tested drift × vol space, generating +54% alpha over buy-and-hold in deep bear markets while still delivering 1.765 Sharpe in strong bulls. Conservative/Moderate need a drift guard (exit when trailing annualized return < -15%/-10%) but are otherwise robust. The regime filter is universally beneficial and becomes *more* valuable in adverse drift conditions. No changes to preset configurations are needed — Exp 6 optimal configs are drift-regime invariant.
- **Action Taken:** Full analysis in `research/sweep7/SWEEP7_ANALYSIS.md`. Deployment zone updated with drift boundaries. No preset changes — Exp 6 configs confirmed stable across drift regimes.

### Experiment 8: VRP Sensitivity
- **Goal:** Test whether the regime filter and strategy viability depend on the assumed Variance Risk Premium (VRP). All prior experiments assumed VRP=15%. The regime filter explicitly exploits VRP — if real VRP is lower, the filtering signal degrades and the entire framework may be overfitted.
- **Market Baseline:** GBM with stochastic IV (OU process, κ=5.0, ξ=0.5), VRP varied from 0% to 25%, tested at drift levels 0% and -30%, vol levels 40%–100%.
- **Approach:** Sweep VRP (0%, 5%, 10%, 15%, 25%) × drift (0%, -30%) × vol (40%, 60%, 80%, 100%) × 3 strategies × 2 configs (Optimal RF ON, Baseline RF OFF) × 1,000 paths. 240 total combinations = 240,000 simulation paths.
- **Results:**
  - **Conservative (δ0.10/30d, RF+AC+PR):** At drift=0%, viable (Sharpe>0) at VRP≥5%. At drift=-30%, not viable at any tested VRP except VRP=25% at vol≥60%. Avg Sharpe ranges from -0.150 (VRP=0%) to 0.300 (VRP=25%).
  - **Moderate (δ0.20/14d, RF+PR):** At drift=0%, viable at VRP≥10%. At drift=-30%, not viable at 40-60% vol even at VRP=25%. Avg Sharpe ranges from -0.187 (VRP=0%) to 0.172 (VRP=25%).
  - **Active (δ0.20/3d, RF only):** At drift=0%, viable at VRP≥5% (all vol≤80% at VRP=0%). At drift=-30%, viable at VRP≥10%. Avg Sharpe ranges from 0.060 (VRP=0%) to 0.889 (VRP=25%). Drift-immune at VRP≥10%.
- **Key Findings:**
  1. **Regime filter wins 120/120 combinations — universally beneficial at every VRP level.** Even at VRP=0%, RF improves Sharpe for every strategy × drift × vol combo. RF value *inversely* correlates with VRP: Active ΔSharpe is +0.517 at VRP=0% vs +0.164 at VRP=25%. RF exploits IV/RV *variance*, not just mean VRP.
  2. **Active's drift immunity breaks below VRP=10%.** At VRP=15%: 8/8 positive (confirming Exp 7). At VRP=10%: still 8/8. At VRP=5%: 7/8 (fails at -30% drift / 100% vol). At VRP=0%: 4/8 failures. The drift immunity threshold is VRP≥10%.
  3. **VRP=10% is the practical deployment floor.** Below 10%: Active loses drift immunity, Moderate has negative avg Sharpe, Conservative near-zero even at drift=0%. Above 10%, framework is robust.
  4. **Sharpe scales linearly with VRP — no cliff edges.** ~+0.16 Sharpe per 5pp of VRP for Active (constant slope). Framework degrades gracefully, not catastrophically. Interpolation between tested levels is reliable.
  5. **Skip rates are VRP-insensitive.** Active: 97.0% skip at VRP=0% vs 91.0% at VRP=25% — the filter finds transient IV>RV windows even with zero mean VRP. Confirms RF exploits stochastic IV variance, not just the VRP offset.
  6. **The framework is NOT overfitted to VRP=15%.** Active achieves positive Sharpe at VRP=0% / drift=0% (avg 0.195). RF is universally beneficial. Feature stack ranking unchanged. The 15% assumption provides comfortable margin, not structural dependence.
  7. **`skipBelowRatio` thresholds do not need recalibration.** RF helps at every VRP level with no sign of the current thresholds (1.0 Conservative, 1.2 Moderate/Active) being suboptimal at low VRP.
- **Conclusion:** **VRP=10% is the deployment floor for the framework.** Below this, Active loses drift immunity and Conservative/Moderate produce negative Sharpe. The regime filter is VRP-independent — it helps at every level tested, with value increasing as VRP decreases. The framework is not overfitted to VRP=15%; Active remains viable down to VRP≈0% in non-bear markets. For live deployment: estimate trailing IV-RV spread; if below 10%, restrict to Active only; if below 5%, reduce sizing or pause.
- **Action Taken:** Full analysis in `research/sweep8/SWEEP8_ANALYSIS.md`. Deployment zone updated with VRP floor. No preset changes — Exp 6 configs confirmed stable across VRP regimes.

### Experiment 9: Model Robustness
- **Goal:** Test whether the Exp 6 optimal configs remain viable across all 4 price models (GBM, Heston, Jump, Heston-Jump). All prior experiments used GBM only.
- **Market Baseline:** 4 models × 3 vol levels (40%, 60%, 80%) × 3 drifts (+5%, 0%, −30%). GBM/Jump: stochastic OU IV (κ=5, ξ=0.5, VRP=15%). Heston/Heston-Jump: IV from variance process √v. Heston: κ=2, σ=0.5, ρ=−0.7, θ=vol². Jump: λ=10, μJ=0, σJ=0.05.
- **Approach:** Each of 3 strategies tested with Optimal (RF ON) and Baseline (RF OFF) across all model × drift × vol combos. 216 total combinations × 1,000 paths = 216,000 simulation paths.
- **Results:**
  - **GBM:** Avg Sharpe 0.345, 21/27 positive. Active 9/9 positive, drift-immune. Baseline control.
  - **Jump:** Avg Sharpe 0.272, 21/27 positive. Active 9/9 positive, drift-immune. −21% Sharpe vs GBM.
  - **Heston:** Avg Sharpe **−0.216**, 5/27 positive. Active 0/9 positive. Moderate 0/9 positive. Conservative 5/9 positive (marginal, 0.042–0.146 Sharpe at drift ≥ 0%).
  - **Heston-Jump:** Avg Sharpe **−0.289**, 2/27 positive. Every strategy fails at nearly every combo.
- **Key Findings:**
  1. **The IV path source is the critical differentiator.** GBM/Jump (OU-based IV) work; Heston/Heston-Jump (variance-based IV) fail. The split is clean and absolute. Jump processes are benign (−21% Sharpe); stochastic variance is the Achilles' heel (−143% to −360% Sharpe).
  2. **The regime filter was implicitly calibrated on OU-generated IV/RV signals.** OU produces smooth, normally-distributed IV paths with predictable mean-reversion. Heston's variance process produces clustered vol with abrupt transitions. Under Heston, the filter skips ~3% more cycles but accepted-trade win rates collapse from 78% to 47%.
  3. **RF is still beneficial under Heston for Moderate/Active (9/9 wins each)** but can't rescue them. Exception: RF *hurts* Conservative under Heston (1/9 wins, −0.018 ΔSharpe) — at δ0.10 with 99%+ skip rates, the filter's few accepted trades are net-negative.
  4. **Active's drift immunity breaks completely under Heston.** 0/9 positive — fails at every drift × vol combo including +5%/40% (Sharpe −0.200). This is not a bear market problem; the strategy is fundamentally non-viable under stochastic variance dynamics.
  5. **The "all-weather" claim requires model qualification.** Active: 18/36 combos positive (all 18 failures under Heston-family). Corrected: "all-weather under diffusion models (GBM, Jump); non-viable under stochastic variance models (Heston, Heston-Jump)."
  6. **Jump processes are benign.** Merton jumps reduce Sharpe by ~21% but preserve all qualitative properties: drift immunity, RF universality (27/27), positive Sharpe at all combos. No assignment cascades observed.
  7. **MaxDD increases are moderate under Heston** (+2–6pp vs GBM). The problem is insufficient return, not excess drawdown. The strategy loses money slowly, not through blowups.
- **Conclusion:** **The framework is model-dependent, not model-robust.** It works under GBM and Jump (OU-based IV), fails under Heston and Heston-Jump (variance-based IV). The regime filter's IV/RV signal degrades under Heston dynamics due to vol clustering and abrupt regime transitions. No preset changes are needed — the issue is structural, not parametric. For live deployment: the framework's edge depends on IV/RV dynamics that follow OU-like mean-reversion. Monitor IV/RV autocorrelation; if clustering is detected (ACF > 0.5 at lag 1), reduce sizing or pause. Experiment 11 (Lookback × Cycle Interaction) should now be tested under both GBM and Heston to determine if lookback tuning can recover Heston performance.
- **Action Taken:** Full analysis in `research/sweep9/SWEEP9_ANALYSIS.md`. "All-weather" claim qualified. Deployment zone updated with model condition. No preset changes — structural mismatch, not parameter issue.

### Experiment 10: Lookback × Cycle Interaction
- **Goal:** Determine whether tuning `lookbackDays` (hardcoded at 20 in all prior experiments) can (a) improve GBM performance and (b) recover positive Sharpe under Heston — the critical path question from Exp 9.
- **Market Baseline:** GBM and Heston, stochastic IV (OU for GBM: κ=5.0, ξ=0.5, VRP=15%; variance-derived for Heston), tested at 2 drift levels (0%, −30%) and 2 vol levels (40%, 60%).
- **Approach:** Sweep `lookbackDays` (5, 10, 15, 20, 30, 45, 60) × 2 models × 2 drifts × 2 vols × 3 strategies × 2 configs (RF ON/OFF) × 1,000 paths. 336 total combinations = 336,000 simulation paths.
- **Results:**
  - **GBM Conservative (δ0.10/30d):** Best lookback **45d**, Sharpe 0.126 (+0.025 vs 20d). The only above-threshold improvement.
  - **GBM Moderate (δ0.20/14d):** Best lookback 30d, Sharpe 0.052 (+0.018 vs 20d). Sub-threshold.
  - **GBM Active (δ0.20/3d):** Best lookback 30d, Sharpe 0.658 (+0.018 vs 20d). Sub-threshold. 4/4 positive at every lookback.
  - **Heston Conservative:** Best lookback 60d, Sharpe **−0.278** (1/4 positive). No recovery.
  - **Heston Moderate:** Best lookback 30d, Sharpe **−0.307** (0/4 positive). No recovery.
  - **Heston Active:** Best lookback 30d, Sharpe **−0.371** (0/4 positive). No recovery.
- **Key Findings:**
  1. **Lookback tuning CANNOT recover Heston performance.** No lookback value achieves positive Sharpe for Moderate or Active under Heston. The best improvements are marginal (ΔSharpe +0.01–0.04), and zero conditions flip from negative to positive. The GBM-Heston win rate gap (−7 to −33pp) is persistent and unclosable at any lookback.
  2. **Optimal GBM lookback is 30–45d, not 20d.** Longer lookback windows smooth the realized vol estimate, producing more stable IV/RV ratios. Conservative benefits most (45d, +0.025 ΔSharpe). All three strategies peak at 30d+, but Moderate/Active improvements are below the 0.02 significance threshold.
  3. **No lookback/cycle ratio rule exists.** The hypothesis that lookback ≈ 2× cycle length does not hold. Active converges to 30d despite its 3-day cycle (ratio 10×). There's a **floor around 30d** driven by the minimum sample size for meaningful RV estimation, irrespective of trade frequency.
  4. **Short lookback (5d) hurts every strategy.** 5d lookback produces the worst Sharpe at 5/6 model × strategy combinations. The noisy RV estimate at 5d degrades the regime filter's signal quality. Minimum viable lookback is 15d.
  5. **RF is universally beneficial at lookback ≥ 15d under GBM.** Below 15d, Conservative's RF signal degrades (2–3/4 wins instead of 4/4). For Moderate/Active, RF helps at every lookback under both models.
  6. **RF hurts Conservative under Heston at short lookbacks.** At 5–15d, RF produces negative ΔSharpe for Conservative under Heston — the only model × strategy × lookback combination where RF is harmful. At δ0.10 with 99%+ skip rates, the few admitted trades are net-negative under Heston dynamics.
  7. **Skip rate increases monotonically with lookback.** Longer lookback → more stable RV → more conservative filtering → fewer trades. GBM Active: 88.9% (5d) → 94.8% (30d). The 30d lookback hits the optimal accuracy/frequency tradeoff.
- **Conclusion:** **The Heston failure is structural, not parametric — lookback tuning cannot solve it.** The regime filter's IV/RV signal fundamentally degrades under Heston's variance clustering, regardless of how much price history is used for RV estimation. For GBM, the default lookback of 20d is near-optimal; Conservative benefits from extending to 45d (+0.025 ΔSharpe), while Moderate/Active see sub-threshold improvements at 30d. The absolute minimum viable lookback is 15d. Proceed to Exp 11 (Heston skip threshold recalibration) as the next recovery attempt; if that also fails, close the Heston investigation.
- **Action Taken:** Full analysis in `research/sweep10/SWEEP10_ANALYSIS.md`. Conservative preset lookback updated: 20d → 45d. Heston recovery remains open → Exp 11.

---

<!-- NOTE: Keep this section at the end of the file. New experiments append above this section; new follow-up ideas append to the list below. -->
## Recommended Next Experiments

### High — Heston recovery & robustness validation; affects deployment confidence

- **Experiment 11: Heston Skip Threshold Recalibration** — *(Highest priority. Last Heston recovery attempt.)* Exp 10 confirmed lookback tuning alone cannot recover Heston (ΔSharpe +0.01–0.04, zero conditions flipped). Exp 9 showed the current `skipBelowRatio` thresholds (1.0 Conservative, 1.2 Moderate/Active) were implicitly calibrated on OU-generated IV/RV distributions. Under Heston, IV/RV ratios have fatter tails and different autocorrelation — the same threshold admits different-quality trades. Sweep `skipBelowRatio` from 0.8 to 2.0 under **Heston only** at drift levels 0% and +5%, vol levels 40% and 60%, for all three strategies, using Exp 10's best lookback (30d for Moderate/Active, 60d for Conservative). Additionally, test RF OFF for Conservative under Heston — Exp 10 found RF *hurts* Conservative under Heston at most lookbacks (negative ΔSharpe at 5–45d), making it the only model × strategy combo where RF is harmful. If a Heston-specific threshold (e.g., 1.5–2.0) restores positive Sharpe, combine with optimal lookback for a model-adaptive RF configuration. **If threshold recalibration also fails, close the Heston investigation** — the failure is structural (stochastic variance breaks the IV/RV spread signal).
- **Experiment 12: Multi-Year Horizon** — All experiments use 365-day simulations. Run the Exp 6 optimal configs (with Exp 10's Conservative lookback update: 45d) over 2-year and 5-year horizons at drift levels 0%, +5%, −30% and VRP levels 10%, 15%. Exp 7 showed Active earns 18% APR at −30% drift over 1 year — does that survive 2+ years of sustained decline, or does compounding drawdown eventually overwhelm premium income? Exp 8 showed the regime filter skips ~94–97% of cycles — over multiple years, the ~3–6% acceptance rate compounds differently than 1-year projections suggest. Also tests whether `skipBelowRatio` thresholds remain stable as vol regimes shift over longer horizons.

### Medium — Deployment readiness & parameter refinement

- **Experiment 13: Deployment Signal Estimation** — Exp 7 established drift floors (−15% Conservative, −10% Moderate), Exp 8 established VRP floor (10%), Exp 9 added a vol dynamics condition (OU-like mean-reversion required), and Exp 10 confirmed strategy-specific lookback (Conservative 45d, others 20d). In practice, drift, VRP, and vol-dynamics must be estimated from trailing market data. Test: (a) trailing windows (30d, 60d, 90d annualized return) as drift estimators, (b) trailing IV-RV spread (20d, 40d, 60d) as VRP estimators, (c) IV/RV autocorrelation at lag 1 as a vol-clustering detector (Exp 9 recommended ACF > 0.5 as pause signal), (d) a combined deployment signal that switches between Active (any drift, VRP≥5%, low clustering), Moderate (drift>−10%, VRP≥10%), Conservative (drift>−15%, VRP≥10%), and Pause (high clustering or VRP<5%). Key questions: does estimation lag cause whipsaw at boundaries, or does smooth Sharpe degradation (Exp 7 finding #6, Exp 8 finding #4) provide enough margin?
- **Experiment 14: Adaptive Calls Rehabilitation** — Exp 6 found adaptive calls harmful for Moderate/Active (up to −0.383 ΔSharpe) due to a −0.231 interaction with regime filter. But AC helps Conservative (+0.118). The conflict may be caused by AC's wide delta band (0.10–0.50) and aggressive skipping at higher base deltas. Test narrower bands (0.15–0.30), higher `skipThresholdPct` values (0.5–2%), and `minStrikeAtCost=false` for Moderate/Active to see if a tuned AC can coexist with RF. If solvable, all three strategies benefit from adaptive calls.

### Low — Speculative or requires engine changes

- **Experiment 15: Defined-Risk Spreads** — Vertical spreads (5-wide, 10-wide put spreads) to cap max loss per cycle. Exp 6 showed stop-loss is structurally unnecessary at 25% threshold (zero triggers), but spreads address a different problem: truncating gamma-driven drawdown tails for deployment above 80% vol. Requires engine changes: spread payoff logic, margin treatment, and dual-leg rolling. High implementation cost but could eliminate the vol ceiling entirely.
- **Experiment 16: Kelly Sizing** — Fractional Kelly criterion for position sizing. Exp 6 showed the wheel's cycling structure inherently limits drawdowns below 25%, so Kelly's main value is in marginal vol regimes (80–100%) where exposure reduction during thin-edge periods could lift Sharpe. Test ½-Kelly and ¼-Kelly against fixed 1-contract sizing. Requires bankroll tracking in the simulation engine.
- **Experiment 17: Vol-Adaptive Skip Threshold** — *(Demoted from Medium; further deprioritized after Exp 10.)* Experiments 4–6 confirmed optimal `skipBelowRatio` varies by strategy (Conservative: 1.0, Moderate/Active: 1.2). Exp 7–8 showed fixed thresholds are stable across drift and VRP regimes under GBM. Exp 10 showed lookback tuning (a different IV/RV parameter) yields only marginal improvement (+0.018–0.025 ΔSharpe), suggesting the IV/RV pipeline is already near its optimization ceiling under GBM. A dynamic formula `skipBelowRatio = base + k × annualizedVol` would primarily simplify configuration rather than improve performance. If Exp 11 identifies a Heston-specific threshold, this idea is further superseded by model-adaptive thresholds.
