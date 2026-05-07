-- Add isFeatured flag to pin tools to the top of the directory.
ALTER TABLE tool ADD COLUMN IF NOT EXISTS "isFeatured" boolean DEFAULT false;
CREATE INDEX IF NOT EXISTS tool_is_featured_idx ON tool ("isFeatured") WHERE "isFeatured" = true;
