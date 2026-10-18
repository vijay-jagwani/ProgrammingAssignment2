import type { CSSProperties } from 'react';
import {
  PHASE_LABELS, PHASE_ORDER, PHASE_ROLE, Phase, ROLES, ROLE_LABELS, TeamProgress,
} from '@scg/shared';
import { useGame } from '../state';
import { Icon, PHASE_ICON } from './icons';

type SubmitKey = keyof TeamProgress['submitted'];

const SUBMIT_KEY: Partial<Record<Phase, SubmitKey>> = {
  FORECAST: 'forecast',
  PRODUCTION: 'production',
  TRANSPORT: 'transport',
  PRICING: 'prices',
  TRADING: 'trading',
};

const WHAT: Partial<Record<Phase, string>> = {
  FORECAST: 'Demand planners estimate what customers will order next month.',
  PRODUCTION: 'Production planners schedule each line, within capacity.',
  TRANSPORT: 'Transport managers split output between fast trucks and slow, cheap interplant.',
  PRICING: 'Customer ops set selling prices, never below landed cost.',
  TRADING: 'CEOs buy and sell stock with rival teams.',
  ORDERS: 'Customers place this month\'s orders.',
  RESULTS: 'Sales, lost demand and cash for the month are in.',
};

/** The whole game at a glance: where we are in the month, and who the game is waiting on. */
export function GameMap() {
  const { view, me } = useGame();
  if (!view || !me || view.phase === 'LOBBY' || view.phase === 'GAME_OVER') return null;

  const solo = view.mode === 'solo';
  const stations = PHASE_ORDER.filter((p) => !solo || (p !== 'TRADING' && p !== 'ORDERS'));
  const curIdx = PHASE_ORDER.indexOf(view.phase);
  const doneCount = stations.filter((p) => PHASE_ORDER.indexOf(p) < curIdx).length;
  const fraction = stations.length > 1 ? Math.min(1, doneCount / (stations.length - 1)) : 0;

  const owner = PHASE_ROLE[view.phase];
  const key = SUBMIT_KEY[view.phase];
  const waiting = key ? view.teamsProgress.filter((t) => !t.submitted[key]) : [];
  const ownerOf = (teamId: string) =>
    owner ? view.players.find((p) => p.teamId === teamId && p.roles.includes(owner))?.name : undefined;

  let status: string;
  if (view.phase === 'ORDERS') {
    status = 'The market is placing orders. The facilitator is locking the split.';
  } else if (view.phase === 'RESULTS') {
    if (view.month >= view.config.months) status = 'The final month is done.';
    else status = solo ? 'Month done. Start the next one when you are ready.' : 'Results are in. The facilitator starts the next month.';
  } else if (key && waiting.length > 0) {
    const names = waiting.map((t) => {
      if (solo && t.id === me.teamId) return 'you';
      const who = owner ? ownerOf(t.id) ?? 'any teammate' : null;
      return who ? `${t.name} (${who})` : t.name;
    });
    status = `Waiting on ${names.join(', ')}.`;
  } else {
    status = solo ? 'Your decisions are in. Advance when you are ready.' : 'Everyone has submitted. The facilitator can move on.';
  }

  return (
    <section className="gm" aria-label="Game overview">
      <div className="gm-head">
        <div className="gm-month">
          <span className="kicker">Month</span>
          <div>
            <b>{view.month}</b>
            <span className="gm-of">of {view.config.months}</span>
          </div>
          <div className="gm-months" aria-hidden="true">
            {Array.from({ length: view.config.months }, (_, i) => (
              <i key={i} className={i < view.month - 1 ? 'past' : i === view.month - 1 ? 'now' : ''} />
            ))}
          </div>
        </div>
        <div className="gm-now">
          <span className="kicker">Right now · {PHASE_LABELS[view.phase]}</span>
          <p>{WHAT[view.phase] ?? ''}</p>
          <p className="gm-status">{status}</p>
        </div>
      </div>

      <div className="gm-scroll">
        <ol
          className="gm-track"
          style={{ '--n': stations.length, '--f': fraction } as CSSProperties}
        >
          {stations.map((p) => {
            const i = PHASE_ORDER.indexOf(p);
            const state = i < curIdx ? 'done' : i === curIdx ? 'now' : 'todo';
            const roleOwner = PHASE_ROLE[p];
            const who = solo
              ? roleOwner ? (me.roles.includes(roleOwner) ? 'You' : 'The game') : 'Everyone'
              : roleOwner ? ROLE_LABELS[roleOwner] : 'Facilitator';
            return (
              <li key={p} className={`gm-st ${state}`}>
                <span className="gm-dot"><Icon name={PHASE_ICON[p]} size={20} /></span>
                <span className="gm-name">{PHASE_LABELS[p]}</span>
                <span className="gm-owner">{who}</span>
              </li>
            );
          })}
        </ol>
      </div>

      <ul className="gm-teams">
        {view.teamsProgress.map((t) => {
          const members = view.players.filter((p) => p.teamId === t.id);
          const isMine = t.id === me.teamId;
          const rival = solo && !isMine;
          const done = key ? t.submitted[key] : false;
          return (
            <li key={t.id} className={`gm-team${isMine ? ' mine' : ''}`}>
              <span className="gm-team-name">
                {rival ? '🤖 ' : ''}{t.name}{isMine ? ' (you)' : ''}
              </span>
              <span className="gm-roles" aria-label="Roles filled">
                {ROLES.map((r) => {
                  const holder = members.find((m) => m.roles.includes(r));
                  const cls = holder ? 'filled' : solo ? 'auto' : '';
                  const label = holder ? holder.name : solo ? 'played by the game' : 'open';
                  return <i key={r} className={cls} title={`${ROLE_LABELS[r]}: ${label}`} />;
                })}
              </span>
              {key && <span className={`gm-tick${done ? ' yes' : ''}`}>{done ? '✓' : '…'}</span>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
