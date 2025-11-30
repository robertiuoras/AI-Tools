# Supabase Migration Guide

## What Changed

We've migrated from direct Prisma database connections to Supabase's REST API. This fixes the connection issues with Vercel.

## Environment Variables

Add these to your `.env` file and Vercel:

```env
NEXT_PUBLIC_SUPABASE_URL=https://zocojjlmjhaegmluqnpu.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpvY29qamxtamhhZWdtbHVxbnB1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ0NDgxMzUsImV4cCI6MjA4MDAyNDEzNX0.oV-QrNpkvjxiF4cUIsnYFbD-CySNDlTtGDuGh3CjEj0
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpvY29qamxtamhhZWdtbHVxbnB1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NDQ0ODEzNSwiZXhwIjoyMDgwMDI0MTM1fQ.E-VJ0fzYlLIRXUCyLjExIHHw8FSE4KUycKjM6Hby_jk
```

## Table Name

**Important:** Supabase table names are case-sensitive. The code uses lowercase `'tool'`.

If your table is named `Tool` (capital T), you'll need to either:
1. Rename the table in Supabase to `tool` (lowercase), OR
2. Update all `.from('tool')` calls to `.from('Tool')` in the API routes

## Verify Table Exists

1. Go to Supabase Dashboard → Table Editor
2. Check if you have a `tool` or `Tool` table
3. If it doesn't exist, create it with this SQL:

```sql
CREATE TABLE tool (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  url TEXT NOT NULL,
  "logoUrl" TEXT,
  category TEXT NOT NULL,
  tags TEXT,
  traffic TEXT,
  revenue TEXT,
  rating REAL,
  "estimatedVisits" INTEGER,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_tool_category ON tool(category);
CREATE INDEX idx_tool_traffic ON tool(traffic);
CREATE INDEX idx_tool_revenue ON tool(revenue);
```

## Testing

After deploying:
1. Visit `/api/diagnose` - should show Supabase connection working
2. Visit `/admin` - should load and allow adding tools
3. Visit `/` - should display tools

## Benefits

- ✅ Works with Vercel serverless functions
- ✅ No direct database connection needed
- ✅ Better for serverless environments
- ✅ Automatic connection pooling
- ✅ Built-in security (RLS)

