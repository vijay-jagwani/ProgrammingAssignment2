# 📦 Supply Chain Game

A team-based, multiplayer supply chain simulation for workshops and
classrooms. Teams of five run a finished-goods business for a season —
forecasting demand, planning production on scarce lines, choosing transport
modes, pricing against a shared market, and trading stock with rival teams —
while facilitators play the customers.

Think *Fresh Connection*-style role play, self-hosted and free, with one
twist no commercial game has: a **live make-vs-buy market between teams**,
run by each team's CEO.

## The five roles

| Role | Decides |
|---|---|
| **Demand Planner** | Monthly forecast per SKU, guided by history and past actuals |
| **Production Planner** | Which lines make what — capacity depends on difficulty, from roomy (Easy) to scarce (Hard) |
| **Transport Manager** | Truckload (fast, expensive, sellable this month) vs interplant (slow, cheap, arrives next month) |
| **Customer Ops Manager** | Selling prices, floored at landed cost |
| **CEO** | The make-vs-buy call: buy SKUs from other teams on the trading desk, watch the budget |

A player may hold several roles, so short-handed teams still work.

## A month in the game

1. **Forecast** → 2. **Production** → 3. **Transport** → 4. **Pricing** →
5. **Price reveal + CEO trading** → 6. **Customer orders** (facilitators
confirm simulation-proposed orders — identical for every team) →
7. **Resolution** (sales, lost sales, aging, expiry, holding costs, overdraft
interest) → 8. **Results**.

After the final month: profit leaderboard and a per-team debrief with
auto-generated learnings (stockout losses, forecast misses, trade activity).

Design choices that keep it fair and instructive:

- **Shared demand**: every team faces the same realized orders — the
  leaderboard measures decisions, not luck.
- **Capacity scales with difficulty**: Easy has *more* capacity than demand
  (the overstock/age-loss lesson), Medium sits at 95–100% of demand, and
  Hard is scarce — specialization and trading emerge naturally.
- **Age loss = build cost spread over shelf life**: a unit that sits out its
  full shelf life loses its entire manufacturing cost, then expires.
- **Lost sales, shelf life, and overdraft**: stockouts hurt, stock ages out,
  and struggling teams keep playing (with interest pain) instead of dying.
- **Anti-collusion**: trade prices are capped and every trade is visible to
  facilitators.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173 — local in-memory backend, no setup
```

Open several browser tabs to play all seats — each tab is its own player
(identity is per tab, so one window can host the admin and a whole team).
State survives restarts (`data/local-games.json`).

```bash
npm test           # engine unit tests (deterministic economics)
npm run typecheck
npm run e2e        # Playwright: full 3-month game with 1 admin + 2 teams
```

## Deploy (Supabase + Netlify)

The production setup is serverless: React on Netlify, game state in Supabase
Postgres, all rules enforced by a single edge function, live sync via
Supabase Realtime, anonymous auth (name + game code, no accounts).

See **[SETUP.md](SETUP.md)** — three steps, ~15 minutes.

## Repo layout

```
shared/     pure deterministic game engine + types (the rules live here)
client/     React + Vite frontend (all screens)
supabase/   SQL migration + apply-action edge function
scripts/    local dev backend, e2e test, engine->function sync
```

The engine is a pure reducer `(state, action) → state` with a seeded RNG:
the same inputs always produce the same game, it runs identically in tests,
the local harness, and the Deno edge function, and clients only ever receive
a redacted per-team view — you can't peek at rivals in dev tools.

**New here?** [`ARCHITECTURE.md`](ARCHITECTURE.md) explains how the backend
works and why Supabase + Netlify, in plain English — good to share with
non-developers and technical reviewers alike.

## Facilitator quick guide

1. Host a game, share the 6-character code; promote co-facilitators (admins
   can't be on teams).
2. Players join, form teams, claim roles. Start the game.
3. Each phase: wait for the ✓ marks, then advance. Unsubmitted decisions get
   safe defaults.
4. In the Orders phase you are the market: confirm or tweak the proposed
   orders (month 1: everyone wants everything on shelf).
5. Advance through Results each month; after the last month the leaderboard
   and debrief appear. Budget ~10–15 minutes per month for discussion — the
   arguing is the point.
