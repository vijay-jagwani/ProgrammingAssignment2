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
    allocations?: Record<string, Record<string, number>>;
    duringTrading?: Action[];
  },
): GameState {
  s = apply(s, [
    { type: 'SUBMIT_FORECAST', playerId: 'a1', forecast: { S1: 200, S2: 200 } },
    { type: 'SUBMIT_FORECAST', playerId: 'b1', forecast: { S1: 200, S2: 200 } },
    { type: 'ADVANCE_PHASE', playerId: 'adm' }, // -> PRODUCTION
    { type: 'SUBMIT_PRODUCTION', playerId: 'a2', allocations: opts.aProd ?? [] },
    { type: 'SUBMIT_PRODUCTION', playerId: 'b2', allocations: opts.bProd ?? [] },
    { type: 'ADVANCE_PHASE', playerId: 'adm' }, // -> TRANSPORT (defaults to all-truckload)
    { type: 'ADVANCE_PHASE', playerId: 'adm' }, // -> PRICING
  ]);
  if (opts.aPrices) s = reduce(s, { type: 'SUBMIT_PRICES', playerId: 'a4', prices: opts.aPrices });
  if (opts.bPrices) s = reduce(s, { type: 'SUBMIT_PRICES', playerId: 'b4', prices: opts.bPrices });
  s = reduce(s, { type: 'ADVANCE_PHASE', playerId: 'adm' }); // -> TRADING
  s = apply(s, opts.duringTrading ?? []);
  s = reduce(s, { type: 'ADVANCE_PHASE', playerId: 'adm' }); // -> ORDERS
  if (opts.allocations) {
    s = reduce(s, { type: 'SUBMIT_ORDERS', playerId: 'adm', allocations: opts.allocations });
  } else if (opts.orders) {
    // same orders for both teams — preserves the identical-demand scenarios
    s = reduce(s, {
      type: 'SUBMIT_ORDERS', playerId: 'adm',
      allocations: { T1: opts.orders, T2: opts.orders },
    });
  }
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

  it('admins can kick non-admin players; kicked seats free up', () => {
    let s = lobby();
    // a1 holds Demand Planner on Alpha; kick them and let a2 claim it
    s = reduce(s, { type: 'KICK_PLAYER', playerId: 'adm', targetPlayerId: 'a1' });
    expect(s.players.some((p) => p.id === 'a1')).toBe(false);
    s = reduce(s, { type: 'CLAIM_ROLE', playerId: 'a2', role: 'DEMAND_PLANNER' });
    expect(s.players.find((p) => p.id === 'a2')!.roles).toContain('DEMAND_PLANNER');
    expect(() =>
      reduce(s, { type: 'KICK_PLAYER', playerId: 'a2', targetPlayerId: 'b1' }),
    ).toThrow(/Only an admin/);
    expect(() =>
      reduce(s, { type: 'KICK_PLAYER', playerId: 'adm', targetPlayerId: 'adm' }),
    ).toThrow(/cannot kick an admin/);
  });

  it('vacant roles fall back to any teammate; claimed roles stay exclusive', () => {
    let s = lobby();
    // a1 holds Demand Planner on Alpha — a2 may NOT act for it
    s = reduce(s, { type: 'START_GAME', playerId: 'adm' });
    expect(() =>
      reduce(s, { type: 'SUBMIT_FORECAST', playerId: 'a2', forecast: { S1: 100, S2: 100 } }),
    ).toThrow(/belongs to the DEMAND_PLANNER/);
    // kick a1 -> the role is vacant -> a2 (Production Planner) can act for it
    s = reduce(s, { type: 'KICK_PLAYER', playerId: 'adm', targetPlayerId: 'a1' });
    s = reduce(s, { type: 'SUBMIT_FORECAST', playerId: 'a2', forecast: { S1: 100, S2: 100 } });
    expect(s.teams[0].decisions.forecast).toEqual({ S1: 100, S2: 100 });
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
    // 50 left on shelf -> holding 25, flat age loss 50x$1 = 50
    expect(r.productionCost).toBe(2500);
    expect(r.transportCost).toBe(1000);
    expect(r.revenue).toBe(4000);
    expect(r.holdingCost).toBe(25);
    expect(r.ageLossCost).toBe(50);
    expect(r.profit).toBe(425);
    expect(r.fillRate).toBe(0.5); // fulfilled 200 of 400 ordered units
    expect(alpha.budget).toBe(100_425);
    expect(alpha.inventory.S1).toEqual([{ qty: 50, age: 1 }]);
  });

  it('market pool: admin can allocate demand unevenly across teams', () => {
    const s = playMonth(start, {
      aProd: [{ lineId: 'L1', skuId: 'S1', qty: 250 }],
      bProd: [{ lineId: 'L2', skuId: 'S2', qty: 250 }],
      allocations: { T1: { S1: 150, S2: 0 }, T2: { S1: 50, S2: 200 } },
    });
    const [alpha, beta] = s.teams;
    expect(alpha.results[0].bySku.S1.ordered).toBe(150);
    expect(alpha.results[0].bySku.S1.fulfilled).toBe(150);
    expect(beta.results[0].bySku.S1.ordered).toBe(50);
    expect(beta.results[0].bySku.S1.fulfilled).toBe(0); // Beta made no S1
    expect(beta.results[0].bySku.S2.fulfilled).toBe(200);
    // a team's view shows its own realized orders; the admin sees totals
    expect(viewFor(s, 'team:T1').orderHistory[1]).toEqual({ S1: 150, S2: 0 });
    expect(viewFor(s, 'admin').orderHistory[1]).toEqual({ S1: 200, S2: 200 });
  });

  it('both teams face identical realized orders', () => {
    const [alpha, beta] = month1.teams;
    for (const sku of ['S1', 'S2']) {
      expect(alpha.results[0].bySku[sku].ordered).toBe(beta.results[0].bySku[sku].ordered);
    }
    expect(month1.orderHistory[1]).toEqual({
      T1: { S1: 200, S2: 200 },
      T2: { S1: 200, S2: 200 },
    });
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

  it('split shipment: truckload lands this month, interplant arrives next month', () => {
    // Alpha produces 250 S1, ships 200 truckload (sell now) + 50 interplant (next month)
    let s = apply(start, [
      { type: 'ADVANCE_PHASE', playerId: 'adm' }, // -> PRODUCTION
      { type: 'SUBMIT_PRODUCTION', playerId: 'a2', allocations: [{ lineId: 'L1', skuId: 'S1', qty: 250 }] },
      { type: 'ADVANCE_PHASE', playerId: 'adm' }, // -> TRANSPORT
    ]);
    // must allocate exactly the produced units
    expect(() =>
      reduce(s, { type: 'SUBMIT_TRANSPORT', playerId: 'a3', split: { S1: { truckload: 200, interplant: 40 }, S2: { truckload: 0, interplant: 0 } } }),
    ).toThrow(/split the 250 produced units/);

    s = apply(s, [
      { type: 'SUBMIT_TRANSPORT', playerId: 'a3', split: { S1: { truckload: 200, interplant: 50 }, S2: { truckload: 0, interplant: 0 } } },
      { type: 'ADVANCE_PHASE', playerId: 'adm' }, // -> PRICING
      { type: 'SUBMIT_PRICES', playerId: 'a4', prices: { S1: 20, S2: 16.5 } },
      { type: 'ADVANCE_PHASE', playerId: 'adm' }, // -> TRADING
      { type: 'ADVANCE_PHASE', playerId: 'adm' }, // -> ORDERS
      { type: 'SUBMIT_ORDERS', playerId: 'adm', allocations: { T1: { S1: 200, S2: 0 }, T2: { S1: 200, S2: 0 } } },
      { type: 'ADVANCE_PHASE', playerId: 'adm' }, // resolve month 1
    ]);
    const alpha = s.teams[0];
    const r = alpha.results[0];
    // transport cost: 200 truckload @4 + 50 interplant @1.5 = 800 + 75 = 875
    expect(r.transportCost).toBe(875);
    // 200 truckload units landed and all sold this month
    expect(r.bySku.S1.fulfilled).toBe(200);
    // the 50 interplant units are still in transit, arriving next month
    expect(alpha.pipeline).toEqual([{ skuId: 'S1', qty: 50, mode: 'interplant', arrivesMonth: 2 }]);
    expect(alpha.inventory.S1).toEqual([]); // truckload units all sold, none held

    // advance to month 2; the interplant stock lands and is sellable
    s = reduce(s, { type: 'ADVANCE_PHASE', playerId: 'adm' }); // -> month 2 FORECAST
    s = apply(s, [
      { type: 'ADVANCE_PHASE', playerId: 'adm' }, // -> PRODUCTION (none)
      { type: 'ADVANCE_PHASE', playerId: 'adm' }, // -> TRANSPORT
      { type: 'ADVANCE_PHASE', playerId: 'adm' }, // -> PRICING
      { type: 'SUBMIT_PRICES', playerId: 'a4', prices: { S1: 20, S2: 16.5 } },
      { type: 'ADVANCE_PHASE', playerId: 'adm' }, // -> TRADING
      { type: 'ADVANCE_PHASE', playerId: 'adm' }, // ORDERS
      { type: 'SUBMIT_ORDERS', playerId: 'adm', allocations: { T1: { S1: 50, S2: 0 }, T2: { S1: 50, S2: 0 } } },
      { type: 'ADVANCE_PHASE', playerId: 'adm' }, // resolve month 2
    ]);
    // the 50 interplant units arrived and sold in month 2
    expect(s.teams[0].results[1].bySku.S1.fulfilled).toBe(50);
    expect(s.teams[0].pipeline).toEqual([]);
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
      { type: 'SUBMIT_ORDERS', playerId: 'adm', allocations: { T1: { S1: 200, S2: 200 }, T2: { S1: 200, S2: 200 } } },
      { type: 'ADVANCE_PHASE', playerId: 'adm' }, // resolve
    ]);
    expect(t.teams[0].results[1].tradeSells).toBe(1500);
    expect(t.teams[1].results[1].tradeBuys).toBe(1500);
    // Beta sold the 50 bought S1 units at its price 18
    expect(t.teams[1].results[1].bySku.S1.fulfilled).toBe(50);
  });

  it('counter-offer: responder changes terms, ball flips to the other CEO', () => {
    // month 1: Alpha builds 250 S1, both teams get 200 orders -> Alpha keeps 50
    let s = playMonth(reduce(lobby(), { type: 'START_GAME', playerId: 'adm' }), {
      aProd: [{ lineId: 'L1', skuId: 'S1', qty: 250 }],
      aPrices: { S1: 20, S2: 16.5 },
      orders: { S1: 200, S2: 0 },
    });
    s = apply(s, [
      { type: 'ADVANCE_PHASE', playerId: 'adm' }, // -> month 2 FORECAST
      { type: 'ADVANCE_PHASE', playerId: 'adm' },
      { type: 'ADVANCE_PHASE', playerId: 'adm' },
      { type: 'ADVANCE_PHASE', playerId: 'adm' },
      { type: 'ADVANCE_PHASE', playerId: 'adm' }, // -> TRADING
      { type: 'PROPOSE_TRADE', playerId: 'b5', sellerTeamId: 'T1', skuId: 'S1', qty: 20, unitPrice: 15 },
    ]);
    const id = s.tradeOffers[0].id;
    expect(s.tradeOffers[0].awaiting).toBe('seller');

    // seller CEO counters: fewer units, higher price -> now the BUYER must respond
    s = reduce(s, { type: 'COUNTER_TRADE', playerId: 'a5', offerId: id, qty: 10, unitPrice: 20 });
    expect(s.tradeOffers[0]).toMatchObject({ qty: 10, unitPrice: 20, awaiting: 'buyer', status: 'pending' });
    // the seller can no longer accept their own counter
    expect(() =>
      reduce(s, { type: 'RESPOND_TRADE', playerId: 'a5', offerId: id, accept: true }),
    ).toThrow(/other team's turn/);

    // buyer CEO accepts the countered terms -> settles at 10 @ 20
    s = reduce(s, { type: 'RESPOND_TRADE', playerId: 'b5', offerId: id, accept: true });
    expect(s.tradeOffers[0].status).toBe('accepted');
    const units = (t: number, sku: string) =>
      (s.teams[t].inventory[sku] ?? []).reduce((sum: number, b: { qty: number }) => sum + b.qty, 0);
    expect(units(1, 'S1')).toBe(10); // Beta received the goods
    expect(units(0, 'S1')).toBe(40); // Alpha kept the rest of its 50
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
    // budget: 1000 - 2500 - 1000 - 125 holding - 250 age loss = -2875,
    // interest 2% = 57.5
    expect(r.holdingCost).toBe(125);
    expect(r.overdraftInterest).toBe(57.5);
    expect(s.teams[0].budget).toBe(-2932.5);
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
    // proposal is the TOTAL market pool: per-team baseline x 2 teams
    expect(s.proposedOrders).toEqual({ S1: 400, S2: 400 });
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

  it('default config: capacity scales with difficulty', () => {
    const build = (difficulty: 'easy' | 'medium' | 'hard') =>
      buildDefaultConfig({ seed: 'x', months: 10, numSkus: 5, difficulty, numCustomers: 5 });
    const ratio = (cfg: ReturnType<typeof buildDefaultConfig>) =>
      cfg.lines.reduce((s, l) => s + l.capacityPerMonth, 0) /
      cfg.skus.reduce((s, k) => s + k.historicalMonthlyDemand, 0);
    // easy: OVER capacity (overbuild -> age loss lesson); medium: ~95-100%;
    // hard: scarce -> specialization + trading
    expect(ratio(build('easy'))).toBeGreaterThan(1);
    expect(ratio(build('medium'))).toBeCloseTo(0.95, 1);
    expect(ratio(build('hard'))).toBeCloseTo(0.5, 1);
  });

  it('default config: age loss depreciates full build cost over shelf life', () => {
    const cfg = buildDefaultConfig({
      seed: 'x', months: 10, numSkus: 5, difficulty: 'medium', numCustomers: 5,
    });
    for (const sku of cfg.skus) {
      const lineCosts = sku.allowedLineIds.map(
        (id) => cfg.lines.find((l) => l.id === id)!.costPerUnit);
      const mfgCost = lineCosts.reduce((a, b) => a + b, 0) / lineCosts.length;
      // depreciating every month of the shelf life sums to the build cost
      expect(sku.ageLossCostPerUnitPerMonth * sku.shelfLifeMonths).toBeCloseTo(mfgCost, 1);
    }
  });
});
