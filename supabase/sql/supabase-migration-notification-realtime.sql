-- Real-time delivery for in-app notifications
-- ---------------------------------------------------------------
-- The notifications bell (components/NotificationsBell.tsx) subscribes to
-- Supabase Realtime for INSERT events on public.notification, so a recipient
-- sees the toast + badge instantly when someone shares a note/whiteboard
-- with them — no need to wait for the 60s poll fallback or refresh the
-- page.
--
-- Realtime only emits changes for tables that are members of the
-- `supabase_realtime` publication. This script adds the notification table
-- idempotently and is safe to re-run.
--
-- Run once in Supabase SQL editor:
--   1. Open Supabase Studio → SQL editor
--   2. Paste this whole file and click Run
--
-- RLS already restricts SELECT to `auth.uid() = user_id`, so realtime will
-- only forward rows the listening user is allowed to see — no extra
-- channel-level filter needed for security (we still apply one client-side
-- for performance).

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notification'
  ) then
    execute 'alter publication supabase_realtime add table public.notification';
  end if;
end$$;

-- Required so subscribers receive the full row (default identity only
-- emits the primary key on UPDATE/DELETE, which would break optimistic
-- merging on the client).
alter table public.notification replica identity full;
