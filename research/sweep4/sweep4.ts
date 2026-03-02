import { defaultMarketValues, defaultStrategyValues } from "../../src/components/presets.ts";
import { runMonteCarlo } from "../../src/components/monte-carlo.ts";

interface StrategyProfile {
  name: string;
  delta: number;
  cycle: number;
}

interface FilterResult {
  vol: number;
  strategy: string;
  skipBelow: number;
  meanAPR: number;
  medianAPR: number;
  p5APR: number;
  sharpe: number;
  sortino: number;
  maxDD: number;
  winRate: number;
  benchAPR: number;
  alpha: number;
  avgSkippedCycles: number;
}

async function main() {
  console.log("=== Experiment 4: Regime Filter ===");
  console.log("Goal: Test whether skipping premium selling when IV < RV improves risk-adjusted returns.\n");

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

  // skipBelowRatio values: 0 = baseline (always sell), then thresholds from 0.8 to 1.3
  const skipValues = [0, 0.8, 0.9, 1.0, 1.05, 1.1, 1.2, 1.3];

  // Vol levels from Experiment 3's sweet spot plus boundary regions
  const volLevels = [40, 50, 60, 70, 80, 100, 120, 150];

  const totalCombos = strategies.length * skipValues.length * volLevels.length;
  console.log(`Strategies: ${strategies.map(s => s.name).join(", ")}`);
  console.log(`Skip thresholds: ${skipValues.join(", ")}`);
  console.log(`Vol levels: ${volLevels.map(v => v + "%").join(", ")}`);
  console.log(`Total combinations: ${totalCombos}`);
  console.log(`Paths: ${numSims} | Days: ${days} | Drift: ${annualDrift}% | Model: ${model}`);
  console.log(`IV model: Stochastic OU (κ=${baseMarket.ivMeanReversion}, ξ=${baseMarket.ivVolOfVol}, VRP=${baseMarket.vrpPremiumPct}%)\n`);

  let completed = 0;
  const allResults: FilterResult[] = [];

  for (const vol of volLevels) {
    for (const strat of strategies) {
      for (const skipBelow of skipValues) {
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
          },
          ivRvSpread: {
            lookbackDays: 20,
            minMultiplier: 0.8,
            maxMultiplier: 1.3,
            ...(skipBelow > 0 ? { skipBelowRatio: skipBelow } : {}),
          },
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
        const avgSkipped = runs.reduce((acc, r) => acc + r.skippedCycles, 0) / count;

        allResults.push({
          vol,
          strategy: strat.name,
          skipBelow,
          meanAPR: avgAPR,
          medianAPR: result.medianAPR,
          p5APR: result.p5APR,
          sharpe: avgSharpe,
          sortino: avgSortino,
          maxDD: avgMaxDD,
          winRate,
          benchAPR: avgBenchAPR,
          alpha: avgAPR - avgBenchAPR,
          avgSkippedCycles: avgSkipped,
        });

        completed++;
        process.stdout.write(`  Progress: ${completed}/${totalCombos} (vol=${vol}%, ${strat.name}, skip=${skipBelow})\r`);
      }
    }
  }

  console.log(`\nSweep complete: ${allResults.length} results.\n`);

  // =======================================================
  // SECTION 1: Per-strategy, per-vol — filtered vs baseline
  // =======================================================
  console.log("=".repeat(80));
  console.log("=== SECTION 1: FILTER IMPACT BY STRATEGY AND VOL LEVEL ===");
  console.log("=".repeat(80));

  for (const strat of strategies) {
    console.log(`\n${"─".repeat(60)}`);
    console.log(`  ${strat.name}`);
    console.log(`${"─".repeat(60)}`);

    for (const vol of volLevels) {
      const subset = allResults
        .filter(r => r.strategy === strat.name && r.vol === vol)
        .sort((a, b) => a.skipBelow - b.skipBelow);

      const baseline = subset.find(r => r.skipBelow === 0)!;

      console.log(`\n  Vol: ${vol}% | Baseline Sharpe: ${baseline.sharpe.toFixed(3)} | Baseline APR: ${baseline.meanAPR.toFixed(2)}%`);
      console.table(subset.map(r => ({
        "Skip<": r.skipBelow === 0 ? "off" : r.skipBelow.toFixed(2),
        "Sharpe": r.sharpe.toFixed(3),
        "ΔSharpe": (r.sharpe - baseline.sharpe).toFixed(3),
        "APR%": r.meanAPR.toFixed(2),
        "ΔAPR%": (r.meanAPR - baseline.meanAPR).toFixed(2),
        "MaxDD%": (r.maxDD * 100).toFixed(1),
        "ΔMaxDD%": ((r.maxDD - baseline.maxDD) * 100).toFixed(1),
        "WinRate%": (r.winRate * 100).toFixed(1),
        "Skipped": r.avgSkippedCycles.toFixed(1),
      })));
    }
  }

  // =======================================================
  // SECTION 2: Best skip threshold per strategy & vol
  // =======================================================
  console.log("\n" + "=".repeat(80));
  console.log("=== SECTION 2: OPTIMAL SKIP THRESHOLD PER STRATEGY & VOL ===");
  console.log("=".repeat(80) + "\n");

  for (const strat of strategies) {
    console.log(`--- ${strat.name} ---`);
    const rows: any[] = [];

    for (const vol of volLevels) {
      const subset = allResults
        .filter(r => r.strategy === strat.name && r.vol === vol)
        .sort((a, b) => b.sharpe - a.sharpe);

      const best = subset[0];
      const baseline = subset.find(r => r.skipBelow === 0)!;
      const improvement = best.sharpe - baseline.sharpe;

      rows.push({
        "Vol%": vol,
        "Best Skip": best.skipBelow === 0 ? "off" : best.skipBelow.toFixed(2),
        "Sharpe": best.sharpe.toFixed(3),
        "vs Baseline": improvement > 0 ? `+${improvement.toFixed(3)}` : improvement.toFixed(3),
        "APR%": best.meanAPR.toFixed(2),
        "MaxDD%": (best.maxDD * 100).toFixed(1),
        "Skipped": best.avgSkippedCycles.toFixed(1),
      });
    }

    console.table(rows);
    console.log();
  }

  // =======================================================
  // SECTION 3: Does filtering shift the vol ceiling?
  // =======================================================
  console.log("=".repeat(80));
  console.log("=== SECTION 3: VOL CEILING SHIFT WITH FILTERING ===");
  console.log("=".repeat(80) + "\n");
  console.log("Sharpe by vol for baseline vs best filter threshold:\n");

  for (const strat of strategies) {
    console.log(`--- ${strat.name} ---`);
    const rows: any[] = [];

    for (const vol of volLevels) {
      const subset = allResults
        .filter(r => r.strategy === strat.name && r.vol === vol);

      const baseline = subset.find(r => r.skipBelow === 0)!;
      const bestFiltered = subset
        .filter(r => r.skipBelow > 0)
        .sort((a, b) => b.sharpe - a.sharpe)[0];

      rows.push({
        "Vol%": vol,
        "Baseline Sharpe": baseline.sharpe.toFixed(3),
        "Best Filter": bestFiltered ? bestFiltered.skipBelow.toFixed(2) : "n/a",
        "Filtered Sharpe": bestFiltered ? bestFiltered.sharpe.toFixed(3) : "n/a",
        "Δ Sharpe": bestFiltered ? (bestFiltered.sharpe - baseline.sharpe).toFixed(3) : "n/a",
        "Baseline MaxDD%": (baseline.maxDD * 100).toFixed(1),
        "Filtered MaxDD%": bestFiltered ? (bestFiltered.maxDD * 100).toFixed(1) : "n/a",
      });
    }

    console.table(rows);

    // Find baseline vol ceiling
    const baselineResults = allResults
      .filter(r => r.strategy === strat.name && r.skipBelow === 0)
      .sort((a, b) => a.vol - b.vol);
    const baselineCeiling = findSharpeCeiling(baselineResults);

    // Find best-filter vol ceiling (use skip=1.0 as the canonical test)
    const filtered10 = allResults
      .filter(r => r.strategy === strat.name && r.skipBelow === 1.0)
      .sort((a, b) => a.vol - b.vol);
    const filteredCeiling = findSharpeCeiling(filtered10);

    console.log(`  Baseline vol ceiling: ${baselineCeiling ?? "none (positive across range)"}`);
    console.log(`  Filtered (skip<1.0) vol ceiling: ${filteredCeiling ?? "none (positive across range)"}`);
    console.log();
  }

  // =======================================================
  // SECTION 4: Skip frequency analysis
  // =======================================================
  console.log("=".repeat(80));
  console.log("=== SECTION 4: SKIP FREQUENCY ANALYSIS ===");
  console.log("=".repeat(80) + "\n");
  console.log("How many cycles are skipped at each threshold?\n");

  for (const strat of strategies) {
    console.log(`--- ${strat.name} ---`);
    const rows: any[] = [];

    for (const vol of volLevels) {
      const subset = allResults
        .filter(r => r.strategy === strat.name && r.vol === vol && r.skipBelow > 0)
        .sort((a, b) => a.skipBelow - b.skipBelow);

      for (const r of subset) {
        rows.push({
          "Vol%": r.vol,
          "Skip<": r.skipBelow.toFixed(2),
          "Avg Skipped": r.avgSkippedCycles.toFixed(1),
          "APR%": r.meanAPR.toFixed(2),
          "Sharpe": r.sharpe.toFixed(3),
        });
      }
    }
    console.table(rows);
    console.log();
  }

  // =======================================================
  // SECTION 5: Summary & Recommendations
  // =======================================================
  console.log("=".repeat(80));
  console.log("=== SECTION 5: SUMMARY ===");
  console.log("=".repeat(80) + "\n");

  for (const strat of strategies) {
    const allForStrat = allResults.filter(r => r.strategy === strat.name);
    const baselines = allForStrat.filter(r => r.skipBelow === 0);
    const filtered = allForStrat.filter(r => r.skipBelow > 0);

    // Count how many vol levels benefit from filtering
    let improvements = 0;
    let degradations = 0;
    for (const vol of volLevels) {
      const base = baselines.find(r => r.vol === vol)!;
      const bestFilt = filtered
        .filter(r => r.vol === vol)
        .sort((a, b) => b.sharpe - a.sharpe)[0];
      if (bestFilt && bestFilt.sharpe > base.sharpe) improvements++;
      else degradations++;
    }

    // Overall best across all vols
    const overallBest = allForStrat.sort((a, b) => b.sharpe - a.sharpe)[0];

    console.log(`${strat.name}:`);
    console.log(`  Filter helps at ${improvements}/${volLevels.length} vol levels`);
    console.log(`  Filter hurts at ${degradations}/${volLevels.length} vol levels`);
    console.log(`  Overall best: vol=${overallBest.vol}%, skip=${overallBest.skipBelow}, Sharpe=${overallBest.sharpe.toFixed(3)}, APR=${overallBest.meanAPR.toFixed(2)}%`);
    console.log();
  }

  // --- Aggregate: does any single skipBelow dominate? ---
  console.log("--- AGGREGATE: MEAN SHARPE IMPROVEMENT BY SKIP THRESHOLD ---\n");

  for (const skip of skipValues.filter(s => s > 0)) {
    let totalDeltaSharpe = 0;
    let count = 0;
    for (const strat of strategies) {
      for (const vol of volLevels) {
        const base = allResults.find(r => r.strategy === strat.name && r.vol === vol && r.skipBelow === 0)!;
        const filt = allResults.find(r => r.strategy === strat.name && r.vol === vol && r.skipBelow === skip)!;
        if (base && filt) {
          totalDeltaSharpe += filt.sharpe - base.sharpe;
          count++;
        }
      }
    }
    const avgDelta = totalDeltaSharpe / count;
    console.log(`  skip<${skip.toFixed(2)}: mean ΔSharpe = ${avgDelta > 0 ? "+" : ""}${avgDelta.toFixed(4)} (across ${count} combos)`);
  }
  console.log();
}

function findSharpeCeiling(results: FilterResult[]): string | null {
  for (let i = 1; i < results.length; i++) {
    const prev = results[i - 1];
    const curr = results[i];
    if (prev.sharpe > 0 && curr.sharpe <= 0) {
      const fraction = prev.sharpe / (prev.sharpe - curr.sharpe);
      const crossover = prev.vol + fraction * (curr.vol - prev.vol);
      return `~${crossover.toFixed(0)}% vol`;
    }
  }
  return null;
}

main().catch(console.error);
