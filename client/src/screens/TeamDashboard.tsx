import { useMemo, useState } from 'react';
import {
  GameView, PHASE_LABELS, PHASE_ORDER, PHASE_ROLE, ProductionAllocation, Role,
  ROLE_LABELS, TeamState, TransportSplit, priceFloor, referenceCost,
} from '@scg/shared';
import { useGame } from '../state';
import { ConfirmButton, NumInput, fmtMoney, fmtNum, pct } from '../components/ui';
import { BarBreakdown, LineChart } from '../components/charts';

const unitsOf = (team: TeamState, skuId: string) =>
  (team.inventory[skuId] ?? []).reduce((s, b) => s + b.qty, 0);
const allUnits = (team: TeamState) =>
  Object.keys(team.inventory).reduce((s, k) => s + unitsOf(team, k), 0);

/** priceFloor only reads config + the team's decisions, so a partial state is fine. */
const floorFor = (view: GameView, team: TeamState, skuId: string) =>
  priceFloor({ config: view.config } as any, team, skuId);

export function TeamDashboard() {
  const { view, me } = useGame();
  if (!view || !me || !view.myTeam) return null;
  const team = view.myTeam;
  const lastResult = team.results.at(-1);

  return (
    <div>
      <PhaseStepper />
      <div className="statrow">
        <div className="stat">
          <div className="k">Budget</div>
          <div className={`v${team.budget < 0 ? ' bad' : ''}`}>{fmtMoney(team.budget)}</div>
        </div>
        <div className="stat">
          <div className="k">Cumulative profit</div>
          <div className={`v${team.cumulativeProfit < 0 ? ' bad' : team.cumulativeProfit > 0 ? ' good' : ''}`}>
            {fmtMoney(team.cumulativeProfit)}
          </div>
        </div>
        <div className="stat">
          <div className="k">Stock on hand</div>
          <div className="v">{fmtNum(allUnits(team))} u</div>
        </div>
        <div className="stat">
          <div className="k">Last fill rate</div>
          <div className="v">{lastResult ? pct(lastResult.fillRate) : '—'}</div>
        </div>
      </div>

      <ActivePanel />

      <div className="grid2">
        <InventoryCard />
        <ForecastChartCard />
      </div>
      <div className="grid2">
        <ProfitChartCard />
        {view.priceBoard && <PriceBoardCard />}
      </div>
    </div>
  );
}

export function PhaseStepper() {
  const { view } = useGame();
  if (!view) return null;
  const idx = PHASE_ORDER.indexOf(view.phase as any);
  return (
    <div className="phase-stepper">
      <span className="phase-step now" style={{ background: 'var(--ink-1)', color: 'var(--page)' }}>
        Month {view.month}/{view.config.months}
      </span>
      {PHASE_ORDER.map((p, i) => (
        <span key={p} className={`phase-step${i === idx ? ' now' : i < idx ? ' done' : ''}`}>
          {PHASE_LABELS[p]}
        </span>
      ))}
    </div>
  );
}

function ActivePanel() {
  const { view, me } = useGame();
  if (!view || !me || !view.myTeam) return null;
  const phase = view.phase;
  const owner = PHASE_ROLE[phase];
  // If nobody on the team claimed the phase's role, every teammate can act
  // (mirrors the engine's vacant-role fallback).
  const claimedOnTeam = owner
    ? view.players.some((p) => p.teamId === me.teamId && p.roles.includes(owner))
    : false;
  const iOwn = owner ? me.roles.includes(owner) || !claimedOnTeam : false;

  if (phase === 'FORECAST' && iOwn) return <ForecastPanel key={`f${view.month}`} />;
  if (phase === 'PRODUCTION' && iOwn) return <ProductionPanel key={`p${view.month}`} />;
  if (phase === 'TRANSPORT' && iOwn) return <TransportPanel key={`t${view.month}`} />;
  if (phase === 'PRICING' && iOwn) return <PricingPanel key={`c${view.month}`} />;
  if (phase === 'TRADING') return <TradingPanel key={`x${view.month}`} />; // whole team watches, CEO acts
  if (phase === 'ORDERS') {
    return (
      <div className="card banner info" style={{ margin: '0 0 14px' }}>
        <b>Customers are placing orders…</b> The facilitators are deciding this month's actual
        demand. Compare it with your forecast when results land.
      </div>
    );
  }
  if (phase === 'RESULTS') return <MonthResultsPanel />;

  const ownerName = owner
    ? view.players.find((p) => p.teamId === me.teamId && p.roles.includes(owner))?.name
    : null;
  return (
    <div className="card banner info" style={{ margin: '0 0 14px' }}>
      <b>{PHASE_LABELS[phase]}</b> — waiting on{' '}
      {owner ? `${ROLE_LABELS[owner]}${ownerName ? ` (${ownerName})` : ''}` : 'the facilitator'}.
      Talk it through as a team: every decision here is shared fate.
    </div>
  );
}

// ------------------------------------------------------------ forecast

function ForecastPanel() {
  const { view, act, busy } = useGame();
  const team = view!.myTeam!;
  const [fc, setFc] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {};
    for (const s of view!.config.skus) {
      init[s.id] =
        team.decisions.forecast?.[s.id] ??
        view!.orderHistory[view!.month - 1]?.[s.id] ??
        s.historicalMonthlyDemand;
    }
    return init;
  });
  const submitted = team.decisions.forecast !== null;
  const numTeams = Math.max(1, view!.teamsProgress.length);

  return (
    <div className="card">
      <h2>Demand forecast — month {view!.month}</h2>
      <p className="sub">
        The total market wants <b>baseline × {numTeams} team{numTeams === 1 ? '' : 's'}</b> of each
        SKU — big enough to absorb every team's output. The customer decides how much to buy{' '}
        <b>from each team</b>, and sharper prices win more volume. Forecast the share <b>you</b>{' '}
        expect to sell; customers carry stock and over-order after stockouts.
      </p>
      <table className="data">
        <thead>
          <tr>
            <th>SKU</th><th className="num">Market/mo ({numTeams} teams)</th>
            <th className="num">Your share baseline</th>
            <th className="num">You sold last month</th><th className="num">Your forecast</th>
          </tr>
        </thead>
        <tbody>
          {view!.config.skus.map((s) => (
            <tr key={s.id}>
              <td>{s.name}</td>
              <td className="num">{fmtNum(s.historicalMonthlyDemand * numTeams)}</td>
              <td className="num">{fmtNum(s.historicalMonthlyDemand)}</td>
              <td className="num">
                {view!.orderHistory[view!.month - 1]?.[s.id] != null
                  ? fmtNum(view!.orderHistory[view!.month - 1][s.id]) : '—'}
              </td>
              <td className="num">
                <NumInput value={fc[s.id]} softCap={s.historicalMonthlyDemand * 2}
                  onChange={(v) => setFc({ ...fc, [s.id]: v })} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row" style={{ marginTop: 12 }}>
        <ConfirmButton disabled={busy} onConfirm={() => act({ type: 'SUBMIT_FORECAST', forecast: fc })}>
          {submitted ? 'Update forecast' : 'Submit forecast'}
        </ConfirmButton>
        {submitted && <span className="badge good">✓ Submitted — you can still revise until the phase ends</span>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------- production

function ProductionPanel() {
  const { view, act, busy } = useGame();
  const team = view!.myTeam!;
  const config = view!.config;
  const [alloc, setAlloc] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {};
    for (const a of team.decisions.production ?? []) init[`${a.lineId}|${a.skuId}`] = a.qty;
    return init;
  });

  const usedOn = (lineId: string) =>
    Object.entries(alloc).reduce(
      (s, [k, v]) => (k.startsWith(`${lineId}|`) ? s + (v || 0) : s), 0);
  const totalCost = Object.entries(alloc).reduce((s, [k, v]) => {
    const line = config.lines.find((l) => l.id === k.split('|')[0]);
    return s + (line ? (v || 0) * line.costPerUnit : 0);
  }, 0);
  const allocations: ProductionAllocation[] = Object.entries(alloc)
    .map(([k, qty]) => ({ lineId: k.split('|')[0], skuId: k.split('|')[1], qty: qty || 0 }))
    .filter((a) => a.qty > 0);
  const submitted = team.decisions.production !== null;

  const forecastOf = (skuId: string) => team.decisions.forecast?.[skuId] ?? 0;
  const totalForecast = config.skus.reduce((s, sk) => s + forecastOf(sk.id), 0);
  const totalCapacity = config.lines.reduce((s, l) => s + l.capacityPerMonth, 0);
  const surplus = totalCapacity - totalForecast;

  return (
    <div className="card">
      <h2>Production plan — month {view!.month}</h2>
      <div className="callout" style={{
        background: 'var(--wash, rgba(42,120,214,0.08))', border: '1px solid var(--grid)',
        borderRadius: 10, padding: '10px 14px', marginBottom: 12,
      }}>
        <b>📈 Demand forecast:</b> this month your Demand Planner expects{' '}
        {config.skus.map((s, i) => (
          <span key={s.id}>{i > 0 && ', '}<b>{fmtNum(forecastOf(s.id))} u</b> of {s.name}</span>
        ))}
        {' '}— <b>{fmtNum(totalForecast)} u in total</b>. Your lines can build up to{' '}
        <b>{fmtNum(totalCapacity)} u</b>.{' '}
        {totalForecast === 0
          ? 'No forecast was submitted — check with your Demand Planner before building.'
          : surplus >= 0
            ? `That's enough to cover the whole forecast — but anything you build beyond demand sits on the shelf, losing value every month (age loss), so only overbuild what you plan to sell.`
            : `That's ${fmtNum(-surplus)} u short of the forecast — you can't make everything, so prioritize your winners and let your CEO buy the rest from other teams.`}
      </div>
      <p className="sub">Allocate units to lines below. Each line shows its capacity and unit cost.</p>
      {config.lines.map((line) => {
        const used = usedOn(line.id);
        const over = used > line.capacityPerMonth;
        return (
          <div key={line.id} style={{ marginBottom: 14 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <b>{line.name}</b>
              <span className={`badge${over ? ' bad' : used > 0 ? ' on' : ''}`}>
                {fmtNum(used)} / {fmtNum(line.capacityPerMonth)} u · ${line.costPerUnit}/u
              </span>
            </div>
            <div style={{ height: 8, borderRadius: 4, background: 'var(--grid)', margin: '6px 0 8px' }}>
              <div style={{
                height: 8, borderRadius: 4,
                width: `${Math.min(100, (used / line.capacityPerMonth) * 100)}%`,
                background: over ? 'var(--status-critical)' : 'var(--series-1)',
              }} />
            </div>
            <div className="row">
              {config.skus.filter((s) => s.allowedLineIds.includes(line.id)).map((s) => (
                <label className="field" key={s.id}>
                  {s.name}
                  <NumInput
                    value={alloc[`${line.id}|${s.id}`] ?? 0}
                    softCap={line.capacityPerMonth}
                    onChange={(v) => setAlloc({ ...alloc, [`${line.id}|${s.id}`]: v })}
                  />
                </label>
              ))}
            </div>
          </div>
        );
      })}
      <div className="row">
        <ConfirmButton disabled={busy} onConfirm={() => act({ type: 'SUBMIT_PRODUCTION', allocations })}>
          {submitted ? 'Update plan' : 'Submit plan'} — cost {fmtMoney(totalCost)}
        </ConfirmButton>
        {submitted && <span className="badge good">✓ Submitted</span>}
        <span className="badge">Budget {fmtMoney(team.budget)}</span>
      </div>
    </div>
  );
}

// ----------------------------------------------------------- transport

function TransportPanel() {
  const { view, act, busy } = useGame();
  const team = view!.myTeam!;
  const config = view!.config;
  const produced: Record<string, number> = {};
  for (const a of team.decisions.production ?? []) {
    produced[a.skuId] = (produced[a.skuId] ?? 0) + a.qty;
  }
  // per-SKU split: how many produced units go truckload vs interplant
  const [split, setSplit] = useState<Record<string, TransportSplit>>(() => {
    const init: Record<string, TransportSplit> = {};
    for (const s of config.skus) {
      const qty = produced[s.id] ?? 0;
      init[s.id] = team.decisions.transport?.[s.id] ?? { truckload: qty, interplant: 0 };
    }
    return init;
  });
  const submitted = team.decisions.transport !== null;

  const setMode = (skuId: string, mode: 'truckload' | 'interplant', value: number) => {
    const qty = produced[skuId] ?? 0;
    const v = Math.max(0, Math.min(qty, Math.round(value || 0)));
    const other = qty - v; // the rest goes to the other mode automatically
    setSplit({
      ...split,
      [skuId]: mode === 'truckload'
        ? { truckload: v, interplant: other }
        : { truckload: other, interplant: v },
    });
  };

  const cost = config.skus.reduce((sum, sku) => {
    const s = split[sku.id] ?? { truckload: 0, interplant: 0 };
    return sum + s.truckload * config.transport.truckload.costPerUnit
      + s.interplant * config.transport.interplant.costPerUnit;
  }, 0);

  const allBalanced = config.skus.every((sku) => {
    const s = split[sku.id] ?? { truckload: 0, interplant: 0 };
    return s.truckload + s.interplant === (produced[sku.id] ?? 0);
  });

  return (
    <div className="card">
      <h2>Transport plan — month {view!.month}</h2>
      <p className="sub">
        Split each SKU's production across two modes. <b>Truckload</b> (${config.transport.truckload.costPerUnit}/u,
        ~1 week) arrives <b>this month</b> so you can sell it now. <b>Interplant</b> (${config.transport.interplant.costPerUnit}/u,
        ~3 weeks) is cheaper but arrives <b>next month</b> — great for stock you'll sell later. Produce extra and
        split it: cover this month by truckload, pre-position the rest cheaply by interplant.
      </p>
      <table className="data">
        <thead>
          <tr>
            <th>SKU</th><th className="num">Produced</th>
            <th className="num">Truckload → M{view!.month}</th>
            <th className="num">Interplant → M{view!.month + 1}</th>
            <th className="num">Line cost</th>
          </tr>
        </thead>
        <tbody>
          {config.skus.map((s) => {
            const qty = produced[s.id] ?? 0;
            const cur = split[s.id] ?? { truckload: 0, interplant: 0 };
            const noneNow = qty > 0 && cur.truckload === 0 && unitsOf(team, s.id) === 0;
            return (
              <tr key={s.id}>
                <td>
                  {s.name}
                  {noneNow && <span className="badge bad" style={{ marginLeft: 6 }}>⚠ nothing on shelf this month</span>}
                </td>
                <td className="num">{fmtNum(qty)}</td>
                <td className="num">
                  <NumInput value={cur.truckload} softCap={qty} min={0}
                    onChange={(v) => setMode(s.id, 'truckload', v)} />
                </td>
                <td className="num">
                  <NumInput value={cur.interplant} softCap={qty} min={0}
                    onChange={(v) => setMode(s.id, 'interplant', v)} />
                </td>
                <td className="num">
                  {fmtMoney(cur.truckload * config.transport.truckload.costPerUnit
                    + cur.interplant * config.transport.interplant.costPerUnit)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="row" style={{ marginTop: 12 }}>
        <ConfirmButton disabled={busy || !allBalanced}
          onConfirm={() => act({ type: 'SUBMIT_TRANSPORT', split })}>
          {submitted ? 'Update transport' : 'Submit transport'} — cost {fmtMoney(cost)}
        </ConfirmButton>
        {!allBalanced && <span className="badge bad">Each SKU's two amounts must add up to its produced units</span>}
        {submitted && allBalanced && <span className="badge good">✓ Submitted</span>}
      </div>
    </div>
  );
}

// ------------------------------------------------------------- pricing

function PricingPanel() {
  const { view, act, busy } = useGame();
  const team = view!.myTeam!;
  const config = view!.config;
  const [prices, setPrices] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {};
    for (const s of config.skus) {
      init[s.id] = team.decisions.prices?.[s.id] ?? Math.round(floorFor(view!, team, s.id) * 1.3 * 100) / 100;
    }
    return init;
  });
  const submitted = team.decisions.prices !== null;

  return (
    <div className="card">
      <h2>Set selling prices — month {view!.month}</h2>
      <p className="sub">
        The floor is your landed cost (production + transport + a month of holding). All teams'
        prices go on the board next phase — but remember: demand is fixed, price is margin.
      </p>
      <table className="data">
        <thead>
          <tr>
            <th>SKU</th><th className="num">Cost floor</th><th className="num">On hand + producing</th>
            <th className="num">Your price</th><th className="num">Margin/u</th>
          </tr>
        </thead>
        <tbody>
          {config.skus.map((s) => {
            const floor = floorFor(view!, team, s.id);
            const produced = (team.decisions.production ?? [])
              .filter((a) => a.skuId === s.id).reduce((x, a) => x + a.qty, 0);
            const margin = (prices[s.id] ?? 0) - floor;
            return (
              <tr key={s.id}>
                <td>{s.name}</td>
                <td className="num">{fmtMoney(floor)}</td>
                <td className="num">{fmtNum(unitsOf(team, s.id) + produced)}</td>
                <td className="num">
                  <NumInput value={prices[s.id]} step={0.5}
                    softCap={referenceCost(config, s.id) * 5}
                    onChange={(v) => setPrices({ ...prices, [s.id]: v })} />
                </td>
                <td className="num" style={{ color: margin < 0 ? 'var(--delta-bad)' : 'var(--delta-good)' }}>
                  {fmtMoney(margin)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="row" style={{ marginTop: 12 }}>
        <ConfirmButton disabled={busy} onConfirm={() => act({ type: 'SUBMIT_PRICES', prices })}>
          {submitted ? 'Update prices' : 'Submit prices'}
        </ConfirmButton>
        {submitted && <span className="badge good">✓ Submitted</span>}
      </div>
    </div>
  );
}

// ------------------------------------------------------------- trading

function TradingPanel() {
  const { view, me, act, busy } = useGame();
  const team = view!.myTeam!;
  const config = view!.config;
  const ceoClaimed = view!.players.some(
    (p) => p.teamId === team.id && p.roles.includes('CEO' as Role));
  const isCEO = me!.roles.includes('CEO' as Role) || !ceoClaimed;
  const otherTeams = view!.teamsProgress.filter((t) => t.id !== team.id);
  const [sellerId, setSellerId] = useState(otherTeams[0]?.id ?? '');
  const [skuId, setSkuId] = useState(config.skus[0].id);
  const [qty, setQty] = useState(50);
  const [price, setPrice] = useState(referenceCost(config, config.skus[0].id));
  const [note, setNote] = useState('');

  const myOffers = view!.offers.filter((o) => o.month === view!.month);
  const cap = Math.round(referenceCost(config, skuId) * config.maxTradePriceMultiplier * 100) / 100;

  return (
    <div className="card">
      <h2>Price reveal & trading — month {view!.month}</h2>
      <p className="sub">
        Prices are on the board. This is the make-vs-buy window: your CEO can buy stock other teams
        hold right now (arrives instantly by truckload). Sellers can only sell what's physically on hand.
      </p>

      {isCEO ? (
        <div className="stack" style={{ marginBottom: 14 }}>
          <div className="row">
            <label className="field">Buy from
              <select value={sellerId} onChange={(e) => setSellerId(e.target.value)}>
                {otherTeams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </label>
            <label className="field">SKU
              <select value={skuId} onChange={(e) => {
                setSkuId(e.target.value);
                setPrice(referenceCost(config, e.target.value));
              }}>
                {config.skus.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <label className="field">Quantity
              <NumInput value={qty} onChange={setQty} />
            </label>
            <label className="field">$/unit (cap {fmtMoney(cap)})
              <NumInput value={price} step={0.5} softCap={cap} onChange={setPrice} />
            </label>
          </div>
          <div className="row">
            <input style={{ flex: 1 }} placeholder="Note to the other CEO (optional)"
              value={note} maxLength={140} onChange={(e) => setNote(e.target.value)} />
            <ConfirmButton disabled={busy || !sellerId || qty <= 0}
              onConfirm={() => act({ type: 'PROPOSE_TRADE', sellerTeamId: sellerId, skuId, qty, unitPrice: price, note })}>
              Propose — {fmtMoney(qty * price)}
            </ConfirmButton>
          </div>
        </div>
      ) : (
        <p className="sub"><b>Your CEO drives this phase.</b> Advise them — you can see every offer below.</p>
      )}

      {myOffers.length === 0 ? (
        <p className="sub">No offers involving your team yet this month.</p>
      ) : (
        <table className="data">
          <thead>
            <tr><th>Offer</th><th className="num">Qty</th><th className="num">$/u</th>
              <th className="num">Total</th><th>Status</th><th /></tr>
          </thead>
          <tbody>
            {myOffers.map((o) => {
              const buying = o.buyerTeamId === team.id;
              const other = view!.teamsProgress.find(
                (t) => t.id === (buying ? o.sellerTeamId : o.buyerTeamId))?.name ?? '?';
              const skuName = config.skus.find((s) => s.id === o.skuId)?.name ?? o.skuId;
              return (
                <tr key={o.id}>
                  <td>
                    {buying ? `Buy ${skuName} from ${other}` : `${other} wants your ${skuName}`}
                    {o.note && <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>"{o.note}"</div>}
                  </td>
                  <td className="num">{fmtNum(o.qty)}</td>
                  <td className="num">{fmtMoney(o.unitPrice)}</td>
                  <td className="num">{fmtMoney(o.qty * o.unitPrice)}</td>
                  <td>
                    <span className={`badge${o.status === 'accepted' ? ' good' : o.status === 'pending' ? ' on' : ''}`}>
                      {o.status}
                    </span>
                  </td>
                  <td>
                    {isCEO && o.status === 'pending' && !buying && (
                      <span className="row">
                        <button className="small primary" disabled={busy}
                          onClick={() => act({ type: 'RESPOND_TRADE', offerId: o.id, accept: true })}>
                          Accept
                        </button>
                        <button className="small" disabled={busy}
                          onClick={() => act({ type: 'RESPOND_TRADE', offerId: o.id, accept: false })}>
                          Decline
                        </button>
                      </span>
                    )}
                    {isCEO && o.status === 'pending' && buying && (
                      <button className="small danger" disabled={busy}
                        onClick={() => act({ type: 'CANCEL_TRADE', offerId: o.id })}>
                        Cancel
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ------------------------------------------------------------- results

function MonthResultsPanel() {
  const { view } = useGame();
  const team = view!.myTeam!;
  const r = team.results.at(-1);
  if (!r) return null;
  return (
    <div className="card">
      <h2>Month {r.month} results — profit {fmtMoney(r.profit)}</h2>
      <div className="grid2">
        <div>
          <table className="data">
            <thead>
              <tr><th>SKU</th><th className="num">Forecast</th><th className="num">Ordered</th>
                <th className="num">Sold</th><th className="num">@ price</th></tr>
            </thead>
            <tbody>
              {view!.config.skus.map((s) => {
                const o = r.bySku[s.id];
                if (!o) return null;
                const missed = o.ordered - o.fulfilled;
                return (
                  <tr key={s.id}>
                    <td>{s.name}</td>
                    <td className="num">{fmtNum(o.forecast)}</td>
                    <td className="num">{fmtNum(o.ordered)}</td>
                    <td className="num">
                      {fmtNum(o.fulfilled)}
                      {missed > 0 && <span className="badge bad" style={{ marginLeft: 6 }}>-{fmtNum(missed)} lost</span>}
                    </td>
                    <td className="num">{fmtMoney(o.price)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div>
          <BarBreakdown valueFmt={fmtMoney} items={[
            { label: 'Revenue', value: r.revenue },
            { label: 'Trade sales', value: r.tradeSells },
            { label: 'Production', value: -r.productionCost },
            { label: 'Transport', value: -r.transportCost },
            { label: 'Trade buys', value: -r.tradeBuys },
            { label: 'Holding', value: -r.holdingCost },
            { label: 'Age loss', value: -r.ageLossCost },
            ...(r.overdraftInterest ? [{ label: 'Overdraft interest', value: -r.overdraftInterest }] : []),
          ]} />
          {r.expiredUnits > 0 && (
            <p className="sub" style={{ marginTop: 8 }}>
              ⚠ {fmtNum(r.expiredUnits)} units expired past shelf life and were written off.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------- persistent cards

function InventoryCard() {
  const { view } = useGame();
  const team = view!.myTeam!;
  return (
    <div className="card">
      <h3>Warehouse & pipeline</h3>
      <table className="data">
        <thead><tr><th>SKU</th><th className="num">On hand</th><th>Ages</th><th className="num">In transit</th></tr></thead>
        <tbody>
          {view!.config.skus.map((s) => {
            const batches = team.inventory[s.id] ?? [];
            const transit = team.pipeline.filter((p) => p.skuId === s.id)
              .reduce((x, p) => x + p.qty, 0);
            return (
              <tr key={s.id}>
                <td>{s.name}</td>
                <td className="num">{fmtNum(batches.reduce((x, b) => x + b.qty, 0))}</td>
                <td style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                  {batches.length
                    ? batches.map((b) => `${fmtNum(b.qty)}u @ ${b.age}mo`).join(', ')
                    : '—'}
                  {batches.some((b) => b.age >= s.shelfLifeMonths - 1) && (
                    <span className="badge bad" style={{ marginLeft: 6 }}>near expiry</span>
                  )}
                </td>
                <td className="num">{transit ? `${fmtNum(transit)} u` : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ForecastChartCard() {
  const { view } = useGame();
  const team = view!.myTeam!;
  const months = team.results.map((r) => `M${r.month}`);
  if (months.length === 0) {
    return (
      <div className="card">
        <h3>Forecast vs actual</h3>
        <p className="sub">Appears after your first month resolves.</p>
      </div>
    );
  }
  const sum = (r: (typeof team.results)[number], key: 'forecast' | 'ordered') =>
    Object.values(r.bySku).reduce((s, o) => s + o[key], 0);
  return (
    <div className="card">
      <h3>Forecast vs actual (total units)</h3>
      <LineChart
        labels={months}
        series={[
          { name: 'Actual', color: 'var(--series-1)', values: team.results.map((r) => sum(r, 'ordered')) },
          { name: 'Forecast', color: 'var(--series-2)', dashed: true, values: team.results.map((r) => sum(r, 'forecast')) },
        ]}
      />
    </div>
  );
}

function ProfitChartCard() {
  const { view } = useGame();
  const team = view!.myTeam!;
  if (team.results.length === 0) {
    return (
      <div className="card">
        <h3>Monthly profit</h3>
        <p className="sub">Appears after your first month resolves.</p>
      </div>
    );
  }
  return (
    <div className="card">
      <h3>Monthly profit</h3>
      <LineChart
        labels={team.results.map((r) => `M${r.month}`)}
        valueFmt={fmtMoney}
        series={[{ name: 'Profit', color: 'var(--series-1)', values: team.results.map((r) => r.profit) }]}
      />
    </div>
  );
}

export function PriceBoardCard() {
  const { view, me } = useGame();
  if (!view?.priceBoard) return null;
  return (
    <div className="card">
      <h3>Price board — month {view.month}</h3>
      <p className="sub">
        Sorted cheapest average first. The customer sees this board when splitting market demand
        across teams — sharper prices can win more volume.
      </p>
      <table className="data">
        <thead>
          <tr>
            <th className="leader-rank">#</th><th>Team</th>
            {view.config.skus.map((s) => <th className="num" key={s.id}>{s.name}</th>)}
          </tr>
        </thead>
        <tbody>
          {view.priceBoard.map((row, i) => (
            <tr key={row.teamId} className={me?.teamId === row.teamId ? 'highlight' : ''}>
              <td className="leader-rank">{i + 1}</td>
              <td>{row.teamName}{me?.teamId === row.teamId ? ' (you)' : ''}</td>
              {view.config.skus.map((s) => (
                <td className="num" key={s.id}>
                  {row.prices[s.id] != null ? fmtMoney(row.prices[s.id]) : '—'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
