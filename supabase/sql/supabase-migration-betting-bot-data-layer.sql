-- AI Betting Bot — data-quality layer.
-- Four tables that turn the bot from a single-source ESPN reader into a
-- multi-provider, history-accumulating engine without paying for any API.
--
-- Run once in the Supabase SQL editor. Every accessor in lib/ degrades
-- silently when these tables don't exist, so partial rollouts are safe.

-- 1. Generic key/value cache for ESPN + provider responses.
--    Cuts latency on repeat requests and protects free-tier quotas.
create table if not exists public.sports_data_cache (
  cache_key text primary key,
  value jsonb not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists sports_data_cache_expires_idx
  on public.sports_data_cache (expires_at);

-- 2. Internal Elo ratings — populates the 16%-weight power-ratings metric
--    that ESPN data alone can't fill (no EPA / xG / KenPom on the free tier).
create table if not exists public.elo_ratings (
  sport text not null,
  team_id text not null,
  rating numeric not null default 1500,
  games_count integer not null default 0,
  last_game_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (sport, team_id)
);

-- 3. Multi-season head-to-head store. ESPN's schedule API only exposes the
--    current season; this accumulates every H2H result we ever see so the
--    "last 2-3 seasons" prompt rubric actually has data to point at.
create table if not exists public.h2h_history (
  sport text not null,
  pair_key text not null,         -- sorted "teamA|teamB"
  game_date date not null,
  home_id text not null,
  away_id text not null,
  home_score integer,
  away_score integer,
  venue text,
  source text not null,           -- 'espn' | 'api-football' | 'sportsdb' | 'manual'
  created_at timestamptz not null default now(),
  primary key (sport, pair_key, game_date, home_id, away_id)
);

create index if not exists h2h_history_pair_idx
  on public.h2h_history (sport, pair_key, game_date desc);

-- 4. Odds snapshots — populates the 14%-weight line-movement metric. Every
--    bot request snapshots the current books for the resolved fixture; over
--    time this builds an opening->current line dataset the model can read.
create table if not exists public.odds_snapshots (
  id bigserial primary key,
  sport text not null,
  event_key text not null,         -- normalized "home|away|kickoffISO"
  espn_event_id text,
  captured_at timestamptz not null default now(),
  books jsonb not null             -- BettingBookOdds[]
);

create index if not exists odds_snapshots_event_idx
  on public.odds_snapshots (event_key, captured_at);

-- All four tables are written via the service role only. RLS is on; no
-- client policy is provided because no client-side reads are expected.
alter table public.sports_data_cache enable row level security;
alter table public.elo_ratings        enable row level security;
alter table public.h2h_history        enable row level security;
alter table public.odds_snapshots     enable row level security;
