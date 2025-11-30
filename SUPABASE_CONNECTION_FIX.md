# Fix: "Can't reach database server" Error

## The Problem

You're getting: "Can't reach database server at `db.zocojjlmjhaegmluqnpu.supabase.co:5432`"

But the table was created before, so the connection worked. This usually means:

1. **Supabase project is paused** (most common)
2. **Connection string changed**
3. **IP restrictions blocking Vercel**

## Quick Fixes

### Fix 1: Check if Supabase Project is Paused

1. Go to [Supabase Dashboard](https://app.supabase.com)
2. Check your project status
3. If you see "Paused" or "Inactive":
   - Click **"Resume"** or **"Restore"**
   - Wait a few minutes for it to restart
   - Try again

### Fix 2: Check Connection Pooling Settings

**Note:** Supabase now uses port 5432 for all connections (Session Mode was moved to 5432).

1. **Check Connection Pooling:**

   - Go to Supabase Dashboard → Your Project
   - Settings → Database
   - Scroll to **"Connection Pooling"** section
   - You should see connection strings there
   - The direct connection (port 5432) is what you need

2. **Your current connection string should work:**
   ```
   postgresql://postgres:ae5ZIDkYGgZVSWJQ@db.zocojjlmjhaegmluqnpu.supabase.co:5432/postgres?sslmode=require
   ```
   This is correct for both direct and session mode now.

### Fix 3: Verify Direct Connection String

If using direct connection (port 5432):

1. **Check Supabase Settings:**

   - Settings → Database
   - Make sure **"Allow connections from anywhere"** is enabled
   - Or check **"Network Restrictions"** aren't blocking Vercel

2. **Verify Connection String:**
   - Should be exactly:
     ```
     postgresql://postgres:ae5ZIDkYGgZVSWJQ@db.zocojjlmjhaegmluqnpu.supabase.co:5432/postgres?sslmode=require
     ```
   - No quotes
   - No extra spaces
   - Has `?sslmode=require`

### Fix 4: Check Database Password

1. **Reset if needed:**
   - Supabase Dashboard → Settings → Database
   - **"Database password"** section
   - Click **"Reset database password"**
   - Copy the new password
   - Update `DATABASE_URL` in Vercel with new password

## Why Connection Pooling is Better

**Direct Connection (port 5432):**

- ❌ Can hit connection limits
- ❌ Slower for serverless
- ❌ May timeout

**Connection Pooling (port 6543):**

- ✅ Better for serverless/Vercel
- ✅ Handles many connections
- ✅ More reliable
- ✅ Recommended by Supabase for serverless

## Step-by-Step: Switch to Connection Pooling

1. **Get Pooled Connection String:**

   ```
   Supabase Dashboard
   → Settings → Database
   → Connection Pooling section
   → Copy "Session" mode connection string
   ```

2. **Update Vercel:**

   ```
   Vercel Dashboard
   → Your Project → Settings → Environment Variables
   → Edit DATABASE_URL
   → Paste pooled connection string
   → Save
   ```

3. **Redeploy:**
   ```
   Deployments → Latest → ⋯ → Redeploy
   ```

## Test Connection

After updating, test by:

1. Visiting your deployed site
2. Going to `/admin`
3. Try adding a tool
4. Should work now! ✅

## Still Not Working?

1. **Check Supabase Logs:**

   - Supabase Dashboard → Logs
   - Look for connection errors

2. **Check Vercel Logs:**

   - Vercel Dashboard → Your Project → Logs
   - Look for database errors

3. **Verify Project Status:**

   - Make sure project is **Active** (not paused)
   - Free tier projects pause after 7 days of inactivity

4. **Try Direct Connection Test:**
   ```bash
   # Test if you can connect
   psql "postgresql://postgres:ae5ZIDkYGgZVSWJQ@db.zocojjlmjhaegmluqnpu.supabase.co:5432/postgres?sslmode=require"
   ```

## Most Likely Solution

**Use Connection Pooling!** It's designed for serverless functions like Vercel and is much more reliable.
