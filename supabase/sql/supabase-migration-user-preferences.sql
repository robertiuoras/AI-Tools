-- Extra user preferences: bio, custom cursor colour, theme preference,
-- email notification opt-out. All optional.
--
-- Run once in Supabase Studio → SQL editor. Safe to re-run.

alter table public.user
  add column if not exists bio                  text,
  add column if not exists cursor_color         text,
  add column if not exists theme_pref           text default 'system'
                                                check (theme_pref in ('light', 'dark', 'system')),
  add column if not exists email_notifications  boolean default true;

-- Cursor colour must be a CSS-friendly hex/hsl string and length-bounded
-- to keep the column tidy. We don't enforce a strict format because
-- letting users paste any colour they like is more flexible than locking
-- them to a palette.
alter table public.user
  drop constraint if exists user_cursor_color_length;
alter table public.user
  add constraint user_cursor_color_length
    check (cursor_color is null or char_length(cursor_color) <= 32);

alter table public.user
  drop constraint if exists user_bio_length;
alter table public.user
  add constraint user_bio_length
    check (bio is null or char_length(bio) <= 280);

-- Existing user_select_self / user_update_self policies (added in
-- supabase-migration-user-profile.sql) already cover read+write of
-- the new columns, so no extra RLS is needed.
