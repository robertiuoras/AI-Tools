# Correct Connection String

## The Issue

Your connection string is missing `?sslmode=require` at the end!

**Current (WRONG):**

```
postgresql://postgres:ae5ZIDkYGgZVSWJQ@db.zocojjlmjhaegmluqnpu.supabase.co:5432/postgres
```

**Correct (RIGHT):**

```
postgresql://postgres:ae5ZIDkYGgZVSWJQ@db.zocojjlmjhaegmluqnpu.supabase.co:5432/postgres?sslmode=require
```

## Why This Matters

Supabase **requires SSL connections**. Without `?sslmode=require`, the connection will fail with "Can't reach database server" error.

## Fix in Vercel

1. Go to [Vercel Dashboard](https://vercel.com/dashboard)
2. Your Project → **Settings** → **Environment Variables**
3. Click on `DATABASE_URL` to edit
4. **Replace the value with:**
   ```
   postgresql://postgres:ae5ZIDkYGgZVSWJQ@db.zocojjlmjhaegmluqnpu.supabase.co:5432/postgres?sslmode=require
   ```
5. **Important:** Make sure `?sslmode=require` is at the end!
6. Make sure all 3 environments are checked:
   - ✅ Production
   - ✅ Preview
   - ✅ Development
7. Click **Save**

## Fix in Local .env

Update your local `.env` file too:

```env
DATABASE_URL="postgresql://postgres:ae5ZIDkYGgZVSWJQ@db.zocojjlmjhaegmluqnpu.supabase.co:5432/postgres?sslmode=require"
```

## After Fixing

1. **Redeploy on Vercel:**

   - Deployments → Latest → ⋯ → Redeploy

2. **Test:**
   - Visit: `https://your-site.vercel.app/api/test-db`
   - Should show: `{"success":true,...}`
   - Try adding a tool - should work! ✅

## Why It Works Locally

Your local `.env` might have had `?sslmode=require` before, or your local PostgreSQL client handles SSL differently. But Vercel's serverless functions **require** the explicit SSL parameter.
