-- Supabase migration for Videos / Creators page
-- Run this AFTER your base AI Tools schema is already set up.
-- In Supabase: SQL Editor → New query → paste and run. If you get "column already exists", that's fine.
-- After adding columns, PostgREST may take a few seconds to refresh; if saves still fail, try Dashboard → Settings → API → "Reload schema cache" (or wait ~1 min).

-- 1. Create Video table (if it doesn't exist)
CREATE TABLE IF NOT EXISTS "video" (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  category TEXT NOT NULL,
  source TEXT DEFAULT 'youtube',
  "youtuberName" TEXT,
  "subscriberCount" BIGINT,
  "channelThumbnailUrl" TEXT,
  "channelVideoCount" BIGINT,
  "verified" BOOLEAN,
  tags TEXT,
  description TEXT,
  "createdAt" TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  "updatedAt" TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- If table already exists, add new columns (run in Supabase SQL Editor; safe to run multiple times)
ALTER TABLE "video" ADD COLUMN IF NOT EXISTS "channelThumbnailUrl" TEXT;
ALTER TABLE "video" ADD COLUMN IF NOT EXISTS "channelVideoCount" BIGINT;
ALTER TABLE "video" ADD COLUMN IF NOT EXISTS "verified" BOOLEAN;
-- source: 'youtube' | 'tiktok' (default youtube for existing rows)
ALTER TABLE "video" ADD COLUMN IF NOT EXISTS "source" TEXT DEFAULT 'youtube';

-- 2. Enable RLS on Video table (read-only for public)
ALTER TABLE "video" ENABLE ROW LEVEL SECURITY;

-- 3. Policies for Video table
DROP POLICY IF EXISTS "Anyone can read videos" ON "video";

CREATE POLICY "Anyone can read videos" ON "video"
  FOR SELECT USING (true);

-- 4. Reuse updatedAt trigger for video table
-- Assumes you already have update_updated_at_column() from your main migration.
DROP TRIGGER IF EXISTS update_video_updated_at ON "video";

CREATE TRIGGER update_video_updated_at BEFORE UPDATE ON "video"
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- 5. Per-user watched state for videos
CREATE TABLE IF NOT EXISTS "video_watch" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  "videoId" TEXT NOT NULL REFERENCES "video"(id) ON DELETE CASCADE,
  "watchedAt" TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE("userId", "videoId")
);

CREATE INDEX IF NOT EXISTS "video_watch_userId_idx" ON "video_watch"("userId");
CREATE INDEX IF NOT EXISTS "video_watch_videoId_idx" ON "video_watch"("videoId");

ALTER TABLE "video_watch" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read video_watch" ON "video_watch";
DROP POLICY IF EXISTS "Users can mark watched videos" ON "video_watch";
DROP POLICY IF EXISTS "Users can clear watched videos" ON "video_watch";

CREATE POLICY "Anyone can read video_watch" ON "video_watch"
  FOR SELECT USING (true);

CREATE POLICY "Users can mark watched videos" ON "video_watch"
  FOR INSERT WITH CHECK (auth.uid() = "userId");

CREATE POLICY "Users can clear watched videos" ON "video_watch"
  FOR DELETE USING (auth.uid() = "userId");

-- Optional data cleanup: align stored video.category with lib/schemas.ts `videoCategories`.
-- Inspect current values: SELECT category, COUNT(*) FROM video GROUP BY category ORDER BY COUNT(*) DESC;
-- Then run targeted UPDATEs, e.g. UPDATE video SET category = 'Education & Tutorials', "updatedAt" = NOW() WHERE category = 'Education';
