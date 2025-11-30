# Supabase Setup Guide

Follow these steps to connect your Supabase database to your Next.js application using Supabase's REST API.

## Step 1: Get Your Supabase API Keys

1. Go to your [Supabase Dashboard](https://app.supabase.com)
2. Select your project
3. In the left sidebar, click **Settings** (⚙️ gear icon)
4. Click **API** (under "Project Settings")
5. You'll see:
   - **Project URL** - Copy this (e.g., `https://xxxxx.supabase.co`)
   - **anon public** key - Copy this (starts with `eyJ...`)
   - **service_role** key - Copy this (starts with `eyJ...`) - **Keep this secret!**

## Step 2: Set Up Environment Variables

### For Local Development:

1. Create or update your `.env` file in the project root:

   ```env
   NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
   SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
   OPENAI_API_KEY=your-openai-key-here
   ```

2. **Never commit this file!** It should already be in `.gitignore`

### For Vercel Deployment:

1. Go to your [Vercel Dashboard](https://vercel.com/dashboard)
2. Select your project
3. Go to **Settings** → **Environment Variables**
4. Click **Add New** and add each variable:

   - **Name:** `NEXT_PUBLIC_SUPABASE_URL`
   - **Value:** Your Supabase project URL
   - **Environment:** All (Production, Preview, Development)

   - **Name:** `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - **Value:** Your anon public key
   - **Environment:** All

   - **Name:** `SUPABASE_SERVICE_ROLE_KEY`
   - **Value:** Your service role key (keep this secret!)
   - **Environment:** All

   - **Name:** `OPENAI_API_KEY` (optional, for AI features)
   - **Value:** Your OpenAI API key
   - **Environment:** All

5. Click **Save** after each variable

## Step 3: Set Up the Database Schema

Create the `tool` table in your Supabase database. Go to **SQL Editor** in Supabase and run:

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

**Note:** Table name must be lowercase `tool` (not `Tool`).

## Step 4: Verify the Connection

1. Start your development server:

   ```bash
   npm run dev
   ```

2. Go to `http://localhost:3000/admin`
3. Try adding a tool - if it works, your connection is successful!

## Step 5: Test in Production

After deploying to Vercel:

1. The build should complete successfully
2. Visit your deployed site
3. Go to the admin page and add a tool
4. Check that tools appear on the main page

## Troubleshooting

### "Connection refused" or "Connection timeout"

- Check that your Supabase project is active (not paused)
- Verify the connection string is correct
- Make sure you added `?sslmode=require` at the end

### "Authentication failed"

- Double-check your database password
- Reset the password in Supabase if needed
- Make sure there are no extra spaces in the connection string

### "Relation does not exist"

- Run `npm run db:push` again to create the tables
- Check Supabase dashboard → **Table Editor** to see if the `Tool` table exists

### "SSL required"

- Make sure `?sslmode=require` is at the end of your connection string
- Supabase requires SSL connections

## Viewing Your Data

You can view your data in the Supabase Dashboard:

- Go to **Table Editor** in your Supabase dashboard
- You'll see the `tool` table with all your data
- You can edit, add, or delete records directly from the dashboard

## Security Notes

- **Never commit your `.env` file** - it's already in `.gitignore`
- **Never commit API keys** to GitHub
- The `service_role` key has full database access - keep it secret!
- The `anon` key is safe to expose in client-side code (it respects Row Level Security)
- Use environment variables for all secrets
