import type { TeamState } from '@scg/shared';
import { PHASE_LABELS } from '@scg/shared';
import { useGame } from '../state';
import { fmtMoney, fmtNum } from './ui';
import { Icon } from './icons';

// The supply network as a map, in the order goods move:
// demand meeting -> production lines -> one factory -> truckload or intermodal
// -> Customer Ops (prices) -> CEO trade -> customers. Each part pulses while
// the matching phase is being decided.

const W = 900;
const H = 440;
const DEMAND = { x: 96, y: H / 2 };
const LINE_X = 262;
const FACTORY = { x: 432, y: H / 2 };
const OPS = { x: 580, y: H / 2, r: 36 };
const CEO = { x: 700, y: H / 2, r: 36 };
const CUSTOMER = { x: 834, y: H / 2, r: 50 };

const TRUCK = { x: -12, y: -7, w: 24, h: 14 };

function Truck({ dur, begin = 0, path }: { dur: number; begin?: number; path: string }) {
  return (
    <g className="smap-truck">
      <rect x={TRUCK.x} y={TRUCK.y} width={TRUCK.w} height={TRUCK.h} rx="3" />
      <animateMotion dur={`${dur}s`} begin={`${begin}s`} repeatCount="indefinite" path={path} />
    </g>
  );
}

/** Round table with six seats: where the demand planners agree the forecast. */
function RoundTable({ x, y, active }: { x: number; y: number; active: boolean }) {
  const seats = Array.from({ length: 6 }, (_, i) => {
    const a = (i * Math.PI * 2) / 6 - Math.PI / 2;
    return { cx: x + 48 * Math.cos(a), cy: y + 48 * Math.sin(a) };
  });
  return (
    <g>
      {seats.map((s, i) => <circle key={i} cx={s.cx} cy={s.cy} r="8" className="smap-seat" />)}
      <circle cx={x} cy={y} r="32" className="smap-table" />
      <circle cx={x} cy={y} r="11" className="smap-table-centre" />
      {active && <circle cx={x} cy={y} r="32" className="smap-ring" />}
    </g>
  );
}

/** Factory building with a roof and two chimneys. */
function Factory({ x, y, scale = 1 }: { x: number; y: number; scale?: number }) {
  return (
    <g transform={scale === 1 ? undefined : `translate(${x} ${y}) scale(${scale}) translate(${-x} ${-y})`}>
      <rect x={x - 46} y={y - 30} width="92" height="62" rx="6" className="smap-factory" />
      <path d={`M ${x - 46} ${y - 30} L ${x - 20} ${y - 52} L ${x - 20} ${y - 30} L ${x + 6} ${y - 52} L ${x + 6} ${y - 30} L ${x + 32} ${y - 52} L ${x + 32} ${y - 30} L ${x + 46} ${y - 30}`} className="smap-factory-roof" />
      <rect x={x - 40} y={y - 92} width="10" height="40" rx="2" className="smap-factory-stack" />
      <rect x={x - 14} y={y - 14} width="28" height="46" rx="3" className="smap-factory-door" />
    </g>
  );
}

/** A round desk on the route: Customer Ops (prices) or the CEO (trade). */
function Desk({ x, y, r, icon, on, label }: {
  x: number; y: number; r: number; icon: 'tag' | 'handshake'; on: boolean; label: string;
}) {
  return (
    <g className={`smap-desk${on ? ' on' : ''}`} transform={`translate(${x} ${y})`}>
      <circle r={r} className="smap-desk-disc" />
      {on && <circle r={r} className="smap-ring" />}
      <g transform="translate(-12 -12)" className="smap-desk-icon">
        <Icon name={icon} size={24} />
      </g>
      <text y={-r - 12} textAnchor="middle" className="smap-title">{label}</text>
    </g>
  );
}

/** Week chip on a transport lane: lit when that lane carries units. */
function WeekPill({ x, y, weeks, units, lit }: { x: number; y: number; weeks: number; units: number; lit: boolean }) {
  return (
    <g className={`week-pill${lit ? ' on' : ''}`} transform={`translate(${x} ${y})`}>
      <rect x="-96" y="-12" width="192" height="24" rx="12" />
      <text y="4" textAnchor="middle">Week {weeks} · {fmtNum(units)} u</text>
    </g>
  );
}

// lanes leave the factory and end on the Customer Ops circle
const TL_PATH = 'M 478 200 C 505 165, 530 180, 552 198';
const IP_PATH = 'M 478 238 C 505 262, 530 262, 552 242';

function lineY(i: number, n: number): number {
  const top = 60;
  const bottom = H - 60;
  return n === 1 ? H / 2 : top + (i * (bottom - top)) / (n - 1);
}

function sum<T>(items: T[], pick: (item: T) => number): number {
  return items.reduce((s, item) => s + pick(item), 0);
}

export function SupplyMap() {
  const { view } = useGame();
  const team = view?.myTeam;
  if (!view || !team) return null;

  const lines = view.config.lines;
  const n = Math.max(1, lines.length);
  const made: Record<string, number> = {};
  for (const a of team.decisions.production ?? []) made[a.lineId] = (made[a.lineId] ?? 0) + a.qty;
  const producedTotal = sum(Object.values(made), (v) => v);

  const forecast = team.decisions.forecast ? sum(Object.values(team.decisions.forecast), (v) => v) : 0;
  const split = Object.values(team.decisions.transport ?? {});
  const truckload = sum(split, (s) => s.truckload);
  const interplant = sum(split, (s) => s.interplant);
  const tlWeeks = view.config.transport.truckload.leadWeeks;
  const ipWeeks = view.config.transport.interplant.leadWeeks;

  const onShelf = sum(Object.values(team.inventory).flat(), (b) => b.qty);
  const inTransit = sum(team.pipeline, (p) => p.qty);
  const last = team.results.at(-1);
  const sold = last ? sum(Object.values(last.bySku), (r) => r.fulfilled) : 0;
  const ordered = last ? sum(Object.values(last.bySku), (r) => r.ordered) : 0;

  // which part of the network the current phase is working on
  const phase = view.phase;
  const demandOn = phase === 'FORECAST';
  const productionOn = phase === 'PRODUCTION';
  const transportOn = phase === 'TRANSPORT';
  const pricingOn = phase === 'PRICING';
  const tradeOn = phase === 'TRADING';
  const customerOn = phase === 'ORDERS';

  return (
    <section className="smap" aria-label="Your supply network">
      <div className="smap-head">
        <div>
          <span className="kicker">Your supply network</span>
          <h3>{team.name}</h3>
        </div>
        <div className="smap-stats">
          <span className="chip now">Now <b>{PHASE_LABELS[phase]}</b></span>
          <span className="chip">Cash <b>{fmtMoney(team.budget)}</b></span>
          {last && (
            <span className={`chip ${last.profit < 0 ? 'bad' : 'good'}`}>
              Last month <b>{fmtMoney(last.profit)}</b>
            </span>
          )}
        </div>
      </div>

      <div className="smap-scroll">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Demand meeting, production lines, factory, truckload or intermodal, Customer Ops, CEO trade, customers">
          <rect x="0" y="0" width={W} height={H} rx="22" className="smap-ground" />

          <RoundTable x={DEMAND.x} y={DEMAND.y} active={demandOn} />
          <text x={DEMAND.x} y={DEMAND.y + 72} textAnchor="middle" className="smap-title">Demand meeting</text>
          <text x={DEMAND.x} y={DEMAND.y + 90} textAnchor="middle" className="smap-sub">
            {forecast > 0 ? `forecast ${fmtNum(forecast)} u` : 'forecast not set'}
          </text>

          {lines.map((line, i) => {
            const y = lineY(i, n);
            const units = made[line.id] ?? 0;
            const pathIn = `M ${DEMAND.x + 34} ${DEMAND.y} C ${LINE_X - 90} ${DEMAND.y}, ${LINE_X - 90} ${y}, ${LINE_X - 24} ${y}`;
            const pathOut = `M ${LINE_X + 24} ${y} C ${FACTORY.x - 120} ${y}, ${FACTORY.x - 120} ${FACTORY.y}, ${FACTORY.x - 48} ${FACTORY.y}`;
            return (
              <g key={line.id}>
                <path d={pathIn} className="smap-road-thin" />
                <path d={pathOut} className="smap-road" />
                <path d={pathOut} className="smap-road-line" />
                <circle cx={LINE_X} cy={y} r="24" className={`smap-node${units > 0 ? ' live' : ''}`} />
                {productionOn && <circle cx={LINE_X} cy={y} r="24" className="smap-ring" />}
                <text x={LINE_X} y={y + 5} textAnchor="middle" className="smap-node-text">{line.id}</text>
                <text x={LINE_X - 36} y={y - 2} textAnchor="end" className="smap-label">{line.name}</text>
                <text x={LINE_X - 36} y={y + 14} textAnchor="end" className="smap-sub">
                  {fmtNum(units)} / {fmtNum(line.capacityPerMonth)} u
                </text>
                {units > 0 && <Truck dur={2.6 + (i % 3) * 0.4} begin={i * 0.5} path={pathOut} />}
              </g>
            );
          })}

          <Factory x={FACTORY.x} y={FACTORY.y} />
          <text x={FACTORY.x} y={FACTORY.y + 52} textAnchor="middle" className="smap-title">Factory</text>
          <text x={FACTORY.x} y={FACTORY.y + 70} textAnchor="middle" className="smap-sub">
            {fmtNum(producedTotal)} u made · {fmtNum(onShelf)} on shelf · {fmtNum(inTransit)} in transit
          </text>

          {/* the two transport options, both ending on Customer Ops */}
          <path d={TL_PATH} className={`smap-road tl${transportOn ? ' active' : ''}`} />
          <path d={TL_PATH} className="smap-road-line" />
          <text x="540" y="118" textAnchor="middle" className="smap-lane">Truckload</text>
          <WeekPill x={540} y={140} weeks={tlWeeks} units={truckload} lit={truckload > 0} />
          {truckload > 0 && <Truck dur={2.2} path={TL_PATH} />}

          <path d={IP_PATH} className={`smap-road ip${transportOn ? ' active' : ''}`} />
          <path d={IP_PATH} className="smap-road-dash" />
          <WeekPill x={540} y={318} weeks={ipWeeks} units={interplant} lit={interplant > 0} />
          <text x="540" y="354" textAnchor="middle" className="smap-lane">Intermodal (interplant)</text>
          {interplant > 0 && <Truck dur={4.6} path={IP_PATH} />}

          <Desk x={OPS.x} y={OPS.y} r={OPS.r} icon="tag" on={pricingOn} label="Customer Ops" />
          <path d={`M ${OPS.x + OPS.r} ${OPS.y} L ${CEO.x - CEO.r} ${CEO.y}`} className="smap-road-link" />
          <Desk x={CEO.x} y={CEO.y} r={CEO.r} icon="handshake" on={tradeOn} label="CEO trade" />
          <path d={`M ${CEO.x + CEO.r} ${CEO.y} L ${CUSTOMER.x - CUSTOMER.r} ${CUSTOMER.y}`} className="smap-road-link" />

          <circle cx={CUSTOMER.x} cy={CUSTOMER.y} r={CUSTOMER.r} className={`smap-market${customerOn ? ' on' : ''}`} />
          {customerOn && <circle cx={CUSTOMER.x} cy={CUSTOMER.y} r={CUSTOMER.r} className="smap-ring" />}
          <text x={CUSTOMER.x} y={CUSTOMER.y - 4} textAnchor="middle" className="smap-title">Customers</text>
          <text x={CUSTOMER.x} y={CUSTOMER.y + CUSTOMER.r + 22} textAnchor="middle" className="smap-sub">
            {last ? `last month: ${fmtNum(sold)} of ${fmtNum(ordered)} sold` : 'sales start next month'}
          </text>
        </svg>
      </div>
    </section>
  );
}

/** Facilitator view: every team's factory sends goods to the same customers. */
export function MarketMap() {
  const { view } = useGame();
  if (!view?.allTeams) return null;
  const teams = view.allTeams;
  const n = Math.max(1, teams.length);

  const orderedFor = (t: TeamState): number => {
    const set = view.submittedOrders?.[t.id];
    if (set) return sum(Object.values(set), (v) => v);
    const last = t.results.at(-1);
    return last ? sum(Object.values(last.bySku), (r) => r.ordered) : 0;
  };
  const rows = teams.map((t) => ({ team: t, units: orderedFor(t) }));
  const maxUnits = Math.max(1, ...rows.map((r) => r.units));
  const total = sum(rows, (r) => r.units);
  const rowY = (i: number) => (n === 1 ? H / 2 : 96 + (i * (H - 190)) / (n - 1));
  const CX = 760;
  const CY = H / 2;

  return (
    <section className="smap" aria-label="Market: every factory and the customers it sells to">
      <div className="smap-head">
        <div>
          <span className="kicker">Market</span>
          <h3>Customers buy from every factory</h3>
        </div>
        <div className="smap-stats">
          <span className="chip">Ordered <b>{fmtNum(total)} u</b></span>
        </div>
      </div>
      <div className="smap-scroll">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Each team's factory sends goods to the customers, thicker lines for more units">
          <rect x="0" y="0" width={W} height={H} rx="22" className="smap-ground" />
          {rows.map(({ team, units }, i) => {
            const y = rowY(i);
            const width = 2 + (units / maxUnits) * 14;
            const path = `M 210 ${y} C 430 ${y}, 560 ${CY}, ${CX - CUSTOMER.r} ${CY}`;
            return (
              <g key={team.id}>
                <path d={path} className="smap-flow" style={{ strokeWidth: width }} />
                <Factory x={150} y={y} scale={0.6} />
                <text x={150} y={y + 46} textAnchor="middle" className="smap-title">{team.name}</text>
                <text x={250} y={y - 12} className="smap-sub">{fmtNum(units)} u ordered</text>
                {units > 0 && <Truck dur={3.2 + i * 0.3} begin={i * 0.4} path={path} />}
              </g>
            );
          })}
          <circle cx={CX} cy={CY} r={CUSTOMER.r} className="smap-market" />
          <text x={CX} y={CY - 4} textAnchor="middle" className="smap-title">Customers</text>
          <text x={CX} y={CY + 16} textAnchor="middle" className="smap-sub">{fmtNum(total)} u</text>
        </svg>
      </div>
    </section>
  );
}

