import { useState } from 'react';
import { ROLES, ROLE_LABELS, Role } from '@scg/shared';
import { useGame } from '../state';
import { fmtMoney, fmtNum } from '../components/ui';
import { Icon, ROLE_ICON, initials } from '../components/icons';

export function Lobby() {
  const { view, me, act, busy, warn } = useGame();
  const [teamName, setTeamName] = useState('');
  if (!view || !me) return null;
  if (view.mode === 'solo') return <SoloLobby />;

  const teamless = view.players.filter((p) => !p.isAdmin && !p.teamId);
  const playerCount = view.players.filter((p) => !p.isAdmin).length;
  const membersOf = (teamId: string) => view.players.filter((p) => p.teamId === teamId);

  return (
    <div className="lobby">
      <section className="lobby-hero">
        <div>
          <span className="kicker">Lobby</span>
          <h2>Waiting for teams</h2>
          <p className="sub">
            Players join from any device with this code. Each team has five seats, one per role.
          </p>
        </div>
        <div className="code-block">
          <span className="kicker">Game code</span>
          <b className="code">{view.code}</b>
          <span className="code-meta">
            {view.config.months} months · {view.config.difficulty} · {playerCount} player{playerCount === 1 ? '' : 's'}
          </span>
        </div>
      </section>

      {teamless.length > 0 && (
        <section className="waiting-room">
          <span className="kicker">Waiting room</span>
          <div className="row" style={{ marginTop: 8 }}>
            {teamless.map((p) => (
              <span key={p.id} className="person">
                <span className="avatar">{initials(p.name)}</span>
                {p.name}{p.id === me.id ? ' (you)' : ''}
              </span>
            ))}
          </div>
        </section>
      )}

      <div className="lane-grid">
        {view.teamsProgress.map((t) => {
          const members = membersOf(t.id);
          const takenRoles = new Map<Role, string>();
          for (const m of members) for (const r of m.roles) takenRoles.set(r, m.name);
          const iAmHere = me.teamId === t.id;
          return (
            <section className={`card lane${iAmHere ? ' mine' : ''}`} key={t.id}>
              <div className="lane-head">
                <h3>{t.name}</h3>
                <span className="badge">{members.length}/5 players</span>
                {!me.isAdmin && !iAmHere && members.length < 5 && (
                  <button className="small" disabled={busy}
                    onClick={() => act({ type: 'JOIN_TEAM', teamId: t.id })}>
                    Join team
                  </button>
                )}
              </div>
              <div className="seats">
                {ROLES.map((r) => {
                  const owner = takenRoles.get(r);
                  const mine = iAmHere && me.roles.includes(r);
                  return (
                    <button
                      key={r}
                      type="button"
                      className={`seat rolechip${mine ? ' mine' : owner ? ' taken' : ''}`}
                      disabled={busy}
                      onClick={() => {
                        if (!iAmHere) {
                          // Explain instead of silently ignoring the click
                          if (!me.isAdmin) warn(`Join ${t.name} first (click "Join team"), then pick your role.`);
                          return;
                        }
                        if (mine) act({ type: 'RELEASE_ROLE', role: r });
                        else if (!owner) act({ type: 'CLAIM_ROLE', role: r });
                      }}
                      title={owner ? `Taken by ${owner}` : iAmHere ? 'Click to take this seat' : 'Join this team first'}
                    >
                      <span className="seat-icon"><Icon name={ROLE_ICON[r]} size={20} /></span>
                      <span className="seat-role">{ROLE_LABELS[r]}</span>
                      <span className="seat-who">{mine ? 'You' : owner ?? 'Open'}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      {!me.isAdmin && (
        <section className="card soft">
          <h3>Start a new team</h3>
          <div className="row">
            <input value={teamName} placeholder="Team name" maxLength={24}
              onChange={(e) => setTeamName(e.target.value)} />
            <button disabled={busy || !teamName.trim()}
              onClick={() => { act({ type: 'CREATE_TEAM', name: teamName }); setTeamName(''); }}>
              Create team
            </button>
          </div>
        </section>
      )}

      {me.isAdmin && (
        <section className="card">
          <div className="lane-head">
            <h3>Facilitator controls</h3>
            <button className="primary" disabled={busy || view.teamsProgress.length === 0}
              onClick={() => act({ type: 'START_GAME' })}>
              Start game ({view.teamsProgress.length} team{view.teamsProgress.length === 1 ? '' : 's'})
            </button>
          </div>
          <p className="sub">
            Promote co-admins (they act as customers with you — an admin can't be on a team).
            Roles don't block the start: any teammate can act for a role nobody claimed, and a
            role that never submits gets a safe default.
          </p>
          {view.players.filter((p) => !p.isAdmin).map((p) => {
            const team = view.teamsProgress.find((t) => t.id === p.teamId);
            return (
              <div key={p.id} className="person-row">
                <span className="avatar">{initials(p.name)}</span>
                <span className="person-name">
                  {p.name}
                  <span className="person-meta">{team ? team.name : 'waiting room'}</span>
                </span>
                {!p.teamId && (
                  <button className="small" disabled={busy}
                    onClick={() => act({ type: 'SET_ADMIN', targetPlayerId: p.id, isAdmin: true })}>
                    Make {p.name} an admin
                  </button>
                )}
                <button className="small danger" disabled={busy}
                  title="Remove this player (e.g. a duplicate joined from a shared device)"
                  onClick={() => act({ type: 'KICK_PLAYER', targetPlayerId: p.id })}>
                  Kick {p.name}
                </button>
              </div>
            );
          })}
        </section>
      )}

      <MarketSetupCard />
    </div>
  );
}

function SoloLobby() {
  const { view, me, act, busy } = useGame();
  if (!view || !me) return null;
  const myTeam = view.teamsProgress.find((t) => t.id === me.teamId);
  const rivals = view.teamsProgress.filter((t) => t.id !== me.teamId);
  const automated = ROLES.filter((r) => !me.roles.includes(r));

  return (
    <div className="lobby">
      <section className="lobby-hero">
        <div>
          <span className="kicker">Solo practice</span>
          <h2>Solo game — set up your roles</h2>
          <p className="sub">
            Only you can play this game. Take the seats you want; the game plays the rest.
          </p>
        </div>
        <div className="code-block">
          <span className="kicker">Game code</span>
          <b className="code">{view.code}</b>
          <span className="code-meta">
            {view.config.months} months · {view.config.skus.length} SKUs · {view.config.difficulty}
          </span>
        </div>
      </section>

      <div className="lane-grid">
        <section className="card lane mine">
          <div className="lane-head">
            <h3>{myTeam?.name ?? 'Your team'}</h3>
            <span className="badge on">you</span>
          </div>
          <div className="seats">
            {ROLES.map((r) => {
              const mine = me.roles.includes(r);
              return (
                <button
                  key={r}
                  type="button"
                  className={`seat rolechip${mine ? ' mine' : ' taken auto'}`}
                  disabled={busy}
                  title={mine ? 'Click to hand this seat to the game' : 'Click to play this seat'}
                  onClick={() => act(mine ? { type: 'RELEASE_ROLE', role: r } : { type: 'CLAIM_ROLE', role: r })}
                >
                  <span className="seat-icon"><Icon name={ROLE_ICON[r]} size={20} /></span>
                  <span className="seat-role">{ROLE_LABELS[r]}</span>
                  <span className="seat-who">{mine ? 'You' : 'Automated'}</span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="card lane">
          <div className="lane-head">
            <h3>Rival teams</h3>
            <span className="badge">{rivals.length} automated</span>
          </div>
          <p className="sub">Each rival is run by the game in every role and sells into the same market.</p>
          <div className="rival-list">
            {rivals.map((t) => (
              <div key={t.id} className="rival-row">
                <span>🤖 {t.name}</span>
                <span className="seat-strip" aria-hidden="true">
                  {ROLES.map((r) => <i key={r} />)}
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="card start-card">
        <div>
          <h3>Ready to start?</h3>
          <p className="sub">
            {automated.length
              ? `The game plays ${automated.map((r) => ROLE_LABELS[r]).join(', ')} for your team.`
              : 'You play every role for your team.'}
          </p>
          {me.roles.length === 0 && <p className="sub">Take at least one seat to play.</p>}
        </div>
        <button className="primary big" disabled={busy || me.roles.length === 0}
          onClick={() => act({ type: 'START_GAME' })}>
          Start solo game
        </button>
      </section>

      <MarketSetupCard />
    </div>
  );
}

function MarketSetupCard() {
  const { view } = useGame();
  if (!view) return null;
  const teamCount = Math.max(1, view.teamsProgress.length);
  return (
    <details className="card market">
      <summary>
        <span>Market setup</span>
        <span className="sub">{view.config.skus.length} products · {view.config.lines.length} lines</span>
      </summary>
      <p className="sub" style={{ margin: '12px 0 8px' }}>
        Total market demand = baseline × number of teams. With{' '}
        <b>{teamCount} team{teamCount === 1 ? '' : 's'}</b>, the market wants{' '}
        <b>{fmtNum((view.config.skus[0]?.historicalMonthlyDemand ?? 0) * teamCount)} u/SKU/mo</b>.
        The facilitator splits it across teams each month.
      </p>
      <div className="table-scroll">
        <table className="data">
          <thead>
            <tr>
              <th>Product</th><th>Lines</th><th className="num">Baseline/mo per team</th>
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
      </div>
      <p className="sub" style={{ marginTop: 10 }}>
        Lines:{' '}
        {view.config.lines.map((l) =>
          `${l.name} (${fmtNum(l.capacityPerMonth)} u/mo @ ${fmtMoney(l.costPerUnit)}/u)`).join(' · ')}
        {' '}· Truckload {fmtMoney(view.config.transport.truckload.costPerUnit)}/u, arrives same month ·
        Interplant {fmtMoney(view.config.transport.interplant.costPerUnit)}/u, arrives next month.
      </p>
    </details>
  );
}
