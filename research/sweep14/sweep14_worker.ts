import { parentPort } from "node:worker_threads";
import { runMonteCarlo } from "../../src/components/monte-carlo.ts";
import { generatePrices } from "../../src/components/price-gen.ts";
import {
  computeTrailingVRP,
  computeTrailingACF,
} from "../../src/components/signals.ts";

parentPort!.on("message", (msg: { type: string; params: any }) => {
  try {
    let result: any;
    if (msg.type === "accuracy") {
      result = handleAccuracy(msg.params);
    } else if (msg.type === "mc") {
      result = handleMC(msg.params);
    }
    parentPort!.postMessage({ result });
  } catch (err: any) {
    parentPort!.postMessage({ error: err.message });
  }
});

function handleAccuracy(p: {
  trueVRP: number;
  vol: number;
  drift: number;
  windows: number[];
  checkDays: number[];
  numSims: number;
  startPrice: number;
  ivMeanReversion: number;
  ivVolOfVol: number;
}) {
  const annualVol = p.vol / 100;
  const vrpOffset = annualVol * p.trueVRP / 100;

  const allEstimates = new Map<string, number[]>();
  const allACFs = new Map<string, number[]>();

  for (let seed = 1; seed <= p.numSims; seed++) {
    const { prices, ivPath } = generatePrices({
      startPrice: p.startPrice,
      days: 365,
      annualVol,
      annualDrift: p.drift / 100,
      seed,
      model: "gbm",
      ivParams: {
        meanReversion: p.ivMeanReversion,
        volOfVol: p.ivVolOfVol,
        vrpOffset,
      },
    });

    if (!ivPath) continue;

    for (const window of p.windows) {
      for (const day of p.checkDays) {
        if (day >= prices.length) continue;
        const key = `${window}|${day}`;

        const vrpEst = computeTrailingVRP(ivPath, prices, day, window, 20);
        if (vrpEst !== undefined) {
          if (!allEstimates.has(key)) allEstimates.set(key, []);
          allEstimates.get(key)!.push(vrpEst);
        }

        const acf = computeTrailingACF(ivPath, prices, day, window, 20);
        if (acf !== undefined) {
          if (!allACFs.has(key)) allACFs.set(key, []);
          allACFs.get(key)!.push(acf);
        }
      }
    }
  }

  const results: any[] = [];
  for (const window of p.windows) {
    for (const day of p.checkDays) {
      const key = `${window}|${day}`;
      const estimates = allEstimates.get(key) ?? [];
      const acfs = allACFs.get(key) ?? [];
      if (estimates.length === 0) continue;

      const trueVRPDec = vrpOffset;
      const meanEst = estimates.reduce((a, b) => a + b, 0) / estimates.length;
      const variance = estimates.reduce((s, v) => s + (v - meanEst) ** 2, 0) / estimates.length;
      const stdEst = Math.sqrt(variance);
      const mse = estimates.reduce((s, v) => s + (v - trueVRPDec) ** 2, 0) / estimates.length;
      const rmse = Math.sqrt(mse);
      const bias = meanEst - trueVRPDec;

      const meanACF = acfs.length > 0 ? acfs.reduce((a, b) => a + b, 0) / acfs.length : 0;
      const acfVar = acfs.length > 0 ? acfs.reduce((s, v) => s + (v - meanACF) ** 2, 0) / acfs.length : 0;
      const stdACF = Math.sqrt(acfVar);

      results.push({
        trueVRP: p.trueVRP, vol: p.vol, drift: p.drift, window,
        meanEstVRP: meanEst, stdEstVRP: stdEst, rmse, bias,
        meanACF, stdACF,
      });
    }
  }

  return results;
}

function handleMC(p: { marketConfig: any; strategyConfig: any; numSims: number }) {
  const result = runMonteCarlo(p.marketConfig, p.strategyConfig, p.numSims);
  const runs = result.runs;
  const count = runs.length;

  const validSharpes = runs.filter((r: any) => !isNaN(r.sharpe));
  return {
    avgAPR: runs.reduce((a: number, r: any) => a + (isNaN(r.apr) ? 0 : r.apr), 0) / count,
    avgSharpe: validSharpes.length > 0
      ? validSharpes.reduce((a: number, r: any) => a + r.sharpe, 0) / validSharpes.length : 0,
    avgMaxDD: runs.reduce((a: number, r: any) => a + (isNaN(r.maxDrawdown) ? 0 : r.maxDrawdown), 0) / count,
    winRate: runs.filter((r: any) => r.isWin).length / count,
    avgBenchAPR: runs.reduce((a: number, r: any) => a + (isNaN(r.benchmarkAPR) ? 0 : r.benchmarkAPR), 0) / count,
    avgSkipped: runs.reduce((a: number, r: any) => a + r.skippedCycles, 0) / count,
    avgFullCycles: runs.reduce((a: number, r: any) => a + r.fullCycles, 0) / count,
    avgDeploySkips: runs.reduce((a: number, r: any) => a + (r.deploymentSkips ?? 0), 0) / count,
    count,
  };
}
