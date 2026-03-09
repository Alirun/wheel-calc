// Deribit public API helpers.
// Pure fetch wrappers — no framework dependencies.

const BASE = "https://www.deribit.com/api/v2";

async function call(method: string, params: Record<string, string>): Promise<any> {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${BASE}/${method}?${qs}`);
  if (!res.ok) throw new Error(`Deribit ${method}: ${res.status}`);
  const json = await res.json();
  return json.result;
}

export interface VolatilityPoint {
  date: Date;
  volatility: number;
}

export async function getHistoricalVolatility(currency: string): Promise<VolatilityPoint[]> {
  const result = await call("public/get_historical_volatility", {currency});
  return result.map(([ts, vol]: [number, number]) => ({date: new Date(ts), volatility: vol}));
}

export interface IndexPricePoint {
  date: Date;
  price: number;
}

export async function getIndexChartData(indexName: string, range: string): Promise<IndexPricePoint[]> {
  const result = await call("public/get_index_chart_data", {index_name: indexName, range});
  return result.map(([ts, price]: [number, number]) => ({date: new Date(ts), price}));
}

export interface DVOLPoint {
  date: Date;
  open: number;
  high: number;
  low: number;
  close: number;
}

export async function getDVOLHistory(
  currency: string,
  startMs: number,
  endMs: number,
  resolution: "1D" | "1" | "60" = "1D"
): Promise<DVOLPoint[]> {
  const resSeconds = resolution === "1D" ? "86400" : resolution === "60" ? "3600" : "60";
  const all: DVOLPoint[] = [];
  let endCursor = String(endMs);
  while (true) {
    const result = await call("public/get_volatility_index_data", {
      currency,
      resolution: resSeconds,
      start_timestamp: String(startMs),
      end_timestamp: endCursor,
    });
    const rows: [number, number, number, number, number][] = result.data;
    for (const [ts, o, h, l, c] of rows) {
      all.push({date: new Date(ts), open: o, high: h, low: l, close: c});
    }
    if (!result.continuation || rows.length < 1000) break;
    endCursor = String(result.continuation);
  }
  all.sort((a, b) => a.date.getTime() - b.date.getTime());
  return all;
}

export interface OHLCPoint {
  date: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export async function getTradingViewChart(
  instrument: string,
  resolution: "1D" | "1" | "60",
  startMs: number,
  endMs: number
): Promise<OHLCPoint[]> {
  const result = await call("public/get_tradingview_chart_data", {
    instrument_name: instrument,
    resolution,
    start_timestamp: String(startMs),
    end_timestamp: String(endMs),
  });
  const ticks: number[] = result.ticks;
  return ticks.map((ts: number, i: number) => ({
    date: new Date(ts),
    open: result.open[i],
    high: result.high[i],
    low: result.low[i],
    close: result.close[i],
    volume: result.volume[i],
  }));
}
