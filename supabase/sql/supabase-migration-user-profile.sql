-- User profile additions: customizable display name + avatar.
--
-- Run once in Supabase Studio → SQL editor.
--
-- After running this migration, also create a public storage bucket named
-- "user-avatars" (Storage → New bucket → Public). The /api/user/avatar
-- endpoint will create it automatically the first time a user uploads, but
-- creating it manually here is fine too.

-- 1) Add the avatar_url column if missing.
alter table public.user
  add column if not exists avatar_url text;

-- 2) Allow users to update their own row (name + avatar_url).
--    Without this RLS policy, name/avatar updates from the client would
--    silently no-op even with the right access token.
alter table public.user enable row level security;

drop policy if exists user_update_self on public.user;
create policy user_update_self
  on public.user for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

drop policy if exists user_select_self on public.user;
create policy user_select_self
  on public.user for select
  using (auth.uid() = id);

-- 3) Storage bucket for avatars (created by API on first upload, but you
--    can create it here ahead of time):
--    insert into storage.buckets (id, name, public) values ('user-avatars', 'user-avatars', true)
--      on conflict (id) do nothing;
--
--    Storage policy (public read, owner write):
--    create policy "Public read user-avatars"
--      on storage.objects for select
--      using (bucket_id = 'user-avatars');
--    create policy "Owner upload user-avatars"
--      on storage.objects for insert
--      with check (bucket_id = 'user-avatars' and auth.uid()::text = (storage.foldername(name))[1]);
--    create policy "Owner update user-avatars"
--      on storage.objects for update
--      using (bucket_id = 'user-avatars' and auth.uid()::text = (storage.foldername(name))[1]);
--    create policy "Owner delete user-avatars"
--      on storage.objects for delete
--      using (bucket_id = 'user-avatars' and auth.uid()::text = (storage.foldername(name))[1]);
