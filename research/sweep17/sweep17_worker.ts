import { parentPort } from "node:worker_threads";
import { runMonteCarlo } from "../../src/components/monte-carlo.ts";
import { generateIVPath, splitmix32, boxMuller } from "../../src/components/price-gen.ts";

parentPort!.on("message", (msg: { type: string; params: any }) => {
  try {
    if (msg.type === "calibration") {
      const { ivParams, annualVol, days, nPaths, baseSeed } = msg.params;
      const allDeltaIVStds: number[] = [];
      const allDeltaIVKurts: number[] = [];
      const allSqACF1s: number[] = [];
      const allRatioMeans: number[] = [];
      const allRatioStds: number[] = [];
      const allSkipRates: number[] = [];

      for (let s = 0; s < nPaths; s++) {
        const rand = splitmix32(baseSeed + s);
        const ivPath = generateIVPath(days, annualVol, ivParams, rand);

        // Generate price path (simple GBM) to compute RV
        const prices: number[] = [2500];
        const dt = 1 / 365;
        const volTerm = annualVol * Math.sqrt(dt);
        for (let d = 1; d < days; d++) {
          const z = boxMuller(rand);
          prices.push(prices[d - 1] * Math.exp(-annualVol * annualVol / 2 * dt + volTerm * z));
        }

        // Compute IV changes (in percentage points for comparison with real data)
        const ivPct = ivPath.map(v => v * 100);
        const deltaIV = ivPct.slice(1).map((v, i) => v - ivPct[i]);

        // Stats on deltaIV
        const n = deltaIV.length;
        const m = deltaIV.reduce((a, b) => a + b, 0) / n;
        const s2 = deltaIV.reduce((a, v) => a + (v - m) ** 2, 0) / (n - 1);
        const std = Math.sqrt(s2);
        allDeltaIVStds.push(std);

        // Kurtosis
        const k4 = deltaIV.reduce((a, v) => a + ((v - m) / (std || 1)) ** 4, 0) / n;
        allDeltaIVKurts.push(k4);

        // Squared ΔIV ACF(1)
        const sqDelta = deltaIV.map(d => d * d);
        const sqMean = sqDelta.reduce((a, b) => a + b, 0) / sqDelta.length;
        let num = 0, den = 0;
        for (let i = 1; i < sqDelta.length; i++) {
          num += (sqDelta[i] - sqMean) * (sqDelta[i - 1] - sqMean);
          den += (sqDelta[i - 1] - sqMean) ** 2;
        }
        allSqACF1s.push(den > 0 ? num / den : 0);

        // IV/RV ratio at 20d lookback
        const logReturns = prices.slice(1).map((p, i) => Math.log(p / prices[i]));
        const lookback = 20;
        const ratios: number[] = [];
        for (let d = lookback; d < logReturns.length; d++) {
          const window = logReturns.slice(d - lookback, d);
          const wm = window.reduce((a, b) => a + b, 0) / window.length;
          const wstd = Math.sqrt(window.reduce((a, v) => a + (v - wm) ** 2, 0) / (window.length - 1));
          const rv = wstd * Math.sqrt(365);
          if (rv > 0.01 && d < ivPath.length) {
            ratios.push(ivPath[d] / rv);
          }
        }
        if (ratios.length > 0) {
          const rMean = ratios.reduce((a, b) => a + b, 0) / ratios.length;
          const rStd = Math.sqrt(ratios.reduce((a, v) => a + (v - rMean) ** 2, 0) / (ratios.length - 1));
          allRatioMeans.push(rMean);
          allRatioStds.push(rStd);
          const skipCount = ratios.filter(r => r < 1.2).length;
          allSkipRates.push(skipCount / ratios.length * 100);
        }
      }

      const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;

      parentPort!.postMessage({
        result: {
          deltaIVStd: avg(allDeltaIVStds),
          deltaIVKurt: avg(allDeltaIVKurts),
          sqACF1: avg(allSqACF1s),
          ratioMean: avg(allRatioMeans),
          ratioStd: avg(allRatioStds),
          skipRate: avg(allSkipRates),
        },
      });
    } else if (msg.type === "mc") {
      const { marketConfig, strategyConfig, numSims } = msg.params;
      const result = runMonteCarlo(marketConfig, strategyConfig, numSims);
      const runs = result.runs;
      const count = runs.length;

      const validSharpes = runs.filter((r: any) => !isNaN(r.sharpe));
      const validSortinos = runs.filter((r: any) => !isNaN(r.sortino));

      parentPort!.postMessage({
        result: {
          avgAPR: runs.reduce((a: number, r: any) => a + (isNaN(r.apr) ? 0 : r.apr), 0) / count,
          avgSharpe: validSharpes.length > 0
            ? validSharpes.reduce((a: number, r: any) => a + r.sharpe, 0) / validSharpes.length : 0,
          avgSortino: validSortinos.length > 0
            ? validSortinos.reduce((a: number, r: any) => a + r.sortino, 0) / validSortinos.length : 0,
          avgMaxDD: runs.reduce((a: number, r: any) => a + (isNaN(r.maxDrawdown) ? 0 : r.maxDrawdown), 0) / count,
          winRate: runs.filter((r: any) => r.isWin).length / count,
          avgBenchAPR: runs.reduce((a: number, r: any) => a + (isNaN(r.benchmarkAPR) ? 0 : r.benchmarkAPR), 0) / count,
          avgSkipped: runs.reduce((a: number, r: any) => a + r.skippedCycles, 0) / count,
          avgFullCycles: runs.reduce((a: number, r: any) => a + r.fullCycles, 0) / count,
          avgStopLosses: runs.reduce((a: number, r: any) => a + r.totalStopLosses, 0) / count,
          avgPutRolls: runs.reduce((a: number, r: any) => a + r.totalPutRolls, 0) / count,
          count,
        },
      });
    } else {
      parentPort!.postMessage({ error: `Unknown task type: ${msg.type}` });
    }
  } catch (err: any) {
    parentPort!.postMessage({ error: err.message });
  }
});
