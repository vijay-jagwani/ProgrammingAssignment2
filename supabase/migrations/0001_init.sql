-- Supply Chain Game: initial schema
-- Run this in the Supabase SQL editor (or `supabase db push`).

create table if not exists public.games (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  state jsonb not null,
  rev bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.players (
  id uuid not null,                -- auth.uid() of the (anonymous) player
  game_id uuid not null references public.games(id) on delete cascade,
  name text not null,
  audience text not null default 'public',  -- 'admin' | 'team:<id>' | 'public'
  primary key (id, game_id)
);

create table if not exists public.game_views (
  game_id uuid not null references public.games(id) on delete cascade,
  audience text not null,
  view jsonb not null,
  rev bigint not null,
  updated_at timestamptz not null default now(),
  primary key (game_id, audience)
);

-- Only the service role (edge function) may touch state; clients read views.
alter table public.games enable row level security;
alter table public.players enable row level security;
alter table public.game_views enable row level security;

-- A player can look up their own membership rows (to find game + audience).
create policy "players read own rows"
  on public.players for select
  using (auth.uid() = id);

-- A player can read the view for their audience, plus the public view of
-- any game they belong to. This is what keeps other teams' data hidden.
create policy "players read their game view"
  on public.game_views for select
  using (
    exists (
      select 1 from public.players p
      where p.game_id = game_views.game_id
        and p.id = auth.uid()
        and (p.audience = game_views.audience or game_views.audience = 'public')
    )
  );

-- Push view updates to subscribed clients (RLS is respected by Realtime).
alter publication supabase_realtime add table public.game_views;
