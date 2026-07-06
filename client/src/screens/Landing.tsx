import { useState } from 'react';
import { useGame } from '../state';

export function Landing() {
  const { create, join, busy } = useGame();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [months, setMonths] = useState(10);
  const [numSkus, setNumSkus] = useState(5);
  const [difficulty, setDifficulty] = useState<'easy' | 'medium' | 'hard'>('medium');
  const [numCustomers, setNumCustomers] = useState(3);
  const [budget, setBudget] = useState(100000);

  return (
    <div>
      <div className="card" style={{ textAlign: 'center' }}>
        <h2 style={{ fontSize: 22 }}>Supply Chain Game</h2>
        <p className="sub">
          Teams of 5 — Demand Planner, Production Planner, Transport Manager, Customer Ops, CEO —
          run a finished-goods supply chain for a season. Forecast, produce, ship, price, trade… profit.
        </p>
      </div>
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
          <p className="sub">You become the facilitator (admin) — admins run the market, not a team.</p>
          <div className="stack">
            <label className="field">
              Your name
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Vijay" maxLength={24} />
            </label>
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
                  <option value="easy">Easy — calm demand, roomy capacity</option>
                  <option value="medium">Medium — tight capacity, must trade</option>
                  <option value="hard">Hard — volatile demand, scarce capacity</option>
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
              disabled={busy || !name.trim()}
              onClick={() =>
                create(name, { months, numSkus, difficulty, numCustomers, startingBudget: budget })
              }
            >
              Create game
            </button>
          </div>
        </div>
      </div>
      <p className="footer-note">
        Tip: capacity is deliberately scarce — no team can make every SKU. Specialize, then let your
        CEOs trade for the rest.
      </p>
    </div>
  );
}
