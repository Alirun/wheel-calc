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
- [ ] **Benchmark vs buy-and-hold** — Show wheel returns vs buy-and-hold on the same price paths. The key question: does the wheel add alpha or just reshape the return distribution?
- [ ] **Sharpe / Sortino ratio** — APR alone doesn't capture risk-adjusted returns. Add Sharpe (return/volatility) and Sortino (return/downside-volatility) to the Monte Carlo summary.

### Medium Impact
- [ ] **Regime-conditional analysis** — Break down results by market regime (bull/bear/sideways). The wheel performs very differently in each. Use drift sign or realized return over the period.
- [ ] **Greeks evolution over time** — Track portfolio delta, gamma, theta daily. Theta is income; gamma is risk. Visualizing this helps understand when the strategy is most/least exposed.
- [ ] **Strategy P/L vs underlying return correlation** — Plot strategy P/L against underlying return to show the payoff diagram across scenarios. Reveals where the wheel wins/loses vs holding.

### Lower Impact
- [ ] **Transaction cost sensitivity analysis** — Sweep bid-ask spread and fees to show how costs erode returns. Helps determine minimum viable premium.
- [ ] **Optimal parameter grid search** — Search over (delta, DTE, adaptive params) to find the Pareto frontier of return vs risk.
