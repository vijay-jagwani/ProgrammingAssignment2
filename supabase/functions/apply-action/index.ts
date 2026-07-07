// Supabase Edge Function: the single authoritative mutation path for games.
// Clients call this with { op: 'create' | 'join' | 'action', ... }.
// It loads state, runs the shared deterministic engine, saves with an
// optimistic rev check, and rewrites redacted per-audience views.
import { createClient, SupabaseClient } from 'npm:@supabase/supabase-js@2';
import {
  Action,
  EngineError,
  GameState,
  allAudiences,
  audienceFor,
  buildDefaultConfig,
  createGame,
  reduce,
  viewFor,
} from './engine/index.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function genCode(): string {
  let code = '';
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  for (const b of bytes) code += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return code;
}

async function syncDerived(admin: SupabaseClient, gameId: string, state: GameState) {
  const playerRows = state.players.map((p) => ({
    id: p.id,
    game_id: gameId,
    name: p.name,
    audience: audienceFor(state, p.id),
  }));
  if (playerRows.length) {
    await admin.from('players').upsert(playerRows);
    // drop rows for kicked players so they lose read access to team views
    await admin
      .from('players')
      .delete()
      .eq('game_id', gameId)
      .not('id', 'in', `(${playerRows.map((r) => r.id).join(',')})`);
  }
  const viewRows = allAudiences(state).map((aud) => ({
    game_id: gameId,
    audience: aud,
    view: viewFor(state, aud),
    rev: state.rev,
    updated_at: new Date().toISOString(),
  }));
  await admin.from('game_views').upsert(viewRows);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: 'Not signed in' }, 401);
    const playerId = user.id;

    // Newer projects: the injected legacy SUPABASE_SERVICE_ROLE_KEY may lack
    // admin rights, and custom secrets can't start with SUPABASE_. Prefer a
    // user-set SERVICE_ROLE_KEY secret (sb_secret_...), fall back to legacy.
    const serviceKey =
      Deno.env.get('SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(supabaseUrl, serviceKey);
    const body = await req.json();

    if (body.op === 'create') {
      const config = body.config ?? buildDefaultConfig({
        seed: crypto.randomUUID(),
        months: 10,
        numSkus: 5,
        difficulty: 'medium',
        numCustomers: 3,
        ...(body.setup ?? {}),
      });
      const code = genCode();
      let state = createGame(config, code);
      state = reduce(state, {
        type: 'JOIN',
        playerId,
        name: String(body.name ?? 'Admin'),
        asAdmin: true,
      });
      const { data: game, error } = await admin
        .from('games')
        .insert({ code, state, rev: state.rev })
        .select('id')
        .single();
      if (error) throw new Error(error.message);
      await syncDerived(admin, game.id, state);
      return json({ code, gameId: game.id, view: viewFor(state, 'admin') });
    }

    const code = String(body.code ?? '').toUpperCase().trim();
    for (let attempt = 0; attempt < 3; attempt++) {
      const { data: game } = await admin
        .from('games')
        .select('id, state, rev')
        .eq('code', code)
        .maybeSingle();
      if (!game) return json({ error: 'Game not found — check the code' }, 404);

      let state = game.state as GameState;
      let action: Action;
      if (body.op === 'join') {
        action = { type: 'JOIN', playerId, name: String(body.name ?? ''), asAdmin: false };
      } else if (body.op === 'action') {
        const a = body.action ?? {};
        if (a.type === 'JOIN') return json({ error: 'Use the join op' }, 400);
        // playerId always comes from the verified JWT, never from the client
        action = { ...a, playerId } as Action;
      } else {
        return json({ error: 'Unknown op' }, 400);
      }

      state = reduce(state, action);
      const { data: updated } = await admin
        .from('games')
        .update({ state, rev: state.rev, updated_at: new Date().toISOString() })
        .eq('id', game.id)
        .eq('rev', game.rev)
        .select('id');
      if (!updated?.length) continue; // concurrent write — reload and retry

      await syncDerived(admin, game.id, state);
      return json({
        code,
        gameId: game.id,
        view: viewFor(state, audienceFor(state, playerId)),
      });
    }
    return json({ error: 'Game is busy, please try again' }, 409);
  } catch (e) {
    if (e instanceof EngineError) return json({ error: e.message }, 400);
    console.error(e);
    return json({ error: 'Internal error' }, 500);
  }
});
