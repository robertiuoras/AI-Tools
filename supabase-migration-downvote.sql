-- Downvotes (community signal for low-quality tools). Run in Supabase SQL Editor.
-- Mirrors monthly window used for upvotes (`downvotedAt` in current local month on API).

CREATE TABLE IF NOT EXISTS "downvote" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  "toolId" TEXT NOT NULL REFERENCES "tool"(id) ON DELETE CASCADE,
  "downvotedAt" TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  "monthlyResetDate" TEXT
);

CREATE INDEX IF NOT EXISTS "downvote_toolId_idx" ON "downvote"("toolId");
CREATE INDEX IF NOT EXISTS "downvote_userId_idx" ON "downvote"("userId");
CREATE INDEX IF NOT EXISTS "downvote_downvotedAt_idx" ON "downvote"("downvotedAt");
CREATE INDEX IF NOT EXISTS "downvote_userId_downvotedAt_idx" ON "downvote"("userId", "downvotedAt");

ALTER TABLE "downvote" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read downvotes" ON "downvote";
CREATE POLICY "Anyone can read downvotes" ON "downvote"
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Users can create own downvotes" ON "downvote";
CREATE POLICY "Users can create own downvotes" ON "downvote"
  FOR INSERT WITH CHECK (auth.uid() = "userId");

DROP POLICY IF EXISTS "Users can delete own downvotes" ON "downvote";
CREATE POLICY "Users can delete own downvotes" ON "downvote"
  FOR DELETE USING (auth.uid() = "userId");
