-- Supabase Migration Script
-- Run this in your Supabase SQL Editor to create the required tables

-- 1. Create User table
CREATE TABLE IF NOT EXISTS "user" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  role TEXT DEFAULT 'user' NOT NULL CHECK (role IN ('user', 'admin')),
  "createdAt" TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  "updatedAt" TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Create indexes for User table
CREATE INDEX IF NOT EXISTS "user_email_idx" ON "user"(email);
CREATE INDEX IF NOT EXISTS "user_role_idx" ON "user"(role);

-- 2. Create Upvote table
CREATE TABLE IF NOT EXISTS "upvote" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  "toolId" TEXT NOT NULL REFERENCES "tool"(id) ON DELETE CASCADE,
  "createdAt" TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE("userId", "toolId")
);

-- Create indexes for Upvote table
CREATE INDEX IF NOT EXISTS "upvote_toolId_idx" ON "upvote"("toolId");
CREATE INDEX IF NOT EXISTS "upvote_userId_idx" ON "upvote"("userId");

-- 3. Create Comment table
CREATE TABLE IF NOT EXISTS "comment" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  "toolId" TEXT NOT NULL REFERENCES "tool"(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  "updatedAt" TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Create indexes for Comment table
CREATE INDEX IF NOT EXISTS "comment_toolId_idx" ON "comment"("toolId");
CREATE INDEX IF NOT EXISTS "comment_userId_idx" ON "comment"("userId");

-- 4. Add foreign key constraints to Tool table (if they don't exist)
-- Note: These are handled by the upvote and comment tables above

-- 5. Enable Row Level Security (RLS) on all tables
ALTER TABLE "user" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "upvote" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "comment" ENABLE ROW LEVEL SECURITY;

-- 6. Create RLS policies for User table
-- Drop existing policies if they exist (to allow re-running this script)
DROP POLICY IF EXISTS "Users can read own data" ON "user";
DROP POLICY IF EXISTS "Users can insert own record" ON "user";
DROP POLICY IF EXISTS "Users can update own data" ON "user";

-- Users can read their own data
CREATE POLICY "Users can read own data" ON "user"
  FOR SELECT USING (auth.uid() = id);

-- Users can insert their own record
CREATE POLICY "Users can insert own record" ON "user"
  FOR INSERT WITH CHECK (auth.uid() = id);

-- Users can update their own data (except role)
CREATE POLICY "Users can update own data" ON "user"
  FOR UPDATE USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id AND role = (SELECT role FROM "user" WHERE id = auth.uid()));

-- 7. Create RLS policies for Upvote table
-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Anyone can read upvotes" ON "upvote";
DROP POLICY IF EXISTS "Users can create own upvotes" ON "upvote";
DROP POLICY IF EXISTS "Users can delete own upvotes" ON "upvote";

-- Anyone can read upvotes
CREATE POLICY "Anyone can read upvotes" ON "upvote"
  FOR SELECT USING (true);

-- Users can create their own upvotes
CREATE POLICY "Users can create own upvotes" ON "upvote"
  FOR INSERT WITH CHECK (auth.uid() = "userId");

-- Users can delete their own upvotes
CREATE POLICY "Users can delete own upvotes" ON "upvote"
  FOR DELETE USING (auth.uid() = "userId");

-- 8. Create RLS policies for Comment table
-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Anyone can read comments" ON "comment";
DROP POLICY IF EXISTS "Users can create own comments" ON "comment";
DROP POLICY IF EXISTS "Users can update own comments" ON "comment";
DROP POLICY IF EXISTS "Users can delete own comments" ON "comment";

-- Anyone can read comments
CREATE POLICY "Anyone can read comments" ON "comment"
  FOR SELECT USING (true);

-- Users can create their own comments
CREATE POLICY "Users can create own comments" ON "comment"
  FOR INSERT WITH CHECK (auth.uid() = "userId");

-- Users can update their own comments
CREATE POLICY "Users can update own comments" ON "comment"
  FOR UPDATE USING (auth.uid() = "userId")
  WITH CHECK (auth.uid() = "userId");

-- Users can delete their own comments
CREATE POLICY "Users can delete own comments" ON "comment"
  FOR DELETE USING (auth.uid() = "userId");

-- 9. Create function to automatically update updatedAt timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW."updatedAt" = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- 10. Create triggers to auto-update updatedAt
-- Drop existing triggers if they exist
DROP TRIGGER IF EXISTS update_user_updated_at ON "user";
DROP TRIGGER IF EXISTS update_comment_updated_at ON "comment";

CREATE TRIGGER update_user_updated_at BEFORE UPDATE ON "user"
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_comment_updated_at BEFORE UPDATE ON "comment"
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Note: Make sure your Tool table has the correct structure
-- It should have: id, name, description, url, logoUrl, category, tags, traffic, revenue, rating, estimatedVisits, createdAt, updatedAt

