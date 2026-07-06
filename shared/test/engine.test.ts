import { describe, expect, it } from 'vitest';
import {
  Action,
  EngineError,
  GameConfig,
  GameState,
  buildDefaultConfig,
  createGame,
  priceFloor,
  reduce,
  referenceCost,
  viewFor,
} from '../src/index.ts';

/** Tiny hand-computable config: 2 SKUs, 2 dedicated lines, zero volatility. */
function testConfig(overrides: Partial<GameConfig> = {}): GameConfig {
  return {
    seed: 'test-seed',
    months: 3,
    difficulty: 'easy',
    demandVolatility: 0,
    skus: [
      {
        id: 'S1', name: 'Alpha Cola', allowedLineIds: ['L1'],
        ageLossCostPerUnitPerMonth: 1, shelfLifeMonths: 3, historicalMonthlyDemand: 200,
      },
      {
        id: 'S2', name: 'Berry Blast', allowedLineIds: ['L2'],
        ageLossCostPerUnitPerMonth: 1, shelfLifeMonths: 3, historicalMonthlyDemand: 200,
      },
    ],
    lines: [
      { id: 'L1', name: 'Line 1', capacityPerMonth: 300, costPerUnit: 10 },
      { id: 'L2', name: 'Line 2', capacityPerMonth: 300, costPerUnit: 12 },
    ],
    transport: {
      truckload: { costPerUnit: 4, leadWeeks: 1 },
      interplant: { costPerUnit: 1.5, leadWeeks: 3 },
    },
    holdingCostPerUnitPerMonth: 0.5,
    startingBudget: 100_000,
    overdraftLimit: 50_000,
    overdraftInterestRate: 0.02,
    numCustomers: 2,
    maxTradePriceMultiplier: 3,
    ...overrides,
  };
}

function apply(state: GameState, actions: Action[]): GameState {
  return actions.reduce((s, a) => reduce(s, a), state);
}

/** Lobby with 1 admin + two 5-player teams, roles assigned a1..a5 / b1..b5. */
function lobby(config = testConfig()): GameState {
  let s = createGame(config, 'ABC123');
  s = apply(s, [
    { type: 'JOIN', playerId: 'adm', name: 'Admin', asAdmin: true },
    { type: 'JOIN', playerId: 'a1', name: 'Ann', asAdmin: false },
    { type: 'JOIN', playerId: 'a2', name: 'Al', asAdmin: false },
    { type: 'JOIN', playerId: 'a3', name: 'Amy', asAdmin: false },
    { type: 'JOIN', playerId: 'a4', name: 'Abe', asAdmin: false },
    { type: 'JOIN', playerId: 'a5', name: 'Ace', asAdmin: false },
    { type: 'JOIN', playerId: 'b1', name: 'Bea', asAdmin: false },
    { type: 'JOIN', playerId: 'b2', name: 'Bob', asAdmin: false },
    { type: 'JOIN', playerId: 'b3', name: 'Ben', asAdmin: false },
    { type: 'JOIN', playerId: 'b4', name: 'Bex', asAdmin: false },
    { type: 'JOIN', playerId: 'b5', name: 'Bo', asAdmin: false },
    { type: 'CREATE_TEAM', playerId: 'a1', name: 'Alpha' },
    { type: 'CREATE_TEAM', playerId: 'b1', name: 'Beta' },
  ]);
  const roles = ['DEMAND_PLANNER', 'PRODUCTION_PLANNER', 'TRANSPORT_MANAGER', 'CUSTOMER_OPS', 'CEO'] as const;
  for (const [prefix, teamId] of [['a', 'T1'], ['b', 'T2']] as const) {
    for (let i = 0; i < 5; i++) {
      const pid = `${prefix}${i + 1}`;
      if (i > 0) s = reduce(s, { type: 'JOIN_TEAM', playerId: pid, teamId });
      s = reduce(s, { type: 'CLAIM_ROLE', playerId: pid, role: roles[i] });
    }
  }
  return s;
}

/** Play one month with the given decisions, through to the RESULTS phase. */
function playMonth(
  s: GameState,
  opts: {
    aProd?: { lineId: string; skuId: string; qty: number }[];
    bProd?: { lineId: string; skuId: string; qty: number }[];
    aPrices?: Record<string, number>;
    bPrices?: Record<string, number>;
    orders?: Record<string, number>;
    duringTrading?: Action[];
  },
): GameState {
  s = apply(s, [
    { type: 'SUBMIT_FORECAST', playerId: 'a1', forecast: { S1: 200, S2: 200 } },
    { type: 'SUBMIT_FORECAST', playerId: 'b1', forecast: { S1: 200, S2: 200 } },
    { type: 'ADVANCE_PHASE', playerId: 'adm' }, // -> PRODUCTION
    { type: 'SUBMIT_PRODUCTION', playerId: 'a2', allocations: opts.aProd ?? [] },
    { type: 'SUBMIT_PRODUCTION', playerId: 'b2', allocations: opts.bProd ?? [] },
    { type: 'ADVANCE_PHASE', playerId: 'adm' }, // -> TRANSPORT
    { type: 'SUBMIT_TRANSPORT', playerId: 'a3', modes: { S1: 'truckload', S2: 'truckload' } },
    { type: 'SUBMIT_TRANSPORT', playerId: 'b3', modes: { S1: 'truckload', S2: 'truckload' } },
    { type: 'ADVANCE_PHASE', playerId: 'adm' }, // -> PRICING
  ]);
  if (opts.aPrices) s = reduce(s, { type: 'SUBMIT_PRICES', playerId: 'a4', prices: opts.aPrices });
  if (opts.bPrices) s = reduce(s, { type: 'SUBMIT_PRICES', playerId: 'b4', prices: opts.bPrices });
  s = reduce(s, { type: 'ADVANCE_PHASE', playerId: 'adm' }); // -> TRADING
  s = apply(s, opts.duringTrading ?? []);
  s = reduce(s, { type: 'ADVANCE_PHASE', playerId: 'adm' }); // -> ORDERS
  if (opts.orders) s = reduce(s, { type: 'SUBMIT_ORDERS', playerId: 'adm', orders: opts.orders });
  s = reduce(s, { type: 'ADVANCE_PHASE', playerId: 'adm' }); // resolve -> RESULTS
  return s;
}

describe('lobby rules', () => {
  it('first joiner becomes admin; admins cannot join teams', () => {
    let s = createGame(testConfig(), 'XYZ');
    s = reduce(s, { type: 'JOIN', playerId: 'p1', name: 'First', asAdmin: false });
    expect(s.players[0].isAdmin).toBe(true);
    expect(() => reduce(s, { type: 'CREATE_TEAM', playerId: 'p1', name: 'Nope' })).toThrow(EngineError);
  });

  it('cannot promote a team member to admin, and roles are unique per team', () => {
    const s = lobby();
    expect(() =>
      reduce(s, { type: 'SET_ADMIN', playerId: 'adm', targetPlayerId: 'a1', isAdmin: true }),
    ).toThrow(/cannot be part of a team/);
    expect(() =>
      reduce(s, { type: 'CLAIM_ROLE', playerId: 'a2', role: 'DEMAND_PLANNER' }),
    ).toThrow(/already taken/);
  });

  it('teams are capped at 5 players', () => {
    let s = lobby();
    s = reduce(s, { type: 'JOIN', playerId: 'x1', name: 'Extra', asAdmin: false });
    expect(() => reduce(s, { type: 'JOIN_TEAM', playerId: 'x1', teamId: 'T1' })).toThrow(/5 players/);
  });
});

describe('month 1 economics (hand-computed)', () => {
  const start = reduce(lobby(), { type: 'START_GAME', playerId: 'adm' });

  const month1 = playMonth(start, {
    aProd: [{ lineId: 'L1', skuId: 'S1', qty: 250 }],
    bProd: [{ lineId: 'L2', skuId: 'S2', qty: 250 }],
    aPrices: { S1: 20, S2: 16.5 },
    bPrices: { S1: 14.5, S2: 22 },
    orders: { S1: 200, S2: 200 },
  });

  it('computes Alpha month-1 P&L exactly', () => {
    const alpha = month1.teams[0];
    const r = alpha.results[0];
    // production 250x10=2500, transport 250x4=1000, sold 200 S1 @20 = 4000
    // 50 left @ age 0 -> holding 25, age loss 0
    expect(r.productionCost).toBe(2500);
    expect(r.transportCost).toBe(1000);
    expect(r.revenue).toBe(4000);
    expect(r.holdingCost).toBe(25);
    expect(r.ageLossCost).toBe(0);
    expect(r.profit).toBe(475);
    expect(r.fillRate).toBe(0.5); // fulfilled 200 of 400 ordered units
    expect(alpha.budget).toBe(100_475);
    expect(alpha.inventory.S1).toEqual([{ qty: 50, age: 1 }]);
  });

  it('both teams face identical realized orders', () => {
    const [alpha, beta] = month1.teams;
    for (const sku of ['S1', 'S2']) {
      expect(alpha.results[0].bySku[sku].ordered).toBe(beta.results[0].bySku[sku].ordered);
    }
    expect(month1.orderHistory[1]).toEqual({ S1: 200, S2: 200 });
  });

  it('price floor is production + transport + holding, and is enforced', () => {
    let s = apply(start, [
      { type: 'SUBMIT_FORECAST', playerId: 'a1', forecast: { S1: 200, S2: 200 } },
      { type: 'ADVANCE_PHASE', playerId: 'adm' },
      { type: 'SUBMIT_PRODUCTION', playerId: 'a2', allocations: [{ lineId: 'L1', skuId: 'S1', qty: 100 }] },
      { type: 'ADVANCE_PHASE', playerId: 'adm' },
      { type: 'ADVANCE_PHASE', playerId: 'adm' }, // transport defaults to truckload
    ]);
    expect(priceFloor(s, s.teams[0], 'S1')).toBe(14.5); // 10 + 4 + 0.5
    expect(priceFloor(s, s.teams[0], 'S2')).toBe(16.5); // no production -> cheapest line 12
    expect(() =>
      reduce(s, { type: 'SUBMIT_PRICES', playerId: 'a4', prices: { S1: 14, S2: 17 } }),
    ).toThrow(/below the cost floor/);
  });

  it('rejects over-capacity and wrong-line production plans', () => {
    const s = apply(start, [
      { type: 'ADVANCE_PHASE', playerId: 'adm' }, // -> PRODUCTION (forecast defaults)
    ]);
    expect(() =>
      reduce(s, { type: 'SUBMIT_PRODUCTION', playerId: 'a2', allocations: [{ lineId: 'L1', skuId: 'S1', qty: 301 }] }),
    ).toThrow(/capacity exceeded/);
    expect(() =>
      reduce(s, { type: 'SUBMIT_PRODUCTION', playerId: 'a2', allocations: [{ lineId: 'L2', skuId: 'S1', qty: 10 }] }),
    ).toThrow(/cannot be manufactured/);
  });

  it('trading in month 1 fails: no stock on hand yet (production lands at resolution)', () => {
    let s = apply(start, [
      { type: 'ADVANCE_PHASE', playerId: 'adm' },
      { type: 'SUBMIT_PRODUCTION', playerId: 'a2', allocations: [{ lineId: 'L1', skuId: 'S1', qty: 250 }] },
      { type: 'ADVANCE_PHASE', playerId: 'adm' },
      { type: 'ADVANCE_PHASE', playerId: 'adm' },
      { type: 'ADVANCE_PHASE', playerId: 'adm' }, // -> TRADING
      { type: 'PROPOSE_TRADE', playerId: 'b5', sellerTeamId: 'T1', skuId: 'S1', qty: 50, unitPrice: 20 },
    ]);
    expect(() =>
      reduce(s, { type: 'RESPOND_TRADE', playerId: 'a5', offerId: s.tradeOffers[0].id, accept: true }),
    ).toThrow(/enough stock on hand/);
  });
});

describe('month 2: trading settlement', () => {
  const start = reduce(lobby(), { type: 'START_GAME', playerId: 'adm' });
  const month1 = playMonth(start, {
    aProd: [{ lineId: 'L1', skuId: 'S1', qty: 250 }],
    bProd: [{ lineId: 'L2', skuId: 'S2', qty: 250 }],
    aPrices: { S1: 20, S2: 16.5 },
    bPrices: { S1: 14.5, S2: 22 },
    orders: { S1: 200, S2: 200 },
  });
  const toMonth2 = reduce(month1, { type: 'ADVANCE_PHASE', playerId: 'adm' }); // -> month 2 FORECAST

  it('transfers stock (preserving age) and cash between teams', () => {
    // Beta buys Alpha's 50 leftover S1 units at 30/unit during TRADING
    let t = apply(toMonth2, [
      { type: 'SUBMIT_FORECAST', playerId: 'a1', forecast: { S1: 200, S2: 200 } },
      { type: 'ADVANCE_PHASE', playerId: 'adm' },
      { type: 'SUBMIT_PRODUCTION', playerId: 'a2', allocations: [{ lineId: 'L1', skuId: 'S1', qty: 200 }] },
      { type: 'SUBMIT_PRODUCTION', playerId: 'b2', allocations: [{ lineId: 'L2', skuId: 'S2', qty: 200 }] },
      { type: 'ADVANCE_PHASE', playerId: 'adm' },
      { type: 'ADVANCE_PHASE', playerId: 'adm' }, // transport defaults
      { type: 'SUBMIT_PRICES', playerId: 'a4', prices: { S1: 20, S2: 16.5 } },
      { type: 'SUBMIT_PRICES', playerId: 'b4', prices: { S1: 18, S2: 22 } },
      { type: 'ADVANCE_PHASE', playerId: 'adm' }, // -> TRADING
      { type: 'PROPOSE_TRADE', playerId: 'b5', sellerTeamId: 'T1', skuId: 'S1', qty: 50, unitPrice: 30 },
    ]);
    const alphaBudgetBefore = t.teams[0].budget;
    const betaBudgetBefore = t.teams[1].budget;
    t = reduce(t, { type: 'RESPOND_TRADE', playerId: 'a5', offerId: t.tradeOffers[0].id, accept: true });

    expect(t.teams[0].budget).toBe(alphaBudgetBefore + 1500);
    expect(t.teams[1].budget).toBe(betaBudgetBefore - 1500);
    expect(t.teams[0].inventory.S1).toEqual([]); // Alpha sold its 50 leftovers
    expect(t.teams[1].inventory.S1).toEqual([{ qty: 50, age: 1 }]); // age preserved

    // resolve the month: trade amounts appear in both teams' results
    t = apply(t, [
      { type: 'ADVANCE_PHASE', playerId: 'adm' }, // -> ORDERS
      { type: 'SUBMIT_ORDERS', playerId: 'adm', orders: { S1: 200, S2: 200 } },
      { type: 'ADVANCE_PHASE', playerId: 'adm' }, // resolve
    ]);
    expect(t.teams[0].results[1].tradeSells).toBe(1500);
    expect(t.teams[1].results[1].tradeBuys).toBe(1500);
    // Beta sold the 50 bought S1 units at its price 18
    expect(t.teams[1].results[1].bySku.S1.fulfilled).toBe(50);
  });

  it('caps trade prices to prevent collusion', () => {
    let t = apply(toMonth2, [
      { type: 'ADVANCE_PHASE', playerId: 'adm' },
      { type: 'ADVANCE_PHASE', playerId: 'adm' },
      { type: 'ADVANCE_PHASE', playerId: 'adm' },
      { type: 'ADVANCE_PHASE', playerId: 'adm' }, // -> TRADING with defaults
    ]);
    const cap = referenceCost(t.config, 'S1') * t.config.maxTradePriceMultiplier; // 14.5 * 3
    expect(() =>
      reduce(t, { type: 'PROPOSE_TRADE', playerId: 'b5', sellerTeamId: 'T1', skuId: 'S1', qty: 10, unitPrice: cap + 1 }),
    ).toThrow(/anti-collusion cap/);
  });
});

describe('edge economics', () => {
  it('charges overdraft interest on negative budgets', () => {
    const cfg = testConfig({ startingBudget: 1000, overdraftLimit: 50_000 });
    let s = reduce(lobby(cfg), { type: 'START_GAME', playerId: 'adm' });
    s = playMonth(s, {
      aProd: [{ lineId: 'L1', skuId: 'S1', qty: 250 }],
      orders: { S1: 0, S2: 0 }, // customers buy nothing -> pure cost month
    });
    const r = s.teams[0].results[0];
    // budget: 1000 - 2500 - 1000 - 125 holding = -2625, interest 2% = 52.5
    expect(r.holdingCost).toBe(125);
    expect(r.overdraftInterest).toBe(52.5);
    expect(s.teams[0].budget).toBe(-2677.5);
  });

  it('blocks production plans beyond the overdraft limit', () => {
    const cfg = testConfig({ startingBudget: 1000, overdraftLimit: 100 });
    let s = reduce(lobby(cfg), { type: 'START_GAME', playerId: 'adm' });
    s = reduce(s, { type: 'ADVANCE_PHASE', playerId: 'adm' }); // -> PRODUCTION
    expect(() =>
      reduce(s, { type: 'SUBMIT_PRODUCTION', playerId: 'a2', allocations: [{ lineId: 'L1', skuId: 'S1', qty: 250 }] }),
    ).toThrow(/overdraft limit/);
  });

  it('writes off stock past its shelf life', () => {
    const cfg = testConfig({
      skus: testConfig().skus.map((s) => ({ ...s, shelfLifeMonths: 1 })),
    });
    let s = reduce(lobby(cfg), { type: 'START_GAME', playerId: 'adm' });
    s = playMonth(s, {
      aProd: [{ lineId: 'L1', skuId: 'S1', qty: 300 }],
      aPrices: { S1: 20, S2: 16.5 },
      orders: { S1: 200, S2: 0 },
    }); // 100 units left at age 1
    s = reduce(s, { type: 'ADVANCE_PHASE', playerId: 'adm' }); // month 2
    s = playMonth(s, { orders: { S1: 0, S2: 0 } }); // nothing sells; age-1 stock expires
    expect(s.teams[0].results[1].expiredUnits).toBe(100);
    expect(s.teams[0].inventory.S1).toEqual([]);
  });
});

describe('demand generation', () => {
  it('is deterministic for the same seed and differs across seeds', () => {
    const cfg = testConfig({ demandVolatility: 0.25 });
    const run = (seed: string) => {
      let s = reduce(lobby({ ...cfg, seed }), { type: 'START_GAME', playerId: 'adm' });
      s = playMonth(s, { orders: undefined }); // accept engine proposal
      s = reduce(s, { type: 'ADVANCE_PHASE', playerId: 'adm' });
      s = playMonth(s, { orders: undefined });
      return s.orderHistory;
    };
    expect(run('seed-A')).toEqual(run('seed-A'));
    expect(JSON.stringify(run('seed-A'))).not.toEqual(JSON.stringify(run('seed-B')));
  });

  it('steady state: with zero volatility, customer orders stay at baseline', () => {
    const cfg = testConfig();
    let s = reduce(lobby(cfg), { type: 'START_GAME', playerId: 'adm' });
    s = playMonth(s, { orders: { S1: 200, S2: 200 } });
    s = reduce(s, { type: 'ADVANCE_PHASE', playerId: 'adm' });
    // advance to ORDERS to see the proposal
    s = apply(s, [
      { type: 'ADVANCE_PHASE', playerId: 'adm' },
      { type: 'ADVANCE_PHASE', playerId: 'adm' },
      { type: 'ADVANCE_PHASE', playerId: 'adm' },
      { type: 'ADVANCE_PHASE', playerId: 'adm' },
      { type: 'ADVANCE_PHASE', playerId: 'adm' },
    ]);
    expect(s.phase).toBe('ORDERS');
    expect(s.proposedOrders).toEqual({ S1: 200, S2: 200 });
  });
});

describe('view redaction', () => {
  const start = reduce(lobby(), { type: 'START_GAME', playerId: 'adm' });

  it('hides other teams and unreleased prices from team audiences', () => {
    let s = apply(start, [
      { type: 'ADVANCE_PHASE', playerId: 'adm' },
      { type: 'ADVANCE_PHASE', playerId: 'adm' },
      { type: 'ADVANCE_PHASE', playerId: 'adm' }, // -> PRICING
      { type: 'SUBMIT_PRICES', playerId: 'b4', prices: { S1: 14.5, S2: 22 } },
    ]);
    const alphaView = viewFor(s, 'team:T1');
    expect(alphaView.priceBoard).toBeNull(); // not revealed until TRADING
    expect(alphaView.allTeams).toBeNull();
    expect(alphaView.myTeam?.id).toBe('T1');
    expect(alphaView.log).toBeNull();
    expect(alphaView.proposedOrders).toBeNull();

    s = reduce(s, { type: 'ADVANCE_PHASE', playerId: 'adm' }); // -> TRADING
    const revealed = viewFor(s, 'team:T1');
    expect(revealed.priceBoard?.length).toBe(2);
    // cheapest average price first
    expect(revealed.priceBoard![0].teamName).toBeDefined();
  });

  it('admins see everything; everyone sees the profit board at game over', () => {
    const adminView = viewFor(start, 'admin');
    expect(adminView.allTeams?.length).toBe(2);
    expect(adminView.profitBoard).not.toBeNull();
    expect(adminView.log).not.toBeNull();

    let s = start;
    for (let m = 0; m < 3; m++) {
      s = playMonth(s, { orders: { S1: 0, S2: 0 } });
      s = reduce(s, { type: 'ADVANCE_PHASE', playerId: 'adm' });
    }
    expect(s.phase).toBe('GAME_OVER');
    const publicView = viewFor(s, 'public');
    expect(publicView.profitBoard?.length).toBe(2);
    expect(publicView.allTeams?.length).toBe(2);
  });
});

describe('determinism & defaults', () => {
  it('a full identical action script yields byte-identical state', () => {
    const script = () => {
      let s = reduce(lobby(), { type: 'START_GAME', playerId: 'adm' });
      s = playMonth(s, {
        aProd: [{ lineId: 'L1', skuId: 'S1', qty: 250 }],
        bProd: [{ lineId: 'L2', skuId: 'S2', qty: 250 }],
        aPrices: { S1: 20, S2: 16.5 },
        bPrices: { S1: 14.5, S2: 22 },
      });
      return JSON.stringify(s);
    };
    expect(script()).toEqual(script());
  });

  it('default config: tight capacity forces specialization', () => {
    const cfg = buildDefaultConfig({
      seed: 'x', months: 10, numSkus: 5, difficulty: 'medium', numCustomers: 5,
    });
    const totalCapacity = cfg.lines.reduce((s, l) => s + l.capacityPerMonth, 0);
    const totalDemand = cfg.skus.reduce((s, k) => s + k.historicalMonthlyDemand, 0);
    expect(totalCapacity).toBeLessThan(totalDemand);
    expect(totalCapacity / totalDemand).toBeCloseTo(0.6, 1);
  });
});
