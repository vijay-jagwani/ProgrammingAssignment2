import { useState } from 'react';
import { PHASE_LABELS } from '@scg/shared';
import { useGame } from '../state';
import { ConfirmButton, NumInput, fmtMoney, fmtNum, pct } from '../components/ui';
import { PhaseStepper, PriceBoardCard } from './TeamDashboard';

const ADVANCE_HINT: Record<string, string> = {
  FORECAST: 'Teams without a forecast get last actuals/baseline.',
  PRODUCTION: 'Teams without a plan produce nothing this month.',
  TRANSPORT: 'Unset transport defaults to truckload.',
  PRICING: 'Unset prices default to the cost floor. Advancing reveals the price board.',
  TRADING: 'Open trade offers expire.',
  ORDERS: 'Advancing locks orders and resolves the month for every team.',
  RESULTS: 'Moves to the next month (or ends the game after the final month).',
};

export function AdminConsole() {
  const { view } = useGame();
  if (!view) return null;
  return (
    <div>
      <PhaseStepper />
      <PhaseControl />
      {view.phase === 'ORDERS' && <OrdersDesk key={`o${view.month}`} />}
      {view.priceBoard && <PriceBoardCard />}
      <TeamsOverview />
      <div className="grid2">
        <TradesCard />
        <LogCard />
      </div>
    </div>
  );
}

function PhaseControl() {
  const { view, act, busy } = useGame();
  if (!view) return null;
  const phaseKey = view.phase as keyof typeof ADVANCE_HINT;
  const submittedFlag = {
    FORECAST: 'forecast', PRODUCTION: 'production', TRANSPORT: 'transport', PRICING: 'prices',
  }[view.phase as string] as 'forecast' | 'production' | 'transport' | 'prices' | undefined;

  return (
    <div className="card">
      <h2>{PHASE_LABELS[view.phase]} — month {view.month}</h2>
      <p className="sub">{ADVANCE_HINT[phaseKey] ?? ''}</p>
      {submittedFlag && (
        <div className="row" style={{ marginBottom: 10 }}>
          {view.teamsProgress.map((t) => (
            <span key={t.id} className={`badge${t.submitted[submittedFlag] ? ' good' : ''}`}>
              {t.submitted[submittedFlag] ? '✓' : '…'} {t.name}
            </span>
          ))}
        </div>
      )}
      <ConfirmButton disabled={busy} onConfirm={() => act({ type: 'ADVANCE_PHASE' })}>
        {view.phase === 'ORDERS' ? 'Lock orders & resolve month'
          : view.phase === 'RESULTS'
            ? view.month >= view.config.months ? 'Finish game' : `Start month ${view.month + 1}`
            : 'Advance phase'}
      </ConfirmButton>
    </div>
  );
}

function OrdersDesk() {
  const { view, act, busy } = useGame();
  const base = view!.submittedOrders ?? view!.proposedOrders ?? {};
  const [orders, setOrders] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {};
    for (const s of view!.config.skus) init[s.id] = base[s.id] ?? s.historicalMonthlyDemand;
    return init;
  });

  return (
    <div className="card">
      <h2>Customer orders — you are the market</h2>
      <p className="sub">
        The simulation proposes orders from each customer's shelf position (leftover stock lowers
        them, stockouts raise them). Confirm or tweak — the same orders hit <b>every</b> team.
      </p>
      <table className="data">
        <thead>
          <tr><th>SKU</th><th className="num">Baseline</th><th className="num">Last month</th>
            <th className="num">Proposed</th><th className="num">Order</th></tr>
        </thead>
        <tbody>
          {view!.config.skus.map((s) => (
            <tr key={s.id}>
              <td>{s.name}</td>
              <td className="num">{fmtNum(s.historicalMonthlyDemand)}</td>
              <td className="num">
                {view!.orderHistory[view!.month - 1]?.[s.id] != null
                  ? fmtNum(view!.orderHistory[view!.month - 1][s.id]) : '—'}
              </td>
              <td className="num">{view!.proposedOrders?.[s.id] != null ? fmtNum(view!.proposedOrders[s.id]) : '—'}</td>
              <td className="num">
                <NumInput value={orders[s.id]} softCap={s.historicalMonthlyDemand * 3}
                  onChange={(v) => setOrders({ ...orders, [s.id]: v })} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row" style={{ marginTop: 12 }}>
        <ConfirmButton disabled={busy} onConfirm={() => act({ type: 'SUBMIT_ORDERS', orders })}>
          Set orders
        </ConfirmButton>
        {view!.submittedOrders && <span className="badge good">✓ Orders set — advance to resolve</span>}
      </div>
    </div>
  );
}

function TeamsOverview() {
  const { view } = useGame();
  if (!view?.allTeams) return null;
  return (
    <div className="card">
      <h3>Teams</h3>
      <table className="data">
        <thead>
          <tr><th>Team</th><th className="num">Budget</th><th className="num">Cum. profit</th>
            <th className="num">Stock (u)</th><th className="num">In transit</th>
            <th className="num">Last fill</th></tr>
        </thead>
        <tbody>
          {view.allTeams.map((t) => {
            const stock = Object.values(t.inventory).flat().reduce((s, b) => s + b.qty, 0);
            const transit = t.pipeline.reduce((s, p) => s + p.qty, 0);
            const last = t.results.at(-1);
            return (
              <tr key={t.id}>
                <td>{t.name}</td>
                <td className="num" style={{ color: t.budget < 0 ? 'var(--delta-bad)' : undefined }}>
                  {fmtMoney(t.budget)}
                </td>
                <td className="num">{fmtMoney(t.cumulativeProfit)}</td>
                <td className="num">{fmtNum(stock)}</td>
                <td className="num">{fmtNum(transit)}</td>
                <td className="num">{last ? pct(last.fillRate) : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TradesCard() {
  const { view } = useGame();
  if (!view) return null;
  const offers = view.offers.slice().reverse().slice(0, 12);
  const teamName = (id: string) => view.teamsProgress.find((t) => t.id === id)?.name ?? id;
  const skuName = (id: string) => view.config.skus.find((s) => s.id === id)?.name ?? id;
  return (
    <div className="card">
      <h3>Trades (all teams)</h3>
      {offers.length === 0 ? <p className="sub">No trade offers yet.</p> : (
        <table className="data">
          <thead><tr><th>M</th><th>Deal</th><th className="num">Total</th><th>Status</th></tr></thead>
          <tbody>
            {offers.map((o) => (
              <tr key={o.id}>
                <td>{o.month}</td>
                <td style={{ fontSize: 13 }}>
                  {teamName(o.buyerTeamId)} buys {fmtNum(o.qty)} × {skuName(o.skuId)} from {teamName(o.sellerTeamId)} @ {fmtMoney(o.unitPrice)}
                </td>
                <td className="num">{fmtMoney(o.qty * o.unitPrice)}</td>
                <td><span className={`badge${o.status === 'accepted' ? ' good' : ''}`}>{o.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function LogCard() {
  const { view } = useGame();
  if (!view?.log) return null;
  return (
    <div className="card">
      <h3>Event log</h3>
      <div className="log">
        {view.log.slice().reverse().map((l, i) => (
          <div key={i}><b>M{l.month}</b> · {l.text}</div>
        ))}
        {view.log.length === 0 && <p className="sub">Quiet so far.</p>}
      </div>
    </div>
  );
}
