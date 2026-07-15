import type {
  GameConfig,
  GameState,
  LogEntry,
  Phase,
  PlayerInfo,
  TeamState,
  TradeOffer,
} from './types.ts';

export type Audience = 'admin' | `team:${string}` | 'public';

export interface TeamProgress {
  id: string;
  name: string;
  submitted: {
    forecast: boolean;
    production: boolean;
    transport: boolean;
    prices: boolean;
  };
}

export interface PriceBoardRow {
  teamId: string;
  teamName: string;
  prices: Record<string, number>;
}

export interface ProfitBoardRow {
  teamId: string;
  teamName: string;
  cumulativeProfit: number;
  avgFillRate: number;
  budget: number;
}

export interface GameView {
  rev: number;
  code: string;
  phase: Phase;
  month: number;
  config: GameConfig;
  players: PlayerInfo[];
  teamsProgress: TeamProgress[];
  /** Full state of the viewer's own team (team audiences only). */
  myTeam: TeamState | null;
  /** All teams in full — admins always, everyone at game over. */
  allTeams: TeamState[] | null;
  /** Trade offers visible to this audience. */
  offers: TradeOffer[];
  /** Everyone's prices — revealed from the TRADING phase onward each month. */
  priceBoard: PriceBoardRow[] | null;
  /** Profit leaderboard — admins always, everyone at game over. */
  profitBoard: ProfitBoardRow[] | null;
  /** Flattened per audience: a team sees ITS OWN realized orders per month;
   *  admins (and everyone at game over) see the market totals. */
  orderHistory: Record<number, Record<string, number>>;
  /** Admin only: engine-proposed TOTAL market demand for this month. */
  proposedOrders: Record<string, number> | null;
  /** Admin only: the submitted per-team allocation (teamId -> sku -> qty). */
  submittedOrders: Record<string, Record<string, number>> | null;
  /** Admin only: event log. */
  log: LogEntry[] | null;
}

const PRICE_REVEAL_PHASES: Phase[] = ['TRADING', 'ORDERS', 'RESULTS'];

function profitBoard(state: GameState): ProfitBoardRow[] {
  return state.teams
    .map((t) => ({
      teamId: t.id,
      teamName: t.name,
      cumulativeProfit: t.cumulativeProfit,
      budget: t.budget,
      avgFillRate: t.results.length
        ? t.results.reduce((s, r) => s + r.fillRate, 0) / t.results.length
        : 1,
    }))
    .sort((a, b) => b.cumulativeProfit - a.cumulativeProfit);
}

export function viewFor(state: GameState, audience: Audience): GameView {
  const isAdmin = audience === 'admin';
  const myTeamId = audience.startsWith('team:') ? audience.slice(5) : null;
  const gameOver = state.phase === 'GAME_OVER';

  const teamsProgress: TeamProgress[] = state.teams.map((t) => ({
    id: t.id,
    name: t.name,
    submitted: {
      forecast: t.decisions.forecast !== null,
      production: t.decisions.production !== null,
      transport: t.decisions.transport !== null,
      prices: t.decisions.prices !== null,
    },
  }));

  const showPrices = PRICE_REVEAL_PHASES.includes(state.phase);
  const priceBoard: PriceBoardRow[] | null = showPrices
    ? state.teams
        .filter((t) => t.decisions.prices)
        .map((t) => ({ teamId: t.id, teamName: t.name, prices: t.decisions.prices! }))
        .sort((a, b) => {
          const avg = (r: PriceBoardRow) => {
            const vals = Object.values(r.prices);
            return vals.reduce((s, v) => s + v, 0) / Math.max(1, vals.length);
          };
          return avg(a) - avg(b);
        })
    : null;

  const offers = state.tradeOffers.filter(
    (o) =>
      isAdmin ||
      (myTeamId !== null && (o.buyerTeamId === myTeamId || o.sellerTeamId === myTeamId)),
  );

  return {
    rev: state.rev,
    code: state.code,
    phase: state.phase,
    month: state.month,
    config: state.config,
    players: state.players,
    teamsProgress,
    myTeam: myTeamId ? state.teams.find((t) => t.id === myTeamId) ?? null : null,
    allTeams: isAdmin || gameOver ? state.teams : null,
    offers,
    priceBoard,
    profitBoard: isAdmin || gameOver ? profitBoard(state) : null,
    orderHistory: flattenOrderHistory(state, myTeamId),
    proposedOrders: isAdmin ? state.proposedOrders : null,
    submittedOrders: isAdmin ? state.submittedOrders : null,
    log: isAdmin ? state.log : null,
  };
}

/** All audiences whose views must be recomputed after a state change. */
export function allAudiences(state: GameState): Audience[] {
  return ['admin', 'public', ...state.teams.map((t) => `team:${t.id}` as const)];
}

/** The audience a given player belongs to. */
export function audienceFor(state: GameState, playerId: string): Audience {
  const p = state.players.find((pl) => pl.id === playerId);
  if (!p) return 'public';
  if (p.isAdmin) return 'admin';
  if (p.teamId) return `team:${p.teamId}`;
  return 'public';
}

/** A team sees its own realized orders; everyone else sees market totals. */
function flattenOrderHistory(
  state: GameState,
  myTeamId: string | null,
): Record<number, Record<string, number>> {
  const flat: Record<number, Record<string, number>> = {};
  for (const [m, alloc] of Object.entries(state.orderHistory)) {
    if (myTeamId && alloc[myTeamId]) {
      flat[Number(m)] = alloc[myTeamId];
    } else {
      const totals: Record<string, number> = {};
      for (const perTeam of Object.values(alloc)) {
        for (const [skuId, qty] of Object.entries(perTeam)) {
          totals[skuId] = (totals[skuId] ?? 0) + qty;
        }
      }
      flat[Number(m)] = totals;
    }
  }
  return flat;
}
