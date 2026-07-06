// Backend abstraction: the same contract against the local dev harness
// (scripts/dev-local.ts) or the real Supabase project. Which one is used
// is decided by env: VITE_SUPABASE_URL set -> Supabase, else local.
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { Action, GameConfig, GameView } from '@scg/shared';

export interface CreateSetup {
  months?: number;
  numSkus?: number;
  difficulty?: 'easy' | 'medium' | 'hard';
  numCustomers?: number;
  startingBudget?: number;
}

export interface SessionInfo {
  code: string;
  gameId: string;
  view: GameView;
}

type DistributiveOmit<T, K extends keyof any> = T extends any ? Omit<T, K> : never;
export type ClientAction = DistributiveOmit<Action, 'playerId'>;

export interface Backend {
  readonly kind: 'local' | 'supabase';
  ready(): Promise<void>;
  playerId(): string;
  create(name: string, setup: CreateSetup, config?: GameConfig): Promise<SessionInfo>;
  join(code: string, name: string): Promise<SessionInfo>;
  action(code: string, action: ClientAction): Promise<GameView>;
  fetchView(code: string, gameId: string): Promise<GameView | null>;
  subscribe(code: string, gameId: string, cb: (v: GameView) => void): () => void;
}

class BackendError extends Error {}

// ------------------------------------------------------------- local

class LocalBackend implements Backend {
  readonly kind = 'local' as const;
  private pid: string;

  constructor() {
    let pid = localStorage.getItem('scg-player-id');
    if (!pid) {
      pid = crypto.randomUUID();
      localStorage.setItem('scg-player-id', pid);
    }
    this.pid = pid;
  }

  async ready() {}
  playerId() { return this.pid; }

  private async rpc(body: Record<string, unknown>): Promise<any> {
    const res = await fetch('/api/local', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-player-id': this.pid },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new BackendError(data.error ?? 'Request failed');
    return data;
  }

  async create(name: string, setup: CreateSetup, config?: GameConfig): Promise<SessionInfo> {
    return this.rpc({ op: 'create', name, setup, config });
  }
  async join(code: string, name: string): Promise<SessionInfo> {
    return this.rpc({ op: 'join', code, name });
  }
  async action(code: string, action: ClientAction): Promise<GameView> {
    const data = await this.rpc({ op: 'action', code, action });
    return data.view;
  }
  async fetchView(code: string): Promise<GameView | null> {
    const res = await fetch(
      `/api/local/view?code=${encodeURIComponent(code)}&playerId=${encodeURIComponent(this.pid)}`,
    );
    if (!res.ok) return null;
    return (await res.json()).view;
  }
  subscribe(code: string, _gameId: string, cb: (v: GameView) => void): () => void {
    const es = new EventSource(
      `/api/local/subscribe?code=${encodeURIComponent(code)}&playerId=${encodeURIComponent(this.pid)}`,
    );
    es.onmessage = (ev) => cb(JSON.parse(ev.data));
    return () => es.close();
  }
}

// ---------------------------------------------------------- supabase

class SupabaseBackend implements Backend {
  readonly kind = 'supabase' as const;
  private sb: SupabaseClient;
  private uid: string | null = null;

  constructor(url: string, anonKey: string) {
    this.sb = createClient(url, anonKey);
  }

  async ready() {
    const { data: { session } } = await this.sb.auth.getSession();
    if (session?.user) {
      this.uid = session.user.id;
      return;
    }
    const { data, error } = await this.sb.auth.signInAnonymously();
    if (error) {
      throw new BackendError(
        `Sign-in failed: ${error.message}. Enable "Anonymous sign-ins" in Supabase Auth settings.`,
      );
    }
    this.uid = data.user!.id;
  }

  playerId() {
    if (!this.uid) throw new BackendError('Backend not ready');
    return this.uid;
  }

  private async rpc(body: Record<string, unknown>): Promise<any> {
    const { data, error } = await this.sb.functions.invoke('apply-action', { body });
    if (error) {
      // FunctionsHttpError carries the JSON body with the engine message
      const ctx = (error as any).context;
      if (ctx && typeof ctx.json === 'function') {
        try {
          const payload = await ctx.json();
          if (payload?.error) throw new BackendError(payload.error);
        } catch (e) {
          if (e instanceof BackendError) throw e;
        }
      }
      throw new BackendError(error.message ?? 'Request failed');
    }
    if (data?.error) throw new BackendError(data.error);
    return data;
  }

  async create(name: string, setup: CreateSetup, config?: GameConfig): Promise<SessionInfo> {
    return this.rpc({ op: 'create', name, setup, config });
  }
  async join(code: string, name: string): Promise<SessionInfo> {
    return this.rpc({ op: 'join', code, name });
  }
  async action(code: string, action: ClientAction): Promise<GameView> {
    const data = await this.rpc({ op: 'action', code, action });
    return data.view;
  }

  async fetchView(_code: string, gameId: string): Promise<GameView | null> {
    const { data } = await this.sb
      .from('game_views')
      .select('audience, view')
      .eq('game_id', gameId);
    if (!data?.length) return null;
    // RLS returns the rows we may read; prefer the most specific audience
    const specific = data.find((r) => r.audience !== 'public') ?? data[0];
    return specific.view as GameView;
  }

  subscribe(code: string, gameId: string, cb: (v: GameView) => void): () => void {
    const channel = this.sb
      .channel(`game-${gameId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'game_views', filter: `game_id=eq.${gameId}` },
        () => {
          // refetch instead of trusting the payload: RLS may deliver the
          // public row while a more specific row also changed
          this.fetchView(code, gameId).then((v) => v && cb(v));
        },
      )
      .subscribe();
    return () => { this.sb.removeChannel(channel); };
  }
}

export function makeBackend(): Backend {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  const force = import.meta.env.VITE_BACKEND as string | undefined;
  if (url && anon && force !== 'local') return new SupabaseBackend(url, anon);
  return new LocalBackend();
}
