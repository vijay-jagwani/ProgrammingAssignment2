import { PHASE_LABELS } from '@scg/shared';
import { useGame } from './state';
import { Landing } from './screens/Landing';
import { Lobby } from './screens/Lobby';
import { AdminConsole } from './screens/AdminConsole';
import { TeamDashboard } from './screens/TeamDashboard';
import { FinalScreen } from './screens/Final';

export default function App() {
  const { ready, fatal, view, me, error, clearError, leave, switchPlayer } = useGame();

  if (fatal) {
    return (
      <div className="shell">
        <div className="banner error" style={{ marginTop: 40 }}>
          <b>Can't start:</b> {fatal}
        </div>
      </div>
    );
  }
  if (!ready) return <div className="shell center-note">Loading…</div>;

  return (
    <div className="shell">
      <div className="topbar">
        <h1>📦 Supply Chain Game</h1>
        {view && <span className="gamecode">{view.code}</span>}
        {view && view.phase !== 'LOBBY' && (
          <span className="badge on">
            Month {view.month}/{view.config.months} · {PHASE_LABELS[view.phase]}
          </span>
        )}
        <span className="spacer" />
        {me && (
          <span className="badge">
            {me.name}{me.isAdmin ? ' · admin' : ''}
          </span>
        )}
        {view && (
          <>
            <button
              className="small"
              onClick={switchPlayer}
              title="Someone else on this device? Get a fresh identity and join as a new player"
            >
              Switch player
            </button>
            <button className="small" onClick={leave} title="Leave this game on this device (you can rejoin as the same player)">
              Leave
            </button>
          </>
        )}
      </div>

      {error && (
        <div className="banner error" onClick={clearError} style={{ cursor: 'pointer' }}>
          {error} <span style={{ opacity: 0.6 }}>(click to dismiss)</span>
        </div>
      )}

      {!view ? (
        <Landing />
      ) : view.phase === 'LOBBY' ? (
        <Lobby />
      ) : view.phase === 'GAME_OVER' ? (
        <FinalScreen />
      ) : me?.isAdmin ? (
        <AdminConsole />
      ) : me?.teamId ? (
        <TeamDashboard />
      ) : (
        <div className="center-note">
          The game has started. You're not on a team — spectate or ask the facilitator.
        </div>
      )}
    </div>
  );
}
