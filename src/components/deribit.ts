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
