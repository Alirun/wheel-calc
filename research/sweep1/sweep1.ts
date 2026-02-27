import { MARKET_BUILT_INS, defaultStrategyValues, defaultMarketValues } from "../../src/components/presets.ts";
import { runMonteCarlo } from "../../src/components/monte-carlo.ts";

async function main() {
  console.log("Starting Iterative Grid Search (Sweep 1)...");

  // 1. Setup the High-Vol Sideways Market Environment
  const marketPreset = MARKET_BUILT_INS.find(p => p.name === "High-Vol Sideways");
  if (!marketPreset) throw new Error("Preset not found");
  
  // Enforce rigorous simulation params for AI optimization
  // price-gen expects decimal form; presets store percentages
  const marketConfig: any = {
    ...marketPreset.values,
    annualVol: marketPreset.values.annualVol / 100,
    annualDrift: marketPreset.values.annualDrift / 100,
    days: 365,
    numSimulations: 1000, 
    heston: {
      kappa: marketPreset.values.kappa,
      theta: marketPreset.values.theta,
      sigma: marketPreset.values.sigma,
      rho: marketPreset.values.rho,
    },
    jump: {
      lambda: marketPreset.values.lambda,
      muJ: marketPreset.values.muJ,
      sigmaJ: marketPreset.values.sigmaJ,
    }
  };

  console.log(`\nMarket Baseline: ${marketPreset.name}`);
  console.log(`Model: ${marketConfig.model} | Drift: ${marketConfig.annualDrift}% | Vol: ${marketConfig.annualVol}%`);
  console.log(`Paths: ${marketConfig.numSimulations} | Days: ${marketConfig.days}\n`);

  // 2. Define the Parameter Grid
  const targetDeltas = [0.10, 0.20, 0.30, 0.40];
  const cycleLengths = [3, 7, 14, 30];
  const skipThresholds = [0, 0.05, 0.10]; // 0%, 5%, 10%

  const totalRuns = targetDeltas.length * cycleLengths.length * skipThresholds.length;
  console.log(`Running ${totalRuns} parameter combinations...\n`);

  const results: any[] = [];
  let runCount = 0;

        // 3. Execute the Sweep
  for (const delta of targetDeltas) {
    for (const cycle of cycleLengths) {
      for (const skip of skipThresholds) {
        
        // Build the strategy config mapping exactly to types.ts interface
        const baseConfig = defaultStrategyValues();
        const baseMarket = defaultMarketValues();
        const strategyConfig: any = {
          targetDelta: delta,
          cycleLengthDays: cycle,
          impliedVol: marketConfig.annualVol * (1 + baseMarket.vrpPremiumPct / 100),
          riskFreeRate: marketConfig.riskFreeRate / 100,
          contracts: baseConfig.contracts,
          bidAskSpreadPct: marketConfig.bidAskSpreadPct / 100,
          feePerTrade: marketConfig.feePerTrade,
          
          // Using skip parameter in adaptive calls config
          adaptiveCalls: {
            enabled: true,
            minDelta: baseConfig.minCallDelta,
            maxDelta: baseConfig.maxCallDelta,
            skipThresholdPct: skip,
            minStrikeAtCost: baseConfig.minStrikeAtCost
          }
        };

        const result = runMonteCarlo(marketConfig as any, strategyConfig, marketConfig.numSimulations);
        
        // Calculate explicit metrics from runs to avoid NaN issues
        const runs = result.runs;
        const count = runs.length;
        
        const avgAPR = runs.reduce((acc: number, r: any) => acc + (isNaN(r.apr) ? 0 : r.apr), 0) / count;
        const validSharpes = runs.filter((r: any) => !isNaN(r.sharpe));
        const avgSharpe = validSharpes.length > 0 
          ? validSharpes.reduce((acc: number, r: any) => acc + r.sharpe, 0) / validSharpes.length 
          : 0;
        
        const validSortinos = runs.filter((r: any) => !isNaN(r.sortino));
        const avgSortino = validSortinos.length > 0
          ? validSortinos.reduce((acc: number, r: any) => acc + r.sortino, 0) / validSortinos.length
          : 0;
          
        const avgMaxDD = runs.reduce((acc: number, r: any) => acc + (isNaN(r.maxDrawdown) ? 0 : r.maxDrawdown), 0) / count;
        const winRate = runs.filter((r: any) => r.isWin).length / count;

        results.push({
          delta,
          cycle,
          skip,
          meanAPR: avgAPR.toFixed(2) + "%",
          winRate: (winRate * 100).toFixed(1) + "%",
          sharpe: avgSharpe.toFixed(3),
          sortino: avgSortino.toFixed(3),
          maxDD: (avgMaxDD * 100).toFixed(2) + "%"
        });

        runCount++;
        if (runCount % 10 === 0) {
           process.stdout.write(`Progress: ${runCount}/${totalRuns}\r`);
        }
      }
    }
  }

  // 4. Sort and Display Results
  // Sort by Sharpe Ratio descending
  results.sort((a, b) => parseFloat(b.sharpe) - parseFloat(a.sharpe));

  console.log("\n\n=== Top 10 Strategies by Sharpe Ratio ===");
  console.table(results.slice(0, 10));
  
  console.log("\n=== Bottom 5 Strategies by Sharpe Ratio ===");
  console.table(results.slice(-5));
}

main().catch(console.error);
