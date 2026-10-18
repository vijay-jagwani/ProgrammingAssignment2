import { useGame } from '../state';
import { fmtMoney } from './ui';

/** Every team's month side by side, ranked by cumulative profit. */
export function MonthSummary() {
  const { view, me } = useGame();
  if (!view?.monthSummary) return null;
  return (
    <section className="card month-summary" aria-label="Month standing">
      <span className="kicker">Month {view.month} standing</span>
      <h3>How every team did this month</h3>
      <div className="table-scroll">
        <table className="data">
          <thead>
            <tr>
              <th>Team</th>
              <th className="num">Revenue</th>
              <th className="num">Production + transport</th>
              <th className="num">Holding + age loss</th>
              <th className="num">Trades (bought / sold)</th>
              <th className="num">Profit this month</th>
              <th className="num">Cumulative</th>
            </tr>
          </thead>
          <tbody>
            {view.monthSummary.map((r) => (
              <tr key={r.teamId} className={me?.teamId === r.teamId ? 'highlight' : undefined}>
                <td>{r.bot ? '🤖 ' : ''}{r.teamName}{me?.teamId === r.teamId ? ' (you)' : ''}</td>
                <td className="num">{fmtMoney(r.revenue)}</td>
                <td className="num">{fmtMoney(r.productionTransport)}</td>
                <td className="num">{fmtMoney(r.holdingAgeLoss)}</td>
                <td className="num">{fmtMoney(r.tradeBuys)} / {fmtMoney(r.tradeSells)}</td>
                <td className="num" style={{ color: r.profit < 0 ? 'var(--delta-bad)' : undefined }}>{fmtMoney(r.profit)}</td>
                <td className="num" style={{ color: r.cumulativeProfit < 0 ? 'var(--delta-bad)' : undefined }}>{fmtMoney(r.cumulativeProfit)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
