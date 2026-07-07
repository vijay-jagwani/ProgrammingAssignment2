import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import type { GameView, PlayerInfo } from '@scg/shared';
import { Backend, ClientAction, CreateSetup, makeBackend } from './backend';

interface Session {
  code: string;
  gameId: string;
}

interface GameCtx {
  ready: boolean;
  fatal: string | null;
  view: GameView | null;
  code: string | null;
  me: PlayerInfo | null;
  error: string | null;
  busy: boolean;
  clearError(): void;
  create(name: string, setup: CreateSetup): Promise<void>;
  join(code: string, name: string): Promise<void>;
  act(action: ClientAction): Promise<boolean>;
  leave(): void;
  switchPlayer(): Promise<void>;
}

const Ctx = createContext<GameCtx>(null as unknown as GameCtx);
export const useGame = () => useContext(Ctx);

const SESSION_KEY = 'scg-session';

export function GameProvider({ children }: { children: React.ReactNode }) {
  const backend = useRef<Backend>();
  if (!backend.current) backend.current = makeBackend();

  const [ready, setReady] = useState(false);
  const [fatal, setFatal] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [view, setView] = useState<GameView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // boot: init identity, restore session
  useEffect(() => {
    backend.current!
      .ready()
      .then(async () => {
        const saved = localStorage.getItem(SESSION_KEY);
        if (saved) {
          const s = JSON.parse(saved) as Session;
          const v = await backend.current!.fetchView(s.code, s.gameId);
          if (v) {
            setSession(s);
            setView(v);
          } else {
            localStorage.removeItem(SESSION_KEY);
          }
        }
        setReady(true);
      })
      .catch((e) => setFatal(e.message));
  }, []);

  // live subscription (keep only the freshest view)
  useEffect(() => {
    if (!session) return;
    return backend.current!.subscribe(session.code, session.gameId, (v) => {
      setView((prev) => (prev && prev.rev > v.rev ? prev : v));
    });
  }, [session?.code, session?.gameId]);

  const persist = (s: Session, v: GameView) => {
    localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    setSession(s);
    setView(v);
  };

  const create = useCallback(async (name: string, setup: CreateSetup) => {
    setBusy(true);
    setError(null);
    try {
      const info = await backend.current!.create(name, setup);
      persist({ code: info.code, gameId: info.gameId }, info.view);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }, []);

  const join = useCallback(async (code: string, name: string) => {
    setBusy(true);
    setError(null);
    try {
      const be = backend.current!;
      let info = await be.join(code.toUpperCase().trim(), name);
      // Shared browser profile (e.g. two incognito windows): if this identity
      // already belongs to a different player in the game, mint a fresh one
      // so the new person doesn't take over the existing seat.
      const existing = info.view.players.find((p) => p.id === be.playerId());
      if (existing && existing.name.trim().toLowerCase() !== name.trim().toLowerCase()) {
        await be.resetIdentity();
        info = await be.join(code.toUpperCase().trim(), name);
      }
      persist({ code: info.code, gameId: info.gameId }, info.view);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }, []);

  const act = useCallback(async (action: ClientAction): Promise<boolean> => {
    if (!session) return false;
    setBusy(true);
    setError(null);
    try {
      const v = await backend.current!.action(session.code, action);
      setView((prev) => (prev && prev.rev > v.rev ? prev : v));
      return true;
    } catch (e: any) {
      setError(e.message);
      return false;
    } finally {
      setBusy(false);
    }
  }, [session]);

  const leave = useCallback(() => {
    localStorage.removeItem(SESSION_KEY);
    setSession(null);
    setView(null);
  }, []);

  /** Full reset for a new person on this device: new identity, back to landing. */
  const switchPlayer = useCallback(async () => {
    setBusy(true);
    try {
      localStorage.removeItem(SESSION_KEY);
      await backend.current!.resetIdentity();
      setSession(null);
      setView(null);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }, []);

  const me = useMemo(() => {
    if (!view) return null;
    const pid = backend.current!.playerId();
    return view.players.find((p) => p.id === pid) ?? null;
  }, [view]);

  const value: GameCtx = {
    ready, fatal, view, code: session?.code ?? null, me, error, busy,
    clearError: () => setError(null),
    create, join, act, leave, switchPlayer,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
