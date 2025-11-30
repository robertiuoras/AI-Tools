# Supabase Network Connection Fix

## The Problem
Your diagnostic shows:
- ✅ Connection string is correct
- ✅ SSL mode is present
- ❌ **"Can't reach database server"**

This means Vercel's servers **cannot connect** to your Supabase database. This is a **network/firewall issue**.

## Solution 1: Use Connection Pooling (RECOMMENDED)

Supabase has a **connection pooler** that works better with serverless functions:

### Step 1: Get Pooled Connection String

1. Go to **Supabase Dashboard** → Your Project
2. **Settings** → **Database**
3. Scroll to **"Connection Pooling"** section
4. You'll see connection strings with different modes:
   - **Transaction Mode** (port 6543) - Best for serverless
   - **Session Mode** (port 5432) - Standard

### Step 2: Use Transaction Mode (Port 6543)

The connection string will look like:
```
postgresql://postgres.zocojjlmjhaegmluqnpu:[YOUR-PASSWORD]@aws-0-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require
```

**Key differences:**
- Different hostname (ends with `.pooler.supabase.com`)
- Port **6543** (not 5432)
- Username format: `postgres.[PROJECT-REF]`

### Step 3: Update Vercel

1. Copy the **Transaction Mode** connection string
2. Add `?sslmode=require` if not present
3. Update `DATABASE_URL` in Vercel
4. Redeploy

## Solution 2: Check Network Restrictions

1. **Supabase Dashboard** → **Settings** → **Database**
2. Look for **"Network Restrictions"** or **"IP Allowlist"**
3. Make sure:
   - ✅ **"Allow connections from anywhere"** is enabled
   - ✅ No IP restrictions
   - ✅ Connection pooling allows external connections

## Solution 3: Check Supabase Project Region

1. **Supabase Dashboard** → **Settings** → **General**
2. Check your project's **region**
3. If it's in a restricted region, this might cause issues
4. Consider creating a new project in a different region

## Solution 4: Use Supabase JS Client (Workaround)

If direct connection doesn't work, we can use Supabase's REST API:

1. **Get API keys:**
   - Settings → API
   - Copy "Project URL" and "anon key"

2. **Use Supabase JS client** instead of Prisma
   - This bypasses direct database connection
   - Works through Supabase's API
   - More reliable for serverless

## Immediate Action

**Try Solution 1 first** (Connection Pooling):
1. Get the **Transaction Mode** connection string from Supabase
2. Update `DATABASE_URL` in Vercel
3. Redeploy
4. Test `/api/diagnose` again

This usually fixes the "Can't reach database server" error!

