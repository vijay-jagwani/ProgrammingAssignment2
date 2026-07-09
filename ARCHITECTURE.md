# Architecture — how the Supply Chain Game works

A plain-English explanation of how the app is built, written to be understood by
non-developers and to hold up to technical scrutiny. It reflects the actual code
in this repository (file paths are linked so a developer can follow along).

## One-paragraph version

The game is a **website** (hosted on **Netlify**) that talks to a **cloud
backend** (**Supabase**). No player's browser changes the game directly —
instead, every move is sent to a single **referee program** running in the
cloud, which checks the rules, updates the one official copy of the game, and
instantly pushes the new state to everyone's screen. That referee, the database,
the login, and the live updates are all provided by Supabase, so there is no
server for us to run or maintain.

## The mental model

Think of it as a **multiplayer board game played over the internet**:

| Part | In this project | What it is, plainly |
|---|---|---|
| The board & pieces | React website on **Netlify** (`client/`) | What each player sees and clicks. Display only — it holds no authority over the rules. |
| The official ledger | Supabase **Postgres** (`supabase/migrations/0001_init.sql`) | One true copy of every game. Tables: `games` (full state), `players` (who's in it), `game_views` (a per-team redacted copy). |
| The referee | Supabase **Edge Function** (`supabase/functions/apply-action/index.ts`) | The only thing allowed to change a game. Every move goes through it. |
| The announcer | Supabase **Realtime** | The moment the ledger changes, the new state is pushed to every connected browser — screens update live. |
| The door wristband | Supabase **Anonymous Auth** | Players join with just a name + game code (no sign-up). Each gets a stable anonymous ID so they can reconnect. |

## How one move flows

Example: the Demand Planner submits a forecast.

1. The browser does **not** change anything itself. It sends "I want to submit
   this forecast" to the referee (`apply-action`).
2. The referee **verifies who they are** (the auth token), loads the **one
   official game state** from the database, and runs the move through the shared
   **game engine** (`shared/src/engine.ts`).
3. If the move is legal, it **saves the new state** with an optimistic
   concurrency check (a `rev` version number, so two simultaneous moves can't
   clobber each other) and **recomputes a redacted view for each audience**
   (`shared/src/view.ts` → `viewFor`).
4. The announcer (Realtime) pushes each team **its own** view; every screen
   updates.

Two consequences worth highlighting:

- **Players can't cheat.** The rules run on the server, not in the browser. Even
  with dev tools open, a player can't fake a move or edit their budget — the
  referee rejects anything illegal.
- **Players can't peek.** Thanks to **row-level security** plus the per-team
  views, a browser is only ever sent its own team's data. Rivals' forecasts and
  prices are not present in the browser to snoop until the game reveals them.

## Why this tech stack

### Supabase (backend)

The game needs **real-time multiplayer** and a **trustworthy referee**. Doing
that the traditional way means writing and running an always-on server —
provisioning, securing, scaling, and paying for it even when idle. Supabase
provides four things in one product, so there is **no server to run**:

- **Database** — standard **Postgres**, so the data is normal SQL with no exotic
  lock-in.
- **Auth** — anonymous sign-in gives frictionless, Kahoot-style joining.
- **Realtime** — live push to every client, which is what makes the shared game
  board feel instant.
- **Edge Functions** — the serverless "referee" where the authoritative rules
  run.

It scales itself and has a generous free tier — plenty for testing.

### Netlify (frontend)

The website is **static files**, so it is served from a **global CDN** — fast
everywhere, effectively free, automatic HTTPS. It **auto-deploys from GitHub**
(push code → site updates). See [`netlify.toml`](netlify.toml).

### The neat trick underneath

The game's rules live in **one shared module** (`shared/src/`) that runs
**identically in three places**:

1. the cloud referee (real play),
2. an automated **test suite** (`shared/test/engine.test.ts`, 21 tests proving
   the economics), and
3. a **local dev backend** (`scripts/dev-local.ts`) so the app can be built and
   tested without touching the cloud.

One source of truth for the rules means fewer bugs and identical behaviour
everywhere. The engine is a **pure, deterministic reducer** — the same inputs
always produce the same game — using a seeded random-number generator, which is
also why every team faces the *same* customer demand (fair leaderboard).

## Honest trade-offs

- **MVP on free tiers.** Great for testing with a group; not yet hardened for
  hundreds of concurrent games or paying customers.
- **Facilitator-driven and synchronous.** A facilitator runs the phases live —
  perfect for workshops, not a self-serve app.
- **Vendor dependency.** We rely on Supabase + Netlify. Both use open standards
  (Postgres, static hosting), so migration is possible, but it is a dependency.

## Repository map

```
client/     React + Vite front-end (what players see) — deployed to Netlify
shared/     the game engine + types — the single source of truth for the rules
supabase/   database schema (migrations) + the apply-action referee function
scripts/    local dev backend, end-to-end test, engine→function sync
```

## Deploying it yourself

See [`SETUP.md`](SETUP.md) for the three wiring steps (run the database
migration, deploy the edge function, set the two Netlify environment variables)
and [`README.md`](README.md) for how to run it locally.
