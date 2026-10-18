import type { TeamState } from '@scg/shared';
import { PHASE_LABELS } from '@scg/shared';
import { useGame } from '../state';
import { fmtMoney, fmtNum } from './ui';
import { Icon } from './icons';

// The team's network as a compact interchange map, in the order goods move:
// demand meeting -> production lines -> factory -> truckload or intermodal
// -> Customer Ops -> CEO trade -> customers. The part being decided pulses.

const SW = 900;
const SH = 200;
const DEMAND = { x: 58, y: 100 };
const LINES = { x: 120, y: 62, w: 120, h: 76 };
const FACTORY = { x: 330, y: 100 };
const OPS = { x: 560, y: 100, r: 22 };
const CEO = { x: 660, y: 100, r: 22 };
const CUSTOMER = { x: 790, y: 100, r: 36 };
const MOVE_PATH = 'M 242 100 L 302 100';
const TL_PATH = 'M 352 92 C 420 40, 480 40, 544 84';
const IP_PATH = 'M 352 108 C 420 160, 480 160, 544 116';

// market view size
const W = 900;
const H = 440;

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
function RoundTable({ active }: { active: boolean }) {
  const seats = Array.from({ length: 6 }, (_, i) => {
    const a = (i * Math.PI * 2) / 6 - Math.PI / 2;
    return { cx: 48 * Math.cos(a), cy: 48 * Math.sin(a) };
  });
  return (
    <g>
      {seats.map((s, i) => <circle key={i} cx={s.cx} cy={s.cy} r="8" className="smap-seat" />)}
      <circle r="32" className="smap-table" />
      <circle r="11" className="smap-table-centre" />
      {active && <circle r="32" className="smap-ring" />}
    </g>
  );
}

/** Factory building with a roof and a chimney. */
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

/** A round desk on the route: Customer Ops (prices) or the CEO (trade). Its label sits below. */
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
      <text y={r + 28} textAnchor="middle" className="smap-title">{label}</text>
    </g>
  );
}

/** Label on a transport lane: lit when that lane carries units. */
function LaneLabel({ x, y, text, lit }: { x: number; y: number; text: string; lit: boolean }) {
  return (
    <g className={`week-pill${lit ? ' on' : ''}`} transform={`translate(${x} ${y})`}>
      <rect x="-118" y="-12" width="236" height="24" rx="12" />
      <text y="4" textAnchor="middle">{text}</text>
    </g>
  );
}

function sum<T>(items: T[], pick: (item: T) => number): number {
  return items.reduce((s, item) => s + pick(item), 0);
}

export function SupplyMap() {
  const { view } = useGame();
  const team = view?.myTeam;
  if (!view || !team) return null;

  const lines = view.config.lines;
  const made: Record<string, number> = {};
  for (const a of team.decisions.production ?? []) made[a.lineId] = (made[a.lineId] ?? 0) + a.qty;
  const producedTotal = sum(Object.values(made), (v) => v);
  const capacity = sum(lines, (l) => l.capacityPerMonth);

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
    <section className="smap smap-compact" aria-label="Your supply network">
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
        <svg viewBox={`0 0 ${SW} ${SH}`} role="img" aria-label="Demand meeting, production lines, factory, truckload or intermodal, Customer Ops, CEO trade, customers">
          <rect x="0" y="0" width={SW} height={SH} rx="18" className="smap-ground" />

          {/* demand meeting */}
          <path d={`M ${DEMAND.x + 26} ${DEMAND.y} L ${LINES.x - 4} ${DEMAND.y}`} className="smap-road-thin" />
          <g transform={`translate(${DEMAND.x} ${DEMAND.y}) scale(0.6)`}>
            <RoundTable active={demandOn} />
          </g>
          <text x={DEMAND.x} y={150} textAnchor="middle" className="smap-title">Demand meeting</text>
          <text x={DEMAND.x} y={166} textAnchor="middle" className="smap-sub">
            {forecast > 0 ? `forecast ${fmtNum(forecast)} u` : 'forecast not set'}
          </text>

          {/* production lines, one dot per line */}
          <rect x={LINES.x} y={LINES.y} width={LINES.w} height={LINES.h} rx="14" className={`smap-lines${productionOn ? ' on' : ''}`} />
          {lines.map((line, i) => {
            const cx = LINES.x + 22 + (i % 4) * 25;
            const cy = LINES.y + 22 + Math.floor(i / 4) * 26;
            const units = made[line.id] ?? 0;
            return (
              <circle key={line.id} cx={cx} cy={cy} r="8" className={`smap-line-dot${units > 0 ? ' live' : ''}`}>
                <title>{`${line.name}: ${fmtNum(units)} / ${fmtNum(line.capacityPerMonth)} u`}</title>
              </circle>
            );
          })}
          <text x={LINES.x + LINES.w / 2} y={LINES.y - 8} textAnchor="middle" className="smap-title">Production lines</text>
          <text x={LINES.x + LINES.w / 2} y={LINES.y + LINES.h + 18} textAnchor="middle" className="smap-sub">
            {fmtNum(producedTotal)} / {fmtNum(capacity)} u
          </text>

          {/* factory, and the move into it */}
          <path d={MOVE_PATH} className="smap-road-thin" />
          {producedTotal > 0 && <Truck dur={2} path={MOVE_PATH} />}
          <Factory x={FACTORY.x} y={FACTORY.y} scale={0.55} />
          <text x={FACTORY.x} y={140} textAnchor="middle" className="smap-title">Factory</text>
          <text x={FACTORY.x} y={156} textAnchor="middle" className="smap-sub">
            {fmtNum(onShelf)} on shelf · {fmtNum(inTransit)} moving
          </text>

          {/* the two transport options */}
          <path d={TL_PATH} className={`smap-road tl${transportOn ? ' active' : ''}`} />
          <path d={TL_PATH} className="smap-road-line" />
          <LaneLabel x={455} y={30} text={`Truckload · week ${tlWeeks} · ${fmtNum(truckload)} u`} lit={truckload > 0} />
          {truckload > 0 && <Truck dur={2.2} path={TL_PATH} />}

          <path d={IP_PATH} className={`smap-road ip${transportOn ? ' active' : ''}`} />
          <path d={IP_PATH} className="smap-road-dash" />
          <LaneLabel x={455} y={180} text={`Intermodal · week ${ipWeeks} · ${fmtNum(interplant)} u`} lit={interplant > 0} />
          {interplant > 0 && <Truck dur={4.6} path={IP_PATH} />}

          {/* Customer Ops prices, CEO trades, then customers */}
          <Desk x={OPS.x} y={OPS.y} r={OPS.r} icon="tag" on={pricingOn} label="Customer Ops" />
          <path d={`M ${OPS.x + OPS.r} ${OPS.y} L ${CEO.x - CEO.r} ${CEO.y}`} className="smap-road-link" />
          <Desk x={CEO.x} y={CEO.y} r={CEO.r} icon="handshake" on={tradeOn} label="CEO trade" />
          <path d={`M ${CEO.x + CEO.r} ${CEO.y} L ${CUSTOMER.x - CUSTOMER.r} ${CUSTOMER.y}`} className="smap-road-link" />

          <circle cx={CUSTOMER.x} cy={CUSTOMER.y} r={CUSTOMER.r} className={`smap-market${customerOn ? ' on' : ''}`} />
          {customerOn && <circle cx={CUSTOMER.x} cy={CUSTOMER.y} r={CUSTOMER.r} className="smap-ring" />}
          <text x={CUSTOMER.x} y={150} textAnchor="middle" className="smap-title">Customers</text>
          <text x={CUSTOMER.x} y={166} textAnchor="middle" className="smap-sub">
            {last ? `${fmtNum(sold)} of ${fmtNum(ordered)} sold` : 'sales start next month'}
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
        <svg className="market-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Each team's factory sends goods to the customers, thicker lines for more units">
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

