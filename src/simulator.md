---
title: Wheel Strategy Simulator
toc: false
---

# Wheel Strategy Simulator

Generate a random ETH price series and backtest the Wheel strategy over it.

```js
import {generatePrices} from "./components/price-gen.js";
import {simulateWheel} from "./components/wheel.js";
```

<div class="grid grid-cols-3">
  <div class="card">
    <h3>Market</h3>

```js
const marketParams = view(Inputs.form({
  startPrice: Inputs.range([500, 8000], {value: 2500, step: 50, label: "Start price (USD)"}),
  days: Inputs.range([30, 365], {value: 30, step: 1, label: "Days to simulate"}),
  annualVol: Inputs.range([10, 200], {value: 80, step: 5, label: "Annual volatility (%)"}),
  annualDrift: Inputs.range([-100, 100], {value: 0, step: 5, label: "Annual drift (%)"}),
  seed: Inputs.range([1, 9999], {value: 42, step: 1, label: "Random seed"})
}));
```

  </div>
  <div class="card">
    <h3>Strategy</h3>

```js
const strategyParams = view(Inputs.form({
  targetDelta: Inputs.range([0.05, 0.50], {value: 0.30, step: 0.01, label: "Target delta"}),
  ivPremiumPct: Inputs.range([0, 50], {value: 15, step: 1, label: "IV premium over RV (%)"}),
  cycleLengthDays: Inputs.range([1, 30], {value: 7, step: 1, label: "Cycle length (days)"}),
  contracts: Inputs.range([1, 20], {value: 1, step: 1, label: "Contracts (1 = 1 ETH)"})
}));
```

  </div>
  <div class="card">
    <h3>Costs</h3>

```js
const costParams = view(Inputs.form({
  riskFreeRate: Inputs.range([0, 10], {value: 5, step: 0.5, label: "Risk-free rate (%)"}),
  bidAskSpreadPct: Inputs.range([0, 20], {value: 5, step: 1, label: "Bid-ask spread (%)"}),
  feePerTrade: Inputs.range([0, 10], {value: 0.50, step: 0.10, label: "Fee per trade (USD)"})
}));
```

  </div>
</div>

```js
const annualVol = marketParams.annualVol / 100;
const impliedVol = annualVol * (1 + strategyParams.ivPremiumPct / 100);

const prices = generatePrices({
  startPrice: marketParams.startPrice,
  days: marketParams.days,
  annualVol: annualVol,
  annualDrift: marketParams.annualDrift / 100,
  seed: marketParams.seed
});

const result = simulateWheel(prices, {
  targetDelta: strategyParams.targetDelta,
  impliedVol: impliedVol,
  riskFreeRate: costParams.riskFreeRate / 100,
  cycleLengthDays: strategyParams.cycleLengthDays,
  contracts: strategyParams.contracts,
  bidAskSpreadPct: costParams.bidAskSpreadPct / 100,
  feePerTrade: costParams.feePerTrade
});

const fullCycles = result.trades.filter((t) => t.type === "call" && t.assigned).length;

// APR: annualize realized P/L relative to cash-secured capital
const capitalAtRisk = marketParams.startPrice * strategyParams.contracts;
const yearsElapsed = marketParams.days / 365;
const apr = yearsElapsed > 0 ? (result.totalRealizedPL / capitalAtRisk) / yearsElapsed * 100 : 0;
```

<div style="display:flex;flex-wrap:wrap;gap:0.75rem;">
  <div class="card" style="padding:0.5rem 1rem;min-width:0;">
    <h3 style="margin:0;font-size:0.75rem;">Realized P/L</h3>
    <p style="margin:0;font-size:1.25rem;font-weight:bold;color:${result.totalRealizedPL >= 0 ? '#2ca02c' : '#d62728'}">
      ${result.totalRealizedPL >= 0 ? '+' : ''}$${result.totalRealizedPL.toFixed(2)}
    </p>
  </div>
  <div class="card" style="padding:0.5rem 1rem;min-width:0;">
    <h3 style="margin:0;font-size:0.75rem;">APR</h3>
    <p style="margin:0;font-size:1.25rem;font-weight:bold;color:${apr >= 0 ? '#2ca02c' : '#d62728'}">
      ${apr >= 0 ? '+' : ''}${apr.toFixed(1)}%
    </p>
  </div>
  <div class="card" style="padding:0.5rem 1rem;min-width:0;">
    <h3 style="margin:0;font-size:0.75rem;">Premiums Collected</h3>
    <p style="margin:0;font-size:1.25rem;font-weight:bold;color:#2ca02c">
      +$${result.totalPremiumCollected.toFixed(2)}
    </p>
  </div>
  <div class="card" style="padding:0.5rem 1rem;min-width:0;">
    <h3 style="margin:0;font-size:0.75rem;">Assignments</h3>
    <p style="margin:0;font-size:1.25rem;font-weight:bold">${result.totalAssignments}</p>
  </div>
  <div class="card" style="padding:0.5rem 1rem;min-width:0;">
    <h3 style="margin:0;font-size:0.75rem;">Full Cycles</h3>
    <p style="margin:0;font-size:1.25rem;font-weight:bold">${fullCycles}</p>
  </div>
</div>

## Price & Position

```js
// Build cycle bands for the chart
const cycleBands = result.trades.map((t) => ({
  x1: t.startDay,
  x2: t.endDay,
  type: t.type,
  strike: t.strike
}));

const assignments = result.trades.filter((t) => t.assigned).map((t) => ({
  day: t.endDay,
  price: prices[t.endDay],
  type: t.type
}));
```

<div class="card">
  ${resize((width) =>
    Plot.plot({
      title: "ETH Price with Wheel Cycles",
      width,
      height: 400,
      x: {label: "Day"},
      y: {label: "Price (USD)", grid: true},
      color: {legend: true},
      marks: [
        // Cycle background bands
        ...cycleBands.map((b) =>
          Plot.rectY([b], {
            x1: "x1",
            x2: "x2",
            y1: () => Math.min(...prices) * 0.95,
            y2: () => Math.max(...prices) * 1.05,
            fill: b.type === "put" ? "#d6272810" : "#1f77b410"
          })
        ),
        // Strike lines per cycle
        ...cycleBands.map((b) =>
          Plot.ruleY([b.strike], {
            x1: b.x1,
            x2: b.x2,
            stroke: b.type === "put" ? "#d62728" : "#1f77b4",
            strokeDasharray: "4,4",
            strokeOpacity: 0.5
          })
        ),
        // Price line
        Plot.line(prices.map((p, i) => ({day: i, price: p})), {
          x: "day",
          y: "price",
          stroke: "#333",
          strokeWidth: 1.5,
          tip: true
        }),
        // Assignment markers
        Plot.dot(assignments, {
          x: "day",
          y: "price",
          fill: (d) => d.type === "put" ? "#d62728" : "#1f77b4",
          r: 6,
          symbol: "diamond2",
          tip: true,
          title: (d) => `${d.type.toUpperCase()} assigned @ day ${d.day}`
        })
      ]
    })
  )}
</div>

## Inventory & Unrealized P/L

```js
// Build inventory events from trades
const inventoryEvents = [];
let invQty = 0;
let invCostBasis = null;
for (const t of result.trades) {
  if (t.type === "put" && t.assigned) {
    invQty = strategyParams.contracts;
    invCostBasis = t.strike;
    inventoryEvents.push({day: t.endDay, event: "PUT assigned", qty: invQty, costBasis: invCostBasis, spot: t.spotAtExpiration});
  } else if (t.type === "call" && t.assigned) {
    inventoryEvents.push({day: t.endDay, event: "CALL assigned", qty: 0, costBasis: invCostBasis, spot: t.spotAtExpiration});
    invQty = 0;
    invCostBasis = null;
  }
}

const holdingDays = result.dailyState.filter((d) => d.holdingETH);
```

<div class="grid grid-cols-2">
  <div class="card">
    <h3>Inventory Events</h3>
    ${inventoryEvents.length === 0
      ? html`<p style="color:var(--theme-foreground-muted)">No assignments yet — not holding ETH</p>`
      : html`<table style="width:100%">
          <thead><tr><th>Day</th><th>Event</th><th>ETH Held</th><th>Cost Basis</th><th>Spot</th><th>Unrealized</th></tr></thead>
          <tbody>${inventoryEvents.map((e) => {
            const unrealized = e.qty > 0 ? (e.spot - e.costBasis) * e.qty : 0;
            return html`<tr>
              <td>${e.day}</td>
              <td><strong>${e.event}</strong></td>
              <td>${e.qty}</td>
              <td>${e.costBasis !== null ? `$${e.costBasis.toFixed(0)}` : "—"}</td>
              <td>$${e.spot.toFixed(0)}</td>
              <td style="color:${unrealized >= 0 ? '#2ca02c' : '#d62728'};font-weight:bold">${e.qty > 0 ? `${unrealized >= 0 ? '+' : ''}$${unrealized.toFixed(2)}` : "—"}</td>
            </tr>`;
          })}</tbody>
        </table>`
    }
  </div>
  <div class="card">
    <h3>Final Position</h3>
    ${(() => {
      const last = result.dailyState[result.dailyState.length - 1];
      if (!last.holdingETH) return html`<p>No ETH held — fully in cash</p><p>Phase: <strong>Selling PUT</strong></p>`;
      const lastTrade = [...result.trades].reverse().find((t) => t.type === "put" && t.assigned);
      const cb = lastTrade ? lastTrade.strike : 0;
      return html`
        <p>Holding: <strong>${strategyParams.contracts} ETH</strong></p>
        <p>Cost basis: <strong>$${cb.toFixed(0)}</strong></p>
        <p>Current spot: <strong>$${last.price.toFixed(0)}</strong></p>
        <p>Unrealized: <span style="font-weight:bold;color:${last.unrealizedPL >= 0 ? '#2ca02c' : '#d62728'}">${last.unrealizedPL >= 0 ? '+' : ''}$${last.unrealizedPL.toFixed(2)}</span></p>
        <p>Phase: <strong>Selling CALL</strong></p>
      `;
    })()}
  </div>
</div>

<div class="card">
  ${resize((width) =>
    Plot.plot({
      title: "Unrealized P/L (when holding ETH)",
      width,
      height: 200,
      x: {label: "Day"},
      y: {label: "Unrealized P/L (USD)", grid: true},
      marks: [
        Plot.ruleY([0]),
        Plot.areaY(result.dailyState, {
          x: "day",
          y: "unrealizedPL",
          fill: (d) => d.unrealizedPL >= 0 ? "#2ca02c" : "#d62728",
          fillOpacity: 0.2
        }),
        Plot.line(result.dailyState, {
          x: "day",
          y: "unrealizedPL",
          stroke: "#ff7f0e",
          strokeWidth: 1.5,
          tip: true
        })
      ]
    })
  )}
</div>

## Cumulative P/L

<div class="card">
  ${resize((width) =>
    Plot.plot({
      title: "Realized vs Unrealized P/L Over Time",
      width,
      height: 300,
      x: {label: "Day"},
      y: {label: "P/L (USD)", grid: true},
      marks: [
        Plot.ruleY([0]),
        Plot.areaY(result.dailyState, {
          x: "day",
          y: "cumulativePL",
          fill: "#2ca02c",
          fillOpacity: 0.15
        }),
        Plot.line(result.dailyState, {
          x: "day",
          y: "cumulativePL",
          stroke: "#2ca02c",
          strokeWidth: 2,
          tip: true
        }),
        Plot.line(result.dailyState, {
          x: "day",
          y: (d) => d.cumulativePL + d.unrealizedPL,
          stroke: "#ff7f0e",
          strokeWidth: 1.5,
          strokeDasharray: "4,4",
          tip: true
        })
      ]
    })
  )}
</div>

<p><small><span style="color:#2ca02c">&#9644;</span> Realized P/L &nbsp; <span style="color:#ff7f0e">- - -</span> Realized + Unrealized</small></p>

## Trade Log

```js
const tradeRows = result.trades.map((t, i) => ({
  "#": i + 1,
  Type: t.type.toUpperCase(),
  Days: `${t.startDay}–${t.endDay}`,
  "Spot Open": `$${t.spotAtOpen.toFixed(0)}`,
  "Spot Exp": `$${t.spotAtExpiration.toFixed(0)}`,
  Strike: `$${t.strike.toFixed(0)}`,
  Delta: t.delta.toFixed(2),
  IV: `${(t.impliedVol * 100).toFixed(0)}%`,
  Premium: `$${t.premium.toFixed(2)}`,
  Assigned: t.assigned ? "Yes" : "No",
  "Cost Basis": t.entryPrice !== null ? `$${t.entryPrice.toFixed(0)}` : "—",
  "P/L": `${t.pl >= 0 ? "+" : ""}$${t.pl.toFixed(2)}`
}));
```

<div style="max-width: none;">
  ${Inputs.table(tradeRows, {sort: "#", reverse: false, layout: "auto"})}
</div>
