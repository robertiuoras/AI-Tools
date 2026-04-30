-- Per-account prompt library (JSON array), synced via /api/user/prompts.
-- Run once in Supabase Studio → SQL editor. Safe to re-run.

create table if not exists public.user_prompt_library (
  user_id uuid not null primary key references public."user"(id) on delete cascade,
  prompts jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists user_prompt_library_updated_at_idx
  on public.user_prompt_library (updated_at desc);

comment on table public.user_prompt_library is
  'User-owned prompt templates; JSON array shape matches client UserPrompt[].';
