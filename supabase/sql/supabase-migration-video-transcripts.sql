-- Video transcript cache for the AI Video Summariser.
-- Keyed on a SHA-256 of the normalized URL so repeat summaries skip Whisper entirely.
-- Run this once in the Supabase SQL editor; the route handles missing-table gracefully.

create table if not exists public.video_transcripts (
  url_hash text primary key,
  url text not null,
  source text not null check (source in ('youtube', 'tiktok')),
  transcript text not null,
  transcript_source jsonb not null,
  title text,
  author text,
  thumbnail_url text,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists video_transcripts_created_at_idx
  on public.video_transcripts (created_at desc);

create or replace function public.video_transcripts_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists video_transcripts_set_updated_at on public.video_transcripts;
create trigger video_transcripts_set_updated_at
before update on public.video_transcripts
for each row execute function public.video_transcripts_set_updated_at();

-- Service role only — clients should never read or write this directly.
alter table public.video_transcripts enable row level security;
