-- Fix RLS policies to allow users to insert their own records
-- Run this in Supabase SQL Editor

-- Allow users to insert their own user record
CREATE POLICY "Users can insert own record" ON "user"
  FOR INSERT WITH CHECK (auth.uid() = id);

-- If the policy already exists, you can drop and recreate it:
-- DROP POLICY IF EXISTS "Users can insert own record" ON "user";
-- CREATE POLICY "Users can insert own record" ON "user"
--   FOR INSERT WITH CHECK (auth.uid() = id);

