-- Whiteboard sharing — enables real-time collab on whiteboards.
--
-- Design note: whiteboard *snapshots* still live in the storage bucket
-- "user-whiteboard" at <ownerId>/<boardId>.json (and <ownerId>/__boards__.json
-- for the metadata index). The owner_id column lets non-owner recipients
-- locate the snapshot file without that path being baked into the boardId.
--
-- Run once in Supabase Studio → SQL editor.

create table if not exists public.whiteboard_share (
  id              uuid          primary key default gen_random_uuid(),
  board_id        text          not null,
  owner_id        uuid          not null references auth.users(id) on delete cascade,
  shared_with_id  uuid          not null references auth.users(id) on delete cascade,
  -- Cached at share time so the recipient sees a meaningful name in
  -- their "Shared with me" list even if the owner renames it later.
  -- Refreshed by the share API whenever a new share is added or
  -- a permission is updated for the same board.
  board_name      text,
  permission      text          not null default 'view'
                                check (permission in ('view', 'edit')),
  created_at      timestamptz   not null default now(),
  updated_at      timestamptz   not null default now(),
  unique (board_id, shared_with_id)
);

create index if not exists idx_whiteboard_share_owner   on public.whiteboard_share (owner_id);
create index if not exists idx_whiteboard_share_with    on public.whiteboard_share (shared_with_id);
create index if not exists idx_whiteboard_share_board   on public.whiteboard_share (board_id);

-- Touch updated_at automatically on UPDATE.
create or replace function public.tg_whiteboard_share_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_whiteboard_share_touch on public.whiteboard_share;
create trigger trg_whiteboard_share_touch
  before update on public.whiteboard_share
  for each row execute procedure public.tg_whiteboard_share_touch();

-- RLS — owner + recipient can read; mutations happen server-side via
-- service role so no INSERT/UPDATE/DELETE policy is needed.
alter table public.whiteboard_share enable row level security;

drop policy if exists whiteboard_share_select_self on public.whiteboard_share;
create policy whiteboard_share_select_self
  on public.whiteboard_share for select
  using (auth.uid() = owner_id or auth.uid() = shared_with_id);
