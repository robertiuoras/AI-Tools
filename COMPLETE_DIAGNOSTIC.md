# Complete Database Connection Diagnostic

## Step 1: Run Diagnostic Endpoint

After deploying, visit:
```
https://your-site.vercel.app/api/diagnose
```

This will show you **exactly** what's wrong:
- ✅ If DATABASE_URL is set
- ✅ If the URL format is correct
- ✅ If SSL mode is present
- ✅ If connection succeeds or fails
- ✅ The exact error message

**Share the response** from this endpoint so I can see what's happening.

## Step 2: Check Supabase Project Status

1. Go to [Supabase Dashboard](https://app.supabase.com)
2. **Look at your project card** - what does it say?
   - "Active" ✅
   - "Paused" ❌ → Click "Resume"
   - "Inactive" ❌ → Click "Restore"
   - Shows a warning/error?

3. **Check project settings:**
   - Settings → General
   - Look for any warnings or errors
   - Check project status

## Step 3: Verify Connection String in Supabase

1. Supabase Dashboard → Settings → Database
2. Scroll to **"Connection string"** section
3. Click **"URI"** tab
4. **Copy the EXACT connection string** shown
5. It should include `?sslmode=require` at the end
6. Compare it with what's in Vercel

## Step 4: Check Supabase Network Settings

1. Supabase Dashboard → Settings → Database
2. Look for:
   - **"Network Restrictions"**
   - **"IP Allowlist"**
   - **"Connection Pooling"** → **"Network Restrictions"**
3. Make sure:
   - ✅ **"Allow connections from anywhere"** is enabled
   - ✅ No IP restrictions blocking Vercel
   - ✅ Connection pooling allows external connections

## Step 5: Try Connection Pooling (If Available)

Some Supabase projects have connection pooling:

1. Supabase Dashboard → Settings → Database
2. Scroll to **"Connection Pooling"** section
3. If you see connection strings there, try using one
4. They might work better with Vercel

## Step 6: Test from Different Location

The issue might be that Vercel's servers can't reach Supabase. Try:

1. **Check Supabase status page:**
   - [status.supabase.com](https://status.supabase.com)
   - See if there are any outages

2. **Check if it's a regional issue:**
   - Vercel might be in a region Supabase blocks
   - Or network routing issue

## Step 7: Alternative - Use Supabase Client

If direct Prisma connection doesn't work, we could:
1. Use Supabase JS client instead
2. Or use Supabase REST API
3. This bypasses direct database connection

## What to Share

After running `/api/diagnose`, share:
1. **The full JSON response** from the endpoint
2. **Supabase project status** (Active/Paused/Inactive)
3. **Any warnings** in Supabase dashboard
4. **Connection string format** you see in Supabase (first 50 chars)

This will help identify the exact issue.

