-- Service / implementation firm flag (separate from category chips; does not use a category slot).
-- Run in Supabase SQL Editor after backup.

ALTER TABLE tool
  ADD COLUMN IF NOT EXISTS "isAgency" BOOLEAN DEFAULT false NOT NULL;

-- Backfill from legacy category + categories JSON array
UPDATE tool
SET "isAgency" = true
WHERE category = 'Agencies'
   OR (
     categories IS NOT NULL
     AND (
       categories::text ILIKE '%"Agencies"%'
       OR categories::text ILIKE '%Agencies%'
     )
   );

COMMENT ON COLUMN tool."isAgency" IS 'True when the vendor is a services or implementation firm (orange ribbon); not stored in categories[]';
