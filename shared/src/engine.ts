import { rand01 } from './rng.ts';
import {
  Action,
  Batch,
  EngineError,
  GameConfig,
  GameState,
  MonthResult,
  PHASE_ORDER,
  Phase,
  PlayerInfo,
  ProductionAllocation,
  Role,
  SkuMonthOutcome,
  TeamState,
  TradeOffer,
  TransportSplit,
} from './types.ts';

// ---------------------------------------------------------------- helpers

function clone<T>(value: T): T {
  return typeof structuredClone === 'function'
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function getPlayer(state: GameState, playerId: string): PlayerInfo {
  const p = state.players.find((pl) => pl.id === playerId);
  if (!p) throw new EngineError('Player not found in this game');
  return p;
}

function getTeam(state: GameState, teamId: string): TeamState {
  const t = state.teams.find((tm) => tm.id === teamId);
  if (!t) throw new EngineError('Team not found');
  return t;
}

function requireAdmin(state: GameState, playerId: string): PlayerInfo {
  const p = getPlayer(state, playerId);
  if (!p.isAdmin) throw new EngineError('Only an admin can do this');
  return p;
}

function requireRole(state: GameState, playerId: string, role: Role): { player: PlayerInfo; team: TeamState } {
  const p = getPlayer(state, playerId);
  if (!p.teamId) throw new EngineError('You are not on a team');
  if (!p.roles.includes(role)) throw new EngineError(`This action belongs to the ${role} role`);
  return { player: p, team: getTeam(state, p.teamId) };
}

function requirePhase(state: GameState, phase: Phase): void {
  if (state.phase !== phase) {
    throw new EngineError(`Not allowed now: game is in the ${state.phase} phase`);
  }
}

/** Units of each SKU the team plans to produce this month (from its plan). */
function producedBySku(team: TeamState): Record<string, number> {
  const m: Record<string, number> = {};
  for (const a of team.decisions.production ?? []) {
    if (a.qty > 0) m[a.skuId] = (m[a.skuId] ?? 0) + a.qty;
  }
  return m;
}

/** Blended transport cost per unit for a SKU given its truckload/interplant split. */
function splitTransportUnitCost(config: GameConfig, split?: { truckload: number; interplant: number }): number {
  if (!split) return config.transport.truckload.costPerUnit;
  const total = split.truckload + split.interplant;
  if (total <= 0) return config.transport.truckload.costPerUnit;
  return (
    (split.truckload * config.transport.truckload.costPerUnit +
      split.interplant * config.transport.interplant.costPerUnit) /
    total
  );
}

function inventoryUnits(team: TeamState, skuId?: string): number {
  const skuIds = skuId ? [skuId] : Object.keys(team.inventory);
  return skuIds.reduce(
    (sum, id) => sum + (team.inventory[id] ?? []).reduce((s, b) => s + b.qty, 0),
    0,
  );
}

function log(state: GameState, text: string): void {
  state.log.push({ month: state.month, phase: state.phase, text });
  if (state.log.length > 500) state.log.splice(0, state.log.length - 500);
}

/** Remove qty from a team's inventory FIFO-oldest-first; returns removed batches. */
function takeFifo(team: TeamState, skuId: string, qty: number): Batch[] {
  const batches = team.inventory[skuId] ?? [];
  const taken: Batch[] = [];
  let remaining = qty;
  // oldest = highest age; keep batches sorted oldest first
  batches.sort((a, b) => b.age - a.age);
  while (remaining > 0 && batches.length > 0) {
    const b = batches[0];
    const take = Math.min(b.qty, remaining);
    taken.push({ qty: take, age: b.age });
    b.qty -= take;
    remaining -= take;
    if (b.qty === 0) batches.shift();
  }
  team.inventory[skuId] = batches;
  if (remaining > 0) throw new EngineError('Not enough stock on hand');
  return taken;
}

function addBatches(team: TeamState, skuId: string, added: Batch[]): void {
  const batches = team.inventory[skuId] ?? [];
  for (const b of added) {
    const same = batches.find((x) => x.age === b.age);
    if (same) same.qty += b.qty;
    else batches.push({ ...b });
  }
  batches.sort((a, b) => b.age - a.age);
  team.inventory[skuId] = batches;
}

// ------------------------------------------------------------- costing

/** Reference landed cost used for trade price caps and sanity bounds. */
export function referenceCost(config: GameConfig, skuId: string): number {
  const sku = config.skus.find((s) => s.id === skuId);
  if (!sku) throw new EngineError('Unknown SKU');
  const lineCosts = sku.allowedLineIds
    .map((id) => config.lines.find((l) => l.id === id)?.costPerUnit ?? Infinity)
    .filter((c) => Number.isFinite(c));
  const maxLine = lineCosts.length ? Math.max(...lineCosts) : 10;
  return round2(maxLine + config.transport.truckload.costPerUnit + config.holdingCostPerUnitPerMonth);
}

/**
 * Minimum selling price for a team's SKU this month:
 * unit production cost (weighted avg of this month's allocation, else the
 * cheapest allowed line) + chosen transport cost + one month of holding.
 */
export function priceFloor(state: GameState, team: TeamState, skuId: string): number {
  const config = state.config;
  const sku = config.skus.find((s) => s.id === skuId);
  if (!sku) throw new EngineError('Unknown SKU');

  const allocs = (team.decisions.production ?? []).filter((a) => a.skuId === skuId && a.qty > 0);
  let prodUnit: number;
  if (allocs.length > 0) {
    let cost = 0;
    let qty = 0;
    for (const a of allocs) {
      const line = config.lines.find((l) => l.id === a.lineId);
      if (!line) continue;
      cost += a.qty * line.costPerUnit;
      qty += a.qty;
    }
    prodUnit = qty > 0 ? cost / qty : 0;
  } else {
    const costs = sku.allowedLineIds
      .map((id) => config.lines.find((l) => l.id === id)?.costPerUnit)
      .filter((c): c is number => c != null);
    prodUnit = costs.length ? Math.min(...costs) : 10;
  }

  const transportUnit = splitTransportUnitCost(config, team.decisions.transport?.[skuId]);
  return round2(prodUnit + transportUnit + config.holdingCostPerUnitPerMonth);
}

// ----------------------------------------------------- demand generation

/** Seeded per-customer sell-through for a month. Identical for every team. */
function customerSales(config: GameConfig, skuId: string, month: number, customerIdx: number): number {
  const sku = config.skus.find((s) => s.id === skuId)!;
  const target = sku.historicalMonthlyDemand / config.numCustomers;
  const u = rand01(config.seed, 'sales', skuId, month, customerIdx) * 2 - 1;
  return Math.max(0, Math.round(target * (1 + config.demandVolatility * u)));
}

/**
 * Proposed market orders for the current month. Month 1: customers order the
 * full baseline ("all products on shelf"). Later months: replenishment =
 * baseline + last month's unmet demand (stockout over-ordering) - leftover
 * shelf stock (overstock under-ordering) — bullwhip in both directions.
 */
export function computeProposedOrders(state: GameState): Record<string, number> {
  const { config } = state;
  const proposal: Record<string, number> = {};
  for (const sku of config.skus) {
    const target = sku.historicalMonthlyDemand / config.numCustomers;
    let total = 0;
    for (let c = 0; c < config.numCustomers; c++) {
      if (state.month <= 1) {
        total += Math.round(target);
      } else {
        const shelf = state.customerSim.shelves[c]?.[sku.id] ?? 0;
        const unmet = state.customerSim.unmet[c]?.[sku.id] ?? 0;
        total += Math.max(0, Math.round(target + unmet - shelf));
      }
    }
    proposal[sku.id] = total;
  }
  return proposal;
}

/** Advance the customer shelf simulation once realized orders are known. */
function stepCustomerSim(state: GameState, orders: Record<string, number>): void {
  const { config } = state;
  while (state.customerSim.shelves.length < config.numCustomers) {
    state.customerSim.shelves.push({});
    state.customerSim.unmet.push({});
  }
  for (const sku of config.skus) {
    const perCustomer = (orders[sku.id] ?? 0) / config.numCustomers;
    for (let c = 0; c < config.numCustomers; c++) {
      const shelf = state.customerSim.shelves[c][sku.id] ?? 0;
      const potential = customerSales(config, sku.id, state.month, c);
      const available = shelf + perCustomer;
      const sold = Math.min(available, potential);
      state.customerSim.shelves[c][sku.id] = Math.max(0, available - sold);
      state.customerSim.unmet[c][sku.id] = Math.max(0, potential - available);
    }
  }
}

// ------------------------------------------------------------ lifecycle

export function createGame(config: GameConfig, code: string): GameState {
  return {
    rev: 0,
    code,
    config,
    phase: 'LOBBY',
    month: 0,
    players: [],
    teams: [],
    tradeOffers: [],
    proposedOrders: null,
    submittedOrders: null,
    orderHistory: {},
    customerSim: { shelves: [], unmet: [] },
    log: [],
  };
}

function emptyDecisions(): TeamState['decisions'] {
  return { forecast: null, production: null, transport: null, prices: null };
}

function makeTeam(id: string, name: string, config: GameConfig): TeamState {
  return {
    id,
    name,
    budget: config.startingBudget,
    cumulativeProfit: 0,
    inventory: Object.fromEntries(config.skus.map((s) => [s.id, []])),
    pipeline: [],
    decisions: emptyDecisions(),
    results: [],
  };
}

// ---------------------------------------------------------- defaults

function fillDefaults(state: GameState, leaving: Phase): void {
  for (const team of state.teams) {
    const d = team.decisions;
    if (leaving === 'FORECAST' && !d.forecast) {
      const fc: Record<string, number> = {};
      for (const sku of state.config.skus) {
        const lastActual = team.results.at(-1)?.bySku[sku.id]?.ordered;
        fc[sku.id] = lastActual ?? sku.historicalMonthlyDemand;
      }
      d.forecast = fc;
      log(state, `${team.name}: no forecast submitted — defaulted to last actuals/baseline.`);
    }
    if (leaving === 'PRODUCTION' && !d.production) {
      d.production = [];
      log(state, `${team.name}: no production plan submitted — producing nothing this month.`);
    }
    if (leaving === 'TRANSPORT' && !d.transport) {
      // default: ship everything produced by truckload (arrives this month)
      const made = producedBySku(team);
      d.transport = Object.fromEntries(
        state.config.skus.map((s) => [s.id, { truckload: made[s.id] ?? 0, interplant: 0 }]),
      );
    }
    if (leaving === 'PRICING' && !d.prices) {
      d.prices = Object.fromEntries(
        state.config.skus.map((s) => [s.id, priceFloor(state, team, s.id)]),
      );
      log(state, `${team.name}: no prices submitted — defaulted to cost floor.`);
    }
  }
}

// --------------------------------------------------------- validation

function validateProduction(state: GameState, team: TeamState, allocations: ProductionAllocation[]): void {
  const { config } = state;
  const usedPerLine: Record<string, number> = {};
  let totalCost = 0;
  for (const a of allocations) {
    if (!Number.isFinite(a.qty) || a.qty < 0 || a.qty !== Math.round(a.qty)) {
      throw new EngineError('Production quantities must be non-negative whole numbers');
    }
    if (a.qty === 0) continue;
    const line = config.lines.find((l) => l.id === a.lineId);
    const sku = config.skus.find((s) => s.id === a.skuId);
    if (!line || !sku) throw new EngineError('Unknown line or SKU in production plan');
    if (!sku.allowedLineIds.includes(line.id)) {
      throw new EngineError(`${sku.name} cannot be manufactured on ${line.name}`);
    }
    usedPerLine[line.id] = (usedPerLine[line.id] ?? 0) + a.qty;
    if (usedPerLine[line.id] > line.capacityPerMonth) {
      throw new EngineError(`${line.name} capacity exceeded (${usedPerLine[line.id]} > ${line.capacityPerMonth})`);
    }
    totalCost += a.qty * line.costPerUnit;
  }
  // transport is decided later; reserve the cheaper mode as the minimum spend
  const minTransport = Math.min(
    config.transport.truckload.costPerUnit,
    config.transport.interplant.costPerUnit,
  );
  const totalQty = allocations.reduce((s, a) => s + a.qty, 0);
  const committed = totalCost + totalQty * minTransport;
  if (team.budget - committed < -config.overdraftLimit) {
    throw new EngineError(
      `Plan costs ${Math.round(committed)} which would exceed the overdraft limit ` +
        `(budget ${Math.round(team.budget)}, limit -${config.overdraftLimit})`,
    );
  }
}

// --------------------------------------------------------- resolution

function resolveMonth(state: GameState): void {
  const { config } = state;
  const orders = state.submittedOrders ?? state.proposedOrders ?? computeProposedOrders(state);
  state.orderHistory[state.month] = orders;

  for (const team of state.teams) {
    const d = team.decisions;
    const result: MonthResult = {
      month: state.month,
      bySku: {},
      revenue: 0,
      productionCost: 0,
      transportCost: 0,
      tradeBuys: 0,
      tradeSells: 0,
      holdingCost: 0,
      ageLossCost: 0,
      expiredUnits: 0,
      overdraftInterest: 0,
      profit: 0,
      fillRate: 0,
      endBudget: 0,
      endInventoryUnits: 0,
    };

    // trades settled during TRADING already moved cash + stock; record totals
    for (const offer of state.tradeOffers) {
      if (offer.month !== state.month || offer.status !== 'accepted') continue;
      const amount = offer.qty * offer.unitPrice;
      if (offer.buyerTeamId === team.id) result.tradeBuys += amount;
      if (offer.sellerTeamId === team.id) result.tradeSells += amount;
    }

    // 1. charge production and dispatch to transport pipeline
    const producedMap: Record<string, number> = {};
    for (const a of d.production ?? []) {
      if (a.qty <= 0) continue;
      const line = config.lines.find((l) => l.id === a.lineId)!;
      result.productionCost += a.qty * line.costPerUnit;
      producedMap[a.skuId] = (producedMap[a.skuId] ?? 0) + a.qty;
    }
    for (const [skuId, qty] of Object.entries(producedMap)) {
      // split the produced units across modes; truckload (1 wk) lands this
      // month, interplant (3 wks) arrives next month. Default: all truckload.
      const split = d.transport?.[skuId] ?? { truckload: qty, interplant: 0 };
      const tl = Math.min(qty, Math.max(0, split.truckload));
      const ip = Math.max(0, qty - tl); // any remainder ships interplant
      if (tl > 0) {
        result.transportCost += tl * config.transport.truckload.costPerUnit;
        team.pipeline.push({ skuId, qty: tl, mode: 'truckload', arrivesMonth: state.month });
      }
      if (ip > 0) {
        result.transportCost += ip * config.transport.interplant.costPerUnit;
        team.pipeline.push({ skuId, qty: ip, mode: 'interplant', arrivesMonth: state.month + 1 });
      }
    }

    // 2. land arrivals due this month
    const stillInTransit = [];
    for (const sh of team.pipeline) {
      if (sh.arrivesMonth <= state.month) {
        addBatches(team, sh.skuId, [{ qty: sh.qty, age: 0 }]);
      } else {
        stillInTransit.push(sh);
      }
    }
    team.pipeline = stillInTransit;

    // 3. fulfill market orders FIFO by age; shortfall is a lost sale
    let orderedTotal = 0;
    let fulfilledTotal = 0;
    for (const sku of config.skus) {
      const ordered = orders[sku.id] ?? 0;
      const onHand = inventoryUnits(team, sku.id);
      const fulfilled = Math.min(onHand, ordered);
      if (fulfilled > 0) takeFifo(team, sku.id, fulfilled);
      const price = d.prices?.[sku.id] ?? priceFloor(state, team, sku.id);
      result.revenue += fulfilled * price;
      result.bySku[sku.id] = {
        ordered,
        fulfilled,
        price,
        forecast: d.forecast?.[sku.id] ?? 0,
      } satisfies SkuMonthOutcome;
      orderedTotal += ordered;
      fulfilledTotal += fulfilled;
    }
    result.fillRate = orderedTotal > 0 ? fulfilledTotal / orderedTotal : 1;

    // 4. expire, charge holding + age loss, then age remaining stock
    for (const sku of config.skus) {
      const batches = team.inventory[sku.id] ?? [];
      const kept: Batch[] = [];
      for (const b of batches) {
        if (b.age >= sku.shelfLifeMonths) {
          result.expiredUnits += b.qty;
        } else {
          kept.push(b);
        }
      }
      for (const b of kept) {
        result.holdingCost += b.qty * config.holdingCostPerUnitPerMonth;
        result.ageLossCost += b.qty * b.age * sku.ageLossCostPerUnitPerMonth;
        b.age += 1;
      }
      team.inventory[sku.id] = kept;
    }
    if (result.expiredUnits > 0) {
      log(state, `${team.name}: ${result.expiredUnits} units expired past shelf life and were written off.`);
    }

    // 5. cash + overdraft interest (trade cash already moved at settlement)
    team.budget +=
      result.revenue -
      result.productionCost -
      result.transportCost -
      result.holdingCost -
      result.ageLossCost;
    if (team.budget < 0) {
      result.overdraftInterest = round2(-team.budget * config.overdraftInterestRate);
      team.budget -= result.overdraftInterest;
    }

    result.revenue = round2(result.revenue);
    result.productionCost = round2(result.productionCost);
    result.transportCost = round2(result.transportCost);
    result.holdingCost = round2(result.holdingCost);
    result.ageLossCost = round2(result.ageLossCost);
    result.profit = round2(
      result.revenue +
        result.tradeSells -
        result.productionCost -
        result.transportCost -
        result.tradeBuys -
        result.holdingCost -
        result.ageLossCost -
        result.overdraftInterest,
    );
    team.budget = round2(team.budget);
    team.cumulativeProfit = round2(team.cumulativeProfit + result.profit);
    result.endBudget = team.budget;
    result.endInventoryUnits = inventoryUnits(team);
    team.results.push(result);
  }

  stepCustomerSim(state, orders);
  state.submittedOrders = null;
  state.proposedOrders = null;
}

// ------------------------------------------------------------- reducer

export function reduce(prev: GameState, action: Action): GameState {
  const state = clone(prev);
  state.rev += 1;

  switch (action.type) {
    case 'JOIN': {
      if (state.players.some((p) => p.id === action.playerId)) return state; // idempotent rejoin
      const name = action.name.trim().slice(0, 24);
      if (!name) throw new EngineError('Please enter a name');
      const isFirst = state.players.length === 0;
      state.players.push({
        id: action.playerId,
        name,
        isAdmin: action.asAdmin || isFirst,
        teamId: null,
        roles: [],
        connected: true,
      });
      break;
    }

    case 'SET_ADMIN': {
      requireAdmin(state, action.playerId);
      const target = getPlayer(state, action.targetPlayerId);
      if (action.isAdmin && target.teamId) {
        throw new EngineError('An admin cannot be part of a team — remove them from the team first');
      }
      const admins = state.players.filter((p) => p.isAdmin);
      if (!action.isAdmin && admins.length === 1 && target.isAdmin) {
        throw new EngineError('The game needs at least one admin');
      }
      target.isAdmin = action.isAdmin;
      break;
    }

    case 'KICK_PLAYER': {
      requireAdmin(state, action.playerId);
      const target = getPlayer(state, action.targetPlayerId);
      if (target.isAdmin) throw new EngineError('You cannot kick an admin — demote them first');
      state.players = state.players.filter((p) => p.id !== target.id);
      log(state, `${target.name} was removed from the game by a facilitator.`);
      break;
    }

    case 'CREATE_TEAM': {
      requirePhase(state, 'LOBBY');
      const p = getPlayer(state, action.playerId);
      if (p.isAdmin) throw new EngineError('Admins cannot be part of a team');
      const name = action.name.trim().slice(0, 24);
      if (!name) throw new EngineError('Please enter a team name');
      if (state.teams.some((t) => t.name.toLowerCase() === name.toLowerCase())) {
        throw new EngineError('A team with this name already exists');
      }
      const team = makeTeam(`T${state.teams.length + 1}`, name, state.config);
      state.teams.push(team);
      if (p.teamId) {
        const old = getTeam(state, p.teamId);
        log(state, `${p.name} left ${old.name}.`);
      }
      p.teamId = team.id;
      p.roles = [];
      break;
    }

    case 'JOIN_TEAM': {
      requirePhase(state, 'LOBBY');
      const p = getPlayer(state, action.playerId);
      if (p.isAdmin) throw new EngineError('Admins cannot be part of a team');
      const team = getTeam(state, action.teamId);
      const members = state.players.filter((pl) => pl.teamId === team.id && pl.id !== p.id);
      if (members.length >= 5) throw new EngineError('This team already has 5 players');
      p.teamId = team.id;
      p.roles = [];
      break;
    }

    case 'CLAIM_ROLE': {
      const p = getPlayer(state, action.playerId);
      if (!p.teamId) throw new EngineError('Join a team first');
      const taken = state.players.some(
        (pl) => pl.teamId === p.teamId && pl.id !== p.id && pl.roles.includes(action.role),
      );
      if (taken) throw new EngineError('That role is already taken on your team');
      if (!p.roles.includes(action.role)) p.roles.push(action.role);
      break;
    }

    case 'RELEASE_ROLE': {
      const p = getPlayer(state, action.playerId);
      p.roles = p.roles.filter((r) => r !== action.role);
      break;
    }

    case 'START_GAME': {
      requireAdmin(state, action.playerId);
      requirePhase(state, 'LOBBY');
      if (state.teams.length < 1) throw new EngineError('At least one team must join before starting');
      state.month = 1;
      state.phase = 'FORECAST';
      log(state, `Game started with ${state.teams.length} team(s) for ${state.config.months} months.`);
      break;
    }

    case 'SUBMIT_FORECAST': {
      requirePhase(state, 'FORECAST');
      const { team } = requireRole(state, action.playerId, 'DEMAND_PLANNER');
      const fc: Record<string, number> = {};
      for (const sku of state.config.skus) {
        const v = action.forecast[sku.id];
        if (!Number.isFinite(v) || v < 0) throw new EngineError('Forecasts must be non-negative numbers');
        if (v > sku.historicalMonthlyDemand * 10) {
          throw new EngineError(`Forecast for ${sku.name} is more than 10x the historical baseline — please double-check`);
        }
        fc[sku.id] = Math.round(v);
      }
      team.decisions.forecast = fc;
      break;
    }

    case 'SUBMIT_PRODUCTION': {
      requirePhase(state, 'PRODUCTION');
      const { team } = requireRole(state, action.playerId, 'PRODUCTION_PLANNER');
      validateProduction(state, team, action.allocations);
      team.decisions.production = action.allocations.filter((a) => a.qty > 0);
      break;
    }

    case 'SUBMIT_TRANSPORT': {
      requirePhase(state, 'TRANSPORT');
      const { team } = requireRole(state, action.playerId, 'TRANSPORT_MANAGER');
      const made = producedBySku(team);
      const split: Record<string, TransportSplit> = {};
      for (const sku of state.config.skus) {
        const s = action.split[sku.id] ?? { truckload: 0, interplant: 0 };
        const tl = Math.round(s.truckload || 0);
        const ip = Math.round(s.interplant || 0);
        if (tl < 0 || ip < 0) {
          throw new EngineError(`Transport quantities for ${sku.name} must be non-negative`);
        }
        const produced = made[sku.id] ?? 0;
        if (tl + ip !== produced) {
          throw new EngineError(
            `${sku.name}: split the ${produced} produced units across truckload + interplant ` +
              `(you allocated ${tl + ip})`,
          );
        }
        split[sku.id] = { truckload: tl, interplant: ip };
      }
      team.decisions.transport = split;
      break;
    }

    case 'SUBMIT_PRICES': {
      requirePhase(state, 'PRICING');
      const { team } = requireRole(state, action.playerId, 'CUSTOMER_OPS');
      const prices: Record<string, number> = {};
      for (const sku of state.config.skus) {
        const v = action.prices[sku.id];
        const floor = priceFloor(state, team, sku.id);
        if (!Number.isFinite(v)) throw new EngineError(`Set a price for ${sku.name}`);
        if (v < floor) {
          throw new EngineError(`Price for ${sku.name} is below the cost floor of ${floor}`);
        }
        if (v > referenceCost(state.config, sku.id) * 20) {
          throw new EngineError(`Price for ${sku.name} looks like a typo — it is 20x the reference cost`);
        }
        prices[sku.id] = round2(v);
      }
      team.decisions.prices = prices;
      break;
    }

    case 'PROPOSE_TRADE': {
      requirePhase(state, 'TRADING');
      const { team: buyer } = requireRole(state, action.playerId, 'CEO');
      const seller = getTeam(state, action.sellerTeamId);
      if (seller.id === buyer.id) throw new EngineError('You cannot trade with your own team');
      const sku = state.config.skus.find((s) => s.id === action.skuId);
      if (!sku) throw new EngineError('Unknown SKU');
      if (!Number.isInteger(action.qty) || action.qty <= 0) {
        throw new EngineError('Trade quantity must be a positive whole number');
      }
      const cap = round2(referenceCost(state.config, sku.id) * state.config.maxTradePriceMultiplier);
      if (!(action.unitPrice > 0) || action.unitPrice > cap) {
        throw new EngineError(`Trade unit price must be between 0 and ${cap} (anti-collusion cap)`);
      }
      const cost = action.qty * action.unitPrice;
      if (buyer.budget - cost < -state.config.overdraftLimit) {
        throw new EngineError('This trade would exceed your overdraft limit');
      }
      state.tradeOffers.push({
        id: `TR${state.tradeOffers.length + 1}-M${state.month}`,
        month: state.month,
        buyerTeamId: buyer.id,
        sellerTeamId: seller.id,
        skuId: sku.id,
        qty: action.qty,
        unitPrice: round2(action.unitPrice),
        status: 'pending',
        note: action.note?.slice(0, 140),
      });
      break;
    }

    case 'RESPOND_TRADE': {
      requirePhase(state, 'TRADING');
      const { team } = requireRole(state, action.playerId, 'CEO');
      const offer = state.tradeOffers.find((o) => o.id === action.offerId);
      if (!offer || offer.status !== 'pending') throw new EngineError('Offer is no longer open');
      if (offer.sellerTeamId !== team.id) throw new EngineError('Only the selling team CEO can respond');
      if (!action.accept) {
        offer.status = 'rejected';
        break;
      }
      const buyer = getTeam(state, offer.buyerTeamId);
      const seller = team;
      const cost = offer.qty * offer.unitPrice;
      if (inventoryUnits(seller, offer.skuId) < offer.qty) {
        throw new EngineError('Your team no longer has enough stock on hand for this trade');
      }
      if (buyer.budget - cost < -state.config.overdraftLimit) {
        throw new EngineError("The buyer can no longer afford this trade");
      }
      const batches = takeFifo(seller, offer.skuId, offer.qty);
      addBatches(buyer, offer.skuId, batches);
      buyer.budget = round2(buyer.budget - cost);
      seller.budget = round2(seller.budget + cost);
      offer.status = 'accepted';
      const skuName = state.config.skus.find((s) => s.id === offer.skuId)?.name ?? offer.skuId;
      log(state, `Trade: ${buyer.name} bought ${offer.qty} x ${skuName} from ${seller.name} at ${offer.unitPrice}/unit.`);
      break;
    }

    case 'CANCEL_TRADE': {
      const { team } = requireRole(state, action.playerId, 'CEO');
      const offer = state.tradeOffers.find((o) => o.id === action.offerId);
      if (!offer || offer.status !== 'pending') throw new EngineError('Offer is no longer open');
      if (offer.buyerTeamId !== team.id) throw new EngineError('Only the proposing team CEO can cancel');
      offer.status = 'cancelled';
      break;
    }

    case 'SUBMIT_ORDERS': {
      requirePhase(state, 'ORDERS');
      requireAdmin(state, action.playerId);
      const orders: Record<string, number> = {};
      for (const sku of state.config.skus) {
        const v = action.orders[sku.id];
        if (!Number.isFinite(v) || v < 0) throw new EngineError('Orders must be non-negative numbers');
        if (v > sku.historicalMonthlyDemand * 10) {
          throw new EngineError(`Order for ${sku.name} is more than 10x the baseline — please double-check`);
        }
        orders[sku.id] = Math.round(v);
      }
      state.submittedOrders = orders;
      break;
    }

    case 'ADVANCE_PHASE': {
      requireAdmin(state, action.playerId);
      if (state.phase === 'LOBBY' || state.phase === 'GAME_OVER') {
        throw new EngineError('Nothing to advance');
      }
      const leaving = state.phase;
      fillDefaults(state, leaving);

      if (leaving === 'TRADING') {
        for (const o of state.tradeOffers) {
          if (o.status === 'pending') o.status = 'expired';
        }
      }
      if (leaving === 'ORDERS') {
        resolveMonth(state);
        state.phase = 'RESULTS';
        break;
      }
      if (leaving === 'RESULTS') {
        if (state.month >= state.config.months) {
          state.phase = 'GAME_OVER';
          log(state, 'Game over — final leaderboard is ready.');
        } else {
          state.month += 1;
          state.phase = 'FORECAST';
          for (const team of state.teams) team.decisions = emptyDecisions();
        }
        break;
      }
      const idx = PHASE_ORDER.indexOf(leaving);
      state.phase = PHASE_ORDER[idx + 1];
      if (state.phase === 'ORDERS') {
        state.proposedOrders = computeProposedOrders(state);
      }
      break;
    }

    default: {
      const _exhaustive: never = action;
      throw new EngineError(`Unknown action ${( _exhaustive as Action).type}`);
    }
  }

  return state;
}
