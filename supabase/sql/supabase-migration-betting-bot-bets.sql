-- AI Betting Bot — tracked bets + self-settlement history
--
-- Every analysis the user "tracks" is persisted here. Two things feed off
-- this table:
--   1. The dashboard lists pending bets, auto-refreshing any whose kickoff
--      has passed so the user sees up-to-date W/L, profit, and scores
--      without doing anything.
--   2. A calibration summary is fed back into the research prompt so the
--      bot sees its own historical hit rate per confidence bucket and
--      stops over- or under-estimating.
--
-- Run this once in Supabase SQL editor.

create table if not exists public.betting_bot_bet (
  id                         uuid          primary key default gen_random_uuid(),
  user_id                    uuid          not null references auth.users(id) on delete cascade,
  created_at                 timestamptz   not null default now(),
  updated_at                 timestamptz   not null default now(),

  -- What the user asked
  query                      text          not null,
  pick_summary               text          not null,
  market_normalized          text          not null,

  -- Fixture identity (from ESPN when available; free-text fallbacks below)
  sport_label                text,
  sport_path                 text,           -- "basketball/nba", "soccer/eng.1", …
  espn_event_id              text,
  espn_home_team_id          text,
  espn_away_team_id          text,
  home_team_name             text,
  away_team_name             text,
  kickoff                    timestamptz,
  venue                      text,

  -- Price
  odds_decimal               numeric(10,4),
  odds_american              integer,
  stake_usd                  numeric(12,2),

  -- Model numbers
  fair_win_probability_pct   numeric(5,2)  not null,
  confidence_pct             numeric(5,2)  not null,
  confidence_bin             text          not null,    -- low | moderate | high | elite
  edge_pct                   numeric(6,2),
  verdict                    text          not null,    -- strong_bet | bet | lean | pass | fade
  composite_score            numeric(5,2),

  -- Settlement
  status                     text          not null default 'pending',
    -- pending | won | lost | push | void | needs_review | cancelled
  settled_at                 timestamptz,
  home_score                 integer,
  away_score                 integer,
  settlement_notes           text,
  profit_units               numeric(10,4),
    -- +(decimal-1) win, -1 loss, 0 push, null pending

  user_notes                 text,

  -- Full BettingAnalysisResult for replay / debugging — never trust it for
  -- anything but display, since we recompute stats server-side.
  snapshot                   jsonb
);

create index if not exists idx_betting_bot_bet_user_created
  on public.betting_bot_bet (user_id, created_at desc);

create index if not exists idx_betting_bot_bet_user_status
  on public.betting_bot_bet (user_id, status);

create index if not exists idx_betting_bot_bet_event_pending
  on public.betting_bot_bet (espn_event_id)
  where espn_event_id is not null and status = 'pending';

-- RLS: users can only see / touch their own bets. Service role (used by
-- the settlement job) bypasses RLS automatically.
alter table public.betting_bot_bet enable row level security;

drop policy if exists betting_bot_bet_select_own on public.betting_bot_bet;
create policy betting_bot_bet_select_own
  on public.betting_bot_bet for select
  using (auth.uid() = user_id);

drop policy if exists betting_bot_bet_insert_own on public.betting_bot_bet;
create policy betting_bot_bet_insert_own
  on public.betting_bot_bet for insert
  with check (auth.uid() = user_id);

drop policy if exists betting_bot_bet_update_own on public.betting_bot_bet;
create policy betting_bot_bet_update_own
  on public.betting_bot_bet for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists betting_bot_bet_delete_own on public.betting_bot_bet;
create policy betting_bot_bet_delete_own
  on public.betting_bot_bet for delete
  using (auth.uid() = user_id);

-- updated_at trigger (snake_case twin of the repo's camelCase helper)
create or replace function public.betting_bot_bet_touch_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists betting_bot_bet_set_updated_at on public.betting_bot_bet;
create trigger betting_bot_bet_set_updated_at
  before update on public.betting_bot_bet
  for each row execute function public.betting_bot_bet_touch_updated_at();
