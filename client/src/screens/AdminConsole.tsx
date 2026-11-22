import { useState } from 'react';
import { PHASE_LABELS } from '@scg/shared';
import { useGame } from '../state';
import { ConfirmButton, NumInput, fmtMoney, fmtNum, pct } from '../components/ui';
import { PriceBoardCard } from './TeamDashboard';
import { MarketMap } from '../components/SupplyMap';
import { CommandRow } from '../components/CommandRow';
import { MonthSummary } from '../components/MonthSummary';

const ADVANCE_HINT: Record<string, string> = {
  FORECAST: 'Teams without a forecast get last actuals/baseline.',
  PRODUCTION: 'Teams without a plan produce nothing this month.',
  TRANSPORT: 'Unset transport defaults to truckload.',
  PRICING: 'Unset prices default to the cost floor. Advancing reveals the price board.',
  TRADING: 'Open trade offers expire.',
  ORDERS: 'Advancing locks orders and resolves the month for every team. If you set none, the suggested split by price is used.',
  RESULTS: 'Moves to the next month (or ends the game after the final month).',
};

export function AdminConsole() {
  const { view } = useGame();
  if (!view) return null;
  return (
    <div>
      <CommandRow control={<PhaseControl />} />
      <MarketMap />
      {view.phase === 'ORDERS' && <OrdersDesk key={`o${view.month}`} />}
      {view.phase === 'RESULTS' && <MonthSummary />}
      {view.priceBoard && <PriceBoardCard />}
      <TeamsOverview />
      <div className="grid2">
        <TradesCard />
        <LogCard />
      </div>
    </div>
  );
}

export function PhaseControl() {
  const { view, act, busy } = useGame();
  if (!view) return null;
  const phaseKey = view.phase as keyof typeof ADVANCE_HINT;
  const solo = view.mode === 'solo';
  const submittedFlag = {
    FORECAST: 'forecast', PRODUCTION: 'production', TRANSPORT: 'transport', PRICING: 'prices',
    TRADING: 'trading',
  }[view.phase as string] as 'forecast' | 'production' | 'transport' | 'prices' | 'trading' | undefined;

  return (
    <div className="card">
      <h2>{PHASE_LABELS[view.phase]} — month {view.month}</h2>
      <p className="sub">
        {solo && view.phase === 'PRICING'
          ? 'Advancing locks your prices and opens trading with the rival teams.'
          : ADVANCE_HINT[phaseKey] ?? ''}
      </p>
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
          : solo && view.phase === 'PRICING' ? 'Lock prices & open trading'
          : solo && view.phase === 'TRADING' ? 'Close trading & resolve month'
          : view.phase === 'RESULTS'
            ? view.month >= view.config.months ? 'Finish game' : `Start month ${view.month + 1}`
            : 'Advance phase'}
      </ConfirmButton>
    </div>
  );
}

function OrdersDesk() {
  const { view, act, busy } = useGame();
  const teams = view!.teamsProgress;
  const skus = view!.config.skus;
  const n = Math.max(1, teams.length);
  const proposed = view!.proposedOrders ?? {};

  const equalSplit = () => {
    const out: Record<string, Record<string, number>> = {};
    for (const t of teams) {
      out[t.id] = {};
      for (const s of skus) out[t.id][s.id] = Math.round((proposed[s.id] ?? s.historicalMonthlyDemand * n) / n);
    }
    return out;
  };
  // the engine's price-weighted split: what the month resolves with if nothing is set
  const suggested = () => {
    const out = equalSplit();
    for (const t of teams) {
      for (const s of skus) {
        const v = view!.suggestedOrders?.[t.id]?.[s.id];
        if (v != null) out[t.id][s.id] = v;
      }
    }
    return out;
  };

  // teamId -> skuId -> qty; start from the submitted allocation if present,
  // otherwise from the suggested split
  const [alloc, setAlloc] = useState<Record<string, Record<string, number>>>(() => {
    const init = suggested();
    for (const t of teams) {
      for (const s of skus) {
        const set = view!.submittedOrders?.[t.id]?.[s.id];
        if (set != null) init[t.id][s.id] = set;
      }
    }
    return init;
  });

  // units each team can sell right now: shelf stock plus this month's truckload plan
  const availableUnits = (teamId: string, skuId: string) => view!.availability?.[teamId]?.[skuId] ?? 0;
  const priceOf = (teamId: string, skuId: string) =>
    view!.priceBoard?.find((r) => r.teamId === teamId)?.prices[skuId];
  const rowTotal = (skuId: string) =>
    teams.reduce((sum, t) => sum + (alloc[t.id]?.[skuId] ?? 0), 0);
  const setCell = (teamId: string, skuId: string, v: number) =>
    setAlloc({ ...alloc, [teamId]: { ...alloc[teamId], [skuId]: v } });

  return (
    <div className="card">
      <h2>Customer orders — you are the market</h2>
      <p className="sub">
        The market wants <b>baseline × {n} team{n === 1 ? '' : 's'}</b> of each SKU, adjusted by
        the shelf simulation (leftover stock lowers demand, missed deliveries raise it) and by
        occasional slumps that rebound 2–3 months later. The table starts from the <b>suggested
        split</b>: a team priced at the market median gets an equal share, cheaper teams get more
        and dearer teams less. If you set nothing, the month resolves with this split.
      </p>
      <div className="row" style={{ marginBottom: 10 }}>
        <button className="small" disabled={busy} onClick={() => setAlloc(suggested())}>Use suggested split</button>
        <button className="small" disabled={busy} onClick={() => setAlloc(equalSplit())}>Split equally</button>
      </div>
      <div className="table-scroll">
        <table className="data orders-desk">
          <thead>
            <tr>
              <th>Team</th>
              {skus.map((s) => (
                <th key={s.id} className="num">
                  {s.name}
                  <div className="price-sub">
                    market {fmtNum(proposed[s.id] ?? s.historicalMonthlyDemand * n)}
                    {view!.orderHistory[view!.month - 1]?.[s.id] != null &&
                      ` · last ${fmtNum(view!.orderHistory[view!.month - 1][s.id])}`}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {teams.map((t) => (
              <tr key={t.id}>
                <td>{t.name}</td>
                {skus.map((s) => {
                  const p = priceOf(t.id, s.id);
                  return (
                    <td key={s.id} className="num">
                      <NumInput value={alloc[t.id]?.[s.id] ?? 0}
                        softCap={Math.max(s.historicalMonthlyDemand * 3, proposed[s.id] ?? 0)} width={76}
                        onChange={(v) => setCell(t.id, s.id, v)} />
                      <div className="price-sub">
                        {p != null ? `@ ${fmtMoney(p)}` : 'no price'}
                        {' · '}{fmtNum(availableUnits(t.id, s.id))} avail
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th>Allocated</th>
              {skus.map((s) => {
                const total = rowTotal(s.id);
                const market = proposed[s.id];
                return (
                  <td key={s.id} className="num">
                    <span className={`badge${market != null && total !== market ? '' : ' on'}`}>
                      {fmtNum(total)}
                    </span>
                  </td>
                );
              })}
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="row" style={{ marginTop: 12 }}>
        <ConfirmButton className="" disabled={busy} onConfirm={() => act({ type: 'SUBMIT_ORDERS', allocations: alloc })}>
          Set orders
        </ConfirmButton>
        {view!.submittedOrders && <span className="badge good">✓ Orders set</span>}
        <span className="sub" style={{ fontSize: 12 }}>
          Totals don't have to match the market figure — you're the customer.
        </span>
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
        <div className="table-scroll">
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
        </div>
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
