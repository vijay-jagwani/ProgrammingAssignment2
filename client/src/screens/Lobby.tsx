import { useState } from 'react';
import { ROLES, ROLE_LABELS, Role } from '@scg/shared';
import { useGame } from '../state';
import { fmtMoney, fmtNum } from '../components/ui';

export function Lobby() {
  const { view, me, act, busy } = useGame();
  const [teamName, setTeamName] = useState('');
  if (!view || !me) return null;

  const admins = view.players.filter((p) => p.isAdmin);
  const teamless = view.players.filter((p) => !p.isAdmin && !p.teamId);

  const membersOf = (teamId: string) => view.players.filter((p) => p.teamId === teamId);

  return (
    <div>
      <div className="card">
        <h2>Lobby — waiting for teams</h2>
        <p className="sub">
          Share code <b>{view.code}</b>. {view.config.months} months · {view.config.skus.length} SKUs ·{' '}
          {view.config.difficulty} difficulty · {fmtMoney(view.config.startingBudget)} per team.
        </p>
        <div className="row">
          {admins.map((a) => (
            <span key={a.id} className="badge on">🛠 {a.name}{a.id === me.id ? ' (you)' : ''} — admin</span>
          ))}
          {teamless.map((p) => (
            <span key={p.id} className="badge">{p.name}{p.id === me.id ? ' (you)' : ''}</span>
          ))}
        </div>
      </div>

      <div className="grid2">
        {view.teamsProgress.map((t) => {
          const members = membersOf(t.id);
          const takenRoles = new Map<Role, string>();
          for (const m of members) for (const r of m.roles) takenRoles.set(r, m.name);
          const iAmHere = me.teamId === t.id;
          return (
            <div className="card" key={t.id}>
              <h3>{t.name} <span className="badge">{members.length}/5</span></h3>
              <div className="row" style={{ marginBottom: 10 }}>
                {members.map((m) => (
                  <span key={m.id} className={`badge${m.id === me.id ? ' on' : ''}`}>{m.name}</span>
                ))}
                {!me.isAdmin && !iAmHere && members.length < 5 && (
                  <button className="small" disabled={busy}
                    onClick={() => act({ type: 'JOIN_TEAM', teamId: t.id })}>
                    Join team
                  </button>
                )}
              </div>
              <div className="row">
                {ROLES.map((r) => {
                  const owner = takenRoles.get(r);
                  const mine = iAmHere && me.roles.includes(r);
                  const free = !owner;
                  return (
                    <span
                      key={r}
                      className={`rolechip${mine ? ' mine' : owner ? ' taken' : ''}`}
                      onClick={() => {
                        if (!iAmHere || busy) return;
                        if (mine) act({ type: 'RELEASE_ROLE', role: r });
                        else if (free) act({ type: 'CLAIM_ROLE', role: r });
                      }}
                      title={owner ? `Taken by ${owner}` : iAmHere ? 'Click to claim' : ''}
                    >
                      {ROLE_LABELS[r]}{owner ? ` — ${owner}` : ''}
                    </span>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {!me.isAdmin && (
        <div className="card">
          <h3>Start a new team</h3>
          <div className="row">
            <input value={teamName} placeholder="Team name" maxLength={24}
              onChange={(e) => setTeamName(e.target.value)} />
            <button disabled={busy || !teamName.trim()}
              onClick={() => { act({ type: 'CREATE_TEAM', name: teamName }); setTeamName(''); }}>
              Create team
            </button>
          </div>
        </div>
      )}

      {me.isAdmin && (
        <div className="card">
          <h3>Facilitator controls</h3>
          <p className="sub">
            Promote co-admins (they act as customers with you — an admin can't be on a team).
            Start once every team has its key roles claimed; unclaimed roles fall back to safe defaults.
          </p>
          <div className="row" style={{ marginBottom: 10 }}>
            {view.players.filter((p) => !p.isAdmin && !p.teamId).map((p) => (
              <button key={p.id} className="small" disabled={busy}
                onClick={() => act({ type: 'SET_ADMIN', targetPlayerId: p.id, isAdmin: true })}>
                Make {p.name} an admin
              </button>
            ))}
          </div>
          <button className="primary" disabled={busy || view.teamsProgress.length === 0}
            onClick={() => act({ type: 'START_GAME' })}>
            Start game ({view.teamsProgress.length} team{view.teamsProgress.length === 1 ? '' : 's'})
          </button>
        </div>
      )}

      <div className="card">
        <h3>Market setup</h3>
        <table className="data">
          <thead>
            <tr>
              <th>SKU</th><th>Lines</th><th className="num">Baseline demand/mo</th>
              <th className="num">Shelf life</th><th className="num">Age loss $/u/mo</th>
            </tr>
          </thead>
          <tbody>
            {view.config.skus.map((s) => (
              <tr key={s.id}>
                <td>{s.name}</td>
                <td>{s.allowedLineIds.join(', ')}</td>
                <td className="num">{fmtNum(s.historicalMonthlyDemand)}</td>
                <td className="num">{s.shelfLifeMonths} mo</td>
                <td className="num">{s.ageLossCostPerUnitPerMonth}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="sub" style={{ marginTop: 8 }}>
          Lines:{' '}
          {view.config.lines.map((l) =>
            `${l.name} (${fmtNum(l.capacityPerMonth)} u/mo @ $${l.costPerUnit}/u)`).join(' · ')}
          {' '}· Truckload ${view.config.transport.truckload.costPerUnit}/u, arrives same month ·
          Interplant ${view.config.transport.interplant.costPerUnit}/u, arrives next month.
        </p>
      </div>
    </div>
  );
}
