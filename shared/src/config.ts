import type { Difficulty, GameConfig, LineConfig, SkuConfig } from './types.js';

export interface SetupOptions {
  seed: string;
  months: number;
  numSkus: number;
  difficulty: Difficulty;
  numCustomers: number;
  startingBudget?: number;
}

const DIFFICULTY_PRESETS: Record<
  Difficulty,
  { volatility: number; capacityFactor: number; shelfLifeMonths: number }
> = {
  // capacityFactor = total line capacity as a share of total baseline demand.
  // Below 1.0 no team can make everything -> forces specialization + trading.
  easy: { volatility: 0.1, capacityFactor: 0.75, shelfLifeMonths: 6 },
  medium: { volatility: 0.25, capacityFactor: 0.6, shelfLifeMonths: 4 },
  hard: { volatility: 0.4, capacityFactor: 0.5, shelfLifeMonths: 3 },
};

export const SKU_NAMES = [
  'Alpha Cola',
  'Berry Blast',
  'Citrus Fizz',
  'Dark Roast',
  'Energy Max',
  'Fresh Mint',
  'Golden Ale',
  'Honey Tea',
];

/**
 * Build a playable default configuration. Everything here is editable in the
 * admin setup wizard before the game starts.
 */
export function buildDefaultConfig(opts: SetupOptions): GameConfig {
  const preset = DIFFICULTY_PRESETS[opts.difficulty];
  const numSkus = Math.max(1, Math.min(8, opts.numSkus));
  const baselinePerSku = opts.numCustomers * 100; // e.g. 5 customers x 100 units
  const totalBaseline = baselinePerSku * numSkus;

  const numLines = Math.max(2, numSkus - 1);
  const capPerLine = Math.round((totalBaseline * preset.capacityFactor) / numLines);

  const lines: LineConfig[] = Array.from({ length: numLines }, (_, i) => ({
    id: `L${i + 1}`,
    name: `Line ${i + 1}`,
    capacityPerMonth: capPerLine,
    // some lines are cheaper than others so allocation choices matter
    costPerUnit: 10 + (i % 3),
  }));

  const skus: SkuConfig[] = Array.from({ length: numSkus }, (_, i) => ({
    id: `S${i + 1}`,
    name: SKU_NAMES[i] ?? `SKU ${i + 1}`,
    // each SKU can run on two lines so there is routing flexibility
    allowedLineIds: [lines[i % numLines].id, lines[(i + 1) % numLines].id],
    ageLossCostPerUnitPerMonth: 1,
    shelfLifeMonths: preset.shelfLifeMonths,
    historicalMonthlyDemand: baselinePerSku,
  }));

  const startingBudget = opts.startingBudget ?? 100_000;

  return {
    seed: opts.seed,
    months: opts.months,
    difficulty: opts.difficulty,
    demandVolatility: preset.volatility,
    skus,
    lines,
    transport: {
      truckload: { costPerUnit: 4, leadWeeks: 1 },
      interplant: { costPerUnit: 1.5, leadWeeks: 3 },
    },
    holdingCostPerUnitPerMonth: 0.5,
    startingBudget,
    overdraftLimit: Math.round(startingBudget * 0.5),
    overdraftInterestRate: 0.02,
    numCustomers: opts.numCustomers,
    maxTradePriceMultiplier: 3,
  };
}
