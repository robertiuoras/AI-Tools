-- Faster /api/tools: aggregate monthly upvotes/downvotes in one round-trip.
-- Run in Supabase SQL Editor (once). If missing, the API falls back to row-by-row counts.

CREATE OR REPLACE FUNCTION public.batch_monthly_vote_counts(
  p_tool_ids uuid[],
  p_month_start timestamptz
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'upvotes', COALESCE(
      (
        SELECT jsonb_object_agg("toolId"::text, cnt)
        FROM (
          SELECT "toolId", count(*)::int AS cnt
          FROM "upvote"
          WHERE "toolId" = ANY (p_tool_ids)
            AND "upvotedAt" >= p_month_start
          GROUP BY "toolId"
        ) sub
      ),
      '{}'::jsonb
    ),
    'downvotes', COALESCE(
      (
        SELECT jsonb_object_agg("toolId"::text, cnt)
        FROM (
          SELECT "toolId", count(*)::int AS cnt
          FROM "downvote"
          WHERE "toolId" = ANY (p_tool_ids)
            AND "downvotedAt" >= p_month_start
          GROUP BY "toolId"
        ) sub
      ),
      '{}'::jsonb
    )
  );
$$;

REVOKE ALL ON FUNCTION public.batch_monthly_vote_counts(uuid[], timestamptz) FROM PUBLIC;
-- Server uses service_role (supabaseAdmin); optional: also grant to postgres for SQL editor tests
GRANT EXECUTE ON FUNCTION public.batch_monthly_vote_counts(uuid[], timestamptz) TO service_role;
