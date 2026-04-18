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

-- 11. Create Favorites table
CREATE TABLE IF NOT EXISTS "favorite" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  "toolId" TEXT NOT NULL REFERENCES "tool"(id) ON DELETE CASCADE,
  "createdAt" TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE("userId", "toolId")
);

-- Create indexes for Favorites table
CREATE INDEX IF NOT EXISTS "favorite_toolId_idx" ON "favorite"("toolId");
CREATE INDEX IF NOT EXISTS "favorite_userId_idx" ON "favorite"("userId");

-- 12. Enable RLS on Favorites table
ALTER TABLE "favorite" ENABLE ROW LEVEL SECURITY;

-- 13. Create RLS policies for Favorites table
-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Anyone can read favorites" ON "favorite";
DROP POLICY IF EXISTS "Users can create own favorites" ON "favorite";
DROP POLICY IF EXISTS "Users can delete own favorites" ON "favorite";

-- Anyone can read favorites
CREATE POLICY "Anyone can read favorites" ON "favorite"
  FOR SELECT USING (true);

-- Users can create their own favorites
CREATE POLICY "Users can create own favorites" ON "favorite"
  FOR INSERT WITH CHECK (auth.uid() = "userId");

-- Users can delete their own favorites
CREATE POLICY "Users can delete own favorites" ON "favorite"
  FOR DELETE USING (auth.uid() = "userId");

-- 14. Create Video table for /videos page
CREATE TABLE IF NOT EXISTS "video" (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  category TEXT NOT NULL,
  "youtuberName" TEXT,
  "subscriberCount" BIGINT,
  tags TEXT,
  description TEXT,
  "createdAt" TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  "updatedAt" TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Enable RLS on Video table (read-only for public)
ALTER TABLE "video" ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Anyone can read videos" ON "video";

-- Anyone can read videos
CREATE POLICY "Anyone can read videos" ON "video"
  FOR SELECT USING (true);

-- Reuse updatedAt trigger for video table
DROP TRIGGER IF EXISTS update_video_updated_at ON "video";

CREATE TRIGGER update_video_updated_at BEFORE UPDATE ON "video"
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Note: Make sure your Tool table has the correct structure
-- It should have: id, name, description, url, logoUrl, category, tags, traffic, revenue, rating, estimatedVisits, createdAt, updatedAt

-- 15. Notes feature tables
CREATE TABLE IF NOT EXISTS "note_page" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  favorite BOOLEAN DEFAULT false NOT NULL,
  "createdAt" TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  "updatedAt" TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS "note" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  "pageId" UUID NOT NULL REFERENCES "note_page"(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT DEFAULT '' NOT NULL,
  favorite BOOLEAN DEFAULT false NOT NULL,
  "createdAt" TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  "updatedAt" TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS "note_page_userId_idx" ON "note_page"("userId");
CREATE INDEX IF NOT EXISTS "note_page_favorite_idx" ON "note_page"(favorite);
CREATE INDEX IF NOT EXISTS "note_userId_idx" ON "note"("userId");
CREATE INDEX IF NOT EXISTS "note_pageId_idx" ON "note"("pageId");
CREATE INDEX IF NOT EXISTS "note_favorite_idx" ON "note"(favorite);

ALTER TABLE "note_page" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "note" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own note pages" ON "note_page";
DROP POLICY IF EXISTS "Users can insert own note pages" ON "note_page";
DROP POLICY IF EXISTS "Users can update own note pages" ON "note_page";
DROP POLICY IF EXISTS "Users can delete own note pages" ON "note_page";

CREATE POLICY "Users can read own note pages" ON "note_page"
  FOR SELECT USING (auth.uid() = "userId");
CREATE POLICY "Users can insert own note pages" ON "note_page"
  FOR INSERT WITH CHECK (auth.uid() = "userId");
CREATE POLICY "Users can update own note pages" ON "note_page"
  FOR UPDATE USING (auth.uid() = "userId")
  WITH CHECK (auth.uid() = "userId");
CREATE POLICY "Users can delete own note pages" ON "note_page"
  FOR DELETE USING (auth.uid() = "userId");

DROP POLICY IF EXISTS "Users can read own notes" ON "note";
DROP POLICY IF EXISTS "Users can insert own notes" ON "note";
DROP POLICY IF EXISTS "Users can update own notes" ON "note";
DROP POLICY IF EXISTS "Users can delete own notes" ON "note";

CREATE POLICY "Users can read own notes" ON "note"
  FOR SELECT USING (auth.uid() = "userId");
CREATE POLICY "Users can insert own notes" ON "note"
  FOR INSERT WITH CHECK (auth.uid() = "userId");
CREATE POLICY "Users can update own notes" ON "note"
  FOR UPDATE USING (auth.uid() = "userId")
  WITH CHECK (auth.uid() = "userId");
CREATE POLICY "Users can delete own notes" ON "note"
  FOR DELETE USING (auth.uid() = "userId");

DROP TRIGGER IF EXISTS update_note_page_updated_at ON "note_page";
DROP TRIGGER IF EXISTS update_note_updated_at ON "note";

CREATE TRIGGER update_note_page_updated_at BEFORE UPDATE ON "note_page"
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_note_updated_at BEFORE UPDATE ON "note"
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 16. Note sharing (Google-Docs-style: share a note with another user by email)
CREATE TABLE IF NOT EXISTS "note_share" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "noteId" UUID NOT NULL REFERENCES "note"(id) ON DELETE CASCADE,
  "ownerId" UUID NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  "sharedWithId" UUID NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  permission TEXT NOT NULL DEFAULT 'view' CHECK (permission IN ('view', 'edit')),
  "createdAt" TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  "updatedAt" TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE ("noteId", "sharedWithId")
);

CREATE INDEX IF NOT EXISTS "note_share_noteId_idx" ON "note_share"("noteId");
CREATE INDEX IF NOT EXISTS "note_share_sharedWithId_idx" ON "note_share"("sharedWithId");
CREATE INDEX IF NOT EXISTS "note_share_ownerId_idx" ON "note_share"("ownerId");

ALTER TABLE "note_share" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owner or recipient can read share" ON "note_share";
DROP POLICY IF EXISTS "Owner can insert share" ON "note_share";
DROP POLICY IF EXISTS "Owner can update share" ON "note_share";
DROP POLICY IF EXISTS "Owner can delete share" ON "note_share";

CREATE POLICY "Owner or recipient can read share" ON "note_share"
  FOR SELECT USING (auth.uid() = "ownerId" OR auth.uid() = "sharedWithId");
CREATE POLICY "Owner can insert share" ON "note_share"
  FOR INSERT WITH CHECK (auth.uid() = "ownerId");
CREATE POLICY "Owner can update share" ON "note_share"
  FOR UPDATE USING (auth.uid() = "ownerId")
  WITH CHECK (auth.uid() = "ownerId");
CREATE POLICY "Owner can delete share" ON "note_share"
  FOR DELETE USING (auth.uid() = "ownerId");

DROP TRIGGER IF EXISTS update_note_share_updated_at ON "note_share";
CREATE TRIGGER update_note_share_updated_at BEFORE UPDATE ON "note_share"
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Extend RLS so recipients can also read/update notes they have access to
DROP POLICY IF EXISTS "Recipients can read shared notes" ON "note";
DROP POLICY IF EXISTS "Recipients can update shared notes when they have edit" ON "note";

CREATE POLICY "Recipients can read shared notes" ON "note"
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM "note_share" ns
      WHERE ns."noteId" = "note".id AND ns."sharedWithId" = auth.uid()
    )
  );

CREATE POLICY "Recipients can update shared notes when they have edit" ON "note"
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM "note_share" ns
      WHERE ns."noteId" = "note".id
        AND ns."sharedWithId" = auth.uid()
        AND ns.permission = 'edit'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "note_share" ns
      WHERE ns."noteId" = "note".id
        AND ns."sharedWithId" = auth.uid()
        AND ns.permission = 'edit'
    )
  );

