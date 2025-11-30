# Troubleshooting Vercel Database Connection

## You Have DATABASE_URL Set, But Still Getting Errors?

### Step 1: Verify Environment Variable Settings

In Vercel Dashboard → Settings → Environment Variables:

1. **Check which environments it's set for:**

   - ✅ Production
   - ✅ Preview
   - ✅ Development

   **All three should be checked!** If not, edit the variable and select all.

2. **Verify the value is correct:**
   - Should be: `postgresql://postgres:ae5ZIDkYGgZVSWJQ@db.zocojjlmjhaegmluqnpu.supabase.co:5432/postgres?sslmode=require`
   - No extra spaces
   - No quotes around it
   - Has `?sslmode=require` at the end

### Step 2: Redeploy (IMPORTANT!)

**Environment variables are only loaded on deployment!**

1. Go to **Deployments** tab
2. Find your latest deployment
3. Click the **three dots** (⋯) menu
4. Click **Redeploy**
5. Wait for build to complete

**OR** push a new commit:

```bash
git commit --allow-empty -m "Trigger redeploy"
git push
```

### Step 3: Check Supabase Settings

1. **Go to Supabase Dashboard:**

   - [app.supabase.com](https://app.supabase.com)
   - Select your project

2. **Check Database Settings:**

   - Settings → Database
   - Make sure **"Allow connections from anywhere"** is enabled
   - Or check **"Connection Pooling"** settings

3. **Check if project is paused:**

   - Free tier projects can pause after inactivity
   - If paused, click "Resume" or "Restore"

4. **Check IP Restrictions:**
   - Settings → Database → Connection Pooling
   - Make sure Vercel IPs aren't blocked

### Step 4: Test Connection String

Try connecting from your local machine:

```bash
# Test if connection string works
psql "postgresql://postgres:ae5ZIDkYGgZVSWJQ@db.zocojjlmjhaegmluqnpu.supabase.co:5432/postgres?sslmode=require"
```

If this fails locally, the connection string might be wrong.

### Step 5: Check Vercel Logs

1. Go to Vercel Dashboard → Your Project
2. Click **Logs** tab
3. Look for recent errors
4. Check if `DATABASE_URL` is being read

You should see logs like:

```
Environment variables loaded from .env
Prisma schema loaded from prisma/schema.prisma
```

### Step 6: Verify in Build Logs

During build, check if you see:

```
✔ Generated Prisma Client
```

If you see database connection errors during build, the variable might not be set correctly.

## Common Issues

### Issue: "Can't reach database server"

**Possible causes:**

1. ✅ Environment variable not set for all environments
2. ✅ Need to redeploy after adding variable
3. ✅ Supabase project is paused
4. ✅ IP restrictions blocking Vercel
5. ✅ Connection string has typo

### Issue: "Authentication failed"

**Possible causes:**

1. Wrong password in connection string
2. Password was reset in Supabase
3. Connection string has extra characters

### Issue: "SSL required"

**Possible causes:**

1. Missing `?sslmode=require` at end of connection string
2. Supabase requires SSL for all connections

## Quick Checklist

- [ ] DATABASE_URL set in Vercel
- [ ] Set for all 3 environments (Production, Preview, Development)
- [ ] Connection string has `?sslmode=require` at end
- [ ] Redeployed after adding variable
- [ ] Supabase project is active (not paused)
- [ ] No IP restrictions blocking Vercel
- [ ] Connection string has correct password

## Still Not Working?

1. **Double-check the connection string:**

   - Go to Supabase → Settings → Database
   - Copy the connection string again
   - Make sure password matches

2. **Try connection pooling:**

   - In Supabase, go to Settings → Database → Connection Pooling
   - Use the pooled connection string instead
   - Format: `postgresql://postgres.xxx:6543/postgres?sslmode=require`

3. **Check Vercel Function Logs:**

   - Vercel Dashboard → Your Project → Functions
   - Look for runtime errors
   - Check if DATABASE_URL is accessible

4. **Test with a simple query:**
   - Add a test endpoint to verify connection
   - Or check Prisma Studio connection
