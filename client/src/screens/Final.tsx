import { useGame } from '../state';
import { fmtMoney, fmtNum, pct } from '../components/ui';
import { LineChart } from '../components/charts';

export function FinalScreen() {
  const { view, me } = useGame();
  if (!view?.profitBoard || !view.allTeams) return null;
  const winner = view.profitBoard[0];

  return (
    <div>
      <div className="card" style={{ textAlign: 'center' }}>
        <h2 style={{ fontSize: 24 }}>🏆 {winner?.teamName} wins with {fmtMoney(winner?.cumulativeProfit ?? 0)} profit</h2>
        <p className="sub">{view.config.months} months · {view.teamsProgress.length} teams · {view.config.difficulty} difficulty</p>
      </div>

      <div className="card">
        <h3>Final leaderboard</h3>
        <table className="data">
          <thead>
            <tr><th className="leader-rank">#</th><th>Team</th><th className="num">Cumulative profit</th>
              <th className="num">Final budget</th><th className="num">Avg fill rate</th></tr>
          </thead>
          <tbody>
            {view.profitBoard.map((row, i) => (
              <tr key={row.teamId} className={i === 0 ? 'winner' : me?.teamId === row.teamId ? 'highlight' : ''}>
                <td className="leader-rank">{i + 1}</td>
                <td>{row.teamName}{me?.teamId === row.teamId ? ' (you)' : ''}</td>
                <td className="num">{fmtMoney(row.cumulativeProfit)}</td>
                <td className="num">{fmtMoney(row.budget)}</td>
                <td className="num">{pct(row.avgFillRate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>Cumulative profit by month</h3>
        <LineChart
          labels={Array.from({ length: view.config.months }, (_, i) => `M${i + 1}`)}
          valueFmt={fmtMoney}
          series={view.allTeams.slice(0, 6).map((t, i) => {
            let acc = 0;
            const values = Array.from({ length: view.config.months }, (_, m) => {
              const r = t.results.find((x) => x.month === m + 1);
              if (!r) return null;
              acc += r.profit;
              return acc;
            });
            return { name: t.name, color: `var(--series-${i + 1})`, values };
          })}
        />
      </div>

      <div className="grid2">
        {view.allTeams.map((t) => <TeamDebrief key={t.id} teamId={t.id} />)}
      </div>
    </div>
  );
}

function TeamDebrief({ teamId }: { teamId: string }) {
  const { view } = useGame();
  const t = view!.allTeams!.find((x) => x.id === teamId)!;
  const skus = view!.config.skus;

  const totals = t.results.reduce(
    (acc, r) => ({
      revenue: acc.revenue + r.revenue,
      production: acc.production + r.productionCost,
      transport: acc.transport + r.transportCost,
      holding: acc.holding + r.holdingCost + r.ageLossCost,
      tradeBuys: acc.tradeBuys + r.tradeBuys,
      tradeSells: acc.tradeSells + r.tradeSells,
      expired: acc.expired + r.expiredUnits,
      interest: acc.interest + r.overdraftInterest,
      lost: acc.lost + Object.values(r.bySku).reduce((s, o) => s + (o.ordered - o.fulfilled), 0),
    }),
    { revenue: 0, production: 0, transport: 0, holding: 0, tradeBuys: 0, tradeSells: 0, expired: 0, interest: 0, lost: 0 },
  );

  // biggest forecast miss
  let missSku = ''; let missAmt = 0;
  for (const r of t.results) {
    for (const s of skus) {
      const o = r.bySku[s.id];
      if (!o) continue;
      const miss = Math.abs(o.forecast - o.ordered);
      if (miss > missAmt) { missAmt = miss; missSku = `${s.name} (M${r.month})`; }
    }
  }

  const learnings: string[] = [];
  if (totals.lost > 0) learnings.push(`Lost ${fmtNum(totals.lost)} units of demand to stockouts — that revenue never comes back.`);
  if (totals.expired > 0) learnings.push(`Wrote off ${fmtNum(totals.expired)} expired units — overproduction has a shelf life.`);
  if (missAmt > 0) learnings.push(`Biggest forecast miss: ${missSku}, off by ${fmtNum(missAmt)} units.`);
  if (totals.tradeBuys + totals.tradeSells > 0) {
    learnings.push(`Traded ${fmtMoney(totals.tradeBuys + totals.tradeSells)} with other teams — make-vs-buy in action.`);
  } else {
    learnings.push('Never traded — was self-sufficiency worth the capacity strain?');
  }
  if (totals.interest > 0) learnings.push(`Paid ${fmtMoney(totals.interest)} in overdraft interest.`);

  return (
    <div className="card">
      <h3>{t.name} — {fmtMoney(t.cumulativeProfit)}</h3>
      <table className="data" style={{ fontSize: 13 }}>
        <tbody>
          <tr><td>Revenue</td><td className="num">{fmtMoney(totals.revenue)}</td></tr>
          <tr><td>Production + transport</td><td className="num">-{fmtMoney(totals.production + totals.transport)}</td></tr>
          <tr><td>Holding + age loss</td><td className="num">-{fmtMoney(totals.holding)}</td></tr>
          <tr><td>Trades (bought / sold)</td>
            <td className="num">{fmtMoney(totals.tradeBuys)} / {fmtMoney(totals.tradeSells)}</td></tr>
        </tbody>
      </table>
      <ul style={{ fontSize: 13, color: 'var(--ink-2)', paddingLeft: 18, marginBottom: 0 }}>
        {learnings.map((l, i) => <li key={i}>{l}</li>)}
      </ul>
    </div>
  );
}
