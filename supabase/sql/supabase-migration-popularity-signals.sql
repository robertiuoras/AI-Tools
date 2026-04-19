-- ============================================================
-- Honest popularity signals for tools
-- ============================================================
-- Replaces the GPT-hallucinated `estimatedVisits` "~7.5M/mo" number on tool
-- cards with real, free signals (Tranco rank, GitHub stars, domain age,
-- Wikipedia presence, Wayback first snapshot, on-page hard claims).
--
-- All columns are nullable / default null so that existing rows continue to
-- behave exactly as before until the analyze pipeline re-computes them.
-- `estimatedVisits` is kept in the schema for backwards compatibility but is
-- no longer displayed on cards — see lib/popularity-signals.ts and
-- components/ToolCard.tsx.
-- ============================================================

alter table public.tool
  add column if not exists "githubRepo"             text,
  add column if not exists "githubStars"            integer,
  add column if not exists "trancoRank"             integer,
  add column if not exists "domainAgeYears"         numeric(5,2),
  add column if not exists "wikipediaPageTitle"     text,
  add column if not exists "wikipediaPageviews90d"  integer,
  add column if not exists "popularityScore"        integer,
  add column if not exists "popularityTier"         text,
  add column if not exists "popularitySignals"      jsonb,
  add column if not exists "popularityRefreshedAt"  timestamptz;

-- Tier is a small enum we control client-side. Validate at the DB level too.
alter table public.tool
  drop constraint if exists tool_popularity_tier_chk;
alter table public.tool
  add constraint tool_popularity_tier_chk
    check ("popularityTier" is null
           or "popularityTier" in ('major', 'established', 'emerging', 'niche'));

-- Score is normalised 0..100. Bound it.
alter table public.tool
  drop constraint if exists tool_popularity_score_range;
alter table public.tool
  add constraint tool_popularity_score_range
    check ("popularityScore" is null
           or ("popularityScore" >= 0 and "popularityScore" <= 100));

-- Helpful indexes for sort / refresh-by-staleness queries.
create index if not exists tool_popularity_score_idx
  on public.tool ("popularityScore" desc nulls last);
create index if not exists tool_popularity_refreshed_at_idx
  on public.tool ("popularityRefreshedAt" asc nulls first);
create index if not exists tool_tranco_rank_idx
  on public.tool ("trancoRank" asc nulls last);
