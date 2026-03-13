# Pre-Production Audit: Engine Integrity & Research Completeness

## Session Plan

| Session | Tasks | Focus |
|---------|-------|-------|
| **Session 1** | 1 + 2 | Engine code deep-dive: catalog assumptions + assess impact |
| **Session 2** | 3 | Simulation vs. reality reconciliation (uses Session 1 results) |
| **Session 3** | 4 + 5 + 6 | Research methodology audit across all 27 sweeps |
| **Session 4** | 7 + 8 + 9 + 10 | Preset justification + parameter/strategy coverage gaps |

---

## Part A — Engine Realism Audit
> *"Is the foundation correct?"*

### Session 1

- [x] **1. Hardcoded assumptions review** — Catalog every hardcoded value or simplification (flat bid-ask spread, constant risk-free rate, European-only options, flat IV surface, no slippage, deterministic assignment, continuous prices with no gaps) and assess which ones could materially bias results in either direction.

<details>
<summary><b>Task 1 Results</b></summary>

### Hardcoded Values & Simplifications Catalog

#### A. Black-Scholes Pricing (`black-scholes.ts`)

| # | Assumption | Code Location | Hardcoded Value | Bias Direction | Severity |
|---|-----------|---------------|-----------------|----------------|----------|
| 1 | CDF rational polynomial approximation | `cdf()` coefficients a1–a5, p | Abramowitz & Stegun constants | None | Negligible (~1e-7 accuracy) |
| 2 | Put strike search range | `findStrikeForDelta()` | `[spot × 0.5, spot]` | Could fail to find extremely deep OTM puts at >200% vol | Negligible (vol capped at 200% in presets) |
| 3 | Call strike search range | `findStrikeForDelta()` | `[spot, spot × 1.5]` | Could fail to find deep OTM calls at high vol | Negligible (same reasoning) |
| 4 | Strike bisection convergence | `findStrikeForDelta()` | 100 iterations or $0.01 tolerance | None ($0.01 on $2500 is 0.0004%) | Negligible |
| 5 | European options only | Structural (BS model) | No early exercise | None for Deribit (European options) | **None — correct for target exchange** |

#### B. Price Generation (`price-gen.ts`)

| # | Assumption | Code Location | Hardcoded Value | Bias Direction | Severity |
|---|-----------|---------------|-----------------|----------------|----------|
| 6 | Time step | All models | `dt = 1/365` (calendar days) | None for crypto (24/7 markets) | **None — correct for crypto** |
| 7 | IV floor | `generateIVPath()` | `floor = 0.05` (5%) | Prevents negative IV; real crypto IV always >10% | Negligible |
| 8 | Box-Muller log guard | `boxMuller()` | `u1 \|\| 1e-10` | Numerical safety only | Negligible |
| 9 | Heston QE psi threshold | `generatePricesHeston()` | `psi <= 1.5` (quadratic vs exponential) | Standard Andersen threshold | None |
| 10 | Heston numerical guards | `generatePricesHeston()` | `1e-20` divisors to prevent /0 | Numerical safety only | Negligible |

#### C. Strategy Simulation (`simulate.ts`, `executor.ts`, `state.ts`, `rules.ts`)

| # | Assumption | Code Location | Hardcoded Value | Bias Direction | Severity |
|---|-----------|---------------|-----------------|----------------|----------|
| 11 | **Daily granularity** | `simulate()` main loop | Decisions once/day, no intraday | **Optimistic** — misses intraday ITM→OTM swings and gamma risk, especially for 3-day Active cycles | **Medium** |
| 12 | **Deterministic assignment** | `resolveExpiration()` | Put: `spot < strike`; Call: `spot >= strike` | Slightly optimistic for near-ATM options (no pin risk) | Low (Deribit auto-exercises, so approximately correct) |
| 13 | **Premium booked immediately** | `applyEvents()` PREMIUM_COLLECTED | Full net premium credited at sale | **Optimistic** — ignores margin lockup / opportunity cost of collateral | **Low-Medium** |
| 14 | **Flat bid-ask spread** | BasePutRule, AdaptiveCallRule | `rawPremium × (1 - bidAskSpreadPct)` for selling; `× (1 + spread)` for buyback | **Optimistic for deep OTM** (real spreads wider); **Pessimistic for ATM** (real spreads tighter) | **Medium** (partially cancels) |
| 15 | **Fixed fee per trade** | Executor `execute()` | `feePerTrade × contracts` regardless of notional | Approximately realistic for Deribit | Low |
| 16 | **No slippage** | Executor fills at theoretical price | Deterministic, no market impact | **Optimistic** for larger positions | **Low** for 1 contract; **Medium** for 5+ |
| 17 | **Constant risk-free rate** | Throughout BS calculations | Single `riskFreeRate` for entire sim | Minor — BS rho is small for short-dated crypto options | Low |
| 18 | **capitalAtRisk fixed at start** | `runMonteCarlo()` | `startPrice × contracts`, never updated | Correct for cash-secured wheel assumption | None |
| 19 | **No dividends / funding** | BS model | Zero dividend yield | Correct for spot ETH; ignores futures funding rate | Low |
| 20 | **Min time-to-expiry** | `execute()` buyback path, `RollCallRule`, `RollPutRule` | `Math.max(T, 1/365)` | Numerical guard, prevents T→0 singularity | Negligible |

#### D. Metric Computations (`monte-carlo.ts`)

| # | Assumption | Code Location | Hardcoded Value | Bias Direction | Severity |
|---|-----------|---------------|-----------------|----------------|----------|
| 21 | **Sharpe annualization** | `computeSharpe()` | `× √365` | Correct for crypto (365 trading days). Would be wrong for equities (√252) | **None — correct for target** |
| 22 | **Regime thresholds** | `classifyRegime()` | `>20%` bull, `<-20%` bear | Arbitrary but reasonable; hardcoded | Low |
| 23 | **Benchmark = pure buy-and-hold** | `summarizeRun()` | `(pN - p0) × contracts`, no staking | **Slightly optimistic alpha** — real ETH holders earn ~3-5% staking APR | **Low-Medium** (alpha is overstated by staking yield) |
| 24 | **Vol annualization in RV calc** | `computeRealizedVol()` | `× √365` | Matches dt=1/365 assumption | None for crypto |
| 25 | **APR uses simple annualization, not CAGR** | `summarizeRun()` | `(totalPL / capitalAtRisk) / yearsElapsed × 100` | **Slightly optimistic** for volatile multi-year paths vs compounded annual return | **Low-Medium** |

#### E. Preset Validation Ranges (`presets.ts`)

| Parameter | Allowed Range | Risk |
|-----------|--------------|------|
| `startPrice` | 500–8000 | Could miss low-cap tokens or extreme dips |
| `annualVol` | 10–200% | 200% cap hit in Exp 1 (150% tested); extreme conditions above this untested |
| `annualDrift` | -200 to +200% | Wide enough for crypto |
| `cycleLengthDays` | 1–30 | Puts with rollPut can go to 60 DTE; no issue |
| `contracts` | 1–20 | 20+ contracts in reality would face liquidity issues anyway |
| `ivRvSkipBelow` | 0–2.0 | Adequate range |

### Summary Assessment

**Correct for target market (Deribit crypto options):**
- European options ✓ (Deribit is European)
- 365-day calendar ✓ (crypto is 24/7)
- Deterministic exercise ✓ (Deribit auto-exercises ITM)
- Cash-secured capital basis ✓ (standard wheel collateralization)

**Items with material bias potential:**
1. **Daily granularity** (Medium) — 3-day Active cycles make ~1 decision before expiry. Intraday volatility is unmodeled.
2. **Flat bid-ask spread** (Medium) — Overestimates cost for ATM, underestimates for deep OTM. Partially self-canceling.
3. **No staking in benchmark** (Low-Medium) — Alpha is overstated by ~3-5%/year.
4. **Premium timing** (Low-Medium) — No margin opportunity cost.

**Additional metric caveat:**
- Reported "APR" is simple annualized return, not CAGR. This is fine for relative comparisons inside the framework, but it overstates investor-experienced annualized growth on volatile multi-year paths.

**Not a concern:**
- Strike search ranges, BS approximation, numerical guards, Sharpe/vol annualization factors, fee model — all appropriate for the target market and scale.

</details>

- [x] **2. Model limitations vs. real-world** — Evaluate whether known model gaps (no vol smile/skew, no ARCH clustering in OU, kurtosis mismatch, no liquidity modeling, no margin/forced liquidation) could have produced falsely optimistic or pessimistic conclusions.

<details>
<summary><b>Task 2 Results</b></summary>

### Net Bias Assessment: Could Model Gaps Have Produced False Conclusions?

#### OPTIMISTIC BIASES (engine overestimates strategy performance)

| # | Model Gap | Mechanism of Overestimation | Severity | Caught by Research? |
|---|----------|----------------------------|----------|---------------------|
| 1 | **No ARCH/vol clustering in OU** | OU model's SqACF(1)=0 vs real 0.351. Engine underestimates probability of IV staying elevated for extended periods after a spike. During prolonged high-IV regimes, the IV/RV ratio stays high longer than OU predicts → engine overestimates how often the regime filter allows trading. Real assignment cascades (put assigned → sell call → call assigned in rapid succession during vol clustering) are underrepresented. | **HIGH** | **Partially in Exp 16-17; decisively in Exp 18.** Exp 16 exposed the mismatch, Exp 17 improved tails/skip-rate calibration but still missed clustering, and Exp 18 confirmed the ranking reversal on real data. |
| 2 | **No slippage / market impact** | Fills at theoretical price minus spread. In fast-moving markets (exactly when stop-loss or roll triggers), real execution would be worse. | **LOW-MEDIUM** | **Partially — Exp 13 & 27** tested spread up to 12% and fee up to $2, which implicitly captures some slippage. But spread is fixed, not state-dependent (wider during vol spikes). |
| 3 | **Benchmark excludes staking yield** | Alpha = strategy APR − benchmark APR. Benchmark is pure spot holding without ~3-5% ETH staking APR. All alpha figures are inflated by this amount. | **LOW-MEDIUM** | **No.** Never adjusted for. Conservative's real-data alpha would shrink from ~5-8% to ~1-4%. Active's alpha is more robust since it's larger magnitude. |
| 4 | **Premium booked immediately** | No modeling of margin requirements or opportunity cost of locked collateral. Real exchanges require initial and maintenance margin, reducing effective capital efficiency. | **LOW** | **No.** The cash-secured assumption (capitalAtRisk = spot × contracts) is conservative as collateral, but doesn't model the margin cost. For fully cash-secured positions this is approximately correct. |
| 5 | **No forced liquidation** | Portfolio can go to any drawdown without exchange-forced closeout. In reality, undermargined positions get liquidated at worst prices. | **LOW** | **Partially.** Vol-scaled sizing (Exp 21-22) + cold-start cap keep MaxDD <40%, which should stay within maintenance margin tolerance for cash-secured positions. |

#### PESSIMISTIC BIASES (engine underestimates strategy performance)

| # | Model Gap | Mechanism of Underestimation | Severity | Caught by Research? |
|---|----------|------------------------------|----------|---------------------|
| 6 | **Flat IV surface (no smile/skew)** | OTM put IV is higher in reality due to put skew. Engine prices OTM puts at ATM-like IV → underestimates premium collected. For δ=0.10 puts, real premium could be 10-25% higher than BS(flat IV) predicts. Similarly, crypto OTM calls often have higher IV (volatility smile), underestimating call premiums. | **MEDIUM** | **Indirectly.** Real-data backtests (Exp 18+) use real DVOL which is a single number (like ATM). The smile effect on actual traded strikes was never directly modeled. |
| 7 | **Conservative bid-ask default** | Default 5% haircut is quite aggressive. Deribit actual spreads for liquid ETH options are often 1-3% for ATM, 3-5% for moderately OTM. Engine applies 5% uniformly. | **LOW-MEDIUM** | **Yes — Exp 13 & 27** tested spread from 1-12%. Results showed even 1% spread gives better Sharpe, meaning default 5% is conservative. |
| 8 | **No limit order fills** | Engine assumes immediate market-order fills. Real traders can post limit orders at better prices, capturing part of the spread. | **LOW** | **No.** Would require execution model overhaul. |

#### NEUTRAL / MIXED-DIRECTION BIASES

| # | Model Gap | Why Neutral | Severity |
|---|----------|------------|----------|
| 9 | **No vol term structure** | Single IV for all DTEs. Short-dated options may have higher or lower IV than 30-day. Direction depends on term structure shape (contango vs backwardation in vol). | Medium — direction varies by market regime |
| 10 | **No regime-switching** | GBM/OU drift and vol are constant over simulation. Real markets have structural breaks (regulatory events, macro shifts). Heston partially addresses via mean-reverting variance but was found non-viable. | Medium — compensated by testing across multiple drift/vol combinations |
| 11 | **ΔIV kurtosis gap** | Real: 27, OU+Jump calibrated: 25. Gap is small after calibration. Extreme IV tail events are slightly underrepresented. | Low after Exp 17 calibration |
| 12 | **Daily granularity for Active (3d cycles)** | Engine makes ~1 decision before expiry for 3-day cycles. Could overstate performance (miss intraday assignment/roll triggers) or understate (miss intraday premium opportunities). Direction unclear. | Medium — specific to Active strategy |

### Critical Question: Could These Biases Have Produced False Conclusions?

**Conclusion 1: "Conservative is the best strategy on real data"** — **ROBUST.**
The real-data validation (Exps 18-27) bypasses all simulation model gaps. Conservative's 0.964 rolling Sharpe is measured on actual 5-year ETH data, not simulated. The OU model biases don't affect this conclusion.

**Conclusion 2: "Regime filter is the most important feature"** — **LIKELY ROBUST, with caveat.**
RF was validated both in simulation (Exp 4-6) and on real data (Exps 18-23). The ARCH gap means simulation overestimates RF's skip-rate behavior, and Exp 17 still did not fully close that gap. However, the real-data tests still showed RF as essential. Caveat: RF's benefit may be partially affected by the flat IV surface assumption — if strike-specific skew were modeled, the VRP signal at the traded strikes could shift.

**Conclusion 3: "Moderate strategy is non-viable"** — **ROBUST.**
Confirmed by real data: -0.348 Sharpe, 124.7% MaxDD, fails 16/17 rolling windows. Model biases are irrelevant — the conclusion is from actual prices.

**Conclusion 4: "Active is drift-immune"** — **PARTIALLY FALSE, correctly caught.**
Simulation (GBM) predicted this. Real data falsified it (negative Sharpe in 2022/2025 bears). The ARCH clustering bias explains why: simulation underestimated assignment cascades during sustained vol spikes.

**Conclusion 5: "Framework is cost-resilient"** — **ROBUST.**
Tested on real data (Exp 27) with extreme cost assumptions. Model biases don't apply to cost sensitivity analysis on real data.

**Conclusion 6: "Alpha is positive"** — **WEAKENED by staking yield omission.**
Conservative's real-data alpha (~5-8% over benchmark) shrinks to ~1-4% if staking yield (~3-5% APR) is included in the benchmark. Still positive but thinner. Active's alpha is higher magnitude and survives this adjustment.

### Overall Engine Verdict

The engine's simulation layer has a **slight net optimistic bias**, primarily from the ARCH clustering gap. The research methodology eventually compensated for this, but the distinction matters: **Exp 16 exposed the problem, Exp 17 improved calibration without fixing the core clustering miss, and Exp 18 is the first definitive reality check.** The final conclusions (Exps 18-27) are validated on real data, which is why the remaining simulation biases do not undermine the shipped presets.

**The one unaddressed systematic bias is the staking yield omission from the benchmark**, which inflates all alpha figures by ~3-5%/year. This doesn't change strategy rankings or viability, but users should understand that the "alpha" is vs. passive spot holding without staking, not vs. staking.

**No model gaps were found that could reverse the core conclusions** (Conservative > Active > Moderate, RF is essential, MaxDD < 40% with sizing). The conclusions rest on real-data evidence that is independent of engine model assumptions.

</details>

### Session 2

- [x] **3. Simulation-vs-reality reconciliation** — Review the Exp 18 rank reversal (simulation predicted Active > Conservative, reality showed the opposite). Are there other places where engine simplifications could cause similar mismatches that haven't been caught?

<details>
<summary><b>Task 3 Results</b> (filled after Session 2)</summary>

### Exp 18 Rank Reversal — Root Cause Decomposition

Simulation (Exps 6–17) predicted Active > Moderate > Conservative. Real data (Exp 18) showed Conservative (0.517) > Active (0.369) >> Moderate (−0.348). Three interacting engine simplifications produced this reversal:

| Root Cause | Mechanism | Which Strategies Affected | Caught? |
|---|---|---|---|
| **ARCH clustering gap** (SqACF1 = 0 vs real 0.351) | OU model produces independent IV shocks; real IV volatility clusters for ~2 weeks. In simulation, assignment events are uncorrelated across cycles. In reality, bear markets produce **assignment cascades** — multiple consecutive assignments during sustained vol spikes. | Active (most exposed: 168 puts, 76 assignments = 45% rate vs sim ~30–40%). Moderate (catastrophic: 23/25 = 92%). Conservative (resilient: 9/11, but cycles are months apart). | **Yes — Exps 16–17 identified the gap, Exp 18 confirmed its impact** |
| **Daily granularity + short cycles** | Active's 3-day cycles get ~1 daily decision point before expiry. Intraday ITM↔OTM swings are invisible. Simulation's smooth GBM paths understate the frequency of intraday breaches that daily snapshots miss. | Active only (3d cycles). Conservative's 30d cycles are largely unaffected — daily granularity is adequate for longer horizons. | **Partially — Task 1 flagged it as Medium severity but no experiment quantified the magnitude** |
| **Regime filter skip rate mismatch** | Simulated skip rate at t=1.2: 94–97% (Exp 17). Real skip rate: 62% (Exp 16 raw), 81% Active / 95% Conservative (Exp 18 in-simulation). The ARCH clustering creates persistent above-threshold IV/RV windows that OU doesn't generate. Active accepts more real trades → more exposure to clustered adverse periods. | Active (81% vs sim 95% — 14pp more trading exposure). Conservative (95% vs sim 99% — 4pp). | **Yes — Exps 16–17 documented the skip rate discrepancy** |

**Why Conservative survived and Active didn't dominate:** Conservative's 95.2% skip rate + 30d cycles + δ0.10 (far OTM) created natural protection against all three root causes. Its few trades (11 put sells in 5 years) are separated by months, breaking the assignment cascade chain. Active's combination of high frequency (168 puts), aggressive delta (0.20), and short cycles (3d) made it maximally exposed to the ARCH clustering gap.

### Confirmed Sim-vs-Reality Discrepancies Across Full Research Arc

| # | Discrepancy | Sim Prediction | Real Outcome | Magnitude | Experiment | Status |
|---|---|---|---|---|---|---|
| 1 | **Strategy ranking** | Active > Moderate > Conservative | Conservative > Active >> Moderate | **Full reversal** | Exp 18 | **Caught & resolved** — real-data backtests became authoritative |
| 2 | **MaxDD underestimation** | Active 5yr: 28.6% (Exp 12) | Active 5yr: 65.1% | **2.3× under** | Exp 18 vs 12 | **Caught** — vol-scaling (Exp 21–22) brings real MaxDD to 38% |
| 3 | **Active drift immunity** | Positive Sharpe at −30% drift (Exp 7) | Negative Sharpe in both real bears (−0.488, −0.867) | **Falsified** | Exp 18 | **Caught** — conclusion downgraded |
| 4 | **Moderate viability** | Sharpe 0.28–0.55 (Exp 17) | Sharpe −0.348, 124.7% MaxDD | **Catastrophic miss** | Exp 18 | **Caught** — Moderate removed from presets |
| 5 | **Cross-asset ranking** | Conservative > Active (from ETH) | Tied on BTC (t-stat 0.30, p=0.77) | **Asset-dependent** | Exp 24 | **Caught** — documented as asset-specific |
| 6 | **Cost model optimism** | MC Sharpe ≥ 0.39 at worst-case costs | ETH Active: 0.149 at 12%/$2.00 | **2.6× over** | Exp 27 vs 13 | **Caught** — all remain positive, ranking stable |
| 7 | **OU smoothness** | ΔIV std ~0.68% | Real: 3.93% (ETH), 3.45% (BTC), 8.56% (SOL) | **3–12× under** | Exps 16, 24, 25 | **Caught** — OU+Jump (Exp 17) closed to 3.61% for ETH |
| 8 | **Open-option MTM omission** | Short options contribute no unrealized P/L between sale and expiry/roll | Daily equity remains artificially smooth while short puts/calls move sharply against the book | **Path risk understated** | Engine accounting model | **Not directly caught** — all real-data backtests inherit this simplification |

### Potential Uncaught Risks — Engine Simplifications Not Yet Stress-Tested

The following are simplification interactions that weren't independently tested and could produce mismatch-class errors in scenarios outside the 2021–2026 backtesting window:

#### Risk A: Put Rolling × ARCH Clustering Interaction (Severity: Medium)

**What:** Conservative executed 19 put rolls over 5 years. `RollPutRule` activates when DTE is low AND the put is OTM (`spot > strike`). It closes the old put and opens a fresh put at the current delta target for a new `initialDTE` (30 days).

**Potential mismatch:** In the OU simulation, IV shocks are independent, so a roll extends into a "fresh" 30-day window with mean-reverting IV. In reality, ARCH clustering means the next 30 days are more likely to **also** be volatile if the current period is volatile. A roll triggered during a vol spike (when the filter accepted the original trade) could roll into another volatile window, increasing the probability of assignment on the rolled position.

**Not caught because:** Exp 18's Conservative did 19 rolls with good outcomes — but this is N=1 path. The rolling-window validation (Exp 20) uses 17 windows but Conservative averages only 3 put sells per window, so the roll interaction was never statistically tested. No experiment isolated roll behavior during ARCH-clustered vol regimes.

**Mitigant:** The RollPutRule requires `spot > strike` (OTM), so the put is profitable at roll time. The new strike is recomputed at the target delta, so it adjusts for the current (higher) IV. However, the regime filter does NOT re-evaluate at roll time — the original trade was admitted, so the roll inherits that admission without checking if IV/RV conditions deteriorated.

#### Risk B: RV Computation Crash Sensitivity (Severity: Low-Medium)

**What:** `computeRealizedVol()` computes sample std of log returns over _lookback_ days, annualized by √365. During extreme single-day moves (20–30% crashes like Luna/FTX), one return dominates the sample.

**Potential mismatch:** A single 25% crash on day _d_ spikes the trailing RV immediately. On day _d+1_, the IV/RV ratio drops sharply (IV may also spike but RV spikes harder from the realized move). The regime filter then skips trades for the entire lookback window — even if IV has expanded further and the VRP is actually favorable. This is arguably correct behavior (don't trade during crashes), but the mechanism is an artifact of the sample std estimator, not a deliberate crash filter.

The interaction with vol-scaling compounds this: `volScaling multiplier = volTarget / RV`. Post-crash RV spikes → multiplier drops → position shrinks. This "double protection" (regime filter skips + vol-scaling shrinks) was never tested independently. The two mechanisms are redundant in crash scenarios, meaning the engine is **more conservative than intended** post-crash.

**Not caught because:** The 2021–2026 backtesting period includes crashes (May 2021, Luna, FTX) but these are always at the start of windows (cold-start cap handles them). A crash occurring mid-simulation (after cold-start) with both protections active was never isolated.

#### Risk C: Adaptive Call Delta × Gap Risk (Severity: Low-Medium)

**What:** `AdaptiveCallRule` computes call delta as a linear interpolation of PnL: `baseDelta = minDelta + (maxDelta - minDelta) × clamp((pnlPct + 1) / 2, 0, 1)`. At −50% PnL → delta = minDelta (protect). At breakeven → delta = midpoint. At +100% PnL → delta = maxDelta (collect more).

**Potential mismatch:** Daily granularity means the adaptive delta only adjusts once per day. In real markets, ETH can gap 10–15% overnight (e.g., regulatory announcements, exchange events). A holding position that's +20% at close could be −5% at open. The adaptive delta computed on the previous snapshot is stale for up to 24 hours.

More critically, the call strike is set at sale time based on the adaptive delta and doesn't adjust afterward. If ETH surges 15% overnight:
- Call goes deep ITM → `RollCallRule` triggers next day
- But the one-day delay means the position was unprotected during the surge
- In simulation, smooth GBM paths make this invisible; in reality, gap risk is meaningful

**Not caught because:** Conservative's adaptive calls use δ0.10–0.50 with gradual PnL-based scaling. The daily delay matters most for Active (short cycles, volatile), but Active doesn't use adaptive calls (RF only). So the gap risk is real but may be moot for the shipped presets.

#### Risk D: Cold-Start × Regime Filter Overlap (Severity: Low, mostly resolved for shipped presets)

**What:** When `computeRealizedVol()` returns `undefined` for days < lookback, `computeIVRVMultiplier()` returns 1.0 (bypass the filter entirely). In configs that also rely on cold-start sizing, this creates an initialization window where both vol-scaling and the IV/RV admission filter are partially degraded.

**Potential mismatch:** The initialization window can admit trades that the regime filter would normally reject once RV history exists. The cold-start cap limits notional, but trade admission logic is still looser than steady-state behavior.

**Why this is mostly resolved:** Exp 22-23 explicitly added a cold-start cap to the shipped Conservative preset, and the rolling/full-period validations passed with that configuration. So this is no longer a material open risk for the shipped ETH Conservative preset; it remains an implementation caveat for custom configs or any setup with long RV lookbacks and no separate admission guard.

**Mitigant:** In practice, the cold-start period is also when vol-scaling is computing its initial RV (same lookback). Both protections are degraded simultaneously, but the cold-start cap provides a hard ceiling regardless.

#### Risk E: Premium Timing + No Open-Option MTM (Severity: Medium)

**What:** Premium is credited to `realizedPL` immediately on sale (day 0 of the option). The engine also never marks the short option to market during its life — only on expiry/roll events. `dailyStates` reflect held-ETH unrealized P/L, but not open short-option unrealized P/L.

**Potential mismatch:** Between sale and expiry, a short put deepening ITM or a short call blowing through the strike can become materially more expensive, but the daily equity path does not reflect that until the terminal event. This can understate intracycle drawdowns, smooth daily returns, and overstate Sharpe/Sortino, especially for high-frequency strategies like Active.

**Not caught because:** All historical backtests and rolling-window validations inherit the same accounting model. Real-data validation removes model-generation risk but not this path-accounting simplification. Final P/L is still directionally correct at expiry, but path-dependent risk metrics are likely optimistic.

### Summary: Are There Other Rank-Reversal Risks?

**Reversal risks already caught and resolved:**
All 7 confirmed sim-vs-reality discrepancies (table above) were identified by the research arc. The most dangerous (full rank reversal, Moderate blow-up, drift immunity falsification) were caught by the real-data pivot at Exp 18. The final shipped presets (Conservative + Aggressive with VS sizing) are validated on 17 rolling windows of real data, not simulation.

**Remaining uncaught risks that could cause a rank reversal in the future:**
1. **Put rolling during ARCH-clustered vol** (Risk A) — could degrade Conservative's edge in a crash regime different from 2021–2026. Not quantified.
2. **Open-option MTM omission** (Risk E) — could understate path risk, especially for Active, even when final ranking remains unchanged.
3. **Cross-asset strategy selection** (Exp 24) — Conservative dominates ETH but is tied on BTC. Better treated as a scope/generalization caveat than a pure sim-vs-reality mismatch.

**Risks that cannot cause a rank reversal:**
- OU model smoothness, MaxDD underestimation, cost model optimism — all bypassed by real-data validation.
- Daily granularity — primarily affects Active, not Conservative. Conservative's ranking appears robust to this in the available real-data tests.
- Staking yield omission — inflates all alpha by ~3–5%/year uniformly, doesn't change rankings.

### Verdict

The Exp 18 rank reversal was the most consequential sim-vs-reality failure in the project. Its root cause (ARCH clustering → assignment cascades → Active's advantage evaporates) is structural and cannot be fixed within the OU framework. The research methodology correctly self-corrected by pivoting to real-data validation (Exps 18–27), which removes model-generation uncertainty but does **not** eliminate engine-accounting simplifications such as daily granularity, flat execution costs, and missing open-option mark-to-market.

**Three residual risks (A, B, E) were identified but not previously surfaced clearly enough.** Risk A (put rolling during ARCH clustering) remains the most strategy-specific open question for Conservative. Risk E (premium timing + no option MTM) is the most important accounting caveat because it can make path-based risk metrics look better than they are. Their practical impact is bounded by the real-data evidence, but they are not fully neutralized by it.

**No additional rank-reversal risks were found that would change the shipped preset recommendations.** The Conservative > Aggressive ranking on ETH is supported by 17 rolling windows of real data with position sizing, walk-forward validation, bear-market stress tests, and cost sensitivity analysis. That evidence is strong enough to survive the remaining engine simplifications, even though it is not literally independent of them.

</details>

---

## Part B — Research Integrity Audit
> *"Were the experiments run correctly and conclusions sound?"*

### Session 3

- [x] **4. Experiment environment consistency** — Verify that all sweeps used consistent baseline assumptions (same PRNG seeding, same default params, same number of MC runs) so results are comparable across experiments.

<details>
<summary><b>Task 4 Results</b> (filled after Session 3)</summary>

### Environment Consistency Audit

All 27 experiments were audited for consistency of PRNG seeding, MC path counts, strategy assumptions, and data sources. The research program divides cleanly into two phases: **MC-based simulation (Exps 1–15, 17, 21 Phase 2)** and **real-data backtests (Exps 16, 18–27)**.

#### A. PRNG Seeding — Fully Consistent

| Dimension | Value | Verified In |
|---|---|---|
| Algorithm | `splitmix32` | All sweep `.ts` files |
| Seed range | Sequential `1` to `numSims` | `runMonteCarlo()` loop: `for (let seed = 1; seed <= numRuns; seed++)` |
| Determinism | Same seed → identical price + IV paths | Guaranteed by pure function design |
| Cross-sweep reproducibility | Same seed + same vol/drift/model → same prices | Verified: sweeps share `generatePrices()` from `price-gen.ts` |

**Verdict:** ✅ No seeding inconsistencies found. Every MC-based sweep uses identical sequential seeding via the shared `runMonteCarlo()` entry point.

#### B. MC Path Counts — Fully Consistent

| Sweep Group | Paths per Combo | Total Combos | Total Paths |
|---|---|---|---|
| Exps 1–11 | 1,000 | 96–320 | 96K–320K |
| Exps 12–13 | 1,000 | 36–240 | 36K–240K |
| Exps 14–15 | 1,000 | 210–864 | 210K–864K |
| Exp 17 | 1,000 (varies by calibration) | 21 model variants | ~21K+ |
| Exp 21 Phase 2 | 1,000 | 54 combos | 54K |

**No sweep used fewer than 1,000 paths per parameter combination.** Exp 17 uses variable path counts for calibration tasks but the strategy validation runs use 1,000.

#### C. Baseline Parameter Consistency

The sweeps do **not** literally call `defaultMarketValues()` / `defaultStrategyValues()` in most cases. Instead, they usually recreate the same baseline via local `BASE_CONFIG` constants or explicit config builders. The important question is whether the baseline values stay aligned:

| Parameter | Baseline Value | Consistent? | Notes |
|---|---|---|---|
| `startPrice` | 2500 | ✅ All MC sweeps | Real-data sweeps use actual ETH/BTC prices |
| `riskFreeRate` | 5% | ✅ All sweeps | Never overridden |
| `bidAskSpreadPct` | 5% | ✅ All except Exp 13, 27 | Exps 13/27 sweep spread as the independent variable |
| `feePerTrade` | $0.50 | ✅ All except Exp 13, 27 | Exps 13/27 sweep fee as the independent variable |
| `contracts` | 1 | ✅ All sweeps | Never overridden |
| `ivMeanReversion` (κ) | 5.0 | ✅ Exps 1–15 | Exp 17 recalibrated to 5.55 (close match) |
| `ivVolOfVol` (ξ) | 0.5 | ✅ All OU-based | Never overridden |
| `vrpPremiumPct` | 15% | ⚠️ See note | Exps 8, 12, 15 test VRP as variable; Exp 16 found real VRP = 6.35%; Exp 21 Phase 2 uses VRP=6% |
| `numSimulations` | 1000 | ✅ All MC sweeps | |

**Important nuance:** consistency here is achieved by repeated manual copying of the same baseline values, not by a single enforced source of truth. That creates a maintenance risk even though no material drift was found in this audit.

**One notable shift:** After Exp 16 discovered that real ETH VRP averages 6.35% (not the 15% default), Exp 21's Phase 2 MC validation switched to `vrpOffset=0.06`. This is a deliberate calibration improvement, not an inconsistency, and is documented. However, it means **Exps 1–15's MC results were generated under a VRP assumption 2.4× higher than reality**. This was caught and acknowledged — Exp 8 tested VRP=5–25% to prove the framework doesn't require 15%, and Exp 18+ validated on real data.

#### D. Simulation Duration

| Phase | Duration | Sweeps |
|---|---|---|
| Standard | 365 days (1 year) | Exps 1–11 |
| Multi-year | 365, 730, 1825 days | Exps 12–15 |
| Historical | 1,811 days (~4.96 years, 2021-03-24 → 2026-03-09) | Exps 16–27 |

**Cross-sweep comparisons are valid within duration groups.** The research explicitly tests horizon sensitivity (Exp 12) before drawing multi-year conclusions.

#### E. Real-Data Sweeps (Exps 16–27)

| Data Source | Period | Records | Used By |
|---|---|---|---|
| ETH-PERPETUAL + ETH DVOL (Deribit) | 2021-03-24 → 2026-03-09 | 1,812 days | Exps 16–23, 26–27 |
| BTC-PERPETUAL + BTC DVOL (Deribit) | 2021-03-24 → 2026-03-11 | 1,814 days | Exps 24, 26–27 |
| SOL-USDC + SOL DVOL (Deribit) | 2022-05-04 → 2022-11-25 | 206 days ⚠️ | Exp 25 (blocked) |

All real-data sweeps use cached data from `sweep16/data/` (ETH) and `sweep24/data/` (BTC), ensuring identical data across experiments. No data preprocessing differences.

#### F. Strategy Definitions — Consistent After Exp 18

The three strategy archetypes evolved across the research program:

| Strategy | Exp 1–17 (Simulation) | Exp 18+ (Real Data) | Change |
|---|---|---|---|
| Conservative | δ0.10 / 30d / RF+AC+PR | δ0.10 / 30d / s1.1 / lb45 / RF+AC+PR | Lookback refined from 20→45 (Exp 10) |
| Moderate | δ0.20 / 14d / RF | δ0.20 / 14d / s1.3 / lb20 / RF | Skip threshold raised (Exp 17) |
| Active/Aggressive | δ0.20 / 3d / RF | δ0.20 / 3d / s1.2 / lb20 / RF | Renamed "Aggressive" after Exp 18 |

The parameter refinements (lookback, skip threshold) between phases are tracked and justified. Moderate was removed after Exp 18 (blow-up on real data). No undocumented parameter changes.

#### G. Identified Inconsistencies

| # | Issue | Severity | Impact |
|---|---|---|---|
| 1 | **VRP default 15% vs real 6.35%** | Medium | MC-based conclusions (Exps 1–15) are optimistic on absolute returns. Relative rankings unaffected — Exp 8 proved the framework holds at VRP≥5%. Real-data validation (Exps 18–27) is not affected. |
| 2 | **Heston θ computation** | Low | Exp 9 computes `θ = vol²` dynamically; preset default is 0.64 (= 0.8²). Only matters for Heston experiments, which were closed after Exp 11. |
| 3 | **Exp 21 Phase 2 VRP shift** | Low | Phase 2 uses `vrpOffset=0.06` (calibrated) vs earlier sweeps' 15%. Documented and deliberate. |
| 4 | **Defaults are duplicated, not imported** | Low | No inconsistency found in this audit, but future sweeps could drift silently because most scripts use local `BASE_CONFIG` literals rather than preset helpers. |

### Summary Verdict

**The experiment environment is consistent.** All MC-based sweeps share the same PRNG algorithm (splitmix32), seeding strategy (sequential 1–1000), path count (1,000), and baseline parameter values. Parameter overrides are intentional, documented, and appropriate for each experiment's purpose. Real-data sweeps all use the same cached Deribit data files.

The one material observation is that the VRP assumption shifted from 15% (simulation default) to 6.35% (real measured) at Exp 16. This means **absolute Sharpe/APR values from Exps 1–15 cannot be directly compared to Exps 18–27's real-data results** — but relative strategy rankings within each phase are internally consistent, and the VRP sensitivity was explicitly tested (Exp 8) before this gap was discovered.

</details>

- [x] **5. Statistical rigor** — Check whether conclusions were drawn from sufficient sample sizes (number of MC paths, rolling windows) and whether any key findings rest on single-path results or narrow margins.

<details>
<summary><b>Task 5 Results</b> (filled after Session 3)</summary>

### Statistical Rigor Audit

#### A. Sample Size Assessment by Experiment Phase

| Phase | Method | Sample Size | Adequate? |
|---|---|---|---|
| **Exps 1–15** (MC simulation) | 1,000 paths per combo | 1,000 | ✅ Adequate for mean/percentile estimation. CLT gives ~3% relative SE on means. |
| **Exp 16** (IV dynamics) | Real data analysis | 1,812 days | ✅ Adequate for distributional statistics (kurtosis, ACF). Jarque-Bera p≪0.001. |
| **Exp 17** (OU recalibration) | 1,000 paths × 21 model variants | 1,000 per variant | ✅ Adequate for calibration scoring. |
| **Exp 18** (historical backtest) | **1 path** (real data) | **N=1** | ⚠️ **Single-path results — no confidence bounds.** |
| **Exps 19** (parameter optimization) | **1 path × 700 combos** | **N=1 per combo** | ⚠️ **High overfitting risk with 700 combos on 1 path.** Exp 19 explicitly warns about this. |
| **Exps 20–23** (rolling windows) | 17 overlapping windows | **Nominal N=17; effective N < 17** | ⚠️ **Marginal to weak.** Overlap reduces independence, so power is lower than the raw window count suggests. |
| **Exp 24** (BTC validation) | 17 overlapping windows | Nominal N=17; effective N < 17 | ⚠️ Same overlap limitation. |
| **Exp 25** (SOL) | 206 days | **N≈0.5 years** | ❌ **Insufficient.** Acknowledged and experiment blocked. |
| **Exps 26–27** (portfolio/cost) | 17 windows × cost/allocation grid | N=17 per config | ⚠️ Same power limitations. |

#### B. Formal Statistical Tests — Only 4 Comparisons Tested, and All Use Overlapping Windows

The research program performed paired t-tests in only 3 experiments (Exps 20, 24, 26). Results:

| Comparison | t-stat | p-value | ΔSharpe | N | Verdict |
|---|---|---|---|---|---|
| Cons vs Moderate (Exp 20) | **4.68** | **<0.001** | +0.923 | 17 | ✅ **Highly significant** |
| Cons vs Active (Exp 20) | 0.78 | >0.05 | +0.189 | 17 | ❌ **Not significant** |
| Cons vs Aggressive on BTC (Exp 24) | 0.30 | ≫0.05 | +0.075 | 17 | ❌ **Not significant** |
| Portfolio vs Single-Asset (Exp 26) | 0.18 | >0.05 | +0.017 | 17 | ❌ **Not significant** |

**Critical finding: Only one strategy comparison in the entire research program achieves statistical significance** — Conservative dominates Moderate. All other key comparisons (Conservative vs Active/Aggressive, portfolio vs single-asset) have p≫0.05.

**Additional caveat:** these t-stats are computed on **overlapping 365-day windows with 90-day stride**, so the observations are autocorrelated rather than independent. That makes the nominal p-values optimistic. The correct interpretation is directional evidence, not formal significance testing.

#### C. Conclusions Resting on Narrow Margins or Single Paths

##### HIGH CONCERN — Conclusions from N=1 path:

| Conclusion | Source | N | Margin | Risk |
|---|---|---|---|---|
| **"Conservative > Active on ETH"** | Exp 18 full-period | **1 path** | Sharpe 0.517 vs 0.369 | **High** — single path; not confirmed by t-test (p>0.05 in rolling windows) |
| **"Active drift immunity falsified"** | Exp 18 sub-periods | **1 path per sub-period** | Sharpe −0.488 (2022), −0.867 (2025 H1) | **High** — 2 bear periods, both negative, but N=2 |
| **"Moderate is non-viable"** | Exp 18 full-period | **1 path** | Sharpe −0.348, MaxDD 124.7% | **Low risk** — confirmed by Exp 20 (9/17 negative windows, p<0.001 vs Conservative) |
| **Conservative preset is optimal** | Exp 19 best config | **700 combos × 1 path** | Rank 14 of 700 on full period | **Medium** — overfitting risk acknowledged; rolling windows contradicted optimization |

##### MEDIUM CONCERN — Conclusions from N=17 with non-significant tests:

| Conclusion | Source | N | Margin | Risk |
|---|---|---|---|---|
| **"Conservative > Aggressive on ETH"** | Exp 20 rolling | 17 windows | ΔSharpe +0.189, t=0.78, **p>0.05** | **Medium** — consistent directional advantage (10/17 windows) but not statistically significant |
| **"Strategy ranking is asset-dependent (tied on BTC)"** | Exp 24 | 17 windows | ΔSharpe +0.075, t=0.30 | **Medium** — correctly identified as non-significant; conclusion is "tied" not "one wins" |
| **"Portfolio diversification helps"** | Exp 26 | 17 windows | ΔSharpe +0.017, t=0.18 | **High** — portfolio improvement is real for full period (+8.1%) but per-window evidence is noise-level |
| **Exp 19 Cand1 sensitivity** | Exp 19 | 1 path | 1-day rollWhenDTE change: Sharpe 0.517 → 0.179 | **High** — demonstrates extreme path sensitivity with few trades |

##### LOW CONCERN — Conclusions with robust statistical support:

| Conclusion | Source | N | Margin | Risk |
|---|---|---|---|---|
| **Regime filter is universally beneficial** | Exps 4–8 | 1,000 paths × 120+ combos | 100% win rate (120/120 in Exp 8, 72/72 in Exp 7, 432/432 in Exp 15) | **Very low** — overwhelming evidence |
| **Heston breaks the framework** | Exps 9–11 | 1,000 paths × 3 recovery attempts | 0/4 positive for Moderate, 0/4 for Active under Heston | **Very low** — three independent failures |
| **Features don't stack** | Exp 6 | 1,000 paths × 320 combos | Stop-loss: 0 triggers; call rolling: 0 ITM events | **Very low** — zero-event findings are definitive |
| **Cost resilience** | Exps 13, 27 | Exp 13: 1,000 paths; Exp 27: 17 windows | 80/80 combos positive (Exp 27); 40/40 Active (Exp 13) | **Very low** — no zero-crossing at any cost level |

#### D. Missing Statistical Practices

| Practice | Present? | Impact |
|---|---|---|
| **Confidence intervals on MC Sharpe** | ❌ Never computed | Medium — P5/median/mean reported but no formal CIs. With 1,000 paths, 95% CI on mean Sharpe would be ±0.06 (typical), which is narrow enough for most conclusions. |
| **Multiple comparison correction** | ❌ Never applied | Low — Exp 19 tests 700 combos on 1 path, but the top finding isn't treated as definitive (correctly rejected by Exp 20). |
| **Bootstrap CIs on rolling-window means** | ❌ Never computed | Medium — 17-window means have ~±0.25 SE (typical), meaning most strategy comparisons can't distinguish 0.5 from 0.75 Sharpe. |
| **Dependence adjustment for overlapping windows** | ❌ Never applied | **High** — rolling-window t-tests treat heavily overlapping windows as independent, overstating effective sample size. |
| **Effect size reporting** | ⚠️ Partial | Low — ΔSharpe reported extensively but not standardized (e.g., Cohen's d). t-tests provide implicit effect sizes. |
| **Power analysis** | ❌ Never performed | Medium — with independent N=17 and typical SD≈1.0, the minimum detectable ΔSharpe at 80% power is ~0.5. With overlapping windows, the true threshold is worse. |

#### E. Power Analysis: What Could 17 Windows Detect?

Using observed standard deviations from Exp 20 (SD of paired differences ≈ 1.0) and **assuming independence**:

| Significance Level | Power 80% Min ΔSharpe | Power 90% Min ΔSharpe |
|---|---|---|
| α = 0.05 | **~0.51** | **~0.59** |
| α = 0.10 | **~0.43** | **~0.50** |

This means the rolling-window methodology **can only detect strategy differences >0.50 Sharpe even under an optimistic independence assumption**. Because the windows overlap heavily, the true detectable threshold is higher. Observed differences:
- Cons vs Moderate: 0.923 → detectable ✅
- Cons vs Active: 0.189 → **undetectable** ❌
- BTC Cons vs Aggr: 0.075 → **undetectable** ❌
- Portfolio vs Single: 0.017 → **undetectable** ❌

### Summary Verdict

**The MC-based experiments (Exps 1–15) have adequate statistical power.** 1,000 paths per combo, 100% win rates for regime filter, and zero-event findings for dropped features provide overwhelming evidence for their conclusions.

**The real-data experiments (Exps 18–27) have fundamental power limitations:**

1. **Exp 18 (N=1 path)** establishes the rank reversal anecdotally but not statistically. The reversal is directionally convincing (Conservative 0.517 vs Active 0.369) but the margin is within noise.

2. **Exps 20–27 (nominal N=17 overlapping windows)** can detect large effects (Moderate blow-up), but cannot distinguish Conservative from Active/Aggressive. Because the windows overlap, even the reported t-stats overstate the amount of independent evidence. The core shipped conclusion — "Conservative > Aggressive" — **does not reach statistically persuasive significance under this design.**

3. **The research program never computes confidence intervals on MC Sharpe estimates**, though with 1,000 paths the intervals would be narrow enough to support the conclusions drawn.

**Key risk: The shipped preset recommendation (Conservative > Aggressive on ETH) rests on directional evidence from 17 overlapping rolling windows that does not reach robust statistical significance.** The recommendation is not wrong — it's the most consistent direction (10/17 windows) — but it cannot be called "statistically proven." The honest statement is: "Conservative tends to outperform Aggressive on ETH historical data, but the difference is not statistically significant under the available overlapping-window evidence."

</details>

- [x] **6. Circular reasoning check** — Ensure no experiment's parameters were tuned on the same data they were validated on (Exp 19 optimized on real data → Exp 20 validated with rolling windows — was this clean?)

<details>
<summary><b>Task 6 Results</b> (filled after Session 3)</summary>

### Circular Reasoning Audit

#### A. Data Flow Across the Research Arc

The research program has two distinct phases with different data-flow concerns:

**Phase 1 — Simulation (Exps 1–15, 17): Low direct circularity risk.**
These experiments generate synthetic data via PRNG. Parameters were refined iteratively (e.g., lookback tuned in Exp 10, features selected in Exp 6), but each experiment uses freshly generated paths rather than reusing a fixed backtest path. The regime filter threshold (1.2) was discovered in Exp 4 and held constant afterward — not re-optimized on subsequent experiments' exact simulated samples.

**Phase 2 — Real data (Exps 16, 18–27): Circularity risk exists.** All use the same ETH dataset (2021-03-24 → 2026-03-09, 1,812 days from Deribit). The question is whether parameters were tuned and validated on the same data.

#### B. The Exp 19 → Exp 20 Chain (Primary Concern)

| Step | Experiment | Data Used | Action |
|---|---|---|---|
| 1 | **Exp 19** | Full 5yr ETH (1,811 days) | Swept 700 parameter combos; found best config δ0.15/c25/s1.3/lb60 (Sharpe 0.620) |
| 2 | **Exp 20** | Same 5yr ETH (17 × 365d rolling windows) | Tested Exp 19's candidates alongside baseline |

**Is this circular?** Yes, methodologically. Exp 19 optimized on the full 2021–2026 dataset. Exp 20's 17 rolling windows are subsets of the same dataset — no data point in Exp 20 was unseen by Exp 19. This is **in-sample validation**, not out-of-sample testing.

**Exp 20's "walk-forward" claim:** Exp 20 splits its 17 windows into 1st half (windows 1–8) and 2nd half (windows 9–17) and reports stability. This is NOT walk-forward validation in the standard sense — true walk-forward would optimize on windows 1–8 only, then test on windows 9–17 with no re-optimization. Instead, Exp 19 saw all windows simultaneously, and the windows themselves overlap heavily.

**However, the circularity was not harmful because the validation contradicted the optimization:**

| Config | Exp 19 Rank (full-period) | Exp 20 Rolling Mean Sharpe | Outcome |
|---|---|---|---|
| Cons-Cand2 (optimized best) | **#1** (Sharpe 0.620) | 0.611 | ❌ **Rejected** — degraded on rolling windows |
| Cons-Cand1 | #3–5 | 0.747 | ❌ **Rejected** — worse than baseline |
| Cons-Current (unoptimized baseline) | **#14** (Sharpe 0.517) | **0.846** | ✅ **Kept** — best on rolling windows |

The final recommendation kept the **pre-existing baseline** (rank 14 in the optimization), not the optimized winner. This means:
- The optimization overfitted (as Exp 19 explicitly warned)
- The rolling-window test caught the overfitting
- The shipped preset was NOT selected by in-sample optimization

#### C. Other Potential Circular Chains

| Chain | Data Flow | Circular? | Verdict |
|---|---|---|---|
| **Exp 16 → Exp 17** | Exp 16 measured real IV dynamics → Exp 17 recalibrated OU model to match | **No** — Exp 16 is descriptive analysis, not optimization. Exp 17 calibration targets are statistical properties (kurtosis, ACF), not strategy parameters. |
| **Exp 18 → Exp 19** | Exp 18 established Conservative as best → Exp 19 optimized Conservative params | **Mild** — Exp 18's ranking informed which strategy to optimize, but didn't inform parameter values. Acceptable — you must select a strategy to optimize. |
| **Exp 21–22 → Exp 23** | Exp 21 selected VS-40/45 sizing → Exp 22 added cold-start → Exp 23 integrated both | **Yes, same pool** — all use the same 17 rolling windows. Position sizing (VS-40/45) was evaluated on the same data it was selected from. |
| **Exp 23 → Exp 24** | ETH presets (Exp 23) → applied unchanged to BTC (Exp 24) | **No** — BTC is genuinely out-of-sample data (different asset, different IV dynamics), though still same broad crypto regime and time period. This is the closest thing to a clean external validation in the program. |
| **Exp 23 → Exp 27** | Presets from Exp 23 → cost sensitivity on same ETH data | **Mild** — cost sensitivity doesn't re-optimize parameters; it tests robustness of fixed configs under varying friction. The concern is that cost robustness is measured on the same data the presets were developed on. |

#### D. Position Sizing Selection (Exps 21–22)

Exp 21 Phase 1 evaluated 27 sizing variants on 17 rolling windows of ETH data. The best (VS-40/45) was selected and carried into Exp 22 (cold-start), then Exp 23 (final integration). **All three experiments use the same 17 ETH windows.**

This is a tighter circular loop than Exp 19→20 because the sizing mode WAS selected from the validation data (unlike Exp 19's optimization, which was rejected):
- VS-40/45 was chosen **because it performed best on the 17 windows**
- It was then validated **on the same 17 windows** in Exps 22–23
- No out-of-sample sizing test exists except Exp 24 (BTC), which happened to also use VS-40/45

Mitigant: Exp 21 Phase 2 validated VS-40/45 on 1,000 MC paths across multiple vol/drift regimes, providing independent (simulated) evidence that vol-scaling improves MaxDD. The MC validation showed consistent MaxDD reduction across all 54 scenarios.

#### E. The Strongest and Weakest Links

**Strongest out-of-sample evidence:**
- **Exp 24 (BTC):** Presets developed on ETH → applied unchanged to BTC. Conservative and Aggressive both achieve positive rolling Sharpe (1.118, 1.043) and MaxDD < 40%. This is the only cross-asset out-of-sample test. It demonstrates some generalization to a different asset without parameter re-tuning, though BTC is still correlated with ETH and observed over the same macro period.

**Weakest (most circular) evidence:**
- **Position sizing (Exps 21–22):** Selected and validated on the same 17 ETH windows. No parameter was rejected (unlike Exp 19→20 where the optimization was rejected). The conclusion "VS-40/45 is optimal" is only validated in-sample for ETH. Partially mitigated by MC validation (Exp 21 Phase 2) and BTC generalization (Exp 24).

#### F. What True Out-of-Sample Validation Would Look Like

The research program lacks a proper temporal holdout:

```
Optimal: Train on 2021-2023 → Test on 2024-2026 (unseen data)
Actual:  Train on 2021-2026 → Validate on rolling subsets of 2021-2026
```

This is a structural limitation of having only ~5 years of ETH/BTC options data (DVOL starts March 2021). With 17 rolling windows, splitting into 8 train / 9 test would leave each half underpowered.

The BTC cross-asset test (Exp 24) is the closest to true out-of-sample and does support the framework's robustness, albeit on a correlated asset.

### Summary Verdict

**Circular reasoning is present but did not lead to false conclusions:**

1. **Exp 19→20 (parameter optimization):** ⚠️ Circular — same data pool. **But the circularity was caught**: the optimization was rejected in favor of the baseline. The shipped preset is not a product of in-sample optimization.

2. **Exps 21–22 (position sizing):** ⚠️ Circular — VS-40/45 selected and validated on same 17 windows. **Partially mitigated** by MC validation (Phase 2) and BTC generalization (Exp 24).

3. **Exp 23→27 (final validation + cost):** ⚠️ Mild — all use the same ETH data the presets were developed on. Cost robustness is in-sample.

4. **Exp 24 (BTC):** ✅ Clean — genuinely out-of-sample cross-asset test. Strongest single piece of validation evidence.

**The core risk is that the shipped presets have never been tested on truly held-out ETH data.** This is an inherent limitation of the dataset (DVOL only available since March 2021 → ~5 years total). The research compensates with rolling-window stability checks, MC validation, and cross-asset testing, but a temporal holdout remains missing.

**No experiment's conclusions were obviously reversed by circular reasoning.** The most concerning pattern (Exp 19 optimization) was self-correcting. The position sizing selection (Exps 21–22) is the residual area of concern, partially mitigated by MC Phase 2 and the BTC check in Exp 24.

</details>

---

## Part C — Parameter & Strategy Coverage Audit
> *"Did we try everything available?"*

### Session 4

- [x] **7. Final preset justification** — Confirm that the shipped Conservative and Aggressive presets are justified by the full research arc, not just one favorable experiment.

<details>
<summary><b>Task 7 Results</b> (filled after Session 4)</summary>

### Preset Parameter Traceability: Conservative

Each shipped Conservative parameter is traced to its supporting experiment(s) and the weight of evidence is assessed.

| Parameter | Shipped Value | Supporting Experiments | Evidence Type | Strength |
|---|---|---|---|---|
| `targetDelta` | 0.10 | Exps 1–3 (grid search), 6 (feature stack), 18 (real data), 19 (optimization), 20 (rolling validation) | MC grid + real backtest + rolling windows | **Strong** — δ0.10 robust across MC (Exps 1–3: lowest assignment rate, highest Sharpe at high vol) and real data (Exp 18: 11 puts, 9 assignments, 0.517 Sharpe). Exp 19 tested δ0.05–0.15; δ0.10–0.12 optimal region confirmed. Exp 20 rejected δ0.15 candidate (0.611 rolling vs 0.846 current). |
| `cycleLengthDays` | 30 | Exps 1–3 (grid search), 6 (feature stack), 12 (multi-year), 19 (real optimization) | MC grid + multi-year MC + real data | **Strong** — 30d optimal for Conservative in MC (Exps 1–3: longer DTE beats shorter). Exp 19 tested 21–45d and found 21–25d marginally better on single path, but Exp 20 rolling windows rejected the change. Supported by 5+ experiments. |
| `adaptiveCalls` | true | Exp 6 (feature stack) | MC simulation only; real-data effect muted | **Moderate** — Exp 6 showed AC helps Conservative (+0.019 marginal Sharpe) but hurts Moderate/Active. Conservative's AC was never independently ablated on real data. Exp 19 tested RF+AC vs RF-only vs RF+PR vs RF+AC+PR but on N=1 path only. The benefit is small (≤0.02 Sharpe) and not statistically distinguishable from zero on real data. |
| `minCallDelta` | 0.10 | Exp 6 (feature stack, implicit) | MC simulation, fixed value | **Weak** — Never independently swept. Set at δ0.10 to match put delta. Only tested as part of the AC feature toggle (on/off), not as a continuous parameter. |
| `maxCallDelta` | 0.50 | Exp 6 (feature stack, implicit) | MC simulation, fixed value | **Weak** — Never independently swept. Uses the maximum allowed delta. Only tested as part of the AC feature toggle. |
| `skipThresholdPct` | 0 | Exps 1–2 (grid search: 0%, 5%, 10%), 6 (feature combo) | MC grid search | **Moderate** — Exp 1–2 tested 0%, 5%, 10% and found 0% best for Conservative. Not re-validated on real data, but the LowPremiumSkipRule is secondary to the regime filter which dominates trade admission. |
| `minStrikeAtCost` | true | Exp 6 (implicit in AC config) | MC simulation, never independently tested | **Weak** — Never independently toggled. Always bundled with adaptive calls. Prevents selling calls below cost basis — logical protection but no experiment compared true vs false. |
| `ivRvSpread` (regime filter) | true | Exps 4–8 (RF discovery + robustness), 12, 15 (universality), 17 (recalibration), 18–23 (real data) | MC (432/432 wins in Exp 15) + real data | **Very Strong** — Most-tested feature in the program. Wins 100% of MC comparisons across all vol/drift/VRP/horizon/model combinations. Validated on real data (Exps 18–23). Universal benefit. |
| `ivRvLookback` | 45 | Exp 10 (lookback sweep), 19 (real optimization) | MC lookback sweep + real data | **Strong** — Exp 10 tested 7 lookback values (5–60d) and found 45d optimal for Conservative under GBM (+0.025 Sharpe vs 20d). Exp 19 confirmed 60d marginally better on single path but 45d chosen. Two independent lines of evidence. |
| `ivRvSkipBelow` | 1.1 | Exps 4–5 (threshold discovery), 11 (Heston recal), 17 (OU+Jump recal) | MC threshold sweeps + recalibrated model | **Strong** — Exp 4 tested 8 thresholds (0–1.3), Exp 5 refined with skip-side. Exp 17 recalibrated under OU+Jump: Conservative optimal at 1.1 (from 1.0). Three independent calibration rounds. |
| `ivRvSkipSide` | "put" | Exp 5 (put-only filter discovery) | MC comparison: put-only vs both | **Strong** — Exp 5 tested "put" vs "both" across 240 combos. Put-only wins 22/32 for Conservative, 30/32 for Active. Clear directional evidence. |
| `rollPut` | true | Exp 6 (feature stack: +0.020 marginal Sharpe), 18 (real data: 19 rolls in 5yr) | MC feature stack + real data observational | **Moderate** — Exp 6 showed put rolling has small positive marginal effect (+0.020 Sharpe in MC). Exp 18 observed 19 rolls but didn't ablate (no comparison to rollPut=false on real data). The benefit is small and rests primarily on MC evidence. |
| `rollPutInitialDTE` | 30 | Exp 6 (fixed at 30d) | MC simulation, never swept | **Weak** — Set to match cycleLengthDays=30. Never independently varied. Only tested as part of the rollPut on/off toggle. |
| `rollPutWhenBelow` | 14 | Exp 6 (fixed at 14d) | MC simulation, never swept | **Weak** — Fixed at half the cycle length. Never independently varied. Only tested as part of the rollPut toggle. |
| `rollPutRequireCredit` | true | Exp 6 (fixed at true) | MC simulation, never swept | **Weak** — Always true. Never compared true vs false. Logical default (avoid rolls that cost money) but no empirical backing. |
| `sizingMode` | volScaled | Exp 21 (sizing mode comparison), 22 (cold-start), 23 (integration) | Real data rolling windows + MC validation | **Strong** — Exp 21 tested 25 sizing variants (Kelly, TRG, VS) across 17 windows. VS-40/45 was the only effective mode. Exp 21 Phase 2 validated on 54K MC paths across 9 conditions. Exp 22 added cold-start. Exp 23 integrated and validated. |
| `sizingVolTarget` | 40 | Exp 21 (9 VS variants: targets 40–80, lookbacks 20–45) | Real data rolling windows | **Moderate** — Exp 21 tested volTarget ∈ {40, 60, 80} at 3 lookback values. VS-40/45 was best on rolling windows, but selection is from the same 17-window data used for validation (circularity concern from Task 6). Partially mitigated by MC Phase 2 and BTC generalization (Exp 24). |
| `sizingVolLookback` | 45 | Exp 21 (9 VS variants) | Real data rolling windows | **Moderate** — Same circularity concern as volTarget. Tested at 20, 30, 45 days. 45d selected. |
| `sizingMinSize` | 0.10 | Exp 21 (fixed) | Default value, never swept | **Weak** — Set at 0.10 (10% minimum position). Never independently varied — only tested as part of the VS mode. |
| `sizingColdStartDays` | 45 | Exp 22 (cold-start sweep: days ∈ {30, 45, 60, 90}) | Real data rolling windows | **Strong** — Exp 22 tested 16 cold-start combinations. 45d chosen (matches vol-scaling lookback). Clear MaxDD improvement (71.7% → 36.1%). |
| `sizingColdStartSize` | 0.50 | Exp 22 (cold-start sweep: size ∈ {0.10, 0.25, 0.50, 0.75}) | Real data rolling windows | **Moderate** — Exp 22 tested 4 sizes. Smaller is monotonically better for both Sharpe and MaxDD, but 0.50 was chosen over 0.10/0.25 (more conservative recommendation). The optimal is actually 0.10 or 0.25 per the data. |
| `stopLoss` | false | Exp 6 (feature stack: 0 impact) | MC feature stack | **Strong (negative result)** — Exp 6 tested stop-loss across 320 combos. Zero triggers in any simulation (put delta too low for stop-loss to activate). Feature correctly disabled. |
| `rollCall` | false | Exp 6 (feature stack: 0 impact) | MC feature stack | **Strong (negative result)** — Exp 6 tested call rolling across 320 combos. Zero ITM call events at δ0.10–0.20 (calls never go ITM). Feature correctly disabled. |

### Preset Parameter Traceability: Aggressive

| Parameter | Shipped Value | Supporting Experiments | Evidence Type | Strength |
|---|---|---|---|---|
| `targetDelta` | 0.20 | Exps 1–3 (grid), 6 (feature stack), 18 (real data), 20 (rolling) | MC grid + real data + rolling | **Strong** — Defined as "Active" archetype from Exp 1. δ0.20 provides higher trade frequency (168 puts in 5yr on real data). Confirmed viable (0.369 Sharpe) on real data. Rolling-window mean 0.657 Sharpe. |
| `cycleLengthDays` | 3 | Exps 1–3 (grid), 6 (feature stack), 12 (multi-year), 18 (real data) | MC grid + real data | **Strong** — 3d cycle is the "Active" archetype. MC showed drift immunity (Exp 7: positive Sharpe at −30% drift). Real data falsified drift immunity but confirmed viability (Sharpe 0.369). |
| `adaptiveCalls` | false | Exp 6 (feature stack: harmful for Active, −0.231 ΔSharpe) | MC feature stack | **Strong (negative result)** — Exp 6 conclusively showed AC is destructive for Active strategy. Correctly disabled. |
| `ivRvSpread` | true | Same as Conservative | Same as Conservative | **Very Strong** |
| `ivRvSkipBelow` | 1.2 | Exps 4 (threshold discovery), 17 (OU+Jump recal) | MC threshold sweeps | **Strong** — Exp 4 tested 8 thresholds; Active optimal at 1.2. Exp 17 recalibrated: 1.2–1.3 range confirmed. Held at 1.2. |
| `ivRvSkipSide` | "put" | Exp 5 (Active: 30/32 wins for put-only) | MC comparison | **Strong** |
| `rollPut` | false | Exp 6 (feature stack) | MC feature stack | **Moderate** — Put rolling not tested for Active in isolation. Exp 6 tested feature combos and found RF-only is optimal for Active. Disabled by omission rather than explicit evidence. |
| `rollCall` | false | Exp 6 (same reasoning as Conservative) | MC feature stack | **Strong (negative result)** |
| `stopLoss` | false | Exp 6 (same reasoning as Conservative) | MC feature stack | **Strong (negative result)** |
| `sizingMode` | volScaled | Exp 21 (same as Conservative) | Real data + MC | **Strong** |
| `sizingVolTarget` | 40 | Exp 21 | Real data rolling | **Moderate** — Same circularity concern. |
| `sizingVolLookback` | 45 | Exp 21 | Real data rolling | **Moderate** — Same circularity concern. |
| `sizingMinSize` | 0.10 | Exp 21 (fixed) | Default, never swept | **Weak** |
| (No cold-start) | — | Exp 22 (cold-start unnecessary for Active) | Real data | **Strong** — Exp 22 explicitly tested and rejected cold-start for Active (costs 6–22% Sharpe for <2pp MaxDD reduction). |

### Parameters Resting on Single Experiment or Non-Significant Results

**Flagged — Single-Experiment Evidence Only:**

| Parameter | Preset | Supporting Exp | Concern |
|---|---|---|---|
| `minCallDelta` = 0.10 | Conservative | Exp 6 only (MC) | Never swept as continuous variable; set by convention |
| `maxCallDelta` = 0.50 | Conservative | Exp 6 only (MC) | Never swept; uses maximum allowed value |
| `minStrikeAtCost` = true | Conservative | Exp 6 only (MC) | Never independently toggled |
| `rollPutInitialDTE` = 30 | Conservative | Exp 6 only (MC) | Set equal to cycleLengthDays, never independently varied |
| `rollPutWhenBelow` = 14 | Conservative | Exp 6 only (MC) | Fixed at half cycle length, never varied |
| `rollPutRequireCredit` = true | Conservative | Exp 6 only (MC) | Never compared true vs false |
| `sizingMinSize` = 0.10 | Both | Exp 21 (real data, but as fixed default) | Never independently swept |

**Flagged — Non-Significant Difference on Real Data:**

| Parameter Choice | Concern |
|---|---|
| Conservative > Aggressive ranking | Exp 20 paired t-test: t=0.78, p>0.05. Direction consistent (10/17 windows) but not statistically significant. |
| `adaptiveCalls` = true for Conservative | MC-only benefit (+0.019 Sharpe in Exp 6). Never ablated on real data with statistical power. |
| `rollPut` = true for Conservative | MC-only marginal benefit (+0.020 Sharpe in Exp 6). 19 rolls observed on real data but no ablation study. |

### Overall Justification Verdict

**Well-justified parameters (multi-experiment, cross-validated):**
- `targetDelta`, `cycleLengthDays`, `ivRvSpread`, `ivRvSkipBelow`, `ivRvSkipSide`, `sizingMode`, `sizingColdStartDays` — each supported by 3+ experiments spanning MC and real data.

**Adequately justified (2+ experiments or strong negative results):**
- `skipThresholdPct`, `ivRvLookback`, `rollCall=false`, `stopLoss=false`, `adaptiveCalls=false` (Aggressive), `sizingVolTarget`, `sizingVolLookback`, `sizingColdStartSize` — supported by focused experiments.

**Weakly justified (single experiment or never independently varied):**
- `minCallDelta`, `maxCallDelta`, `minStrikeAtCost`, `rollPutInitialDTE`, `rollPutWhenBelow`, `rollPutRequireCredit`, `sizingMinSize` — set by convention or bundled with feature toggles, never independently tested.

**Not a concern:** The weakly-justified parameters are all secondary parameters (sub-settings of features whose on/off toggle IS well-justified). Their impact is bounded by the containing feature's marginal contribution. For example, `rollPutInitialDTE=30` only matters when `rollPut=true`, and `rollPut`'s total marginal Sharpe contribution is +0.020 — so even if `rollPutInitialDTE` is suboptimal, the maximum damage is ≤0.020 Sharpe.

**The core preset architecture — (δ, cycle, RF threshold, RF side, sizing mode) — is well-supported by the full research arc.** The secondary parameters (call delta range, roll sub-parameters, sizing minimum) are reasonable defaults that were never independently optimized, but their total influence on strategy performance is bounded and small.

</details>

- [x] **8. Strategy parameter sweep completeness** — Verify every configurable parameter was varied in at least one sweep. Identify any parameter that was never independently swept or only tested at its default.

<details>
<summary><b>Task 8 Results</b> (filled after Session 4)</summary>

### Complete Parameter × Sweep Matrix

#### A. Strategy Parameters (`StrategyPresetValues`)

| # | Parameter | Type | Swept In | Values Tested | Default | Status |
|---|---|---|---|---|---|---|
| 1 | `targetDelta` | continuous | Exps 1, 2, 3, 19 | 0.05, 0.08, 0.10, 0.12, 0.15, 0.20, 0.25, 0.30, 0.40 | 0.30 | ✅ **Thoroughly swept** |
| 2 | `cycleLengthDays` | continuous | Exps 1, 2, 19 | 3, 7, 14, 21, 25, 30, 35, 45 | 7 | ✅ **Thoroughly swept** |
| 3 | `contracts` | integer | — | Only tested at 1 | 1 | ⚠️ **Never swept** — always 1. Multi-contract effects (liquidity, slippage scaling) untested. |
| 4 | `adaptiveCalls` | boolean | Exp 6 | on/off across 320 combos | true | ✅ **Swept as feature toggle** |
| 5 | `minCallDelta` | continuous | — | Only tested at 0.10 | 0.10 | ❌ **Never swept** |
| 6 | `maxCallDelta` | continuous | — | Only tested at 0.50 | 0.50 | ❌ **Never swept** |
| 7 | `skipThresholdPct` | continuous | Exps 1, 2 | 0%, 5%, 10% | 0.1 | ✅ **Swept** (3 levels in MC) |
| 8 | `minStrikeAtCost` | boolean | — | Only tested at true | true | ❌ **Never toggled** |
| 9 | `ivRvSpread` | boolean | Exps 4–8, 10–15, 17 | on/off in 600+ combos | true | ✅ **Most-tested parameter** |
| 10 | `ivRvLookback` | continuous | Exp 10 | 5, 10, 15, 20, 30, 45, 60 | 20 | ✅ **Thoroughly swept** (7 levels) |
| 11 | `ivRvMinMult` | continuous | — | Only tested at 0.8 | 0.8 | ❌ **Never swept** |
| 12 | `ivRvMaxMult` | continuous | — | Only tested at 1.3 | 1.3 | ❌ **Never swept** |
| 13 | `ivRvSkipBelow` | continuous | Exps 4, 5, 11, 17, 19 | 0, 0.80, 0.90, 1.00, 1.05, 1.10, 1.15, 1.20, 1.30, 1.50, 2.0 | 0 | ✅ **Thoroughly swept** (11+ levels) |
| 14 | `ivRvSkipSide` | enum | Exp 5 | "both", "put" | "put" | ✅ **Swept** (2 values across 240 combos) |
| 15 | `rollCall` | boolean | Exp 6 | on/off across 320 combos | false | ✅ **Swept as feature toggle** |
| 16 | `rollITMThreshold` | continuous | — | Only tested at 5% | 5 | ❌ **Never swept** |
| 17 | `rollRequireCredit` | boolean | — | Only tested at true | true | ❌ **Never toggled** |
| 18 | `rollPut` | boolean | Exp 6 | on/off across 320 combos | false | ✅ **Swept as feature toggle** |
| 19 | `rollPutInitialDTE` | continuous | — | Only tested at 30 | 30 | ❌ **Never swept** |
| 20 | `rollPutWhenBelow` | continuous | — | Only tested at 14 | 14 | ❌ **Never swept** |
| 21 | `rollPutRequireCredit` | boolean | — | Only tested at true | true | ❌ **Never toggled** |
| 22 | `stopLoss` | boolean | Exp 6 | on/off across 320 combos | false | ✅ **Swept as feature toggle** |
| 23 | `stopLossDrawdown` | continuous | — | Only tested at 25% (Exp 6) / 30% (default) | 30 | ❌ **Never swept** (tested at single non-default value) |
| 24 | `stopLossCooldown` | continuous | — | Only tested at 7 | 7 | ❌ **Never swept** |
| 25 | `sizingMode` | enum | Exp 21 | none, fractionalKelly, trailingReturn, volScaled | "none" | ✅ **Swept** (4 modes, 25 variants) |
| 26 | `sizingVolTarget` | continuous | Exp 21 | 40, 60, 80 | 40 | ✅ **Swept** (3 levels) |
| 27 | `sizingVolLookback` | continuous | Exp 21 | 20, 30, 45 | 45 | ✅ **Swept** (3 levels) |
| 28 | `sizingMinSize` | continuous | — | Only tested at 0.10 | 0.10 | ❌ **Never swept** |
| 29 | `sizingColdStartDays` | continuous | Exp 22 | 0, 30, 45, 60, 90 | 0 | ✅ **Swept** (5 levels) |
| 30 | `sizingColdStartSize` | continuous | Exp 22 | 0.10, 0.25, 0.50, 0.75 | 1.0 | ✅ **Swept** (4 levels) |

#### B. Market Parameters (`MarketPresetValues`)

| # | Parameter | Swept In | Values Tested | Default | Status |
|---|---|---|---|---|---|
| 1 | `startPrice` | — | Only 2500 (MC) or real prices | 2500 | ⚠️ **Never independently swept** — not expected to matter for normalized metrics |
| 2 | `days` | Exps 12, 15 | 365, 730, 1825 | 365 | ✅ **Swept** |
| 3 | `annualVol` | Exps 1–5, 7–8, 10, 15 | 25–155% in fine increments | 80 | ✅ **Thoroughly swept** |
| 4 | `annualDrift` | Exps 7, 8 | −30%, −10%, 0%, +5%, +20%, +50% | 0 | ✅ **Swept** (6 levels) |
| 5 | `numSimulations` | — | Only 1000 | 1000 | ⚠️ **Never varied** — always 1000 paths |
| 6 | `model` | Exps 1, 9 | gbm, heston, jump, heston-jump | gbm | ✅ **Swept** (4 models) |
| 7 | `kappa` (Heston) | — | Only 2.0 | 2.0 | ⚠️ **Never swept** — Heston was dropped |
| 8 | `theta` (Heston) | Exp 9 | Computed as vol² dynamically | 0.64 | ⚠️ **Indirectly varied via vol** |
| 9 | `sigma` (Heston) | — | Only 0.5 | 0.5 | ⚠️ **Never swept** — Heston dropped |
| 10 | `rho` (Heston) | — | −0.7, −0.8 only | −0.7 | ⚠️ **Never swept** — Heston dropped |
| 11 | `lambda` (Jump) | Exp 17 | 5, 10, 15, 20, 30 | 10 | ✅ **Swept** (5 levels, OU+Jump calibration) |
| 12 | `muJ` (Jump) | — | Only 0 | 0 | ❌ **Never swept** |
| 13 | `sigmaJ` (Jump) | Exp 17 | 0.05, 0.08, 0.10, 0.15, 0.20 | 0.05 | ✅ **Swept** (5 levels) |
| 14 | `riskFreeRate` | — | Only 5% | 5 | ❌ **Never swept** |
| 15 | `bidAskSpreadPct` | Exps 13, 27 | 1%, 3%, 5%, 8%, 12% | 5 | ✅ **Swept** (5 levels, MC + real data) |
| 16 | `feePerTrade` | Exps 13, 27 | $0.25, $0.50, $1.00, $2.00 | 0.50 | ✅ **Swept** (4 levels) |
| 17 | `ivMeanReversion` (κ) | Exp 16 (measured), 17 (calibrated) | 5.0, 5.55 | 5.0 | ⚠️ **Measured but not swept** as independent variable |
| 18 | `ivVolOfVol` (ξ) | Exp 17 | 0.50, 0.75, 1.00, 1.50, 2.00, 3.00 | 0.5 | ✅ **Swept** (6 levels) |
| 19 | `vrpPremiumPct` | Exp 8 | 0%, 5%, 10%, 15%, 25% | 15 | ✅ **Swept** (5 levels) |

#### C. Summary Statistics

| Category | Total Parameters | Swept (≥2 values) | Never Swept | Coverage |
|---|---|---|---|---|
| **Strategy params** | 30 | 17 | 13 | **57%** |
| **Market params** | 19 | 12 | 7 | **63%** |
| **Total** | 49 | 29 | 20 | **59%** |

#### D. Never-Swept Parameters — Risk Assessment

**High-priority gaps (parameters that could meaningfully affect shipped preset performance):**

| Parameter | Why It Matters | Risk if Suboptimal |
|---|---|---|
| `ivRvMinMult` (0.8) | Scales effective delta down when IV/RV is low. Could clip premium too aggressively or too little. | Low-Medium — the regime filter skip (ivRvSkipBelow) dominates admission; the multiplier only affects trades that pass the skip filter. Range is 0.8–1.0, so maximum delta reduction is 20%. |
| `ivRvMaxMult` (1.3) | Scales effective delta up when IV/RV is high. Could cause over-aggressive delta in vol spikes. | Low-Medium — capped at 0.50 by the `Math.min(effectiveDelta, 0.50)` guard. At Conservative's δ0.10, 1.3× gives 0.13 — modest. At Aggressive's δ0.20, gives 0.26 — still moderate. |
| `contracts` (1) | Multi-contract positions face liquidity/slippage effects not modeled. | Low for current deployment (1-contract cash-secured wheel). Would matter for scaling. |
| `riskFreeRate` (5%) | Affects BS pricing, especially for longer-dated options. Fed funds rate has varied 0–5.5% during backtest period. | Low — BS rho is small for short-dated crypto options. Task 1 rated this as Low severity. |

**Low-priority gaps (parameters for features that are disabled or have near-zero impact):**

| Parameter | Why Low Priority |
|---|---|
| `minCallDelta`, `maxCallDelta` | AC's marginal contribution is +0.019 Sharpe. Even if these are suboptimal, maximum impact is bounded by AC's total contribution. |
| `minStrikeAtCost` | Only affects calls when position is underwater. Logical protective default. |
| `rollITMThreshold`, `rollRequireCredit` | Call rolling has zero impact (Exp 6: 0 ITM call events). Parameters are moot. |
| `rollPutInitialDTE`, `rollPutWhenBelow`, `rollPutRequireCredit` | Put rolling's marginal contribution is +0.020 Sharpe. Sub-parameter optimization bounded by this. |
| `stopLossDrawdown`, `stopLossCooldown` | Stop-loss is disabled (0 triggers in Exp 6). Parameters are moot. |
| `sizingMinSize` | Floor on position size. At 0.10, ensures minimum 10% allocation. Reasonable default. |

### Verdict

**17 of 30 strategy parameters were independently swept.** The 13 unswept parameters fall into two categories:

1. **Sub-parameters of feature toggles** (10/13): Parameters like `rollPutInitialDTE` that only matter when their parent feature is enabled. The parent toggle (on/off) WAS tested, and the feature's total marginal contribution is small (≤0.020 Sharpe). Sweeping sub-parameters would optimistically find an additional ~0.005–0.010 Sharpe improvement, bounded by the feature's total contribution.

2. **Regime filter multiplier bounds** (2/13): `ivRvMinMult` and `ivRvMaxMult` control delta scaling within the regime filter. These were always tested at [0.8, 1.3] and never varied. They have a plausible but bounded impact — the skip filter dominates trade admission, and the multiplier only adjusts delta for trades that pass the filter.

3. **Position sizing floor** (1/13): `sizingMinSize = 0.10` was never varied. Impact is bounded — only matters when vol-scaling would suggest <10% allocation.

**No obviously critical shipped parameter was overlooked.** The five core strategy parameters (delta, cycle, RF threshold, RF side, sizing mode) and all feature toggles were swept. The gaps are in secondary sub-parameters whose total influence is bounded by their parent feature's marginal contribution.

</details>

- [x] **9. Untested parameter interactions** — Check for meaningful 2-way interactions between parameters that were never tested together (e.g., rollCall + rollPut combined, stop-loss + position sizing, adaptive calls + put rolling).

<details>
<summary><b>Task 9 Results</b> (filled after Session 4)</summary>

### 2-Way Feature Interaction Matrix

The engine has 6 toggleable features: Regime Filter (RF), Adaptive Calls (AC), Put Rolling (PR), Call Rolling (CR), Stop-Loss (SL), and Position Sizing (PS). This gives 15 possible 2-way interactions.

#### A. Interaction Coverage from Exp 6 (Feature Stack)

Exp 6 tested all 2^5 = 32 combinations of {RF, AC, PR, CR, SL} across 4 vol levels × 3 strategies = 320 combos. This covers all 10 pairwise interactions among the first 5 features **in MC simulation only**:

| Interaction | Tested in Exp 6? | Effect Found | Tested on Real Data? |
|---|---|---|---|
| RF × AC | ✅ Yes | **Conflict** — AC hurts Active (−0.231) | ❌ Never ablated on real data |
| RF × PR | ✅ Yes | **Synergy** — +0.019–0.041 (Conservative) | ❌ Never ablated on real data |
| RF × CR | ✅ Yes | **Neutral** — CR has 0 impact | ❌ Not needed (CR inert) |
| RF × SL | ✅ Yes | **Neutral** — SL has 0 impact | ❌ Not needed (SL inert) |
| AC × PR | ✅ Yes | **Tested but not highlighted** | ❌ Never ablated on real data |
| AC × CR | ✅ Yes | **Neutral** — CR inert | ❌ Not needed |
| AC × SL | ✅ Yes | **Neutral** — SL inert | ❌ Not needed |
| PR × CR | ✅ Yes | **Neutral** — CR inert | ❌ Not needed |
| PR × SL | ✅ Yes | **Neutral** — SL inert | ❌ Not needed |
| CR × SL | ✅ Yes | **Both inert** | ❌ Not needed |

#### B. Position Sizing Interactions (Exp 21+)

Position sizing (PS) was introduced in Exp 21, AFTER the feature stack experiment (Exp 6). PS was only combined with the "winning" feature set from Exp 6 — never tested in factorial combination with individual features:

| Interaction | Tested? | Notes |
|---|---|---|
| PS × RF | ⚠️ **Implicitly only** — RF is always ON in Exps 21–23. Never tested PS with RF OFF. | PS's benefit might differ without RF's trade admission filter. |
| PS × AC | ⚠️ **Implicitly only** — AC is ON for Conservative, OFF for Aggressive. Never independently toggled. | |
| PS × PR | ⚠️ **Implicitly only** — PR is ON for Conservative, OFF for Aggressive. | |
| PS × CR | ❌ **Never tested** — CR always OFF. | Not needed (CR inert). |
| PS × SL | ❌ **Never tested** — SL always OFF. | Potentially meaningful — both are drawdown-reduction mechanisms. |

#### C. Untested Meaningful Interactions

##### Priority 1 — Potentially significant, never tested on real data:

| # | Interaction | Why It Could Matter | Risk |
|---|---|---|---|
| 1 | **RF × AC on real data** | Exp 6 showed RF+AC conflict for Active (−0.231 Sharpe in MC). For Conservative, AC adds +0.019. But on real data with ARCH clustering, the interaction could differ — AC's PnL-based delta scaling interacts with the regime filter's trade admission differently when IV clusters. Exp 19 tested RF-only vs RF+AC+PR on N=1 path but never on rolling windows. | **Medium** — AC's total contribution is +0.019 Sharpe; even if the interaction behaves differently on real data, the impact is bounded. |
| 2 | **RF × PR on real data** | Exp 6 synergy (+0.019–0.041) was in MC. On real data, put rolling during ARCH-clustered vol (Task 3, Risk A) could create issues — the regime filter admits the original trade, and the roll inherits that admission without re-checking. The interaction between RF admitting a trade and PR extending it into a volatile period was never isolated on real data. | **Medium** — Task 3 identified this as Risk A. Conservative's 19 real-data rolls went well, but N=1 path. |
| 3 | **PS × RF** | Vol-scaling and regime filter are both "protective" mechanisms that can interact redundantly (Task 3, Risk B). Post-crash, both trigger simultaneously: RF skips trades (high RV spikes IV/RV down), and PS shrinks position (high RV lowers multiplier). Never tested: (a) PS alone without RF, (b) RF alone without PS. The double protection might be overly conservative, missing profitable re-entry opportunities. | **Low-Medium** — Redundancy is conservative (safe), not optimistic. Over-protection costs missed premium but doesn't increase risk. |
| 4 | **PS × SL** | Both reduce drawdown. With PS active (MaxDD ~37%), stop-loss at 30% drawdown might now trigger occasionally — unlike in Exp 6 where unsized positions at δ0.10 never reached 25% drawdown. The interaction could conflict: stop-loss sells ETH at a loss, then PS re-enters with a smaller position in the recovery. | **Low** — SL is disabled in shipped presets. Would matter only if users enable it manually. |

##### Priority 2 — Lower significance, academic interest:

| # | Interaction | Why It's Lower Priority |
|---|---|---|
| 5 | **δ × ivRvSkipBelow joint optimization** | Exp 19 swept both but not factorially (700 combos, not full grid). Higher delta with higher skip threshold could change the optimal balance — more aggressive puts filtered more strictly. Partially tested but the interaction term was never isolated. |
| 6 | **cycleLengthDays × ivRvLookback** | Both affect temporal scale. Short cycles (3d) with long lookback (60d) might have stale signals. Never explicitly tested — Exp 10 tested lookback at fixed cycle lengths, Exps 1–2 tested cycles at fixed lookback (20d). |
| 7 | **sizingVolTarget × sizingVolLookback** | Exp 21 tested a 3×3 grid (volTarget × volLookback) but only 9 combos. The interaction surface is sparsely sampled. |
| 8 | **coldStartDays × coldStartSize × sizingVolLookback** | Exp 22 tested coldStart parameters with fixed VS-40/45. The triple interaction (cold-start duration, cold-start size, vol-scaling lookback) was never explored — e.g., would a longer vol lookback reduce the need for cold-start protection? |

#### D. Interactions Tested in Exp 6 That Were Never Revisited on Real Data

**All 10 pairwise interactions among {RF, AC, PR, CR, SL} were tested exhaustively in MC (Exp 6) but NONE were independently ablated on real data.** The real-data experiments (18–27) used fixed feature sets:

- Conservative: RF + AC + PR (always together)
- Aggressive: RF only (always alone)

The real-data evidence treats each feature set as a monolithic bundle. The individual feature contributions observed in MC (Exp 6) were assumed to transfer to real data, but this was never verified because:
1. Real data has ARCH clustering (MC doesn't)
2. The regime filter's skip behavior differs on real data (81% Active vs 95% MC)
3. Put rolling's interaction with clustered vol regimes wasn't captured in MC

**Specific real-data ablations that were never performed:**

| Ablation | What It Would Test | Why It Matters |
|---|---|---|
| Conservative with RF only (no AC, no PR) | Whether AC and PR add anything on real data | AC adds +0.019, PR adds +0.020 in MC — together ~0.04 Sharpe. Real-data contribution unknown. |
| Conservative with RF + AC (no PR) | PR's real-data contribution | 19 rolls in 5yr; contribution could be positive or negative with ARCH clustering. |
| Conservative with RF + PR (no AC) | AC's real-data contribution | AC was harmful for Active in MC; might also be moot for Conservative on real data. |
| Aggressive with RF + PR | Whether PR helps Aggressive on real data | Exp 6 didn't find PR beneficial for Active in MC, but 3d cycles with rolling would behave differently. |

#### E. Interactions from Exp 6 — What Was Dropped and Why

Exp 6's key findings that shaped the shipped presets:

| Feature Combo | Exp 6 Finding | Dropped/Kept? | Ever Revisited? |
|---|---|---|---|
| RF + AC (Active) | **Severe conflict** (−0.231 Sharpe) | Dropped: AC disabled for Active/Aggressive | ❌ Never re-tested on real data or with position sizing |
| RF + SL | **SL inert** (0 triggers at δ0.10–0.20) | Dropped: SL disabled | ❌ Never re-tested with sizing (which changes position dynamics) |
| RF + CR | **CR inert** (0 ITM events) | Dropped: CR disabled | ❌ No reason to revisit (structural zero) |
| AC + PR (Conservative) | **Tested in Exp 6 combo** | Kept together | ❌ Never isolated on real data |
| RF + AC + PR (Conservative) | **Best combo for Conservative** | Kept: shipped preset | ❌ Never ablated on real data |

### Verdict

**Exp 6 provided comprehensive factorial coverage of 5-feature interactions in MC simulation**, resulting in the correct identification of feature conflicts (AC hurts Active) and inert features (CR, SL). The feature selections that emerged from Exp 6 are well-supported within the MC framework.

**The critical gap is that no feature interaction was independently tested on real data.** All real-data experiments used the Exp 6 winning combos as monolithic bundles. Given the known ARCH clustering gap between MC and reality (Tasks 1–3), some interaction effects could differ on real data — particularly RF × PR (put rolling during clustered vol) and PS × RF (redundant protection).

**The practical risk is bounded:** The total marginal contribution of AC + PR for Conservative is ~0.04 Sharpe in MC. Even if these features are neutral or slightly negative on real data, the worst outcome is that Conservative's Sharpe drops from ~0.85 to ~0.81 (rolling-window mean), which is still viable. There is no plausible interaction that would reverse the Conservative > Aggressive ranking or make either preset non-viable.

**Three interactions warrant future investigation if more data becomes available:**
1. RF × PR on real data (put rolling during ARCH clustering) — Task 3's Risk A
2. PS × RF interaction (redundant protection mechanism) — Task 3's Risk B
3. Conservative RF-only ablation (simplest viable version)

</details>

- [x] **10. Unexplored strategy ideas** — Identify any strategy mechanisms that could be added given the existing engine architecture but weren't tried (e.g., the planned TrendFilterRule, IVRankDeltaRule, gamma-aware sizing, or alternative delta-scaling functions).

<details>
<summary><b>Task 10 Results</b> (filled after Session 4)</summary>

### Engine Capability Surface vs. Explored Strategy Space

#### A. Existing Engine Architecture — What It Can Express

The engine's `StrategyConfig` type and rule system support a specific set of trade decisions:

1. **Trade admission**: Per-cycle IV/RV ratio check (regime filter) → skip or proceed
2. **Put strike selection**: Delta-targeted, with IV/RV multiplier scaling and optional minStrikeAtCost
3. **Call strike selection**: Adaptive (PnL-based delta interpolation) or fixed delta, with IV/RV scaling
4. **Put rolling**: DTE-triggered, OTM-conditional, credit-requiring roll to fresh initialDTE
5. **Call rolling**: ITM-threshold-triggered roll up and out
6. **Stop-loss**: Drawdown-triggered ETH liquidation with cooldown
7. **Position sizing**: Vol-scaled (with fractional Kelly and trailing return gates also implemented but inert)
8. **Cycle timing**: Fixed-DTE cycles (no data-driven entry timing)

The rule evaluation pipeline (`defaultRules()`) runs: StopLossCooldown → StopLoss → LowPremiumSkip → BasePut → AdaptiveCall → RollCall → RollPut. Rules have priorities and the first matching signal wins.

#### B. Strategy Ideas — Categorized by Feasibility

##### Category 1: Implementable Within Current Architecture (New Rules or Config Options)

| # | Idea | Description | Architecture Fit | Research Status | Potential Value |
|---|---|---|---|---|---|
| 1 | **Trend Filter Rule** | Skip put-selling when price is below N-day moving average. Prevents entry during confirmed downtrends. | Moderate — new Rule is straightforward, but the current rule API only receives `MarketSnapshot`, not trailing price history. Would need a pre-computed trend field added to `MarketSnapshot` or a broader rule context. | Exp 14 tested deployment signals (VRP threshold, ACF guard) and found them destructive (−0.656 to −0.738 ΔSharpe). However, a simple SMA trend filter was never tested — Exp 14's signals were IV-based, not price-based. | **Medium** — Trend filters are well-studied in systematic trading. Could reduce assignment rate during sustained bears (Conservative's main risk period). However, Exp 14's negative results with signal-based approaches suggest caution. |
| 2 | **IV Rank / IV Percentile Delta Scaling** | Scale delta based on IV rank (current IV's percentile over trailing N days) instead of raw IV/RV ratio. Higher IV rank → more aggressive delta (sell richer premium). | Moderate — requires adding IV history tracking to `MarketSnapshot` or computing in-rule. Currently, rules only see current `market.iv` and `market.realizedVol`. Would need a trailing IV array or pre-computed IV rank field. | Never tested. Current regime filter uses IV/RV ratio — IV rank would be a complementary signal. Exp 16 computed IV percentiles descriptively but never used them for trade decisions. | **Low-Medium** — IV rank and IV/RV ratio are correlated. Conservative already skips 95% of opportunities; adding IV rank would further narrow the trading window. Marginal improvement at best. |
| 3 | **DTE-Adaptive Delta** | Scale target delta based on remaining DTE: higher delta for longer-dated options (more time premium cushion), lower delta for shorter-dated (less time to recover from adverse moves). | Easy — modify `BasePutRule` to compute `effectiveDelta = f(targetDelta, DTE)`. No new infrastructure needed. | Never tested. Current delta is fixed per cycle irrespective of actual DTE (which equals `cycleLengthDays` at put sale and may differ at roll). | **Low** — Conservative uses fixed 30d cycles and rolls at 14d. DTE is always 30d at entry. Only matters for Aggressive (3d cycles) where delta adjustment range would be tiny. |
| 4 | **Gamma-Aware Sizing** | Reduce position size when short option gamma is high (near-ATM, short DTE). Prevents concentrated losses from rapid delta changes. | Moderate — requires computing gamma from BS model (second derivative). The engine has BS infrastructure but doesn't compute gamma. Would need `bsPutGamma()` function + sizing modifier. | Never tested. Position sizing currently uses vol-scaling (realized vol target), not option-specific Greeks. | **Low-Medium** — Conservative's δ0.10 puts are far OTM with low gamma. Aggressive's δ0.20 has moderate gamma. VS-40/45 already achieves <40% MaxDD through vol-based sizing, which implicitly captures some of the same information (high vol → high gamma → smaller position). |
| 5 | **Regime Filter Re-Evaluation at Roll** | Re-check IV/RV ratio when rolling a put, not just at initial trade entry. Currently, a put admitted by the regime filter can be rolled indefinitely without re-checking market conditions. | Easy — add `computeIVRVMultiplier()` check inside `RollPutRule.evaluate()`. Return null (skip roll → let put expire) if IV/RV below threshold. | Never tested. Task 3 identified this as Risk A — put rolls during ARCH-clustered vol inherit the original admission without re-checking. Conservative's 19 rolls in 5 years all went well, but the exposure is theoretically present. | **Medium** — Addresses a known theoretical risk (Task 3, Risk A). Implementation is trivial. However, the empirical evidence (19/19 successful rolls) suggests the risk is low in practice. |
| 6 | **Calendar Spread Logic** | Instead of selling naked short puts, sell a put spread (short near-term, long far-term) to cap downside. | Hard — requires multi-leg option tracking. Current `OpenOption` only holds one option per phase. Would need `OpenOption[]` or a new spread type. The executor would need to track and settle two legs independently. | Never tested. Listed implicitly in `improvements-for-later.md` under "put spread protection" — closed as "solved by position sizing." | **Low** — VS-40/45 + cold-start already achieves <40% MaxDD. Calendar spreads add complexity (two legs, two expirations, potential assignment on short leg) for a problem already solved. |
| 7 | **Conditional Call Skipping Beyond LowPremiumSkip** | Skip call selling when spot is significantly below cost basis (deep underwater). Currently, `AdaptiveCallRule` sells calls even when deeply underwater (at `minDelta=0.10`). Skipping calls entirely when deeply underwater avoids capping recovery potential. | Easy — new Rule or modification to `LowPremiumSkipRule` with a PnL-threshold-based skip. | Never tested. The current `skipThresholdPct=0` for Conservative means LowPremiumSkip never triggers. A PnL-based call skip was never explored. | **Low** — Conservative's adaptive calls already scale to δ0.10 when underwater (protecting upside). Complete call skipping might improve recovery in deep drawdowns but sacrifices the small premiums that AC generates. |

##### Category 2: Requires Engine Architecture Changes

| # | Idea | Description | What Would Change | Research Status | Potential Value |
|---|---|---|---|---|---|
| 8 | **Intraday Granularity** | Model intraday prices/decisions to capture gamma risk on 3-day Active cycles. | Major — `simulate()` loop runs daily. Would need sub-daily price paths and decision points. Task 1 flagged daily granularity as Medium severity for Active. | Never tested. Engine fundamentally operates on daily snapshots. | **Medium for Active only** — Task 1 identified this as potentially material for Active's 3d cycles. Conservative's 30d cycles are adequately modeled at daily granularity. |
| 9 | **Open-Option Mark-to-Market** | Track unrealized P/L of short options between entry and expiry/roll. | Moderate — `DailyState.unrealizedPL` currently only reflects ETH spot position, not open option value. Would need daily BS re-pricing of `openOption`. Task 3 identified this as Risk E. | Never implemented. All experiments inherit the same accounting simplification. | **Medium** — Improves path-based risk metrics (MaxDD, Sharpe) accuracy. Doesn't change trade decisions but could reveal that true intra-cycle drawdowns are worse than reported. |
| 10 | **Multi-Contract / Partial Execution** | Support positions >1 contract with independent legs, partial fills, and liquidity-dependent execution. | Major — `PortfolioState` tracks a single position. Would need portfolio-level tracking, per-leg P/L, and execution model overhaul. | `contracts` parameter exists but only scales linearly. No liquidity modeling. | **Low for current scope** — Shipped presets use 1 contract. Multi-contract would matter for institutional deployment but is out of scope. |
| 11 | **IV Surface / Smile Modeling** | Use strike-specific IV instead of flat ATM IV for option pricing. | Major — `generateIVPath()` produces a single IV per day. Would need a full volatility surface model (strike, tenor dimensions). | Task 2 noted this as a pessimistic bias (OTM put premiums likely higher in reality due to put skew). Exp 16 used DVOL (ATM-like single IV). | **Medium** — Would improve premium estimation accuracy. Real-data backtests partially bypass this (use real DVOL at point of trade), but the flat IV still affects BS pricing at the traded strike. |
| 12 | **State-Dependent Bid-Ask Spread** | Model wider spreads during high-vol periods and narrower spreads in calm markets. | Easy-Moderate — replace `config.bidAskSpreadPct` with a function of IV or RV. Would need spread model calibration. | Task 1 noted flat spread as Medium severity (partially self-canceling). Exps 13, 27 tested spread sensitivity but always uniform. | **Low-Medium** — Self-canceling effect (wider in vol → conservative; narrower in calm → optimistic). Net direction unclear without calibration to real Deribit order-book data. |

##### Category 3: Documented and Closed in `improvements-for-later.md`

These ideas were explicitly assessed against the research program and closed:

| Idea | Closure Reason |
|---|---|
| Put spread / naked put protection | Solved by VS-40/45 + cold-start (Exps 21–22) |
| Event-aware cycle skipping | Superseded by regime filter (Exps 4–5). Exp 14 proved additional signals destructive |
| Collar strategy when underwater | Solved by position sizing |
| Trend-based call skipping | Implemented as Adaptive Calls (Exp 6) |
| Portfolio-level delta management | Requires multi-contract engine (out of scope) |
| Staggered covered calls | Call rolling has zero impact (Exp 6); staggering zero-impact calls is pointless |
| Assignment cost averaging | Contradicts research (Conservative wins by minimizing assignments) |
| IV skew awareness | Needs strike-level data; Conservative's 11 trades make optimization noise |
| Vol term structure | Would improve MC realism but research pivoted to real data (Exps 18+) |
| Greeks evolution over time | Pure visualization, no strategy impact |
| Capital efficiency tracking | Analytics metric, not strategy improvement |

### Summary: What Was Explored vs. What's Possible

**Strategy space explored:**
- Core parameters: delta (9 values), cycle (8 values), lookback (7 values), skip threshold (11 values), skip side (2 values)
- Feature toggles: RF, AC, PR, CR, SL — all 32 combos
- Position sizing: 3 modes, 25 variants
- Execution costs: 5 spreads × 4 fees
- Assets: ETH (primary), BTC (secondary), SOL (blocked)
- Models: GBM, Heston, Jump, Heston-Jump

**Strategy space NOT explored but feasible:**
1. **Trend filter** — never tested as a trade admission rule (Exp 14 tested IV-based signals, not price-based)
2. **Regime filter re-evaluation at roll** — trivial to implement, addresses a known theoretical risk
3. **IV rank / percentile-based delta scaling** — alternative to IV/RV ratio
4. **Gamma-aware position sizing** — complementary to vol-scaling
5. **DTE-adaptive delta** — minimal expected impact for shipped presets

**Strategy space explored and closed:**
- Heston model (Exps 9–11: framework non-viable)
- Deployment signals beyond regime filter (Exp 14: destructive)
- Advanced position sizing modes (Exp 21: Kelly and TRG inert)

### Prioritized Recommendations for Future Exploration

If additional research capacity becomes available, the highest-value unexplored ideas are:

1. **Regime filter re-evaluation at roll** (Priority: High, Effort: Trivial) — Addresses Task 3's Risk A with a one-line code change. Should be tested on real-data rolling windows.

2. **Simple trend filter** (Priority: Medium, Effort: Low) — SMA-based entry filter could reduce assignment cascades during sustained bears. Unlike Exp 14's signal approaches, a trend filter operates on price (observable) not volatility (estimated).

3. **Open-option MTM accounting** (Priority: Medium, Effort: Moderate) — Not a strategy change but an accounting improvement that would make risk metrics more accurate. Task 3's Risk E.

4. **Conservative feature ablation on real data** (Priority: Medium, Effort: Low) — Test Conservative with RF-only (no AC, no PR) on rolling windows. Would confirm whether AC+PR add real value or are MC artifacts.

</details>
