-- Video suggestion queue — users can suggest YouTube / TikTok videos to add to the curated list.
-- Run once in the Supabase SQL editor.

create table if not exists public.video_suggestion (
  id                    uuid        primary key default gen_random_uuid(),
  url                   text        not null,
  normalized_url        text        not null,
  note                  text,                          -- optional message from the suggester
  status                text        not null default 'pending'
                          check (status in ('pending', 'approved', 'rejected')),
  suggested_by_user_id  uuid        references auth.users(id) on delete set null,
  reviewed_at           timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- Prevent duplicate pending suggestions for the same URL.
create unique index if not exists video_suggestion_normalized_url_pending_idx
  on public.video_suggestion (normalized_url)
  where (status = 'pending');

create index if not exists video_suggestion_status_created_idx
  on public.video_suggestion (status, created_at desc);

create or replace function public.video_suggestion_set_updated_at()
  returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists video_suggestion_set_updated_at on public.video_suggestion;
create trigger video_suggestion_set_updated_at
  before update on public.video_suggestion
  for each row execute function public.video_suggestion_set_updated_at();

alter table public.video_suggestion enable row level security;

-- Admins (service-role key) can do everything; regular users have no direct access.
create policy "service_role_all" on public.video_suggestion
  for all using (true) with check (true);
