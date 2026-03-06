import { parentPort } from "node:worker_threads";
import { runMonteCarlo } from "../../src/components/monte-carlo.ts";

parentPort!.on("message", (msg: { type: string; params: any }) => {
  try {
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
  } catch (err: any) {
    parentPort!.postMessage({ error: err.message });
  }
});
