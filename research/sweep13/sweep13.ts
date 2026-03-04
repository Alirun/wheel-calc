import { defaultMarketValues, defaultStrategyValues } from "../../src/components/presets.ts";
import { runMonteCarlo } from "../../src/components/monte-carlo.ts";

interface StrategyProfile {
  name: string;
  delta: number;
  cycle: number;
  lookback: number;
  adaptiveCalls: boolean;
  putRollEnabled: boolean;
  putRollInitialDTE: number;
  putRollWhenBelow: number;
}

interface CostResult {
  strategy: string;
  vol: number;
  days: number;
  horizon: string;
  spreadPct: number;
  feePerTrade: number;
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
  avgTotalCycles: number;
  skipPct: number;
  avgExecCycles: number;
  avgPutRolls: number;
  costDragAPR: number;
}

function buildConfigs(
  strat: StrategyProfile,
  vol: number,
  drift: number,
  vrpPremiumPct: number,
  days: number,
  spreadPct: number,
  feePerTrade: number,
  baseMarket: ReturnType<typeof defaultMarketValues>,
) {
  const annualVolDec = vol / 100;
  const base = defaultStrategyValues();

  const marketConfig: any = {
    ...baseMarket,
    startPrice: baseMarket.startPrice,
    annualVol: annualVolDec,
    annualDrift: drift / 100,
    model: "gbm" as const,
    days,
    numSimulations: 1000,
    jump: {
      lambda: baseMarket.lambda,
      muJ: baseMarket.muJ,
      sigmaJ: baseMarket.sigmaJ,
    },
    ivParams: {
      meanReversion: baseMarket.ivMeanReversion,
      volOfVol: baseMarket.ivVolOfVol,
      vrpOffset: annualVolDec * vrpPremiumPct / 100,
    },
  };

  const impliedVol = annualVolDec * (1 + vrpPremiumPct / 100);
  const skipBelowRatio = strat.name.includes("Conservative") ? 1.0 : 1.2;

  const strategyConfig: any = {
    targetDelta: strat.delta,
    cycleLengthDays: strat.cycle,
    impliedVol: impliedVol,
    riskFreeRate: baseMarket.riskFreeRate / 100,
    contracts: base.contracts,
    bidAskSpreadPct: spreadPct / 100,
    feePerTrade: feePerTrade,

    ...(strat.adaptiveCalls ? {
      adaptiveCalls: {
        minDelta: base.minCallDelta,
        maxDelta: base.maxCallDelta,
        skipThresholdPct: 0,
        minStrikeAtCost: base.minStrikeAtCost,
      },
    } : {}),

    ivRvSpread: {
      lookbackDays: strat.lookback,
      minMultiplier: 0.8,
      maxMultiplier: 1.3,
      skipBelowRatio,
      skipSide: "put" as const,
    },

    ...(strat.putRollEnabled ? {
      rollPut: {
        initialDTE: strat.putRollInitialDTE,
        rollWhenDTEBelow: strat.putRollWhenBelow,
        requireNetCredit: true,
      },
    } : {}),
  };

  return { marketConfig, strategyConfig };
}

function runCombo(
  marketConfig: any,
  strategyConfig: any,
  numSims: number,
): { runs: any[]; medianAPR: number; p5APR: number } {
  const result = runMonteCarlo(marketConfig, strategyConfig, numSims);
  return { runs: result.runs, medianAPR: result.medianAPR, p5APR: result.p5APR };
}

function extractResult(
  stratName: string,
  vol: number,
  days: number,
  horizon: string,
  spreadPct: number,
  feePerTrade: number,
  result: { runs: any[]; medianAPR: number; p5APR: number },
  baselineAPR: number | null,
): CostResult {
  const { runs, medianAPR, p5APR } = result;
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
  const avgBenchAPR = runs.reduce((acc: number, r: any) => acc + (isNaN(r.benchmarkAPR) ? 0 : r.benchmarkAPR), 0) / count;
  const avgSkipped = runs.reduce((acc: number, r: any) => acc + r.skippedCycles, 0) / count;
  const avgFullCycles = runs.reduce((acc: number, r: any) => acc + r.fullCycles, 0) / count;
  const avgPutRolls = runs.reduce((acc: number, r: any) => acc + r.totalPutRolls, 0) / count;
  const totalCycles = avgSkipped + avgFullCycles;
  const skipPct = totalCycles > 0 ? (avgSkipped / totalCycles) * 100 : 0;

  const costDrag = baselineAPR !== null ? avgAPR - baselineAPR : 0;

  return {
    strategy: stratName,
    vol,
    days,
    horizon,
    spreadPct,
    feePerTrade,
    meanAPR: avgAPR,
    medianAPR,
    p5APR,
    sharpe: avgSharpe,
    sortino: avgSortino,
    maxDD: avgMaxDD,
    winRate,
    benchAPR: avgBenchAPR,
    alpha: avgAPR - avgBenchAPR,
    avgSkippedCycles: avgSkipped,
    avgTotalCycles: totalCycles,
    skipPct,
    avgExecCycles: avgFullCycles,
    avgPutRolls,
    costDragAPR: costDrag,
  };
}

function fmt(n: number, decimals: number = 2): string {
  return n.toFixed(decimals);
}

function fmtSign(n: number, decimals: number = 2): string {
  return (n > 0 ? "+" : "") + n.toFixed(decimals);
}

function fmtUSD(n: number): string {
  return "$" + n.toFixed(2);
}

function avgField(rows: CostResult[], field: keyof CostResult): number {
  const vals = rows.map(r => r[field] as number).filter(v => !isNaN(v));
  return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
}

function linearInterp(
  x1: number, y1: number,
  x2: number, y2: number,
  yTarget: number,
): number | null {
  if ((y1 - yTarget) * (y2 - yTarget) > 0) return null;
  if (y1 === y2) return null;
  return x1 + (yTarget - y1) * (x2 - x1) / (y2 - y1);
}

async function main() {
  console.log("=== Experiment 13: Execution Cost Sensitivity ===");
  console.log("Goal: Determine at what cost level each strategy's Sharpe crosses zero.");
  console.log("      Test whether Active's higher trade frequency makes it more cost-sensitive.");
  console.log("      Verify multi-year advantage survives realistic Deribit friction.\n");

  const baseMarket = defaultMarketValues();
  const numSims = 1000;

  const strategies: StrategyProfile[] = [
    {
      name: "Conservative (δ0.10/30d)",
      delta: 0.10, cycle: 30, lookback: 45,
      adaptiveCalls: true,
      putRollEnabled: true, putRollInitialDTE: 30, putRollWhenBelow: 14,
    },
    {
      name: "Moderate (δ0.20/14d)",
      delta: 0.20, cycle: 14, lookback: 20,
      adaptiveCalls: false,
      putRollEnabled: true, putRollInitialDTE: 14, putRollWhenBelow: 7,
    },
    {
      name: "Active (δ0.20/3d)",
      delta: 0.20, cycle: 3, lookback: 20,
      adaptiveCalls: false,
      putRollEnabled: false, putRollInitialDTE: 0, putRollWhenBelow: 0,
    },
  ];

  const spreadLevels = [1, 3, 5, 8, 12];
  const feeLevels = [0.25, 0.50, 1.00, 2.00];
  const volLevels = [40, 60];
  const horizons = [
    { days: 365, label: "1yr" },
    { days: 1825, label: "5yr" },
  ];
  const drift = 5;
  const vrp = 15;

  const totalCombos = spreadLevels.length * feeLevels.length * strategies.length
    * volLevels.length * horizons.length;

  console.log(`Strategies: ${strategies.map(s => s.name).join(", ")}`);
  console.log(`Spread levels: ${spreadLevels.map(s => s + "%").join(", ")}`);
  console.log(`Fee levels: ${feeLevels.map(f => "$" + f.toFixed(2)).join(", ")}`);
  console.log(`Vol levels: ${volLevels.map(v => v + "%").join(", ")}`);
  console.log(`Horizons: ${horizons.map(h => `${h.label} (${h.days}d)`).join(", ")}`);
  console.log(`Drift: +${drift}% | VRP: ${vrp}% | Model: GBM`);
  console.log(`Total combinations: ${totalCombos}`);
  console.log(`Paths per combo: ${numSims}\n`);

  const allResults: CostResult[] = [];
  let completed = 0;

  // First pass: run lowest cost (baseline) for cost drag calculation
  const baselineAPRs = new Map<string, number>();

  for (const hz of horizons) {
    for (const vol of volLevels) {
      for (const strat of strategies) {
        for (const spread of spreadLevels) {
          for (const fee of feeLevels) {
            const { marketConfig, strategyConfig } = buildConfigs(
              strat, vol, drift, vrp, hz.days, spread, fee, baseMarket,
            );
            const result = runCombo(marketConfig, strategyConfig, numSims);

            const baselineKey = `${strat.name}|${vol}|${hz.days}`;
            const bl = baselineAPRs.get(baselineKey) ?? null;

            const row = extractResult(
              strat.name, vol, hz.days, hz.label,
              spread, fee, result, bl,
            );

            // Store first result (lowest spread=1, lowest fee=0.25) as baseline
            if (!baselineAPRs.has(baselineKey) && spread === spreadLevels[0] && fee === feeLevels[0]) {
              baselineAPRs.set(baselineKey, row.meanAPR);
            }

            allResults.push(row);
            completed++;
            if (completed % 5 === 0 || completed === totalCombos) {
              process.stdout.write(`  Progress: ${completed}/${totalCombos} (${(completed / totalCombos * 100).toFixed(0)}%)\r`);
            }
          }
        }
      }
    }
  }

  // Recalculate cost drag now that all baselines are known
  for (const r of allResults) {
    const baselineKey = `${r.strategy}|${r.vol}|${r.days}`;
    const bl = baselineAPRs.get(baselineKey);
    if (bl !== undefined) {
      r.costDragAPR = r.meanAPR - bl;
    }
  }

  console.log(`\nSweep complete: ${allResults.length} result rows.\n`);

  // =======================================================
  // SECTION 1: Full Results Table
  // =======================================================
  console.log("=".repeat(130));
  console.log("=== SECTION 1: FULL RESULTS TABLE ===");
  console.log("=".repeat(130));
  console.log("All results sorted by strategy → vol → horizon → spread → fee.\n");

  for (const strat of strategies) {
    for (const vol of volLevels) {
      for (const hz of horizons) {
        console.log(`\n  ${strat.name} | Vol=${vol}% | ${hz.label}:`);
        const rows: any[] = [];

        for (const spread of spreadLevels) {
          for (const fee of feeLevels) {
            const r = allResults.find(x =>
              x.strategy === strat.name && x.vol === vol && x.days === hz.days
              && x.spreadPct === spread && x.feePerTrade === fee
            );
            if (r) {
              rows.push({
                "Spread%": spread,
                "Fee$": fmtUSD(fee),
                "Sharpe": fmt(r.sharpe, 3),
                "APR%": fmt(r.meanAPR),
                "MaxDD%": fmt(r.maxDD * 100, 1),
                "WinRate%": fmt(r.winRate * 100, 1),
                "Alpha%": fmtSign(r.alpha),
                "ExecCyc": fmt(r.avgExecCycles, 1),
                "CostDrag%": fmtSign(r.costDragAPR),
              });
            }
          }
        }
        console.table(rows);
      }
    }
  }

  // =======================================================
  // SECTION 2: Sharpe Heatmaps (Spread × Fee) Per Strategy
  // =======================================================
  console.log("\n" + "=".repeat(130));
  console.log("=== SECTION 2: SHARPE HEATMAPS (Spread × Fee) ===");
  console.log("=".repeat(130));
  console.log("Sharpe at each (spread, fee) pair. Averaged across vol levels.\n");

  for (const strat of strategies) {
    for (const hz of horizons) {
      console.log(`--- ${strat.name} | ${hz.label} ---`);

      // Header
      const header = ["Spread\\Fee", ...feeLevels.map(f => fmtUSD(f))];
      console.log("  " + header.map(h => h.padStart(10)).join(""));

      for (const spread of spreadLevels) {
        const cells: string[] = [`${spread}%`];
        for (const fee of feeLevels) {
          const subset = allResults.filter(x =>
            x.strategy === strat.name && x.days === hz.days
            && x.spreadPct === spread && x.feePerTrade === fee
          );
          const avgSharpe = avgField(subset, "sharpe");
          cells.push(fmt(avgSharpe, 3));
        }
        console.log("  " + cells.map(c => c.padStart(10)).join(""));
      }
      console.log("");
    }
  }

  // =======================================================
  // SECTION 3: Sharpe Zero-Crossing Analysis
  // =======================================================
  console.log("=".repeat(130));
  console.log("=== SECTION 3: SHARPE ZERO-CROSSING ANALYSIS ===");
  console.log("=".repeat(130));
  console.log("Find the (spread, fee) boundary where Sharpe crosses zero.\n");

  for (const strat of strategies) {
    console.log(`--- ${strat.name} ---`);

    for (const hz of horizons) {
      for (const vol of volLevels) {
        console.log(`  ${hz.label} | Vol=${vol}%:`);

        // Fix fee at baseline ($0.50), vary spread
        console.log(`    Varying spread (fee fixed at $0.50):`);
        const fixedFeeResults = spreadLevels.map(spread => {
          const r = allResults.find(x =>
            x.strategy === strat.name && x.days === hz.days && x.vol === vol
            && x.spreadPct === spread && x.feePerTrade === 0.50
          );
          return { spread, sharpe: r?.sharpe ?? 0 };
        });

        for (const { spread, sharpe } of fixedFeeResults) {
          console.log(`      Spread=${spread}%: Sharpe=${fmt(sharpe, 3)}`);
        }

        // Find zero crossing by interpolation
        let zeroCrossSpread: number | null = null;
        for (let i = 0; i < fixedFeeResults.length - 1; i++) {
          const cross = linearInterp(
            fixedFeeResults[i].spread, fixedFeeResults[i].sharpe,
            fixedFeeResults[i + 1].spread, fixedFeeResults[i + 1].sharpe,
            0,
          );
          if (cross !== null) {
            zeroCrossSpread = cross;
            break;
          }
        }

        if (zeroCrossSpread !== null) {
          console.log(`      → Sharpe crosses zero at ~${fmt(zeroCrossSpread, 1)}% spread.`);
        } else if (fixedFeeResults.every(r => r.sharpe > 0)) {
          console.log(`      → Sharpe remains positive across all tested spreads.`);
        } else {
          console.log(`      → Sharpe negative even at lowest spread — strategy non-viable.`);
        }

        // Fix spread at 5% (baseline), vary fee
        console.log(`    Varying fee (spread fixed at 5%):`);
        const fixedSpreadResults = feeLevels.map(fee => {
          const r = allResults.find(x =>
            x.strategy === strat.name && x.days === hz.days && x.vol === vol
            && x.spreadPct === 5 && x.feePerTrade === fee
          );
          return { fee, sharpe: r?.sharpe ?? 0 };
        });

        for (const { fee, sharpe } of fixedSpreadResults) {
          console.log(`      Fee=${fmtUSD(fee)}: Sharpe=${fmt(sharpe, 3)}`);
        }

        let zeroCrossFee: number | null = null;
        for (let i = 0; i < fixedSpreadResults.length - 1; i++) {
          const cross = linearInterp(
            fixedSpreadResults[i].fee, fixedSpreadResults[i].sharpe,
            fixedSpreadResults[i + 1].fee, fixedSpreadResults[i + 1].sharpe,
            0,
          );
          if (cross !== null) {
            zeroCrossFee = cross;
            break;
          }
        }

        if (zeroCrossFee !== null) {
          console.log(`      → Sharpe crosses zero at ~${fmtUSD(zeroCrossFee)} fee.`);
        } else if (fixedSpreadResults.every(r => r.sharpe > 0)) {
          console.log(`      → Sharpe remains positive across all tested fees.`);
        } else {
          console.log(`      → Sharpe negative even at lowest fee.`);
        }

        console.log("");
      }
    }
  }

  // =======================================================
  // SECTION 4: Cost Sensitivity Coefficients
  // =======================================================
  console.log("=".repeat(130));
  console.log("=== SECTION 4: COST SENSITIVITY (ΔSharpe per 1pp Spread Increase) ===");
  console.log("=".repeat(130));
  console.log("Linear regression of Sharpe on spread% (fee fixed at $0.50).\n");

  for (const strat of strategies) {
    console.log(`--- ${strat.name} ---`);
    const rows: any[] = [];

    for (const hz of horizons) {
      for (const vol of volLevels) {
        const dataPoints = spreadLevels.map(spread => {
          const r = allResults.find(x =>
            x.strategy === strat.name && x.days === hz.days && x.vol === vol
            && x.spreadPct === spread && x.feePerTrade === 0.50
          );
          return { x: spread, y: r?.sharpe ?? 0 };
        });

        // Simple linear regression
        const n = dataPoints.length;
        const sumX = dataPoints.reduce((a, d) => a + d.x, 0);
        const sumY = dataPoints.reduce((a, d) => a + d.y, 0);
        const sumXY = dataPoints.reduce((a, d) => a + d.x * d.y, 0);
        const sumX2 = dataPoints.reduce((a, d) => a + d.x * d.x, 0);
        const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
        const intercept = (sumY - slope * sumX) / n;

        rows.push({
          "Horizon": hz.label,
          "Vol%": vol,
          "Slope (ΔSharpe/pp)": fmt(slope, 4),
          "Intercept": fmt(intercept, 3),
          "Sharpe@1%": fmt(intercept + slope * 1, 3),
          "Sharpe@5%": fmt(intercept + slope * 5, 3),
          "Sharpe@12%": fmt(intercept + slope * 12, 3),
        });
      }
    }
    console.table(rows);
  }

  // =======================================================
  // SECTION 5: Multi-Year Cost Amplification
  // =======================================================
  console.log("\n" + "=".repeat(130));
  console.log("=== SECTION 5: MULTI-YEAR COST AMPLIFICATION ===");
  console.log("=".repeat(130));
  console.log("Does friction compound over 5yr? Compare 1yr vs 5yr Sharpe at each cost level.\n");

  for (const strat of strategies) {
    console.log(`--- ${strat.name} ---`);
    const rows: any[] = [];

    for (const spread of spreadLevels) {
      for (const fee of feeLevels) {
        const r1yr = allResults.filter(x =>
          x.strategy === strat.name && x.days === 365
          && x.spreadPct === spread && x.feePerTrade === fee
        );
        const r5yr = allResults.filter(x =>
          x.strategy === strat.name && x.days === 1825
          && x.spreadPct === spread && x.feePerTrade === fee
        );
        const s1 = avgField(r1yr, "sharpe");
        const s5 = avgField(r5yr, "sharpe");
        const decay = s1 !== 0 ? ((s5 - s1) / Math.abs(s1)) * 100 : 0;

        rows.push({
          "Spread%": spread,
          "Fee$": fmtUSD(fee),
          "Sharpe 1yr": fmt(s1, 3),
          "Sharpe 5yr": fmt(s5, 3),
          "Δ": fmtSign(s5 - s1, 3),
          "Decay%": fmtSign(decay, 1),
        });
      }
    }
    console.table(rows);

    // Summary
    const lowestCost = allResults.filter(x =>
      x.strategy === strat.name && x.spreadPct === 1 && x.feePerTrade === 0.25
    );
    const highestCost = allResults.filter(x =>
      x.strategy === strat.name && x.spreadPct === 12 && x.feePerTrade === 2.00
    );
    const lcS1 = avgField(lowestCost.filter(x => x.days === 365), "sharpe");
    const lcS5 = avgField(lowestCost.filter(x => x.days === 1825), "sharpe");
    const hcS1 = avgField(highestCost.filter(x => x.days === 365), "sharpe");
    const hcS5 = avgField(highestCost.filter(x => x.days === 1825), "sharpe");

    const decayLow = lcS1 !== 0 ? ((lcS5 - lcS1) / Math.abs(lcS1)) * 100 : 0;
    const decayHigh = hcS1 !== 0 ? ((hcS5 - hcS1) / Math.abs(hcS1)) * 100 : 0;

    console.log(`  Lowest cost  (1%/$0.25): 1yr→5yr decay = ${fmtSign(decayLow, 1)}%`);
    console.log(`  Highest cost (12%/$2.00): 1yr→5yr decay = ${fmtSign(decayHigh, 1)}%`);
    if (Math.abs(decayHigh) > Math.abs(decayLow) * 1.5) {
      console.log(`  → Cost AMPLIFIES multi-year degradation.\n`);
    } else {
      console.log(`  → Multi-year decay is NOT materially amplified by costs.\n`);
    }
  }

  // =======================================================
  // SECTION 6: Strategy Comparison at Realistic Costs
  // =======================================================
  console.log("=".repeat(130));
  console.log("=== SECTION 6: STRATEGY COMPARISON AT REALISTIC DERIBIT COSTS ===");
  console.log("=".repeat(130));
  console.log("Realistic Deribit: spread ~5-8%, fee ~$0.50-$1.00.");
  console.log("Compare strategies at (5%, $0.50) = optimistic and (8%, $1.00) = conservative.\n");

  const realisticCosts = [
    { label: "Optimistic (5%/$0.50)", spread: 5, fee: 0.50 },
    { label: "Conservative (8%/$1.00)", spread: 8, fee: 1.00 },
  ];

  for (const cost of realisticCosts) {
    console.log(`--- ${cost.label} ---`);
    const rows: any[] = [];

    for (const strat of strategies) {
      for (const hz of horizons) {
        const subset = allResults.filter(x =>
          x.strategy === strat.name && x.days === hz.days
          && x.spreadPct === cost.spread && x.feePerTrade === cost.fee
        );
        const avgSharpe = avgField(subset, "sharpe");
        const avgAPR = avgField(subset, "meanAPR");
        const avgMaxDD = avgField(subset, "maxDD") * 100;
        const avgWin = avgField(subset, "winRate") * 100;
        const avgAlpha = avgField(subset, "alpha");
        const avgExec = avgField(subset, "avgExecCycles");

        rows.push({
          "Strategy": strat.name,
          "Horizon": hz.label,
          "Sharpe": fmt(avgSharpe, 3),
          "APR%": fmt(avgAPR),
          "MaxDD%": fmt(avgMaxDD, 1),
          "WinRate%": fmt(avgWin, 1),
          "Alpha%": fmtSign(avgAlpha),
          "Exec Cycles": fmt(avgExec, 1),
        });
      }
    }
    console.table(rows);
  }

  // =======================================================
  // SECTION 7: Trade Frequency vs Cost Sensitivity
  // =======================================================
  console.log("\n" + "=".repeat(130));
  console.log("=== SECTION 7: TRADE FREQUENCY vs COST SENSITIVITY ===");
  console.log("=".repeat(130));
  console.log("Active does ~8 trades/yr, Conservative ~0.4. Does higher frequency");
  console.log("make Active more cost-sensitive per Sharpe point?\n");

  for (const hz of horizons) {
    console.log(`--- ${hz.label} ---`);
    const rows: any[] = [];

    for (const strat of strategies) {
      // Sharpe at lowest vs highest cost
      const low = allResults.filter(x =>
        x.strategy === strat.name && x.days === hz.days
        && x.spreadPct === 1 && x.feePerTrade === 0.25
      );
      const high = allResults.filter(x =>
        x.strategy === strat.name && x.days === hz.days
        && x.spreadPct === 12 && x.feePerTrade === 2.00
      );
      const sharpeRange = avgField(low, "sharpe") - avgField(high, "sharpe");
      const avgExecLow = avgField(low, "avgExecCycles");
      const avgExecHigh = avgField(high, "avgExecCycles");
      const sharpeLoss = sharpeRange;
      const sharpePerCycle = avgExecLow > 0 ? sharpeLoss / avgExecLow : 0;

      rows.push({
        "Strategy": strat.name,
        "Avg Exec Cycles": fmt(avgExecLow, 1),
        "Sharpe@Low": fmt(avgField(low, "sharpe"), 3),
        "Sharpe@High": fmt(avgField(high, "sharpe"), 3),
        "Total ΔSharpe": fmtSign(-sharpeLoss, 3),
        "ΔSharpe/Cycle": fmt(-sharpePerCycle, 4),
      });
    }
    console.table(rows);
  }

  // =======================================================
  // SECTION 8: Breakeven Analysis
  // =======================================================
  console.log("\n" + "=".repeat(130));
  console.log("=== SECTION 8: BREAKEVEN ANALYSIS ===");
  console.log("=".repeat(130));
  console.log("Maximum cost at which each strategy maintains Sharpe ≥ 0.20 (deployment threshold).\n");

  for (const strat of strategies) {
    console.log(`--- ${strat.name} ---`);

    for (const hz of horizons) {
      for (const vol of volLevels) {
        console.log(`  ${hz.label} | Vol=${vol}%:`);

        // Scan all (spread, fee) combos
        const viable: { spread: number; fee: number; sharpe: number }[] = [];
        const nonViable: { spread: number; fee: number; sharpe: number }[] = [];

        for (const spread of spreadLevels) {
          for (const fee of feeLevels) {
            const r = allResults.find(x =>
              x.strategy === strat.name && x.days === hz.days && x.vol === vol
              && x.spreadPct === spread && x.feePerTrade === fee
            );
            if (r) {
              if (r.sharpe >= 0.20) {
                viable.push({ spread, fee, sharpe: r.sharpe });
              } else {
                nonViable.push({ spread, fee, sharpe: r.sharpe });
              }
            }
          }
        }

        if (viable.length === 0) {
          console.log(`    No cost level achieves Sharpe ≥ 0.20.`);
          const bestCombo = allResults
            .filter(x => x.strategy === strat.name && x.days === hz.days && x.vol === vol)
            .sort((a, b) => b.sharpe - a.sharpe)[0];
          if (bestCombo) {
            console.log(`    Best: spread=${bestCombo.spreadPct}%, fee=${fmtUSD(bestCombo.feePerTrade)}, Sharpe=${fmt(bestCombo.sharpe, 3)}`);
          }
        } else {
          // Find the highest-cost viable combo
          const maxCostViable = viable.sort((a, b) =>
            (b.spread + b.fee * 10) - (a.spread + a.fee * 10)
          )[0];
          console.log(`    Viable up to spread=${maxCostViable.spread}%, fee=${fmtUSD(maxCostViable.fee)} (Sharpe=${fmt(maxCostViable.sharpe, 3)})`);
          console.log(`    ${viable.length}/${viable.length + nonViable.length} cost combos achieve Sharpe ≥ 0.20.`);
        }
      }
      console.log("");
    }
  }

  // =======================================================
  // SECTION 9: Recommendations
  // =======================================================
  console.log("=".repeat(130));
  console.log("=== SECTION 9: RECOMMENDATIONS ===");
  console.log("=".repeat(130) + "\n");

  console.log("--- COST RESILIENCE RANKING ---\n");

  for (const strat of strategies) {
    console.log(`  ${strat.name}:`);

    // At baseline (5%, $0.50)
    const baseline5 = allResults.filter(x =>
      x.strategy === strat.name && x.spreadPct === 5 && x.feePerTrade === 0.50
    );
    const blS1 = avgField(baseline5.filter(x => x.days === 365), "sharpe");
    const blS5 = avgField(baseline5.filter(x => x.days === 1825), "sharpe");
    const blAPR1 = avgField(baseline5.filter(x => x.days === 365), "meanAPR");
    const blAPR5 = avgField(baseline5.filter(x => x.days === 1825), "meanAPR");

    console.log(`    Baseline (5%/$0.50): 1yr Sharpe=${fmt(blS1, 3)}, APR=${fmt(blAPR1)}% | 5yr Sharpe=${fmt(blS5, 3)}, APR=${fmt(blAPR5)}%`);

    // At conservative (8%, $1.00)
    const cons = allResults.filter(x =>
      x.strategy === strat.name && x.spreadPct === 8 && x.feePerTrade === 1.00
    );
    const cS1 = avgField(cons.filter(x => x.days === 365), "sharpe");
    const cS5 = avgField(cons.filter(x => x.days === 1825), "sharpe");
    const cAPR1 = avgField(cons.filter(x => x.days === 365), "meanAPR");
    const cAPR5 = avgField(cons.filter(x => x.days === 1825), "meanAPR");

    console.log(`    Conservative (8%/$1.00): 1yr Sharpe=${fmt(cS1, 3)}, APR=${fmt(cAPR1)}% | 5yr Sharpe=${fmt(cS5, 3)}, APR=${fmt(cAPR5)}%`);

    // At worst (12%, $2.00)
    const worst = allResults.filter(x =>
      x.strategy === strat.name && x.spreadPct === 12 && x.feePerTrade === 2.00
    );
    const wS1 = avgField(worst.filter(x => x.days === 365), "sharpe");
    const wS5 = avgField(worst.filter(x => x.days === 1825), "sharpe");

    console.log(`    Worst (12%/$2.00): 1yr Sharpe=${fmt(wS1, 3)} | 5yr Sharpe=${fmt(wS5, 3)}`);

    // Verdict
    if (cS5 > 0.20) {
      console.log(`    → RESILIENT: Maintains deployable Sharpe even at conservative costs.\n`);
    } else if (cS1 > 0.20) {
      console.log(`    → SHORT-TERM ONLY: Deployable at 1yr but not 5yr at conservative costs.\n`);
    } else if (blS1 > 0.20) {
      console.log(`    → FRAGILE: Only deployable at optimistic cost assumptions.\n`);
    } else {
      console.log(`    → NON-VIABLE: Edge consumed by friction at all realistic cost levels.\n`);
    }
  }

  // Overall findings
  console.log("--- KEY FINDINGS ---\n");

  // Does Active survive?
  const activeBaseline1yr = allResults.filter(x =>
    x.strategy === "Active (δ0.20/3d)" && x.days === 365
    && x.spreadPct === 5 && x.feePerTrade === 0.50
  );
  const activeBaseline5yr = allResults.filter(x =>
    x.strategy === "Active (δ0.20/3d)" && x.days === 1825
    && x.spreadPct === 5 && x.feePerTrade === 0.50
  );
  console.log(`  Active at baseline costs (5%/$0.50):`);
  console.log(`    1yr: Sharpe=${fmt(avgField(activeBaseline1yr, "sharpe"), 3)}, APR=${fmt(avgField(activeBaseline1yr, "meanAPR"))}%`);
  console.log(`    5yr: Sharpe=${fmt(avgField(activeBaseline5yr, "sharpe"), 3)}, APR=${fmt(avgField(activeBaseline5yr, "meanAPR"))}%`);

  const activeCons1yr = allResults.filter(x =>
    x.strategy === "Active (δ0.20/3d)" && x.days === 365
    && x.spreadPct === 8 && x.feePerTrade === 1.00
  );
  const activeCons5yr = allResults.filter(x =>
    x.strategy === "Active (δ0.20/3d)" && x.days === 1825
    && x.spreadPct === 8 && x.feePerTrade === 1.00
  );
  console.log(`  Active at conservative costs (8%/$1.00):`);
  console.log(`    1yr: Sharpe=${fmt(avgField(activeCons1yr, "sharpe"), 3)}, APR=${fmt(avgField(activeCons1yr, "meanAPR"))}%`);
  console.log(`    5yr: Sharpe=${fmt(avgField(activeCons5yr, "sharpe"), 3)}, APR=${fmt(avgField(activeCons5yr, "meanAPR"))}%`);

  if (avgField(activeCons5yr, "sharpe") > 0.20) {
    console.log(`  → Active's multi-year advantage SURVIVES realistic friction.\n`);
  } else if (avgField(activeCons1yr, "sharpe") > 0.20) {
    console.log(`  → Active is cost-fragile: deployable at 1yr but multi-year edge erodes.\n`);
  } else {
    console.log(`  → Active's edge is CONSUMED by realistic execution costs.\n`);
  }

  // Does Moderate become the practical choice?
  const modCons1yr = allResults.filter(x =>
    x.strategy === "Moderate (δ0.20/14d)" && x.days === 365
    && x.spreadPct === 8 && x.feePerTrade === 1.00
  );
  const modSharpe = avgField(modCons1yr, "sharpe");
  const actSharpe = avgField(activeCons1yr, "sharpe");

  if (modSharpe > actSharpe) {
    console.log(`  Moderate OVERTAKES Active at conservative costs (Sharpe ${fmt(modSharpe, 3)} vs ${fmt(actSharpe, 3)}).`);
    console.log(`  → Moderate becomes the practical deployment choice at higher friction.\n`);
  } else {
    console.log(`  Active remains dominant even at conservative costs (Sharpe ${fmt(actSharpe, 3)} vs Moderate ${fmt(modSharpe, 3)}).\n`);
  }

  console.log("\n=== END OF EXPERIMENT 13 ===\n");
}

main().catch(console.error);
