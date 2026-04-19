-- Note version history (for shared notes with collaborative editing).
-- A snapshot is written on each PUT /api/notes/:id, deduplicated to at
-- most one row per minute per note. Owners + users with edit permission
-- can revert the note to any prior version via POST /api/notes/:id/versions/:versionId.
--
-- Run once in Supabase Studio → SQL editor.

create table if not exists public.note_version (
  id          uuid          primary key default gen_random_uuid(),
  note_id     uuid          not null references public.note(id) on delete cascade,
  author_id   uuid          references auth.users(id) on delete set null,
  title       text          not null,
  content     text          not null,
  created_at  timestamptz   not null default now()
);

create index if not exists idx_note_version_note_created
  on public.note_version (note_id, created_at desc);

-- RLS: users can only read versions of notes they have access to.
-- Insert/revert happens server-side via the service role.
alter table public.note_version enable row level security;

drop policy if exists note_version_select_with_access on public.note_version;
create policy note_version_select_with_access
  on public.note_version for select
  using (
    exists (
      select 1
      from public.note n
      where n.id = note_version.note_id
        and (
          n."userId" = auth.uid()
          or exists (
            select 1
            from public.note_share s
            where s."noteId" = n.id
              and s."sharedWithId" = auth.uid()
          )
        )
    )
  );
