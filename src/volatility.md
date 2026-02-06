---
title: Deribit Data
toc: false
---

# Deribit Data

Live market data from the Deribit public API.

```js
import {getIndexChartData} from "./components/deribit.js";
import {getHistoricalVolatility} from "./components/deribit.js";
```

---

## Index Price

Data from `public/get_index_chart_data`.

```js
const indexParams = view(Inputs.form({
  indexName: Inputs.select(
    ["eth_usd", "btc_usd", "sol_usdc", "btc_usdc", "eth_usdc"],
    {value: "eth_usd", label: "Index"}
  ),
  range: Inputs.select(
    ["1h", "1d", "2d", "1m", "1y", "all"],
    {value: "1m", label: "Range"}
  )
}));
```

```js
const indexData = await getIndexChartData(indexParams.indexName, indexParams.range);
```

<div class="grid grid-cols-2">
  <div class="card">
    <h2>Latest price</h2>
    <p style="font-size:2rem;font-weight:bold">${indexData.length ? "$" + indexData[indexData.length - 1].price.toFixed(2) : "—"}</p>
    <p style="color:var(--theme-foreground-muted)">${indexData.length ? indexData[indexData.length - 1].date.toLocaleString() : ""}</p>
  </div>
  <div class="card">
    <h2>Range</h2>
    <p style="font-size:2rem;font-weight:bold">${indexData.length >= 2 ? "$" + d3.min(indexData, d => d.price).toFixed(2) + " — $" + d3.max(indexData, d => d.price).toFixed(2) : "—"}</p>
    <p style="color:var(--theme-foreground-muted)">${indexData.length} data points</p>
  </div>
</div>

<div class="card">
  ${resize((width) =>
    Plot.plot({
      title: `${indexParams.indexName.toUpperCase()} Index Price`,
      width,
      height: 400,
      x: {label: "Date", type: "time"},
      y: {label: "Price (USD)", grid: true},
      marks: [
        Plot.areaY(indexData, {x: "date", y: "price", fill: "#1f77b4", fillOpacity: 0.1}),
        Plot.line(indexData, {x: "date", y: "price", stroke: "#1f77b4", tip: true}),
        Plot.dot(indexData, Plot.selectLast({x: "date", y: "price", fill: "#1f77b4", r: 4}))
      ]
    })
  )}
</div>

---

## Historical Volatility

Data from `public/get_historical_volatility`.

```js
const currency = view(Inputs.select(["ETH", "BTC"], {value: "ETH", label: "Currency"}));
```

```js
const volData = await getHistoricalVolatility(currency);
```

<div class="grid grid-cols-2">
  <div class="card">
    <h2>Latest volatility</h2>
    <p style="font-size:2rem;font-weight:bold">${volData.length ? volData[volData.length - 1].volatility.toFixed(2) + "%" : "—"}</p>
    <p style="color:var(--theme-foreground-muted)">${volData.length ? volData[volData.length - 1].date.toLocaleString() : ""}</p>
  </div>
  <div class="card">
    <h2>Data points</h2>
    <p style="font-size:2rem;font-weight:bold">${volData.length}</p>
    <p style="color:var(--theme-foreground-muted)">${volData.length >= 2 ? `${volData[0].date.toLocaleDateString()} — ${volData[volData.length - 1].date.toLocaleDateString()}` : ""}</p>
  </div>
</div>

<div class="card">
  ${resize((width) =>
    Plot.plot({
      title: `${currency} Historical Volatility`,
      width,
      height: 400,
      x: {label: "Date", type: "time"},
      y: {label: "Volatility (%)", grid: true},
      marks: [
        Plot.ruleY([0]),
        Plot.line(volData, {x: "date", y: "volatility", stroke: "#e377c2", tip: true}),
        Plot.dot(volData, Plot.selectLast({x: "date", y: "volatility", fill: "#e377c2", r: 4}))
      ]
    })
  )}
</div>

<div class="card">
  ${resize((width) =>
    Plot.plot({
      title: `${currency} Volatility Distribution`,
      width,
      height: 300,
      x: {label: "Volatility (%)"},
      y: {label: "Frequency", grid: true},
      marks: [
        Plot.rectY(volData, Plot.binX({y: "count"}, {x: "volatility", fill: "#e377c2", thresholds: 30})),
        Plot.ruleY([0])
      ]
    })
  )}
</div>
