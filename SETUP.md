# Deploying the Supply Chain Game (Supabase + Netlify)

Three steps, ~15 minutes. You need your Supabase project and the Netlify site
connected to this GitHub repo.

## 1. Supabase — database

Open your project's **SQL Editor** and run the contents of
[`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql).

This creates three tables (`games`, `players`, `game_views`), row-level
security so each player can only read their own team's redacted view, and
enables Realtime on `game_views`.

## 2. Supabase — auth + edge function

1. **Enable anonymous sign-ins**: Dashboard → Authentication → Sign In / Up →
   toggle **Anonymous sign-ins** on. (Players join with just a name + game
   code; no accounts.)
2. **Deploy the edge function** (needs the [Supabase CLI](https://supabase.com/docs/guides/cli)
   and an access token):

   ```bash
   node scripts/sync-shared.mjs        # refresh the engine copy in the function
   supabase link --project-ref <your-project-ref>
   supabase functions deploy apply-action
   ```

   The function uses the built-in `SUPABASE_URL` / `SUPABASE_ANON_KEY` /
   `SUPABASE_SERVICE_ROLE_KEY` secrets — nothing extra to configure.

## 3. Netlify — frontend

1. Connect this repo to a Netlify site. `netlify.toml` already sets the build
   (`npm run build`, publish `client/dist`, SPA redirects).
2. Site settings → Environment variables, add:
   - `VITE_SUPABASE_URL` = `https://<your-project-ref>.supabase.co`
   - `VITE_SUPABASE_ANON_KEY` = your project's anon/public key
3. Trigger a deploy.

## Verify

Open the site in two browser windows: host a game in one, join with the code
in the other. If joining works and the lobby updates live in both windows,
everything is wired.

## Local development (no Supabase needed)

```bash
npm install
npm run dev        # local in-memory backend on :8787 + Vite on :5173
npm test           # engine unit tests
npm run e2e        # full multi-browser game via Playwright
```

The client automatically uses the local backend when `VITE_SUPABASE_URL` is
not set. To develop against your real Supabase project instead, copy
`client/.env.example` to `client/.env.local` and fill in the two values.
