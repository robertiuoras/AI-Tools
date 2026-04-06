-- Upvote System Migration
-- Run this in your Supabase SQL Editor to update the upvote system

-- 1. Add timestamp fields to upvote table for daily/monthly resets
ALTER TABLE "upvote" 
ADD COLUMN IF NOT EXISTS "upvotedAt" TIMESTAMPTZ DEFAULT NOW() NOT NULL,
ADD COLUMN IF NOT EXISTS "monthlyResetDate" DATE DEFAULT CURRENT_DATE NOT NULL;

-- Remove the unique constraint on (userId, toolId) since users can upvote the same tool daily
-- We'll enforce uniqueness per day in application logic
ALTER TABLE "upvote" DROP CONSTRAINT IF EXISTS "upvote_userId_toolId_key";

-- Create index for efficient queries
CREATE INDEX IF NOT EXISTS "upvote_upvotedAt_idx" ON "upvote"("upvotedAt");
CREATE INDEX IF NOT EXISTS "upvote_monthlyResetDate_idx" ON "upvote"("monthlyResetDate");
CREATE INDEX IF NOT EXISTS "upvote_userId_upvotedAt_idx" ON "upvote"("userId", "upvotedAt");

-- 2. Function to check if user can upvote (3 per day limit)
CREATE OR REPLACE FUNCTION can_user_upvote(user_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  upvote_count INTEGER;
BEGIN
  -- Count upvotes from today
  SELECT COUNT(*) INTO upvote_count
  FROM "upvote"
  WHERE "userId" = user_id
    AND DATE("upvotedAt") = CURRENT_DATE;
  
  RETURN upvote_count < 3;
END;
$$ LANGUAGE plpgsql;

-- 3. Function to reset daily upvotes (runs automatically)
CREATE OR REPLACE FUNCTION reset_daily_upvotes()
RETURNS void AS $$
BEGIN
  -- This function is called to check/reset upvotes
  -- Daily reset is handled by checking DATE(upvotedAt) = CURRENT_DATE
  -- No action needed as we check dates dynamically
  NULL;
END;
$$ LANGUAGE plpgsql;

-- 4. Function to reset monthly upvotes
CREATE OR REPLACE FUNCTION reset_monthly_upvotes()
RETURNS void AS $$
DECLARE
  current_month_start DATE;
BEGIN
  -- Get first day of current month
  current_month_start := DATE_TRUNC('month', CURRENT_DATE)::DATE;
  
  -- Delete all upvotes from previous months
  DELETE FROM "upvote"
  WHERE "monthlyResetDate" < current_month_start;
  
  -- Update remaining upvotes to current month
  UPDATE "upvote"
  SET "monthlyResetDate" = current_month_start
  WHERE "monthlyResetDate" < current_month_start;
END;
$$ LANGUAGE plpgsql;

-- 5. Create a scheduled job to reset monthly upvotes (if using pg_cron extension)
-- Note: This requires pg_cron extension to be enabled in Supabase
-- You can also call this manually or via a cron job
-- COMMENT ON FUNCTION reset_monthly_upvotes() IS 'Resets all upvotes at the start of each month';

-- 6. Update existing upvotes to have timestamps
UPDATE "upvote"
SET "upvotedAt" = COALESCE("createdAt", NOW()),
    "monthlyResetDate" = DATE_TRUNC('month', COALESCE("createdAt", NOW()))::DATE
WHERE "upvotedAt" IS NULL OR "monthlyResetDate" IS NULL;

