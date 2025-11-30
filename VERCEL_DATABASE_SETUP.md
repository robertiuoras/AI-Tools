# Fix: Database Connection Error on Vercel

## The Problem

You're seeing this error:
```
Can't reach database server at `db.zocojjlmjhaegmluqnpu.supabase.co:5432`
```

This means Vercel doesn't have your `DATABASE_URL` environment variable set.

## Quick Fix (2 minutes)

### Step 1: Get Your Connection String

Your Supabase connection string should be:
```
postgresql://postgres:ae5ZIDkYGgZVSWJQ@db.zocojjlmjhaegmluqnpu.supabase.co:5432/postgres?sslmode=require
```

### Step 2: Add to Vercel

1. **Go to Vercel Dashboard:**
   - Visit [vercel.com/dashboard](https://vercel.com/dashboard)
   - Click on your **AI Tools** project

2. **Navigate to Settings:**
   - Click **Settings** in the top menu
   - Click **Environment Variables** in the left sidebar

3. **Add the Database URL:**
   - Click **Add New**
   - **Key:** `DATABASE_URL`
   - **Value:** `postgresql://postgres:ae5ZIDkYGgZVSWJQ@db.zocojjlmjhaegmluqnpu.supabase.co:5432/postgres?sslmode=require`
   - **Environment:** Select **all three** (Production, Preview, Development)
   - Click **Save**

4. **Redeploy:**
   - Go to **Deployments** tab
   - Click the **three dots** (⋯) on the latest deployment
   - Click **Redeploy**
   - Or push a new commit to trigger a redeploy

## Verify It's Working

After redeploying:
1. Wait for the build to complete
2. Visit your deployed site
3. Try adding a tool
4. It should work now! ✅

## Troubleshooting

### Still Not Working?

1. **Check Environment Variables:**
   - Make sure `DATABASE_URL` is set for **all environments**
   - Check for typos in the connection string

2. **Check Supabase:**
   - Go to Supabase Dashboard
   - Make sure your project is **active** (not paused)
   - Check that the database is running

3. **Check Connection String:**
   - Make sure it includes `?sslmode=require` at the end
   - Verify the password is correct
   - Make sure there are no extra spaces

4. **Check Vercel Logs:**
   - Go to Vercel Dashboard → Your Project → **Logs**
   - Look for database connection errors
   - Check if the environment variable is being read

### Connection String Format

Your connection string should look exactly like this:
```
postgresql://postgres:PASSWORD@db.PROJECT-REF.supabase.co:5432/postgres?sslmode=require
```

**Important:**
- Replace `PASSWORD` with your actual database password
- Replace `PROJECT-REF` with your project reference
- Keep `?sslmode=require` at the end (required for Supabase)

## Security Note

⚠️ **Never commit your `.env` file to Git!** It's already in `.gitignore`, but make sure your connection string with password is only in:
- Local `.env` file (not committed)
- Vercel Environment Variables (secure)

