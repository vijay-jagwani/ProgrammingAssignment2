import { useState } from 'react';
import { ROLES, ROLE_LABELS, Role } from '@scg/shared';
import { useGame } from '../state';
import { fmtMoney, fmtNum } from '../components/ui';

export function Lobby() {
  const { view, me, act, busy, warn } = useGame();
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
                        if (busy) return;
                        if (!iAmHere) {
                          // Explain instead of silently ignoring the click
                          if (!me.isAdmin) warn(`Join ${t.name} first (click "Join team"), then pick your role.`);
                          return;
                        }
                        if (mine) act({ type: 'RELEASE_ROLE', role: r });
                        else if (free) act({ type: 'CLAIM_ROLE', role: r });
                      }}
                      title={owner ? `Taken by ${owner}` : iAmHere ? 'Click to claim' : 'Join this team first'}
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
            Roles don't block the start: any teammate can act for a role nobody claimed, and a
            role that never submits gets a safe default.
          </p>
          <div className="row" style={{ marginBottom: 10 }}>
            {view.players.filter((p) => !p.isAdmin && !p.teamId).map((p) => (
              <button key={p.id} className="small" disabled={busy}
                onClick={() => act({ type: 'SET_ADMIN', targetPlayerId: p.id, isAdmin: true })}>
                Make {p.name} an admin
              </button>
            ))}
          </div>
          <div className="row" style={{ marginBottom: 10 }}>
            {view.players.filter((p) => !p.isAdmin).map((p) => (
              <button key={p.id} className="small danger" disabled={busy}
                title="Remove this player (e.g. a duplicate joined from a shared device)"
                onClick={() => act({ type: 'KICK_PLAYER', targetPlayerId: p.id })}>
                Kick {p.name}
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
        <p className="sub" style={{ marginBottom: 8 }}>
          Total market demand = baseline × number of teams — with{' '}
          <b>{view.teamsProgress.length || 'no'} team{view.teamsProgress.length === 1 ? '' : 's'}</b>{' '}
          joined, the market wants{' '}
          <b>{fmtNum((view.config.skus[0]?.historicalMonthlyDemand ?? 0) * Math.max(1, view.teamsProgress.length))} u
          /SKU/mo</b> (updates as teams form). The facilitator splits it across teams each month.
        </p>
        <table className="data">
          <thead>
            <tr>
              <th>SKU</th><th>Lines</th><th className="num">Baseline/mo per team</th>
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
