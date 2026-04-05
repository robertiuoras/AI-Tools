-- Run this in your Supabase SQL editor to enable OpenAI usage tracking
create table if not exists openai_usage_log (
  id           uuid        default gen_random_uuid() primary key,
  created_at   timestamptz default now(),
  model        text        not null,
  operation    text        not null, -- 'tool_analyze' | 'video_analyze' | 'add_missing_ratings'
  prompt_tokens      integer     not null default 0,
  completion_tokens  integer     not null default 0,
  total_tokens       integer     not null default 0,
  estimated_cost_usd numeric(12, 8) not null default 0
);

-- Index for fast monthly queries
create index if not exists openai_usage_log_created_at_idx on openai_usage_log (created_at desc);
