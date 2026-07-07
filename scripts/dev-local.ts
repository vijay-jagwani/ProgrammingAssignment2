// Local development stand-in for the Supabase backend.
// Same request/response contract as the `apply-action` edge function,
// plus an SSE endpoint that plays the part of Supabase Realtime.
// Run with: npx tsx scripts/dev-local.ts   (or `npm run dev` at the root)
import http from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Action,
  EngineError,
  GameState,
  audienceFor,
  buildDefaultConfig,
  createGame,
  reduce,
  viewFor,
} from '../shared/src/index.ts';

const PORT = Number(process.env.PORT ?? 8787);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = join(root, 'data');
const dataFile = join(dataDir, 'local-games.json');

const games = new Map<string, GameState>();
if (existsSync(dataFile)) {
  try {
    const raw = JSON.parse(readFileSync(dataFile, 'utf8')) as Record<string, GameState>;
    for (const [code, state] of Object.entries(raw)) games.set(code, state);
    console.log(`Restored ${games.size} game(s) from ${dataFile}`);
  } catch {
    console.warn('Could not restore saved games; starting fresh');
  }
}

function persist() {
  try {
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(dataFile, JSON.stringify(Object.fromEntries(games)));
  } catch (e) {
    console.warn('persist failed', e);
  }
}

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function genCode(): string {
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return games.has(code) ? genCode() : code;
}

interface Subscriber {
  playerId: string;
  res: http.ServerResponse;
}
const subscribers = new Map<string, Set<Subscriber>>();

function broadcast(code: string) {
  const state = games.get(code);
  if (!state) return;
  for (const sub of subscribers.get(code) ?? []) {
    const view = viewFor(state, audienceFor(state, sub.playerId));
    sub.res.write(`data: ${JSON.stringify(view)}\n\n`);
  }
}

function json(res: http.ServerResponse, body: unknown, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readBody(req: http.IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);

  if (url.pathname === '/api/local/subscribe' && req.method === 'GET') {
    const code = (url.searchParams.get('code') ?? '').toUpperCase();
    const playerId = url.searchParams.get('playerId') ?? '';
    if (!games.has(code)) return json(res, { error: 'Game not found' }, 404);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    const sub: Subscriber = { playerId, res };
    if (!subscribers.has(code)) subscribers.set(code, new Set());
    subscribers.get(code)!.add(sub);
    const state = games.get(code)!;
    res.write(`data: ${JSON.stringify(viewFor(state, audienceFor(state, playerId)))}\n\n`);
    const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
    req.on('close', () => {
      clearInterval(ping);
      subscribers.get(code)?.delete(sub);
    });
    return;
  }

  if (url.pathname === '/api/local/view' && req.method === 'GET') {
    const code = (url.searchParams.get('code') ?? '').toUpperCase();
    const playerId = url.searchParams.get('playerId') ?? '';
    const state = games.get(code);
    if (!state) return json(res, { error: 'Game not found' }, 404);
    return json(res, { code, gameId: code, view: viewFor(state, audienceFor(state, playerId)) });
  }

  if (url.pathname === '/api/local' && req.method === 'POST') {
    try {
      const playerId = String(req.headers['x-player-id'] ?? '');
      if (!playerId) return json(res, { error: 'Missing x-player-id header' }, 401);
      const body = await readBody(req);

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
          type: 'JOIN', playerId, name: String(body.name ?? 'Admin'), asAdmin: true,
        });
        games.set(code, state);
        persist();
        return json(res, { code, gameId: code, view: viewFor(state, 'admin') });
      }

      const code = String(body.code ?? '').toUpperCase().trim();
      const prev = games.get(code);
      if (!prev) return json(res, { error: 'Game not found — check the code' }, 404);

      let action: Action;
      if (body.op === 'join') {
        action = { type: 'JOIN', playerId, name: String(body.name ?? ''), asAdmin: false };
      } else if (body.op === 'action') {
        const a = body.action ?? {};
        if (a.type === 'JOIN') return json(res, { error: 'Use the join op' }, 400);
        action = { ...a, playerId } as Action;
      } else {
        return json(res, { error: 'Unknown op' }, 400);
      }

      const state = reduce(prev, action);
      games.set(code, state);
      persist();
      broadcast(code);
      return json(res, { code, gameId: code, view: viewFor(state, audienceFor(state, playerId)) });
    } catch (e) {
      if (e instanceof EngineError) return json(res, { error: e.message }, 400);
      console.error(e);
      return json(res, { error: 'Internal error' }, 500);
    }
  }

  json(res, { error: 'Not found' }, 404);
});

server.listen(PORT, () => {
  console.log(`Local game API listening on http://localhost:${PORT}`);
});
