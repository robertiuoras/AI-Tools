# Fix Vercel Database Connection - Step by Step

✅ **Good news:** Your database connection works locally! The issue is Vercel configuration.

## The Problem

Vercel can't read `DATABASE_URL` correctly. Here's how to fix it:

## Step-by-Step Fix

### Step 1: Delete and Re-add DATABASE_URL in Vercel

1. Go to [Vercel Dashboard](https://vercel.com/dashboard)
2. Click your **AI Tools** project
3. Go to **Settings** → **Environment Variables**
4. Find `DATABASE_URL`
5. Click the **trash icon** to **DELETE** it
6. Confirm deletion

### Step 2: Add It Back Correctly

1. Click **"Add New"** button
2. **Key:** `DATABASE_URL`
3. **Value:** Copy this EXACTLY (no quotes, no spaces):
   ```
   postgresql://postgres:ae5ZIDkYGgZVSWJQ@db.zocojjlmjhaegmluqnpu.supabase.co:5432/postgres?sslmode=require
   ```
4. **Environment:** Check ALL THREE:
   - ✅ Production
   - ✅ Preview
   - ✅ Development
5. Click **Save**

### Step 3: Verify It's Set

1. You should see `DATABASE_URL` in the list
2. Click on it to view
3. Make sure:
   - No quotes visible
   - Starts with `postgresql://`
   - Has `?sslmode=require` at end

### Step 4: Redeploy (CRITICAL!)

**Environment variables only load on NEW deployments!**

1. Go to **Deployments** tab
2. Click **three dots** (⋯) on the latest deployment
3. Click **Redeploy**
4. **OR** push an empty commit:
   ```bash
   git commit --allow-empty -m "Redeploy with DATABASE_URL"
   git push
   ```

### Step 5: Test

1. Wait for deployment to complete
2. Visit your deployed site
3. Go to `/admin`
4. Try adding a tool
5. Should work! ✅

## Why This Works

- Deleting and re-adding ensures no hidden characters
- Setting for all environments ensures it works everywhere
- Redeploying loads the new environment variable

## If Still Not Working

### Check Vercel Logs

1. Vercel Dashboard → Your Project → **Logs**
2. Look for:
   - `🔌 Database connection:` - shows what URL Vercel is using
   - `❌ DATABASE_URL environment variable is not set` - means it's not set
   - Connection errors - means it's set but wrong

### Verify in Function Logs

1. Vercel Dashboard → Your Project → **Functions**
2. Click on a function execution
3. Check the logs for database connection info

## Alternative: Use Vercel CLI

If the UI isn't working, use CLI:

```bash
# Install Vercel CLI
npm i -g vercel

# Login
vercel login

# Link project
vercel link

# Set environment variable
vercel env add DATABASE_URL production
# Paste: postgresql://postgres:ae5ZIDkYGgZVSWJQ@db.zocojjlmjhaegmluqnpu.supabase.co:5432/postgres?sslmode=require

# Repeat for preview and development
vercel env add DATABASE_URL preview
vercel env add DATABASE_URL development
```

## Quick Checklist

- [ ] Deleted old `DATABASE_URL` in Vercel
- [ ] Added new `DATABASE_URL` with correct value
- [ ] Set for all 3 environments
- [ ] No quotes in value
- [ ] Redeployed after setting
- [ ] Checked Vercel logs for connection info
