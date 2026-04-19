-- Notifications table for in-app + email notifications
-- (e.g. "Alice shared the note 'Q4 plan' with you").
--
-- Run this once in Supabase SQL editor:
--   1. Open Supabase Studio → SQL editor
--   2. Paste this whole file and click Run

create table if not exists public.notification (
  id          uuid          primary key default gen_random_uuid(),
  user_id     uuid          not null references auth.users(id) on delete cascade,
  type        text          not null,
  title       text          not null,
  body        text,
  link        text,
  payload     jsonb,
  is_read     boolean       not null default false,
  created_at  timestamptz   not null default now()
);

-- Listing unread + recent notifications is the hot path.
create index if not exists idx_notification_user_created
  on public.notification (user_id, created_at desc);

create index if not exists idx_notification_user_unread
  on public.notification (user_id, is_read, created_at desc);

-- RLS: users can only see / mutate their own notifications.
-- API routes that need to insert on behalf of the recipient (e.g. when User
-- A shares a note with User B) use the service role and bypass RLS.
alter table public.notification enable row level security;

drop policy if exists notification_select_own on public.notification;
create policy notification_select_own
  on public.notification for select
  using (auth.uid() = user_id);

drop policy if exists notification_update_own on public.notification;
create policy notification_update_own
  on public.notification for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists notification_delete_own on public.notification;
create policy notification_delete_own
  on public.notification for delete
  using (auth.uid() = user_id);
