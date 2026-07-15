export const ROLES = [
  'DEMAND_PLANNER',
  'PRODUCTION_PLANNER',
  'TRANSPORT_MANAGER',
  'CUSTOMER_OPS',
  'CEO',
] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  DEMAND_PLANNER: 'Demand Planner',
  PRODUCTION_PLANNER: 'Production Planner',
  TRANSPORT_MANAGER: 'Transport Manager',
  CUSTOMER_OPS: 'Customer Ops Manager',
  CEO: 'CEO',
};

export type Phase =
  | 'LOBBY'
  | 'FORECAST'
  | 'PRODUCTION'
  | 'TRANSPORT'
  | 'PRICING'
  | 'TRADING'
  | 'ORDERS'
  | 'RESULTS'
  | 'GAME_OVER';

export const PHASE_ORDER: Phase[] = [
  'FORECAST',
  'PRODUCTION',
  'TRANSPORT',
  'PRICING',
  'TRADING',
  'ORDERS',
  'RESULTS',
];

export const PHASE_LABELS: Record<Phase, string> = {
  LOBBY: 'Lobby',
  FORECAST: 'Demand Forecast',
  PRODUCTION: 'Production Planning',
  TRANSPORT: 'Transport Planning',
  PRICING: 'Pricing',
  TRADING: 'Price Reveal & Trading',
  ORDERS: 'Customer Orders',
  RESULTS: 'Month Results',
  GAME_OVER: 'Final Results',
};

/** Which role owns the decision in each phase (null = admin/CEO driven). */
export const PHASE_ROLE: Partial<Record<Phase, Role>> = {
  FORECAST: 'DEMAND_PLANNER',
  PRODUCTION: 'PRODUCTION_PLANNER',
  TRANSPORT: 'TRANSPORT_MANAGER',
  PRICING: 'CUSTOMER_OPS',
  TRADING: 'CEO',
};

export type TransportMode = 'truckload' | 'interplant';

export type Difficulty = 'easy' | 'medium' | 'hard';

export interface TransportModeConfig {
  costPerUnit: number;
  leadWeeks: number; // truckload: 1 (arrives same month), interplant: 3 (arrives next month)
}

export interface LineConfig {
  id: string;
  name: string;
  capacityPerMonth: number; // units, shared across all SKUs made on this line
  costPerUnit: number;
}

export interface SkuConfig {
  id: string;
  name: string;
  allowedLineIds: string[];
  ageLossCostPerUnitPerMonth: number; // value lost per unit per month of age
  shelfLifeMonths: number; // units at this age or older are written off
  historicalMonthlyDemand: number; // market-wide baseline demand per month
}

export interface GameConfig {
  seed: string;
  months: number;
  difficulty: Difficulty;
  demandVolatility: number; // derived from difficulty, e.g. 0.1 / 0.25 / 0.4
  skus: SkuConfig[];
  lines: LineConfig[];
  transport: Record<TransportMode, TransportModeConfig>;
  holdingCostPerUnitPerMonth: number;
  startingBudget: number;
  overdraftLimit: number; // how far below zero the budget may go when committing spend
  overdraftInterestRate: number; // monthly rate charged on a negative balance
  numCustomers: number; // how many "customer" admins the demand generator simulates
  maxTradePriceMultiplier: number; // trade unit price cap = multiplier x reference landed cost
}

export interface PlayerInfo {
  id: string;
  name: string;
  isAdmin: boolean;
  teamId: string | null;
  roles: Role[]; // a player may hold several roles if the team is short-handed
  connected: boolean;
}

export interface Batch {
  qty: number;
  age: number; // months since arrival at the warehouse
}

export interface Shipment {
  skuId: string;
  qty: number;
  mode: TransportMode;
  arrivesMonth: number;
}

export interface ProductionAllocation {
  lineId: string;
  skuId: string;
  qty: number;
}

/** How a SKU's produced units are split between transport modes this month. */
export interface TransportSplit {
  truckload: number; // ships fast, arrives this month, higher cost
  interplant: number; // ships slow, arrives next month, lower cost
}

export interface MonthDecisions {
  forecast: Record<string, number> | null;
  production: ProductionAllocation[] | null;
  transport: Record<string, TransportSplit> | null;
  prices: Record<string, number> | null;
}

export interface SkuMonthOutcome {
  ordered: number;
  fulfilled: number;
  price: number;
  forecast: number;
}

export interface MonthResult {
  month: number;
  bySku: Record<string, SkuMonthOutcome>;
  revenue: number;
  productionCost: number;
  transportCost: number;
  tradeBuys: number;
  tradeSells: number;
  holdingCost: number;
  ageLossCost: number;
  expiredUnits: number;
  overdraftInterest: number;
  profit: number;
  fillRate: number; // fulfilled / ordered across SKUs
  endBudget: number;
  endInventoryUnits: number;
}

export interface TeamState {
  id: string;
  name: string;
  budget: number;
  cumulativeProfit: number;
  inventory: Record<string, Batch[]>; // skuId -> batches (FIFO, oldest first)
  pipeline: Shipment[]; // in-transit, not yet sellable
  decisions: MonthDecisions;
  results: MonthResult[];
}

export interface TradeOffer {
  id: string;
  month: number;
  buyerTeamId: string;
  sellerTeamId: string;
  skuId: string;
  qty: number;
  unitPrice: number;
  status: 'pending' | 'accepted' | 'rejected' | 'cancelled' | 'expired';
  /** Whose CEO must respond next. Counters flip this. Default: 'seller'. */
  awaiting?: 'seller' | 'buyer';
  note?: string;
}

export interface CustomerShelf {
  // customerIdx -> skuId -> units left on the customer's shelf
  shelves: Record<string, number>[];
  // customerIdx -> skuId -> demand the customer could not serve last month
  unmet: Record<string, number>[];
}

export interface LogEntry {
  month: number;
  phase: Phase;
  text: string;
}

export interface GameState {
  rev: number;
  code: string;
  config: GameConfig;
  phase: Phase;
  month: number; // 1-based; 0 while in LOBBY
  players: PlayerInfo[];
  teams: TeamState[];
  tradeOffers: TradeOffer[];
  /** Engine-proposed TOTAL market demand for the current ORDERS phase, per
   *  SKU (baseline × number of teams, adjusted by the shelf simulation). */
  proposedOrders: Record<string, number> | null;
  /** Admin-confirmed allocation of market demand: teamId -> skuId -> qty. */
  submittedOrders: Record<string, Record<string, number>> | null;
  /** Realized orders by month: month -> teamId -> skuId -> qty. */
  orderHistory: Record<number, Record<string, Record<string, number>>>;
  customerSim: CustomerShelf;
  log: LogEntry[];
}

export type Action =
  | { type: 'JOIN'; playerId: string; name: string; asAdmin: boolean }
  | { type: 'SET_ADMIN'; playerId: string; targetPlayerId: string; isAdmin: boolean }
  | { type: 'KICK_PLAYER'; playerId: string; targetPlayerId: string }
  | { type: 'CREATE_TEAM'; playerId: string; name: string }
  | { type: 'JOIN_TEAM'; playerId: string; teamId: string }
  | { type: 'CLAIM_ROLE'; playerId: string; role: Role }
  | { type: 'RELEASE_ROLE'; playerId: string; role: Role }
  | { type: 'START_GAME'; playerId: string }
  | { type: 'SUBMIT_FORECAST'; playerId: string; forecast: Record<string, number> }
  | { type: 'SUBMIT_PRODUCTION'; playerId: string; allocations: ProductionAllocation[] }
  | { type: 'SUBMIT_TRANSPORT'; playerId: string; split: Record<string, TransportSplit> }
  | { type: 'SUBMIT_PRICES'; playerId: string; prices: Record<string, number> }
  | { type: 'PROPOSE_TRADE'; playerId: string; sellerTeamId: string; skuId: string; qty: number; unitPrice: number; note?: string }
  | { type: 'RESPOND_TRADE'; playerId: string; offerId: string; accept: boolean }
  | { type: 'COUNTER_TRADE'; playerId: string; offerId: string; qty: number; unitPrice: number; note?: string }
  | { type: 'CANCEL_TRADE'; playerId: string; offerId: string }
  | { type: 'SUBMIT_ORDERS'; playerId: string; allocations: Record<string, Record<string, number>> }
  | { type: 'ADVANCE_PHASE'; playerId: string };

export class EngineError extends Error {}
