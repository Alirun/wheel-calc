import { defaultMarketValues, defaultStrategyValues } from "../../src/components/presets.ts";
import { runMonteCarlo } from "../../src/components/monte-carlo.ts";

interface StrategyProfile {
  name: string;
  delta: number;
  cycle: number;
}

interface VolResult {
  vol: number;
  strategy: string;
  meanAPR: number;
  medianAPR: number;
  p5APR: number;
  sharpe: number;
  sortino: number;
  maxDD: number;
  winRate: number;
  benchAPR: number;
  alpha: number;
}

async function main() {
  console.log("=== Experiment 3: Vol Boundary Search ===");
  console.log("Goal: Find the exact vol level where Sharpe crosses zero.\n");

  const baseMarket = defaultMarketValues();
  const annualDrift = 5;
  const model = "gbm";
  const numSims = 1000;
  const days = 365;

  const strategies: StrategyProfile[] = [
    { name: "Conservative (δ0.10/30d)", delta: 0.10, cycle: 30 },
    { name: "Moderate (δ0.20/14d)",     delta: 0.20, cycle: 14 },
    { name: "Active (δ0.20/3d)",        delta: 0.20, cycle: 3  },
  ];

  // Phase 1: Coarse sweep — 5% vol increments from 40% to 155%
  const coarseVols = Array.from({ length: 24 }, (_, i) => 40 + i * 5);
  console.log(`Phase 1: Coarse sweep across ${coarseVols.length} vol levels (${coarseVols[0]}%–${coarseVols[coarseVols.length - 1]}%)`);
  console.log(`Strategies: ${strategies.map(s => s.name).join(", ")}`);
  console.log(`Paths: ${numSims} | Days: ${days} | Drift: ${annualDrift}% | Model: ${model}\n`);

  const totalCombos = coarseVols.length * strategies.length;
  let completed = 0;

  const allResults: VolResult[] = [];

  for (const vol of coarseVols) {
    for (const strat of strategies) {
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

      const base = defaultStrategyValues();
      const impliedVol = annualVolDec * (1 + baseMarket.vrpPremiumPct / 100);
      const strategyConfig: any = {
        targetDelta: strat.delta,
        cycleLengthDays: strat.cycle,
        impliedVol: impliedVol,
        riskFreeRate: baseMarket.riskFreeRate / 100,
        contracts: base.contracts,
        bidAskSpreadPct: baseMarket.bidAskSpreadPct / 100,
        feePerTrade: baseMarket.feePerTrade,
        adaptiveCalls: {
          minDelta: base.minCallDelta,
          maxDelta: base.maxCallDelta,
          skipThresholdPct: 0,
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

      allResults.push({
        vol,
        strategy: strat.name,
        meanAPR: avgAPR,
        medianAPR: result.medianAPR,
        p5APR: result.p5APR,
        sharpe: avgSharpe,
        sortino: avgSortino,
        maxDD: avgMaxDD,
        winRate,
        benchAPR: avgBenchAPR,
        alpha: avgAPR - avgBenchAPR,
      });

      completed++;
      process.stdout.write(`  Progress: ${completed}/${totalCombos} (vol=${vol}%, ${strat.name})\r`);
    }
  }

  console.log(`\nPhase 1 complete: ${allResults.length} results.\n`);

  // === Phase 1 Results: Sharpe vs Vol curve for each strategy ===
  console.log("========================================");
  console.log("=== SHARPE vs VOL BY STRATEGY ===");
  console.log("========================================\n");

  for (const strat of strategies) {
    console.log(`--- ${strat.name} ---`);
    const stratResults = allResults
      .filter(r => r.strategy === strat.name)
      .sort((a, b) => a.vol - b.vol);

    console.table(stratResults.map(r => ({
      "Vol%": r.vol,
      "Sharpe": r.sharpe.toFixed(3),
      "APR%": r.meanAPR.toFixed(2),
      "Alpha%": r.alpha.toFixed(2),
      "MaxDD%": (r.maxDD * 100).toFixed(1),
      "WinRate%": (r.winRate * 100).toFixed(1),
    })));

    // Find the crossover point via linear interpolation
    let crossoverVol: number | null = null;
    for (let i = 1; i < stratResults.length; i++) {
      const prev = stratResults[i - 1];
      const curr = stratResults[i];
      if (prev.sharpe > 0 && curr.sharpe <= 0) {
        // Linear interpolation
        const fraction = prev.sharpe / (prev.sharpe - curr.sharpe);
        crossoverVol = prev.vol + fraction * (curr.vol - prev.vol);
        break;
      }
    }
    if (crossoverVol !== null) {
      console.log(`  >>> SHARPE ZERO CROSSING at ~${crossoverVol.toFixed(1)}% vol <<<\n`);
    } else {
      const allPositive = stratResults.every(r => r.sharpe > 0);
      if (allPositive) {
        console.log(`  >>> Sharpe positive across entire range (${stratResults[0].vol}%–${stratResults[stratResults.length - 1].vol}%) <<<\n`);
      } else {
        console.log(`  >>> Sharpe negative across entire range <<<\n`);
      }
    }
  }

  // === Phase 2: Fine-grained search around crossover ===
  console.log("========================================");
  console.log("=== PHASE 2: FINE-GRAINED CROSSOVER SEARCH ===");
  console.log("========================================\n");

  for (const strat of strategies) {
    const stratResults = allResults
      .filter(r => r.strategy === strat.name)
      .sort((a, b) => a.vol - b.vol);

    // Find coarse bracket
    let lowerVol: number | null = null;
    let upperVol: number | null = null;
    for (let i = 1; i < stratResults.length; i++) {
      const prev = stratResults[i - 1];
      const curr = stratResults[i];
      if (prev.sharpe > 0 && curr.sharpe <= 0) {
        lowerVol = prev.vol;
        upperVol = curr.vol;
        break;
      }
    }

    if (lowerVol === null || upperVol === null) {
      console.log(`${strat.name}: No crossover found in coarse sweep, skipping fine search.\n`);
      continue;
    }

    console.log(`${strat.name}: Refining between ${lowerVol}% and ${upperVol}% vol...`);

    // 1% increments within the bracket
    const fineVols: number[] = [];
    for (let v = lowerVol + 1; v < upperVol; v++) {
      fineVols.push(v);
    }

    const fineResults: VolResult[] = [];
    // Include the boundary coarse results
    fineResults.push(stratResults.find(r => r.vol === lowerVol)!);

    for (const vol of fineVols) {
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

      const base = defaultStrategyValues();
      const impliedVol = annualVolDec * (1 + baseMarket.vrpPremiumPct / 100);
      const strategyConfig: any = {
        targetDelta: strat.delta,
        cycleLengthDays: strat.cycle,
        impliedVol: impliedVol,
        riskFreeRate: baseMarket.riskFreeRate / 100,
        contracts: base.contracts,
        bidAskSpreadPct: baseMarket.bidAskSpreadPct / 100,
        feePerTrade: baseMarket.feePerTrade,
        adaptiveCalls: {
          minDelta: base.minCallDelta,
          maxDelta: base.maxCallDelta,
          skipThresholdPct: 0,
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

      fineResults.push({
        vol,
        strategy: strat.name,
        meanAPR: avgAPR,
        medianAPR: result.medianAPR,
        p5APR: result.p5APR,
        sharpe: avgSharpe,
        sortino: avgSortino,
        maxDD: avgMaxDD,
        winRate,
        benchAPR: avgBenchAPR,
        alpha: avgAPR - avgBenchAPR,
      });
    }

    fineResults.push(stratResults.find(r => r.vol === upperVol)!);
    fineResults.sort((a, b) => a.vol - b.vol);

    console.table(fineResults.map(r => ({
      "Vol%": r.vol,
      "Sharpe": r.sharpe.toFixed(4),
      "APR%": r.meanAPR.toFixed(2),
      "Alpha%": r.alpha.toFixed(2),
      "MaxDD%": (r.maxDD * 100).toFixed(1),
    })));

    // Fine interpolation
    for (let i = 1; i < fineResults.length; i++) {
      const prev = fineResults[i - 1];
      const curr = fineResults[i];
      if (prev.sharpe > 0 && curr.sharpe <= 0) {
        const fraction = prev.sharpe / (prev.sharpe - curr.sharpe);
        const exactVol = prev.vol + fraction * (curr.vol - prev.vol);
        console.log(`  >>> PRECISE SHARPE ZERO CROSSING: ~${exactVol.toFixed(1)}% vol <<<\n`);
        break;
      }
    }
  }

  // === Summary ===
  console.log("========================================");
  console.log("=== SUMMARY: WHEEL DEPLOYMENT ZONES ===");
  console.log("========================================\n");

  for (const strat of strategies) {
    const stratResults = allResults
      .filter(r => r.strategy === strat.name)
      .sort((a, b) => a.vol - b.vol);

    const positiveRange = stratResults.filter(r => r.sharpe > 0);
    if (positiveRange.length > 0) {
      const minVol = positiveRange[0].vol;
      const maxVol = positiveRange[positiveRange.length - 1].vol;
      const peakResult = positiveRange.reduce((best, r) => r.sharpe > best.sharpe ? r : best);
      console.log(`${strat.name}:`);
      console.log(`  Deployment zone: ${minVol}%–${maxVol}% vol`);
      console.log(`  Peak Sharpe: ${peakResult.sharpe.toFixed(3)} at ${peakResult.vol}% vol`);
      console.log(`  Peak APR: ${peakResult.meanAPR.toFixed(2)}% | Alpha: ${peakResult.alpha.toFixed(2)}% | MaxDD: ${(peakResult.maxDD * 100).toFixed(1)}%`);
    } else {
      console.log(`${strat.name}: No positive Sharpe found in tested range.`);
    }
    console.log();
  }

  // Alpha crossover (where wheel stops beating buy-and-hold)
  console.log("--- ALPHA CROSSOVER (Wheel vs Buy-and-Hold) ---\n");
  for (const strat of strategies) {
    const stratResults = allResults
      .filter(r => r.strategy === strat.name)
      .sort((a, b) => a.vol - b.vol);

    let alphaCrossover: number | null = null;
    for (let i = 1; i < stratResults.length; i++) {
      const prev = stratResults[i - 1];
      const curr = stratResults[i];
      if (prev.alpha > 0 && curr.alpha <= 0) {
        const fraction = prev.alpha / (prev.alpha - curr.alpha);
        alphaCrossover = prev.vol + fraction * (curr.vol - prev.vol);
        break;
      }
    }
    if (alphaCrossover !== null) {
      console.log(`${strat.name}: Alpha crosses zero at ~${alphaCrossover.toFixed(1)}% vol`);
    } else {
      const allPositiveAlpha = stratResults.every(r => r.alpha > 0);
      if (allPositiveAlpha) {
        console.log(`${strat.name}: Alpha positive across entire range`);
      } else {
        console.log(`${strat.name}: Alpha negative across entire range`);
      }
    }
  }
}

main().catch(console.error);
