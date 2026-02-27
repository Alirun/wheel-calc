import { defaultMarketValues, defaultStrategyValues } from "../../src/components/presets.ts";
import { runMonteCarlo } from "../../src/components/monte-carlo.ts";

interface SweepResult {
  vol: number;
  delta: number;
  cycle: number;
  skip: number;
  meanAPR: string;
  medianAPR: string;
  p5APR: string;
  winRate: string;
  sharpe: string;
  sortino: string;
  maxDD: string;
  benchAPR: string;
  alpha: string;
}

async function main() {
  console.log("=== Experiment 2: Normal-Vol Regime Grid Search ===\n");

  const baseMarket = defaultMarketValues();

  // Two vol regimes: typical equity (25%) and moderate crypto (50%)
  const annualVols = [25, 50];
  const annualDrift = 5; // Slight positive drift (realistic)
  const model = "gbm";
  const numSims = 1000;
  const days = 365;

  const targetDeltas = [0.10, 0.15, 0.20, 0.25, 0.30, 0.40];
  const cycleLengths = [3, 7, 14, 21, 30];
  const skipThresholds = [0, 0.05, 0.10];

  const allResults: SweepResult[] = [];

  for (const vol of annualVols) {
    console.log(`\n--- Volatility: ${vol}% | Drift: ${annualDrift}% | Model: ${model} ---`);

    // IMPORTANT: price-gen expects decimal form, presets store percentages
    const annualVolDec = vol / 100;
    const marketConfig: any = {
      ...baseMarket,
      startPrice: baseMarket.startPrice,
      annualVol: annualVolDec,
      annualDrift: annualDrift / 100,
      model: model,
      days: days,
      numSimulations: numSims,
      heston: {
        kappa: baseMarket.kappa,
        theta: baseMarket.theta,
        sigma: baseMarket.sigma,
        rho: baseMarket.rho,
      },
      jump: {
        lambda: baseMarket.lambda,
        muJ: baseMarket.muJ,
        sigmaJ: baseMarket.sigmaJ,
      },
      ivParams: {
        meanReversion: baseMarket.ivMeanReversion,
        volOfVol: baseMarket.ivVolOfVol,
        vrpOffset: annualVolDec * baseMarket.vrpPremiumPct / 100,
      }
    };

    const combos = targetDeltas.length * cycleLengths.length * skipThresholds.length;
    console.log(`Running ${combos} parameter combinations x ${numSims} paths...\n`);

    let runCount = 0;

    for (const delta of targetDeltas) {
      for (const cycle of cycleLengths) {
        for (const skip of skipThresholds) {
          const base = defaultStrategyValues();
          const impliedVol = annualVolDec * (1 + baseMarket.vrpPremiumPct / 100);
          const strategyConfig: any = {
            targetDelta: delta,
            cycleLengthDays: cycle,
            impliedVol: impliedVol,
            riskFreeRate: baseMarket.riskFreeRate / 100,
            contracts: base.contracts,
            bidAskSpreadPct: baseMarket.bidAskSpreadPct / 100,
            feePerTrade: baseMarket.feePerTrade,
            adaptiveCalls: {
              minDelta: base.minCallDelta,
              maxDelta: base.maxCallDelta,
              skipThresholdPct: skip,
              minStrikeAtCost: base.minStrikeAtCost
            }
          };

          const result = runMonteCarlo(marketConfig as any, strategyConfig, numSims);

          const runs = result.runs;
          const count = runs.length;

          const avgAPR = runs.reduce((acc, r) => acc + (isNaN(r.apr) ? 0 : r.apr), 0) / count;
          const validSharpes = runs.filter(r => !isNaN(r.sharpe));
          const avgSharpe = validSharpes.length > 0
            ? validSharpes.reduce((acc, r) => acc + r.sharpe, 0) / validSharpes.length
            : 0;
          const validSortinos = runs.filter(r => !isNaN(r.sortino));
          const avgSortino = validSortinos.length > 0
            ? validSortinos.reduce((acc, r) => acc + r.sortino, 0) / validSortinos.length
            : 0;
          const avgMaxDD = runs.reduce((acc, r) => acc + (isNaN(r.maxDrawdown) ? 0 : r.maxDrawdown), 0) / count;
          const winRate = runs.filter(r => r.isWin).length / count;
          const avgBenchAPR = runs.reduce((acc, r) => acc + (isNaN(r.benchmarkAPR) ? 0 : r.benchmarkAPR), 0) / count;

          const medianAPR = result.medianAPR;
          const p5APR = result.p5APR;

          allResults.push({
            vol,
            delta,
            cycle,
            skip,
            meanAPR: avgAPR.toFixed(2) + "%",
            medianAPR: medianAPR.toFixed(2) + "%",
            p5APR: p5APR.toFixed(2) + "%",
            winRate: (winRate * 100).toFixed(1) + "%",
            sharpe: avgSharpe.toFixed(3),
            sortino: avgSortino.toFixed(3),
            maxDD: (avgMaxDD * 100).toFixed(2) + "%",
            benchAPR: avgBenchAPR.toFixed(2) + "%",
            alpha: (avgAPR - avgBenchAPR).toFixed(2) + "%"
          });

          runCount++;
          if (runCount % 10 === 0) {
            process.stdout.write(`  Progress: ${runCount}/${combos}\r`);
          }
        }
      }
    }
    console.log(`  Completed ${combos} combos for ${vol}% vol.`);
  }

  // Sort all results by Sharpe descending
  allResults.sort((a, b) => parseFloat(b.sharpe) - parseFloat(a.sharpe));

  console.log("\n\n========================================");
  console.log("=== TOP 15 STRATEGIES BY SHARPE RATIO ===");
  console.log("========================================");
  console.table(allResults.slice(0, 15));

  console.log("\n=== TOP 10 STRATEGIES BY APR ===");
  const byAPR = [...allResults].sort((a, b) => parseFloat(b.meanAPR) - parseFloat(a.meanAPR));
  console.table(byAPR.slice(0, 10));

  console.log("\n=== TOP 10 BY WIN RATE ===");
  const byWin = [...allResults].sort((a, b) => parseFloat(b.winRate) - parseFloat(a.winRate));
  console.table(byWin.slice(0, 10));

  console.log("\n=== BOTTOM 5 STRATEGIES BY SHARPE RATIO ===");
  console.table(allResults.slice(-5));

  // Show per-vol summary
  for (const vol of annualVols) {
    const volResults = allResults.filter(r => r.vol === vol);
    volResults.sort((a, b) => parseFloat(b.sharpe) - parseFloat(a.sharpe));
    console.log(`\n=== BEST 5 FOR ${vol}% VOL ===`);
    console.table(volResults.slice(0, 5));
    console.log(`=== WORST 3 FOR ${vol}% VOL ===`);
    console.table(volResults.slice(-3));
  }

  // Aggregate stats
  const positiveSharpe = allResults.filter(r => parseFloat(r.sharpe) > 0);
  const positiveAPR = allResults.filter(r => parseFloat(r.meanAPR) > 0);
  console.log(`\n=== SUMMARY ===`);
  console.log(`Total combos tested: ${allResults.length}`);
  console.log(`Positive Sharpe: ${positiveSharpe.length} / ${allResults.length} (${(positiveSharpe.length / allResults.length * 100).toFixed(1)}%)`);
  console.log(`Positive mean APR: ${positiveAPR.length} / ${allResults.length} (${(positiveAPR.length / allResults.length * 100).toFixed(1)}%)`);
}

main().catch(console.error);
