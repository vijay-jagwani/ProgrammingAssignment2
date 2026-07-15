// Facilitator / player briefing shown on the landing page: what each role
// does, the monthly workflow, what players learn, and difficulty tiers.
// Intentionally long — it is reference material, meant to be scrolled.

interface RoleCard {
  role: string;
  who: string;
  does: string;
  color: string;
}

const ROLES: RoleCard[] = [
  {
    role: 'Demand Planner',
    who: 'The forecaster',
    does: 'Predicts how much the market will order each month from history and past actuals. Sets the target everyone else plans against — get it wrong and the team over- or under-produces.',
    color: 'var(--series-1)',
  },
  {
    role: 'Production Planner',
    who: 'The factory boss',
    does: 'Allocates the forecast to production lines within capacity. On harder settings you cannot make every SKU — choose what to build in-house and flag what to buy; on Easy, resist overbuilding.',
    color: 'var(--series-2)',
  },
  {
    role: 'Transport Manager',
    who: 'The logistics lead',
    does: 'Splits each SKU between truckload (fast, dear — sells this month) and interplant (slow, cheap — arrives next month). Balances speed, cost, and stockout risk.',
    color: 'var(--series-3)',
  },
  {
    role: 'Customer Ops Manager',
    who: 'The pricer',
    does: 'Sets the selling price above the landed-cost floor, weighing production, transport, and holding costs against the competitive price board.',
    color: 'var(--series-5)',
  },
  {
    role: 'CEO',
    who: 'The dealmaker',
    does: 'Owns the budget and the make-vs-buy call — negotiates with rival CEOs to buy SKUs the team cannot make and sell surplus it can. Signs off the team’s month.',
    color: 'var(--series-6)',
  },
];

interface Phase {
  n: string;
  name: string;
  owner: string;
  detail: string;
}

const PHASES: Phase[] = [
  { n: '1', name: 'Forecast', owner: 'Demand Planner', detail: 'Enter this month’s demand forecast per SKU.' },
  { n: '2', name: 'Production', owner: 'Production Planner', detail: 'Allocate the forecast to lines, capped by capacity.' },
  { n: '3', name: 'Transport', owner: 'Transport Manager', detail: 'Split each SKU across truckload / interplant.' },
  { n: '4', name: 'Pricing', owner: 'Customer Ops', detail: 'Set selling prices above the cost floor.' },
  { n: '5', name: 'Reveal & Trade', owner: 'CEO', detail: 'Prices go on the board; CEOs trade make-vs-buy.' },
  { n: '6', name: 'Customer Orders', owner: 'Facilitator', detail: 'Admins act as the market and place real orders.' },
  { n: '7', name: 'Resolution', owner: 'Engine', detail: 'Sales, stockouts, aging, costs, and P&L are computed.' },
  { n: '8', name: 'Results', owner: 'Whole team', detail: 'Forecast vs actual, fill rate, profit — then repeat.' },
];

const OBJECTIVES = [
  ['Forecast vs actual', 'Feel the cost of a wrong forecast — over-production ages out, under-production stocks out.'],
  ['The bullwhip effect', 'Customer orders swing month to month as shelves stock out and overstock — small signals, big upstream swings.'],
  ['Speed vs cost tradeoffs', 'Fast truckload or cheap interplant? Every logistics choice trades cash against availability.'],
  ['Inventory economics', 'Holding costs, aging, and shelf-life write-offs punish carrying the wrong stock.'],
  ['Make vs buy', 'When capacity is scarce, teams specialize and negotiate — the classic sourcing decision, live.'],
  ['Cross-functional alignment', 'Five roles, one P&L. The team wins or loses together, so they must reconcile.'],
];

const TIERS = [
  ['Easy', 'More capacity than demand', 'The overstock lesson: you CAN build everything — but unsold units bleed value every month (age loss equals the build cost spread over shelf life), so excess must be priced to move.'],
  ['Medium', 'Capacity ≈ demand (95–100%)', 'The default. A near-perfect plan covers the market — any slack or misallocation leaves gaps to fill by trading.'],
  ['Hard', 'Scarce capacity, volatile demand', 'Capacity covers only half of demand and forecasts get punished — specialization and aggressive CEO trading are essential. For experienced groups.'],
];

export function HowItWorks() {
  return (
    <div style={{ marginTop: 8 }}>
      <div className="card">
        <h2>How the game works</h2>
        <p className="sub">
          A team of five runs a finished-goods supply chain over several months. Each month moves
          through eight phases; each role acts in turn, then the market (the facilitators) places the
          real orders and the engine settles the books. Shared demand means the
          leaderboard rewards good decisions, not luck.
        </p>
      </div>

      {/* Monthly workflow */}
      <div className="card">
        <h3>The monthly cycle</h3>
        <p className="sub">What happens each month, and who drives it. This loop repeats until the final month.</p>
        <div className="phase-flow">
          {PHASES.map((p, i) => (
            <div className="phase-flow-item" key={p.n}>
              <div className="phase-node">
                <div className="phase-node-n">{p.n}</div>
                <div className="phase-node-name">{p.name}</div>
                <div className="phase-node-owner">{p.owner}</div>
                <div className="phase-node-detail">{p.detail}</div>
              </div>
              {i < PHASES.length - 1 && <div className="phase-arrow" aria-hidden>→</div>}
            </div>
          ))}
          <div className="phase-loop">↺ next month</div>
        </div>
      </div>

      {/* Roles */}
      <div className="card">
        <h3>The five roles</h3>
        <p className="sub">Each player owns one seat. One player can hold several if the team is short-handed.</p>
        <div className="role-grid">
          {ROLES.map((r) => (
            <div className="role-tile" key={r.role} style={{ borderTop: `3px solid ${r.color}` }}>
              <div className="role-tile-name">{r.role}</div>
              <div className="role-tile-who">{r.who}</div>
              <div className="role-tile-does">{r.does}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Learning objectives + difficulty */}
      <div className="grid2">
        <div className="card">
          <h3>What players learn</h3>
          <ul className="learn-list">
            {OBJECTIVES.map(([title, body]) => (
              <li key={title}>
                <b>{title}.</b> {body}
              </li>
            ))}
          </ul>
        </div>
        <div className="card">
          <h3>Difficulty tiers</h3>
          <p className="sub">Set at game creation — scales demand volatility and how scarce capacity is.</p>
          <table className="data">
            <tbody>
              {TIERS.map(([tier, tag, body]) => (
                <tr key={tier}>
                  <td style={{ whiteSpace: 'nowrap', verticalAlign: 'top' }}>
                    <b>{tier}</b>
                    <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{tag}</div>
                  </td>
                  <td style={{ fontSize: 13, color: 'var(--ink-2)' }}>{body}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
          <h3>Facilitator quick start</h3>
          <a href="/facilitator-guide.html" target="_blank" rel="noopener noreferrer">
            <button className="primary small">📄 Full facilitator guide (print / save as PDF) →</button>
          </a>
        </div>
        <ol className="learn-list">
          <li><b>Host a game</b> above and share the 6-character code. Co-facilitators join and you promote them (admins run the market, they can’t be on a team).</li>
          <li><b>Players join</b>, form teams of five, and claim roles. Two people on one device? Use <b>Switch player</b>. Aim for 2+ teams so the make-vs-buy market comes alive.</li>
          <li><b>Drive each phase</b>: wait for the ✓ marks, then advance. Unsubmitted decisions fall back to safe defaults, so a quiet seat never blocks the game.</li>
          <li><b>Be the market</b> in the Orders phase — the simulation proposes total demand (baseline × number of teams); you split it across teams. Reward sharper prices with more volume, or split evenly for identical orders.</li>
          <li><b>Debrief on Results</b>: forecast accuracy, fill rate, and the P&L breakdown. Budget 10–15 minutes per month — the arguing is where the learning happens.</li>
        </ol>
      </div>
    </div>
  );
}
