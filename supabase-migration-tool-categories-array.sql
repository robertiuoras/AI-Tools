-- Multiple categories per tool (PostgreSQL text[]).
-- Run once in Supabase SQL Editor.

ALTER TABLE "tool" ADD COLUMN IF NOT EXISTS categories TEXT[];

UPDATE "tool"
SET categories = ARRAY[category]
WHERE categories IS NULL OR cardinality(categories) = 0;

CREATE INDEX IF NOT EXISTS tool_categories_gin ON "tool" USING GIN (categories);
