# Wheel Strategy — Future Improvements

## Put Selling Phase (Cash Secured)

### Medium Impact
- [ ] **Put spread instead of naked put** — Buy a further OTM put as protection (e.g., sell 30-delta, buy 10-delta). Caps max loss, reduces capital requirement, at the cost of some premium.

### Lower Impact
- [ ] **Event-aware cycle skipping** — Skip put-selling cycles around known high-vol events (major protocol upgrades, macro announcements) where realized vol is likely to exceed implied vol.
- [ ] **IV skew awareness** — Target strikes where skew is steepest for better risk-adjusted premium. Puts often carry skew premium that can be exploited.

---

## Call Selling Phase (Covered)

### Medium Impact
- [ ] **Staggered covered calls** — If holding multiple units, sell calls at different strikes/dates. Some closer ATM (higher premium), some further OTM (upside participation). Diversifies assignment risk.
- [ ] **Trend-based call skipping** — When the asset is in a strong uptrend (e.g., above 20-day MA by X%), skip selling calls entirely to capture the move. Current skip logic is premium-based; a trend-based skip would be more strategic.

### Lower Impact
- [ ] **Collar strategy when underwater** — When unrealized loss exceeds a threshold, buy a protective put in addition to selling the covered call. Caps further downside at the cost of premium.

---

## Position Management & Risk

### High Impact
- [ ] **Portfolio-level delta management** — Track net portfolio delta and adjust strategy to stay within a target range. Becomes useful when multi-contract support is added.

### Medium Impact
- [ ] **Capital efficiency tracking** — Track return on capital deployed (not just P/L). A put tying up $2,500 for $50 premium is different from one tying up $1,500 for $40.
- [ ] **Assignment cost averaging** — If assigned on a put and price drops further, sell another put at a lower strike. When assigned again, average entry is lower. (Aggressive variant of the wheel.)

---

## Volatility & Pricing Model

### Medium Impact
- [ ] **Volatility term structure** — Model different IVs for different DTEs. A 7-day and a 30-day option don't share the same vol. Improves strike/DTE selection accuracy.

---

## Simulation & Analytics

### Medium Impact
- [ ] **Greeks evolution over time** — Track portfolio delta, gamma, theta daily. Theta is income; gamma is risk. Visualizing this helps understand when the strategy is most/least exposed.
- [ ] **Strategy P/L vs underlying return correlation** — Plot strategy P/L against underlying return to show the payoff diagram across scenarios. Reveals where the wheel wins/loses vs holding.

### Lower Impact
- [ ] **Transaction cost sensitivity analysis** — Sweep bid-ask spread and fees to show how costs erode returns. Helps determine minimum viable premium.
- [ ] **Optimal parameter grid search** — Search over (delta, DTE, adaptive params) to find the Pareto frontier of return vs risk.
