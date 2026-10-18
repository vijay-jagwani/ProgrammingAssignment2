import { useGame } from '../state';
import { fmtMoney, fmtNum } from './ui';

// The team's own supply network, drawn as a live map: production lines feed a
// warehouse, which ships to customers. Trucks move while goods are moving.

const W = 820;
const H = 380;
const LINE_X = 210;
const WH = { x: 430, y: 150, w: 160, h: 100 };
const MARKET = { cx: 720, cy: 200, r: 58 };

export function SupplyMap() {
  const { view } = useGame();
  const team = view?.myTeam;
  if (!view || !team) return null;

  const lines = view.config.lines;
  const made: Record<string, number> = {};
  for (const a of team.decisions.production ?? []) made[a.lineId] = (made[a.lineId] ?? 0) + a.qty;

  const onShelf = Object.values(team.inventory).flat().reduce((s, b) => s + b.qty, 0);
  const inTransit = team.pipeline.reduce((s, p) => s + p.qty, 0);
  const last = team.results.at(-1);
  const sold = last ? Object.values(last.bySku).reduce((s, r) => s + r.fulfilled, 0) : 0;
  const ordered = last ? Object.values(last.bySku).reduce((s, r) => s + r.ordered, 0) : 0;
  const lastProfit = last?.profit ?? null;

  const n = Math.max(1, lines.length);
  const top = 60;
  const bottom = H - 60;
  const lineY = (i: number) => (n === 1 ? (top + bottom) / 2 : top + (i * (bottom - top)) / (n - 1));
  const whY = WH.y + WH.h / 2;
  const roadTo = (y: number) => `M ${LINE_X} ${y} C ${LINE_X + 150} ${y}, ${WH.x - 130} ${whY}, ${WH.x} ${whY}`;
  const shipPath = `M ${WH.x + WH.w} ${whY} L ${MARKET.cx - MARKET.r} ${whY}`;

  return (
    <section className="smap" aria-label="Your supply network">
      <div className="smap-head">
        <div>
          <span className="kicker">Your supply network</span>
          <h3>{team.name}</h3>
        </div>
        <div className="smap-stats">
          <span className="chip">Cash <b>{fmtMoney(team.budget)}</b></span>
          {lastProfit != null && (
            <span className={`chip ${lastProfit < 0 ? 'bad' : 'good'}`}>
              Last month <b>{fmtMoney(lastProfit)}</b>
            </span>
          )}
        </div>
      </div>

      <div className="smap-scroll">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Production lines feed the warehouse, which ships to customers">
          <rect x="0" y="0" width={W} height={H} rx="22" className="smap-ground" />

          {lines.map((line, i) => {
            const y = lineY(i);
            const units = made[line.id] ?? 0;
            return (
              <g key={line.id}>
                <path d={roadTo(y)} className="smap-road" />
                <path d={roadTo(y)} className="smap-road-line" />
                <circle cx={LINE_X} cy={y} r="26" className={`smap-node${units > 0 ? ' live' : ''}`} />
                <text x={LINE_X} y={y + 5} textAnchor="middle" className="smap-node-text">{line.id}</text>
                <text x={LINE_X - 42} y={y - 2} textAnchor="end" className="smap-label">{line.name}</text>
                <text x={LINE_X - 42} y={y + 16} textAnchor="end" className="smap-sub">
                  {fmtNum(units)} / {fmtNum(line.capacityPerMonth)} u
                </text>
                {units > 0 && (
                  <g className="smap-truck">
                    <rect x="-12" y="-7" width="24" height="14" rx="3" />
                    <animateMotion
                      dur={`${2.6 + (i % 3) * 0.4}s`}
                      begin={`${(i * 0.5).toFixed(1)}s`}
                      repeatCount="indefinite"
                      path={roadTo(y)}
                    />
                  </g>
                )}
              </g>
            );
          })}

          <rect x={WH.x} y={WH.y} width={WH.w} height={WH.h} rx="16" className="smap-warehouse" />
          <text x={WH.x + WH.w / 2} y={WH.y + 26} textAnchor="middle" className="smap-title">Warehouse</text>
          <text x={WH.x + WH.w / 2} y={WH.y + 60} textAnchor="middle" className="smap-big">{fmtNum(onShelf)}</text>
          <text x={WH.x + WH.w / 2} y={WH.y + 80} textAnchor="middle" className="smap-sub">
            on shelf · {fmtNum(inTransit)} in transit
          </text>

          <line x1={WH.x + WH.w} y1={whY} x2={MARKET.cx - MARKET.r} y2={whY} className="smap-road" />
          <line x1={WH.x + WH.w} y1={whY} x2={MARKET.cx - MARKET.r} y2={whY} className="smap-road-line" />
          {sold > 0 && (
            <g className="smap-truck">
              <rect x="-12" y="-7" width="24" height="14" rx="3" />
              <animateMotion dur="1.8s" repeatCount="indefinite" path={shipPath} />
            </g>
          )}

          <circle cx={MARKET.cx} cy={MARKET.cy} r={MARKET.r} className="smap-market" />
          <text x={MARKET.cx} y={MARKET.cy - 4} textAnchor="middle" className="smap-title">Customers</text>
          <text x={MARKET.cx} y={MARKET.cy + 16} textAnchor="middle" className="smap-sub">
            {last ? `${fmtNum(sold)} of ${fmtNum(ordered)} sold` : 'first month ahead'}
          </text>
          <text x={MARKET.cx} y={MARKET.cy + MARKET.r + 26} textAnchor="middle" className="smap-sub">
            last month
          </text>
        </svg>
      </div>
    </section>
  );
}
