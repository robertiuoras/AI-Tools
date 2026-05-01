-- Pending tool suggestions from public homepage (admin approves → same flow as Quick Add).

CREATE TABLE IF NOT EXISTS tool_suggestion (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  url TEXT NOT NULL,
  normalized_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  suggested_by_user_id UUID NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS tool_suggestion_pending_url_unique
  ON tool_suggestion (normalized_url)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS tool_suggestion_status_created_idx
  ON tool_suggestion (status, created_at DESC);
