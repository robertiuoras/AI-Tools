# Complete Reset and Fix Guide

Let's reset everything and fix the database connection properly.

## Step 1: Check Supabase Project Status

1. Go to [Supabase Dashboard](https://app.supabase.com)
2. Check if your project shows:
   - ✅ **Active** - Good, continue
   - ⏸️ **Paused** - Click "Resume" and wait 2 minutes
   - ❌ **Inactive** - Click "Restore" and wait 2 minutes

## Step 2: Get Fresh Connection String

1. In Supabase Dashboard → Your Project
2. Go to **Settings** → **Database**
3. Scroll to **"Connection string"** section
4. Click the **"URI"** tab
5. Copy the connection string
6. It should look like:
   ```
   postgresql://postgres:[YOUR-PASSWORD]@db.zocojjlmjhaegmluqnpu.supabase.co:5432/postgres
   ```

7. **Get your password:**
   - Same page, **"Database password"** section
   - If you don't know it, click **"Reset database password"**
   - Copy the password immediately (shown only once!)

8. **Build your connection string:**
   ```
   postgresql://postgres:YOUR-PASSWORD@db.zocojjlmjhaegmluqnpu.supabase.co:5432/postgres?sslmode=require
   ```
   Replace `YOUR-PASSWORD` with the actual password

## Step 3: Clean Database (Optional - if you want fresh start)

**⚠️ This will delete all your data!**

1. Go to Supabase Dashboard → **SQL Editor**
2. Run this to drop the table:
   ```sql
   DROP TABLE IF EXISTS "Tool" CASCADE;
   ```
3. Click **Run**

## Step 4: Update Vercel Environment Variable

1. Go to [Vercel Dashboard](https://vercel.com/dashboard)
2. Your Project → **Settings** → **Environment Variables**
3. Find `DATABASE_URL`
4. Click to **edit** it
5. **Delete the old value completely**
6. **Paste the new connection string** (from Step 2)
7. Make sure:
   - ✅ No quotes around it
   - ✅ No extra spaces
   - ✅ Has `?sslmode=require` at end
8. Check all 3 environments:
   - ✅ Production
   - ✅ Preview
   - ✅ Development
9. Click **Save**

## Step 5: Reset Local Database

On your local machine:

```bash
# Delete local database
rm -f prisma/dev.db prisma/dev.db-journal

# Regenerate Prisma Client
npm run db:generate

# Push schema to Supabase (creates tables)
npm run db:push
```

## Step 6: Redeploy on Vercel

1. Go to Vercel → **Deployments**
2. Click **three dots** (⋯) on latest deployment
3. Click **Redeploy**
4. Wait for build to complete

## Step 7: Test

1. Visit your deployed site
2. Go to `/admin`
3. Try adding a tool
4. Should work! ✅

## If Still Not Working

### Check Vercel Logs

1. Vercel Dashboard → Your Project → **Logs**
2. Look for:
   - "🔌 Database connection:" - shows what URL is being used
   - Any connection errors
   - "DATABASE_URL environment variable is not set"

### Test Connection Locally

```bash
# Test if connection works
psql "postgresql://postgres:YOUR-PASSWORD@db.zocojjlmjhaegmluqnpu.supabase.co:5432/postgres?sslmode=require"
```

If this fails, the connection string is wrong.

### Verify in Supabase

1. Supabase Dashboard → **Table Editor**
2. Check if `Tool` table exists
3. If not, run `npm run db:push` again

## Quick Test Script

Create a test file to verify connection:

```bash
# Test database connection
node -e "
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.tool.findMany().then(() => {
  console.log('✅ Connection works!');
  process.exit(0);
}).catch(err => {
  console.error('❌ Connection failed:', err.message);
  process.exit(1);
});
"
```

