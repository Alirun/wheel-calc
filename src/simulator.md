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

```js
const marketParams = view(Inputs.form({
  startPrice: Inputs.range([500, 8000], {value: 2500, step: 50, label: "Start price (USD)"}),
  days: Inputs.range([30, 365], {value: 180, step: 1, label: "Days to simulate"}),
  annualVol: Inputs.range([10, 200], {value: 80, step: 5, label: "Annual volatility (%)"}),
  annualDrift: Inputs.range([-100, 100], {value: 0, step: 5, label: "Annual drift (%)"}),
  seed: Inputs.range([1, 9999], {value: 42, step: 1, label: "Random seed"})
}));
```

```js
const stratParams = view(Inputs.form({
  strikeOffsetPct: Inputs.range([1, 20], {value: 5, step: 1, label: "Strike offset (% OTM)"}),
  premiumPct: Inputs.range([0.5, 10], {value: 3, step: 0.5, label: "Premium (% of strike)"}),
  contracts: Inputs.range([1, 20], {value: 1, step: 1, label: "Contracts (1 = 1 ETH)"})
}));
```

```js
const prices = generatePrices({
  startPrice: marketParams.startPrice,
  days: marketParams.days,
  annualVol: marketParams.annualVol / 100,
  annualDrift: marketParams.annualDrift / 100,
  seed: marketParams.seed
});

const result = simulateWheel(prices, {
  strikeOffsetPct: stratParams.strikeOffsetPct / 100,
  premiumPct: stratParams.premiumPct / 100,
  cycleLengthDays: 7,
  contracts: stratParams.contracts
});

const fullCycles = result.trades.filter((t) => t.type === "call" && t.assigned).length;
```

<div class="grid grid-cols-4">
  <div class="card">
    <h3>Realized P/L</h3>
    <p style="font-size:1.5rem;font-weight:bold;color:${result.totalRealizedPL >= 0 ? '#2ca02c' : '#d62728'}">
      ${result.totalRealizedPL >= 0 ? '+' : ''}$${result.totalRealizedPL.toFixed(2)}
    </p>
  </div>
  <div class="card">
    <h3>Premiums Collected</h3>
    <p style="font-size:1.5rem;font-weight:bold;color:#2ca02c">
      +$${result.totalPremiumCollected.toFixed(2)}
    </p>
  </div>
  <div class="card">
    <h3>Assignments</h3>
    <p style="font-size:1.5rem;font-weight:bold">${result.totalAssignments}</p>
  </div>
  <div class="card">
    <h3>Full Cycles</h3>
    <p style="font-size:1.5rem;font-weight:bold">${fullCycles}</p>
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
  Strike: `$${t.strike.toFixed(2)}`,
  Premium: `$${t.premium.toFixed(2)}`,
  Assigned: t.assigned ? "Yes" : "No",
  "P/L": `${t.pl >= 0 ? "+" : ""}$${t.pl.toFixed(2)}`
}));
```

${Inputs.table(tradeRows, {sort: "#", reverse: false})}
