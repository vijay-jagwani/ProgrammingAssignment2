import { useState } from 'react';
import { ROLES, ROLE_LABELS, Role } from '@scg/shared';
import { useGame } from '../state';
import { HowItWorks } from '../components/HowItWorks';

export function Landing() {
  const { create, join, busy } = useGame();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [months, setMonths] = useState(10);
  const [numSkus, setNumSkus] = useState(5);
  const [difficulty, setDifficulty] = useState<'easy' | 'medium' | 'hard'>('medium');
  const [numCustomers, setNumCustomers] = useState(3);
  const [budget, setBudget] = useState(100000);
  const [solo, setSolo] = useState(false);
  const [teamName, setTeamName] = useState('');
  const [roles, setRoles] = useState<Role[]>([...ROLES]);
  const [rivals, setRivals] = useState(2);
  const toggleRole = (r: Role) =>
    setRoles(roles.includes(r) ? roles.filter((x) => x !== r) : [...roles, r]);

  return (
    <div>
      <section className="hero">
        <span className="kicker">Supply chain simulation · no sign-up</span>
        <h2>Run a supply chain for a season. Learn from the mistakes that cost money.</h2>
        <p className="sub">
          Forecast, produce, ship, price and trade against other teams. Practise alone for free,
          or run a whole class with a join code.
        </p>
      </section>
      <div className="grid2">
        <div className="card">
          <h2>Join a game</h2>
          <p className="sub">Get the 6-character code from your facilitator.</p>
          <div className="stack">
            <label className="field">
              Your name
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Priya" maxLength={24} />
            </label>
            <label className="field">
              Game code
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="e.g. K7M2QX"
                maxLength={6}
                style={{ letterSpacing: 3, fontFamily: 'ui-monospace, monospace' }}
              />
            </label>
            <button
              className="primary"
              disabled={busy || !name.trim() || code.trim().length !== 6}
              onClick={() => join(code, name)}
            >
              Join game
            </button>
          </div>
        </div>
        <div className="card">
          <h2>Host a new game</h2>
          <div className="row" style={{ marginBottom: 10 }}>
            <button className={`small${solo ? '' : ' primary'}`} onClick={() => setSolo(false)}>Multiplayer</button>
            <button className={`small${solo ? ' primary' : ''}`} onClick={() => setSolo(true)}>Solo practice</button>
          </div>
          <p className="sub">
            {solo
              ? 'Play one team yourself: pick the roles you want, and the game plays the rest and runs rival teams.'
              : 'You become the facilitator (admin) — admins run the market, not a team.'}{' '}
            <a href="/facilitator-guide.html" target="_blank" rel="noopener noreferrer">
              Read the facilitator guide →
            </a>
          </p>
          <div className="stack">
            <label className="field">
              Your name
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Vijay" maxLength={24} />
            </label>
            {solo && (
              <>
                <label className="field">
                  Team name
                  <input value={teamName} onChange={(e) => setTeamName(e.target.value)}
                    placeholder="e.g. Sam Co" maxLength={24} />
                </label>
                <label className="field">
                  Roles you play (the game plays the rest)
                  <div className="row">
                    {ROLES.map((r) => (
                      <span key={r} className={`rolechip${roles.includes(r) ? ' mine' : ''}`}
                        onClick={() => toggleRole(r)}>
                        {ROLE_LABELS[r]}
                      </span>
                    ))}
                  </div>
                </label>
                <label className="field">
                  Rival teams, automated (1–5)
                  <input className="num" type="number" min={1} max={5} value={rivals}
                    onChange={(e) => setRivals(Number(e.target.value))} />
                </label>
              </>
            )}
            <div className="row">
              <label className="field">
                Months
                <input className="num" type="number" min={3} max={24} value={months}
                  onChange={(e) => setMonths(Number(e.target.value))} />
              </label>
              <label className="field">
                SKUs
                <input className="num" type="number" min={2} max={8} value={numSkus}
                  onChange={(e) => setNumSkus(Number(e.target.value))} />
              </label>
              <label className="field">
                Customers
                <input className="num" type="number" min={1} max={8} value={numCustomers}
                  onChange={(e) => setNumCustomers(Number(e.target.value))} />
              </label>
            </div>
            <div className="row">
              <label className="field">
                Difficulty
                <select value={difficulty} onChange={(e) => setDifficulty(e.target.value as any)}>
                  <option value="easy">Easy — spare capacity; overbuilding bleeds value</option>
                  <option value="medium">Medium — capacity ≈ demand; plan tight</option>
                  <option value="hard">Hard — scarce capacity, volatile demand; must trade</option>
                </select>
              </label>
              <label className="field">
                Team budget ($)
                <input className="num" type="number" min={10000} step={10000} value={budget}
                  onChange={(e) => setBudget(Number(e.target.value))} />
              </label>
            </div>
            <button
              className="primary"
              disabled={busy || !name.trim() || (solo && roles.length === 0)}
              onClick={() =>
                create(
                  name,
                  { months, numSkus, difficulty, numCustomers, startingBudget: budget },
                  solo ? { teamName, roles, rivals } : undefined,
                )
              }
            >
              {solo ? 'Start solo game' : 'Create game'}
            </button>
          </div>
        </div>
      </div>
      <p className="footer-note">
        Tip: capacity is deliberately scarce — no team can make every SKU. Specialize, then let your
        CEOs trade for the rest.
      </p>

      <HowItWorks />
    </div>
  );
}
