# Quick Fix: Database Connection Error

## The Problem

"Can't reach database server" - but the table was created before, so connection worked.

## Most Likely Causes (in order)

### 1. Supabase Project is Paused ⚠️ (MOST COMMON)

**Free tier projects pause after 7 days of inactivity.**

**Fix:**
1. Go to [Supabase Dashboard](https://app.supabase.com)
2. Check your project - do you see "Paused" or "Inactive"?
3. If paused:
   - Click **"Resume"** or **"Restore"**
   - Wait 1-2 minutes for it to restart
   - Try your site again

### 2. DATABASE_URL Has Quotes in Vercel

**Fix:**
1. Go to Vercel → Settings → Environment Variables
2. Click on `DATABASE_URL` to edit
3. Check the value - it should be:
   ```
   postgresql://postgres:ae5ZIDkYGgZVSWJQ@db.zocojjlmjhaegmluqnpu.supabase.co:5432/postgres?sslmode=require
   ```
4. **Remove any quotes** if present (no `"` or `'` around it)
5. Save
6. Redeploy

### 3. DATABASE_URL Not Set for All Environments

**Fix:**
1. Vercel → Settings → Environment Variables
2. Click on `DATABASE_URL`
3. Make sure all three are checked:
   - ✅ Production
   - ✅ Preview
   - ✅ Development
4. Save
5. Redeploy

### 4. Database Password Changed

**Fix:**
1. Supabase Dashboard → Settings → Database
2. Check **"Database password"** section
3. If you reset it, update `DATABASE_URL` in Vercel with new password
4. Redeploy

## Quick Checklist

- [ ] Supabase project is **Active** (not paused)
- [ ] `DATABASE_URL` in Vercel has **no quotes**
- [ ] `DATABASE_URL` set for **all 3 environments**
- [ ] Connection string has `?sslmode=require` at end
- [ ] **Redeployed** after making changes

## Test It

After fixing:
1. Wait 1-2 minutes (if you resumed Supabase)
2. Visit your deployed site
3. Go to `/admin`
4. Try adding a tool
5. Should work! ✅

## Still Not Working?

Check Vercel logs:
1. Vercel Dashboard → Your Project → **Logs**
2. Look for database connection errors
3. Check what `DATABASE_URL` value is being read

The logs will show if:
- Variable is missing
- Has wrong format
- Connection is being blocked

