# Wheel Strategy Improvements

## 1. Put Selling Phase (Cash Secured)

### High Impact
- [ ] **Dynamic delta based on IV rank/percentile** — Sell higher-delta (closer ATM) puts when IV is elevated (rich premiums compensate for risk), lower-delta when IV is low. Currently uses a fixed `targetDelta` regardless of vol regime.
- [ ] **DTE ladder / rolling** — Instead of fixed 7-day cycles, sell at ~30-45 DTE and roll at ~14-21 DTE. Theta decay accelerates after 21 DTE but before that you carry gamma risk with less theta compensation. Rolling captures the "theta sweet spot" repeatedly.

### Medium Impact
- [ ] **Put spread instead of naked put** — Buy a further OTM put as protection (e.g., sell 30-delta, buy 10-delta). Caps max loss, reduces capital requirement, at the cost of some premium.
- [ ] **Position sizing / multiple puts** — Sell multiple puts at different strikes or expirations to create a "put spread ladder". Scale position size based on portfolio delta or max loss tolerance.

### Lower Impact
- [ ] **Event-aware cycle skipping** — Skip put-selling cycles around known high-vol events (major protocol upgrades, macro announcements) where realized vol is likely to exceed implied vol.
- [ ] **IV skew awareness** — Target strikes where skew is steepest for better risk-adjusted premium. Puts often carry skew premium that can be exploited.

---

## 2. Call Selling Phase (Covered)

### High Impact
- [ ] **Roll up and out instead of assignment** — When a call goes ITM before expiration, roll to a higher strike + further DTE for a net credit. Avoids forced selling and captures more upside. Current sim just waits for expiry.
- [ ] **Minimum strike at cost-basis** — Never sell a call below the put assignment strike (entry price). Guarantees no loss on the stock leg if assigned. Currently the adaptive delta could theoretically select a strike below entry in a crash.

### Medium Impact
- [ ] **Staggered covered calls** — If holding multiple units, sell calls at different strikes/dates. Some closer ATM (higher premium), some further OTM (upside participation). Diversifies assignment risk.
- [ ] **Trend-based call skipping** — When the asset is in a strong uptrend (e.g., above 20-day MA by X%), skip selling calls entirely to capture the move. Current skip logic is premium-based; a trend-based skip would be more strategic.

### Lower Impact
- [ ] **Collar strategy when underwater** — When unrealized loss exceeds a threshold, buy a protective put in addition to selling the covered call. Caps further downside at the cost of premium.

---

## 3. Position Management & Risk

### High Impact
- [ ] **Max drawdown / stop-loss rule** — If unrealized loss on the ETH position exceeds X% (e.g., 30%), cut the position instead of hoping for recovery via call premium. Current strategy has unbounded downside during the holding phase.
- [ ] **Position sizing via Kelly criterion or risk budget** — Size the number of contracts based on edge (premium/risk ratio) rather than a fixed number. Reduce exposure when premiums don't justify the risk.
- [ ] **Portfolio-level delta management** — Track net portfolio delta and adjust strategy to stay within a target range. If holding ETH + selling calls, net delta is positive; if it gets too high, reduce exposure.

### Medium Impact
- [ ] **Capital efficiency tracking** — Track return on capital deployed (not just P/L). A put tying up $2,500 for $50 premium is different from one tying up $1,500 for $40.
- [ ] **Assignment cost averaging** — If assigned on a put and price drops further, sell another put at a lower strike. When assigned again, average entry is lower. (Aggressive variant of the wheel.)

---

## 4. Volatility & Pricing Model

### High Impact
- [ ] **IV vs RV spread as a trading signal** — When IV >> RV, premiums are "rich" — sell more aggressively. When IV ~ RV, premiums are "fair" — be selective. Currently `ivPremiumPct` is static; this should be dynamic per-cycle.
- [ ] **Stochastic volatility model (Heston/SABR)** — Replace constant-vol GBM with mean-reverting, clustered vol. Real crypto vol exhibits these properties. Would make Monte Carlo results more realistic.

### Medium Impact
- [ ] **Volatility term structure** — Model different IVs for different DTEs. A 7-day and a 30-day option don't share the same vol. Improves strike/DTE selection accuracy.
- [ ] **Jump diffusion model** — Add a Poisson jump process to GBM for fat-tail events (sudden crashes/pumps). Better models tail risk and gives more realistic drawdown estimates.

---

## 5. Simulation & Analytics

### High Impact
- [x] **Benchmark vs buy-and-hold** — Show wheel returns vs buy-and-hold on the same price paths. The key question: does the wheel add alpha or just reshape the return distribution?
- [x] **Sharpe / Sortino ratio** — APR alone doesn't capture risk-adjusted returns. Add Sharpe (return/volatility) and Sortino (return/downside-volatility) to the Monte Carlo summary.

### Medium Impact
- [x] **Regime-conditional analysis** — Break down results by market regime (bull/bear/sideways). The wheel performs very differently in each. Use drift sign or realized return over the period.
- [ ] **Greeks evolution over time** — Track portfolio delta, gamma, theta daily. Theta is income; gamma is risk. Visualizing this helps understand when the strategy is most/least exposed.
- [ ] **Strategy P/L vs underlying return correlation** — Plot strategy P/L against underlying return to show the payoff diagram across scenarios. Reveals where the wheel wins/loses vs holding.

### Lower Impact
- [ ] **Transaction cost sensitivity analysis** — Sweep bid-ask spread and fees to show how costs erode returns. Helps determine minimum viable premium.
- [ ] **Optimal parameter grid search** — Search over (delta, DTE, adaptive params) to find the Pareto frontier of return vs risk.

---

## Analysis: Contradictions, Complements & Implementation Order

### Contradictions & Tensions

#### 1. DTE Ladder (1.2) vs Event-Aware Skipping (1.5)
DTE ladder wants positions **always** open at 30-45 DTE with rolling at 14-21 DTE. Event-aware skipping wants to **avoid** positions around certain events. Not incompatible, but rolling logic gets complex — if you're supposed to roll at 14 DTE but an event is at 12 DTE, do you roll into a new position or close entirely?

#### 2. Dynamic Delta via IV Rank (1.1) vs IV/RV Spread Signal (4.1)
Both modulate aggressiveness based on volatility but use **different signals**. IV rank/percentile asks "is IV high relative to its own history?" while IV/RV spread asks "is IV high relative to realized vol?" These can disagree: IV could be at its 90th percentile but still accurately pricing realized vol. Need to pick one as primary or combine them, not implement both independently.

#### 3. Max Drawdown Stop-Loss (3.1) vs Assignment Cost Averaging (3.5)
Stop-loss says "cut the position at X% loss." Cost averaging says "if price drops further, sell more puts to lower your average." These are **directly contradictory** — one limits loss, the other doubles down. Must choose one, or define clear regimes (cost-average within a band, stop-loss beyond it).

#### 4. Collar Strategy (2.5) vs Stop-Loss (3.1)
Both cap downside during the holding phase but via different mechanisms (buying a put vs selling the position). Collar preserves the position for potential recovery; stop-loss exits. Having both is redundant — pick one or make them mutually exclusive by threshold.

#### 5. Trend-Based Call Skipping (2.4) vs Portfolio Delta Management (3.3)
Skipping calls in an uptrend **increases** portfolio delta (fully long ETH with no short call offset). Portfolio delta management wants to keep delta within a target range. These will fight each other unless the delta target explicitly accounts for "trend mode."

---

### Strong Complements (implement together)

#### A. DTE Ladder (1.2) + Roll Up/Out (2.1) + Vol Term Structure (4.3)
These form a coherent "rolling strategy" package. Term structure is needed to correctly price different DTEs, DTE ladder to select optimal entry, and roll logic to manage positions mid-life. Implementing one without the others gives incomplete results.

#### B. IV/RV Spread (4.1) + Dynamic Delta (1.1) + Stochastic Vol Model (4.2)
Stochastic vol generates realistic IV/RV dynamics. IV/RV spread uses those dynamics as a signal. Dynamic delta acts on that signal. Without the better vol model, testing signal-based delta adjustment on constant-vol GBM is meaningless — IV would always equal the model's vol parameter.

#### C. Benchmark vs B&H (5.1) + Sharpe/Sortino (5.2) + Regime Analysis (5.3)
Pure analytics with no strategy changes. Complement each other perfectly and can be built independently. **Should be implemented first** — can't evaluate any improvement without proper benchmarks.

#### D. Put Spread (1.3) + Collar (2.5)
Both involve buying protective options. Share the same pricing infrastructure and capital requirement logic.

#### E. Kelly Criterion (3.2) + Capital Efficiency (3.4)
Kelly needs return-on-capital as an input. Capital efficiency tracking provides it.

---

### Recommended Implementation Order

#### Phase 0: Analytics Foundation (no strategy changes) ✅
- [x] **5.1** Benchmark vs buy-and-hold
- [x] **5.2** Sharpe/Sortino ratio
- [x] **5.3** Regime-conditional analysis

Completed: baseline metrics, benchmark comparison, risk-adjusted ratios, and regime breakdown all implemented in `monte-carlo.ts` and `simulator.md`.

#### Phase 1: Better Price Model
- **4.2** Stochastic volatility (Heston)
- **4.4** Jump diffusion

Why next: every subsequent improvement depends on realistic price paths. Test by comparing generated return distributions against historical ETH data (fat tails, vol clustering).

#### Phase 2: Core Strategy Improvements
- **2.2** Minimum strike at cost-basis (simple guard, high value)
- **4.1** IV/RV spread signal (now meaningful with stochastic vol)
- **1.1** Dynamic delta (uses IV/RV spread)
- **2.1** Roll up/out

Testing: run Monte Carlo with improvement ON vs OFF on identical seeds. Compare Sharpe/Sortino/max drawdown. Improvement should increase risk-adjusted returns, not just raw APR.

#### Phase 3: Risk Management
- **3.1** Max drawdown stop-loss (pick over cost-averaging)
- **3.3** Portfolio delta management

Testing: specifically examine 5th percentile outcomes. Should improve tail risk without gutting median returns.
