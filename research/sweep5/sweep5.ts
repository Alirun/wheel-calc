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
  skipSide: "both" | "put";
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
  console.log("=== Experiment 5: Put-Only Regime Filter ===");
  console.log("Goal: Test whether applying skipBelowRatio to puts only (always sell calls when holding ETH)");
  console.log("      improves risk-adjusted returns vs. the current 'skip both' behavior.\n");

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

  const skipValues = [0, 0.9, 1.0, 1.1, 1.2];
  const skipSides: Array<"both" | "put"> = ["both", "put"];
  const volLevels = [40, 50, 60, 70, 80, 100, 120, 150];

  const totalCombos = strategies.length * skipValues.length * skipSides.length * volLevels.length
    - strategies.length * volLevels.length; // baseline (skip=0) is same for both sides
  const totalRuns = strategies.length * volLevels.length + totalCombos; // deduplicated
  console.log(`Strategies: ${strategies.map(s => s.name).join(", ")}`);
  console.log(`Skip thresholds: ${skipValues.join(", ")}`);
  console.log(`Skip sides: ${skipSides.join(", ")}`);
  console.log(`Vol levels: ${volLevels.map(v => v + "%").join(", ")}`);
  console.log(`Total unique combinations: ${strategies.length * volLevels.length + (skipValues.length - 1) * skipSides.length * strategies.length * volLevels.length}`);
  console.log(`Paths per combo: ${numSims} | Days: ${days} | Drift: ${annualDrift}% | Model: ${model}`);
  console.log(`IV model: Stochastic OU (κ=${baseMarket.ivMeanReversion}, ξ=${baseMarket.ivVolOfVol}, VRP=${baseMarket.vrpPremiumPct}%)\n`);

  let completed = 0;
  const allResults: FilterResult[] = [];

  for (const vol of volLevels) {
    for (const strat of strategies) {
      for (const skipBelow of skipValues) {
        const sidesToRun: Array<"both" | "put"> = skipBelow === 0 ? ["both"] : skipSides;

        for (const skipSide of sidesToRun) {
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
              ...(skipBelow > 0 ? { skipBelowRatio: skipBelow, skipSide: skipSide } : {}),
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

          const resultEntry: FilterResult = {
            vol,
            strategy: strat.name,
            skipBelow,
            skipSide: skipBelow === 0 ? "both" : skipSide,
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
          };

          allResults.push(resultEntry);

          // For baseline (skip=0), duplicate entry for "put" side for easier comparison
          if (skipBelow === 0) {
            allResults.push({ ...resultEntry, skipSide: "put" });
          }

          completed++;
          process.stdout.write(`  Progress: ${completed} combos (vol=${vol}%, ${strat.name}, skip=${skipBelow}, side=${skipSide})\r`);
        }
      }
    }
  }

  console.log(`\nSweep complete: ${allResults.length} result rows.\n`);

  // =======================================================
  // SECTION 1: Head-to-head — "put" vs "both" at each threshold
  // =======================================================
  console.log("=".repeat(90));
  console.log("=== SECTION 1: PUT-ONLY vs BOTH — HEAD-TO-HEAD COMPARISON ===");
  console.log("=".repeat(90));

  for (const strat of strategies) {
    console.log(`\n${"─".repeat(70)}`);
    console.log(`  ${strat.name}`);
    console.log(`${"─".repeat(70)}`);

    for (const vol of volLevels) {
      console.log(`\n  Vol: ${vol}%`);
      const rows: any[] = [];

      for (const skipBelow of skipValues) {
        if (skipBelow === 0) {
          const baseline = allResults.find(r =>
            r.strategy === strat.name && r.vol === vol && r.skipBelow === 0 && r.skipSide === "both"
          )!;
          rows.push({
            "Skip<": "off",
            "Side": "baseline",
            "Sharpe": baseline.sharpe.toFixed(3),
            "APR%": baseline.meanAPR.toFixed(2),
            "MaxDD%": (baseline.maxDD * 100).toFixed(1),
            "WinRate%": (baseline.winRate * 100).toFixed(1),
            "Skipped": baseline.avgSkippedCycles.toFixed(1),
            "Alpha%": baseline.alpha.toFixed(2),
          });
          continue;
        }

        for (const side of skipSides) {
          const r = allResults.find(x =>
            x.strategy === strat.name && x.vol === vol && x.skipBelow === skipBelow && x.skipSide === side
          )!;
          const baseline = allResults.find(x =>
            x.strategy === strat.name && x.vol === vol && x.skipBelow === 0 && x.skipSide === "both"
          )!;

          rows.push({
            "Skip<": skipBelow.toFixed(2),
            "Side": side,
            "Sharpe": r.sharpe.toFixed(3),
            "ΔSharpe": (r.sharpe - baseline.sharpe).toFixed(3),
            "APR%": r.meanAPR.toFixed(2),
            "MaxDD%": (r.maxDD * 100).toFixed(1),
            "WinRate%": (r.winRate * 100).toFixed(1),
            "Skipped": r.avgSkippedCycles.toFixed(1),
            "Alpha%": r.alpha.toFixed(2),
          });
        }
      }
      console.table(rows);
    }
  }

  // =======================================================
  // SECTION 2: Aggregate — which side wins?
  // =======================================================
  console.log("\n" + "=".repeat(90));
  console.log("=== SECTION 2: AGGREGATE — PUT-ONLY vs BOTH ===");
  console.log("=".repeat(90) + "\n");

  for (const strat of strategies) {
    console.log(`--- ${strat.name} ---`);
    let putWins = 0;
    let bothWins = 0;
    let ties = 0;
    const deltas: number[] = [];

    for (const vol of volLevels) {
      for (const skipBelow of skipValues.filter(s => s > 0)) {
        const putResult = allResults.find(r =>
          r.strategy === strat.name && r.vol === vol && r.skipBelow === skipBelow && r.skipSide === "put"
        )!;
        const bothResult = allResults.find(r =>
          r.strategy === strat.name && r.vol === vol && r.skipBelow === skipBelow && r.skipSide === "both"
        )!;

        const delta = putResult.sharpe - bothResult.sharpe;
        deltas.push(delta);
        if (delta > 0.001) putWins++;
        else if (delta < -0.001) bothWins++;
        else ties++;
      }
    }

    const meanDelta = deltas.reduce((a, b) => a + b, 0) / deltas.length;
    console.log(`  put-only wins: ${putWins}/${deltas.length}`);
    console.log(`  both wins: ${bothWins}/${deltas.length}`);
    console.log(`  ties (|Δ|<0.001): ${ties}/${deltas.length}`);
    console.log(`  mean ΔSharpe (put - both): ${meanDelta > 0 ? "+" : ""}${meanDelta.toFixed(4)}`);
    console.log();
  }

  // =======================================================
  // SECTION 3: Best config per strategy & vol
  // =======================================================
  console.log("=".repeat(90));
  console.log("=== SECTION 3: BEST CONFIGURATION PER STRATEGY & VOL ===");
  console.log("=".repeat(90) + "\n");

  for (const strat of strategies) {
    console.log(`--- ${strat.name} ---`);
    const rows: any[] = [];

    for (const vol of volLevels) {
      const subset = allResults
        .filter(r => r.strategy === strat.name && r.vol === vol)
        .sort((a, b) => b.sharpe - a.sharpe);

      const best = subset[0];
      const baseline = allResults.find(r =>
        r.strategy === strat.name && r.vol === vol && r.skipBelow === 0 && r.skipSide === "both"
      )!;

      rows.push({
        "Vol%": vol,
        "Best Skip": best.skipBelow === 0 ? "off" : best.skipBelow.toFixed(2),
        "Best Side": best.skipSide,
        "Sharpe": best.sharpe.toFixed(3),
        "vs Baseline": `${best.sharpe - baseline.sharpe > 0 ? "+" : ""}${(best.sharpe - baseline.sharpe).toFixed(3)}`,
        "APR%": best.meanAPR.toFixed(2),
        "MaxDD%": (best.maxDD * 100).toFixed(1),
        "Alpha%": best.alpha.toFixed(2),
        "Skipped": best.avgSkippedCycles.toFixed(1),
      });
    }
    console.table(rows);
    console.log();
  }

  // =======================================================
  // SECTION 4: Vol ceiling comparison
  // =======================================================
  console.log("=".repeat(90));
  console.log("=== SECTION 4: VOL CEILING — BASELINE vs BEST FILTER ===");
  console.log("=".repeat(90) + "\n");

  for (const strat of strategies) {
    console.log(`--- ${strat.name} ---`);
    const rows: any[] = [];

    for (const vol of volLevels) {
      const baseline = allResults.find(r =>
        r.strategy === strat.name && r.vol === vol && r.skipBelow === 0 && r.skipSide === "both"
      )!;
      const bestPut = allResults
        .filter(r => r.strategy === strat.name && r.vol === vol && r.skipSide === "put" && r.skipBelow > 0)
        .sort((a, b) => b.sharpe - a.sharpe)[0];
      const bestBoth = allResults
        .filter(r => r.strategy === strat.name && r.vol === vol && r.skipSide === "both" && r.skipBelow > 0)
        .sort((a, b) => b.sharpe - a.sharpe)[0];

      rows.push({
        "Vol%": vol,
        "Baseline Sharpe": baseline.sharpe.toFixed(3),
        "Best put-only": bestPut ? `${bestPut.sharpe.toFixed(3)} (skip=${bestPut.skipBelow})` : "n/a",
        "Best both": bestBoth ? `${bestBoth.sharpe.toFixed(3)} (skip=${bestBoth.skipBelow})` : "n/a",
        "Δ(put-both)": bestPut && bestBoth ? (bestPut.sharpe - bestBoth.sharpe).toFixed(3) : "n/a",
      });
    }
    console.table(rows);

    // Find vol ceilings
    for (const side of skipSides) {
      const baselineResults = allResults
        .filter(r => r.strategy === strat.name && r.skipBelow === 0 && r.skipSide === "both")
        .sort((a, b) => a.vol - b.vol);
      const ceilingBaseline = findSharpeCeiling(baselineResults);

      const bestSkip = side === "put" ? 1.0 : 1.0;
      const filteredResults = allResults
        .filter(r => r.strategy === strat.name && r.skipBelow === bestSkip && r.skipSide === side)
        .sort((a, b) => a.vol - b.vol);
      const ceilingFiltered = findSharpeCeiling(filteredResults);

      if (side === "both") {
        console.log(`  Baseline vol ceiling: ${ceilingBaseline ?? "none (positive across range)"}`);
      }
      console.log(`  Filtered (skip<1.0, side=${side}) vol ceiling: ${ceilingFiltered ?? "none (positive across range)"}`);
    }
    console.log();
  }

  // =======================================================
  // SECTION 5: APR impact — does put-only preserve more income?
  // =======================================================
  console.log("=".repeat(90));
  console.log("=== SECTION 5: APR IMPACT — INCOME PRESERVATION ===");
  console.log("=".repeat(90) + "\n");
  console.log("When calls are NOT skipped (put-only mode), does APR improve vs. skipping both?\n");

  for (const strat of strategies) {
    console.log(`--- ${strat.name} ---`);
    const rows: any[] = [];

    for (const vol of volLevels) {
      for (const skipBelow of skipValues.filter(s => s > 0)) {
        const putR = allResults.find(r =>
          r.strategy === strat.name && r.vol === vol && r.skipBelow === skipBelow && r.skipSide === "put"
        )!;
        const bothR = allResults.find(r =>
          r.strategy === strat.name && r.vol === vol && r.skipBelow === skipBelow && r.skipSide === "both"
        )!;

        rows.push({
          "Vol%": vol,
          "Skip<": skipBelow.toFixed(2),
          "APR%(put)": putR.meanAPR.toFixed(2),
          "APR%(both)": bothR.meanAPR.toFixed(2),
          "ΔAPR%": (putR.meanAPR - bothR.meanAPR).toFixed(2),
          "Sharpe(put)": putR.sharpe.toFixed(3),
          "Sharpe(both)": bothR.sharpe.toFixed(3),
          "ΔSharpe": (putR.sharpe - bothR.sharpe).toFixed(3),
          "Skip(put)": putR.avgSkippedCycles.toFixed(1),
          "Skip(both)": bothR.avgSkippedCycles.toFixed(1),
        });
      }
    }
    console.table(rows);
    console.log();
  }

  // =======================================================
  // SECTION 6: Summary
  // =======================================================
  console.log("=".repeat(90));
  console.log("=== SECTION 6: SUMMARY & RECOMMENDATIONS ===");
  console.log("=".repeat(90) + "\n");

  for (const strat of strategies) {
    const allForStrat = allResults.filter(r => r.strategy === strat.name);

    // Count put-only vs both wins across all vol/skip combos
    let putBetter = 0;
    let bothBetter = 0;
    let totalCompared = 0;
    let totalDeltaSharpe = 0;
    let totalDeltaAPR = 0;

    for (const vol of volLevels) {
      for (const skipBelow of skipValues.filter(s => s > 0)) {
        const putR = allForStrat.find(r => r.vol === vol && r.skipBelow === skipBelow && r.skipSide === "put")!;
        const bothR = allForStrat.find(r => r.vol === vol && r.skipBelow === skipBelow && r.skipSide === "both")!;
        totalDeltaSharpe += putR.sharpe - bothR.sharpe;
        totalDeltaAPR += putR.meanAPR - bothR.meanAPR;
        totalCompared++;
        if (putR.sharpe > bothR.sharpe + 0.001) putBetter++;
        else if (bothR.sharpe > putR.sharpe + 0.001) bothBetter++;
      }
    }

    // Overall best
    const overallBest = allForStrat.sort((a, b) => b.sharpe - a.sharpe)[0];

    console.log(`${strat.name}:`);
    console.log(`  put-only better: ${putBetter}/${totalCompared} combos`);
    console.log(`  both better: ${bothBetter}/${totalCompared} combos`);
    console.log(`  mean ΔSharpe (put-both): ${totalDeltaSharpe / totalCompared > 0 ? "+" : ""}${(totalDeltaSharpe / totalCompared).toFixed(4)}`);
    console.log(`  mean ΔAPR (put-both): ${totalDeltaAPR / totalCompared > 0 ? "+" : ""}${(totalDeltaAPR / totalCompared).toFixed(2)}%`);
    console.log(`  Overall best: vol=${overallBest.vol}%, skip=${overallBest.skipBelow}, side=${overallBest.skipSide}, Sharpe=${overallBest.sharpe.toFixed(3)}, APR=${overallBest.meanAPR.toFixed(2)}%`);
    console.log();
  }
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
