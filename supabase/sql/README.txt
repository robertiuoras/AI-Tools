Supabase SQL scripts — run in the SQL Editor in this order for a new project.
Skip any script whose changes already exist in your database.

1. supabase-migration.sql              — users, upvotes, comments, favorites, video (base), notes RLS
2. upvote-system-migration.sql        — upvote timestamps / monthly behavior
3. supabase-migration-tool-categories-array.sql — tool.categories array
4. supabase-migration-tool-is-agency.sql       — tool.isAgency flag
5. supabase-migration-downvote.sql    — downvote table + RLS
6. supabase-migration-videos.sql      — video columns, video_watch, RLS
7. supabase-batch-vote-counts.sql     — batch_monthly_vote_counts RPC (optional perf)
8. openai-usage-migration.sql         — openai_usage_log table
