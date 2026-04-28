-- Track per-user day marker for "/news" daily notifications.
-- This prevents duplicate "new daily news" alerts during polling.
--
-- Safe to re-run.

alter table public."user"
  add column if not exists last_news_notified_day text;

alter table public."user"
  drop constraint if exists user_last_news_notified_day_format;

alter table public."user"
  add constraint user_last_news_notified_day_format
    check (
      last_news_notified_day is null
      or last_news_notified_day ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    );
