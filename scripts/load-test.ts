// Load test: plays a whole room of bot teams through the real backend, the same
// way browsers do, so you can try a big session without opening a tab per team.
// Every team submits at the same moment in each phase (the worst case), and the
// test reports response times, "Game is busy" errors and stale screens.
//
// Local (starts its own local server; nothing leaves this machine):
//   npx tsx scripts/load-test.ts --teams 25 --months 3
// Live Supabase backend (creates a real test game and anonymous users there):
//   SUPABASE_URL=https://<project>.supabase.co SUPABASE_ANON_KEY=<publishable key> \
//     npx tsx scripts/load-test.ts --backend supabase --teams 25 --months 3
import { spawn, type ChildProcess } from 'node:child_process';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  priceFloor,
  type GameState,
  type GameView,
  type ProductionAllocation,
  type Role,
} from '../shared/src/index.ts';

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const BACKEND = arg('backend', 'local');
const TEAMS = Number(arg('teams', '25'));
const MONTHS = Number(arg('months', '3'));
const DIFFICULTY = arg('difficulty', 'medium');
const LOCAL_PORT = Number(arg('port', '8790'));
const ROLES: Role[] = ['DEMAND_PLANNER', 'PRODUCTION_PLANNER', 'TRANSPORT_MANAGER', 'CUSTOMER_OPS', 'CEO'];

class BusyError extends Error {}

/** One player: its own identity, like one browser tab. */
interface Bot {
  name: string;
  call(body: Record<string, unknown>): Promise<any>;
  /** Read this player's stored view, as the browser does after a change. */
  fetchView(id: string): Promise<GameView | null>;
  view?: GameView;
}

// ------------------------------------------------------------ backends

async function localBot(name: string): Promise<Bot> {
  const pid = crypto.randomUUID();
  return {
    name,
    async call(body) {
      const res = await fetch(`http://localhost:${LOCAL_PORT}/api/local`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-player-id': pid },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.status === 409) throw new BusyError(data.error);
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      return data;
    },
    async fetchView(code) {
      const res = await fetch(`http://localhost:${LOCAL_PORT}/api/local/view?code=${code}&playerId=${pid}`);
      return res.ok ? (await res.json()).view : null;
    },
  };
}

async function supabaseBot(name: string): Promise<Bot> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Set SUPABASE_URL and SUPABASE_ANON_KEY for --backend supabase');
  const sb: SupabaseClient = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await sb.auth.signInAnonymously();
  if (error) {
    throw new Error(`Anonymous sign-in failed for ${name}: ${error.message}. ` +
      'If this is a rate limit, raise it in Supabase (Authentication, Rate Limits) or use fewer --teams.');
  }
  return {
    name,
    async call(body) {
      const { data, error: err } = await sb.functions.invoke('apply-action', { body });
      if (err) {
        const ctx = (err as any).context;
        const payload = ctx && typeof ctx.json === 'function' ? await ctx.json().catch(() => null) : null;
        if (ctx?.status === 409) throw new BusyError(payload?.error ?? 'busy');
        throw new Error(payload?.error ?? err.message);
      }
      if (data?.error) throw new Error(data.error);
      return data;
    },
    async fetchView(gameId) {
      const { data } = await sb.from('game_views').select('audience, view').eq('game_id', gameId);
      const row = data?.find((r) => r.audience !== 'public') ?? data?.[0];
      return row ? (row.view as GameView) : null;
    },
  };
}

// ------------------------------------------------------------- metrics

const latencies: number[] = [];
const errors = new Map<string, number>();
let busy = 0;
let busyGaveUp = 0;

/** Send one request; a "busy" answer is what a player would see, so count it, then retry like a player would. */
async function send(bot: Bot, body: Record<string, unknown>): Promise<any> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const t0 = performance.now();
    try {
      const data = await bot.call(body);
      latencies.push(performance.now() - t0);
      if (data.view) bot.view = data.view;
      return data;
    } catch (e) {
      latencies.push(performance.now() - t0);
      if (e instanceof BusyError) {
        busy++;
        await new Promise((r) => setTimeout(r, 300 + Math.random() * 700));
        continue;
      }
      const msg = (e as Error).message;
      errors.set(msg, (errors.get(msg) ?? 0) + 1);
      throw e;
    }
  }
  busyGaveUp++;
  throw new Error(`${bot.name}: still busy after 6 tries`);
}

const act = (bot: Bot, code: string, action: Record<string, unknown>) => send(bot, { op: 'action', code, action });
const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]) : 0;
};

// ------------------------------------------------------- team decisions

function production(view: GameView): ProductionAllocation[] {
  const { config } = view;
  const team = view.myTeam!;
  const capLeft = Object.fromEntries(config.lines.map((l) => [l.id, l.capacityPerMonth]));
  const need = Object.fromEntries(config.skus.map((s) => [s.id, team.decisions.forecast?.[s.id] ?? s.historicalMonthlyDemand]));
  const planned = new Map<string, number>();
  let budget = Math.max(0, team.budget) * 0.8;
  let moved = true;
  while (moved) {
    moved = false;
    for (const sku of config.skus) {
      if (need[sku.id] <= 0) continue;
      const line = config.lines
        .filter((l) => sku.allowedLineIds.includes(l.id))
        .sort((a, b) => capLeft[b.id] - capLeft[a.id])[0];
      const unit = line.costPerUnit + config.transport.truckload.costPerUnit;
      const qty = Math.min(20, need[sku.id], capLeft[line.id], Math.floor(budget / unit));
      if (qty <= 0) continue;
      planned.set(`${line.id}|${sku.id}`, (planned.get(`${line.id}|${sku.id}`) ?? 0) + qty);
      capLeft[line.id] -= qty;
      need[sku.id] -= qty;
      budget -= qty * unit;
      moved = true;
    }
  }
  return [...planned].map(([key, qty]) => {
    const [lineId, skuId] = key.split('|');
    return { lineId, skuId, qty };
  });
}

// ----------------------------------------------------------------- run

async function startLocalServer(): Promise<ChildProcess> {
  const server = spawn('npx', ['tsx', 'scripts/dev-local.ts'], {
    env: { ...process.env, PORT: String(LOCAL_PORT) },
    stdio: 'ignore',
    cwd: new URL('..', import.meta.url).pathname,
  });
  for (let i = 0; i < 100; i++) {
    try { await fetch(`http://localhost:${LOCAL_PORT}/api/local/view?code=NONE`); return server; } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('Local server did not start');
}

async function main() {
  const server = BACKEND === 'local' ? await startLocalServer() : null;
  const makeBot = BACKEND === 'supabase' ? supabaseBot : localBot;
  const started = performance.now();
  const seconds = () => Math.round((performance.now() - started) / 1000);
  try {
    console.log(`Load test: ${TEAMS} teams, ${MONTHS} months, ${DIFFICULTY}, backend ${BACKEND}`);
    const admin = await makeBot('Facilitator');
    const { code, gameId } = await send(admin, {
      op: 'create', name: 'Load test facilitator',
      setup: { months: MONTHS, numSkus: 5, difficulty: DIFFICULTY, numCustomers: 3 },
    });
    const viewId = BACKEND === 'supabase' ? gameId : code;
    console.log(`Game ${code} created`);

    // one player per team holding all five roles; sign-ins one at a time, joins all at once
    const bots: Bot[] = [];
    for (let i = 0; i < TEAMS; i++) bots.push(await makeBot(`Player ${i + 1}`));
    await Promise.all(bots.map(async (bot, i) => {
      await send(bot, { op: 'join', code, name: bot.name });
      await act(bot, code, { type: 'CREATE_TEAM', name: `Load ${String(i + 1).padStart(2, '0')}` });
      for (const role of ROLES) await act(bot, code, { type: 'CLAIM_ROLE', role });
    }));
    console.log(`${TEAMS} teams joined and claimed roles (${seconds()} s)`);

    const advance = () => act(admin, code, { type: 'ADVANCE_PHASE' });
    const all = (fn: (bot: Bot, i: number) => Promise<unknown>) => Promise.all(bots.map(fn));
    await act(admin, code, { type: 'START_GAME' });
    for (let m = 1; m <= MONTHS; m++) {
      // every team reloads its screen, then all submit at the same moment
      await all(async (bot) => { bot.view = (await bot.fetchView(viewId)) ?? bot.view; });
      await all((bot) => act(bot, code, {
        type: 'SUBMIT_FORECAST',
        forecast: Object.fromEntries(bot.view!.config.skus.map((s) => [s.id, s.historicalMonthlyDemand])),
      }));
      await advance();
      await all((bot) => act(bot, code, { type: 'SUBMIT_PRODUCTION', allocations: production(bot.view!) }));
      await advance();
      await all((bot) => {
        const made: Record<string, number> = {};
        for (const a of bot.view!.myTeam!.decisions.production ?? []) made[a.skuId] = (made[a.skuId] ?? 0) + a.qty;
        return act(bot, code, {
          type: 'SUBMIT_TRANSPORT',
          split: Object.fromEntries(bot.view!.config.skus.map((s) => [s.id, { truckload: made[s.id] ?? 0, interplant: 0 }])),
        });
      });
      await advance();
      await all((bot, i) => {
        const v = bot.view!;
        const markup = 1.2 + (i % 5) * 0.1;
        const prices = Object.fromEntries(v.config.skus.map((s) => [
          s.id,
          Math.round(priceFloor({ config: v.config } as GameState, v.myTeam!, s.id) * markup * 100) / 100,
        ]));
        return act(bot, code, { type: 'SUBMIT_PRICES', prices });
      });
      await advance(); // -> trading
      await all((bot) => act(bot, code, { type: 'MARK_TRADING_DONE', done: true }));
      await advance(); // -> orders
      await advance(); // lock the suggested split -> results
      await advance(); // next month, or game over
      console.log(`Month ${m} done (${seconds()} s)`);
    }

    // stale screens: every player's stored view should be at the game's latest revision
    await new Promise((r) => setTimeout(r, 2000));
    const latest = admin.view!.rev;
    const views = await Promise.all([admin, ...bots].map((b) => b.fetchView(viewId)));
    const stale = views.filter((v) => v && v.rev < latest).length;

    const sizeKb = (v?: GameView | null) => (v ? Math.round(JSON.stringify(v).length / 1024) : 0);
    console.log('\n=== Results ===');
    console.log(`Requests: ${latencies.length}; response time p50 ${pct(latencies, 50)} ms, p95 ${pct(latencies, 95)} ms, max ${pct(latencies, 100)} ms`);
    console.log(`"Game is busy" answers (a player would see an error and click again): ${busy}; gave up after retries: ${busyGaveUp}`);
    console.log(`Stale screens at the end (view older than the game): ${stale} of ${views.length}`);
    console.log(`View sizes at the end: facilitator ${sizeKb(views[0])} KB, one team ${sizeKb(views[1])} KB`);
    console.log(`Other errors: ${errors.size ? [...errors].map(([msg, n]) => `${n} x ${msg}`).join('; ') : 'none'}`);
    console.log(`Total time: ${seconds()} s; game ${code} ended in phase ${views[0]?.phase ?? 'unknown'}`);
    if (BACKEND === 'supabase') {
      console.log('The test game and its anonymous users stay in Supabase; delete them there if you want a clean project.');
    }
  } finally {
    server?.kill('SIGTERM');
  }
}

main().catch((e) => {
  console.error('\nLoad test failed:', (e as Error).message);
  console.error(`Before it stopped: ${latencies.length} requests; response time p50 ${pct(latencies, 50)} ms, ` +
    `p95 ${pct(latencies, 95)} ms, max ${pct(latencies, 100)} ms; "Game is busy" answers ${busy}`);
  process.exitCode = 1;
});
