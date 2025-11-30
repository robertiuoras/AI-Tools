# Quick Connection String Guide

If you can't find the connection string in Supabase, here's the fastest way to get it:

## What You Need:

1. **Project Reference ID** - Found in Settings → General
2. **Database Password** - Found in Settings → Database

## Step-by-Step:

### 1. Get Project Reference ID
- Go to Supabase Dashboard
- Click **Settings** (⚙️) → **General**
- Find **"Reference ID"** or **"Project ID"**
- Copy it (looks like: `abcdefghijklmnop`)

### 2. Get Database Password
- Go to **Settings** → **Database**
- Find **"Database password"** section
- If you don't have it, click **"Reset database password"**
- **IMPORTANT:** Copy it immediately (you can only see it once!)

### 3. Build Your Connection String

Use this template:
```
postgresql://postgres:YOUR-PASSWORD@db.YOUR-PROJECT-REF.supabase.co:5432/postgres?sslmode=require
```

**Example:**
If your:
- Project Reference: `abcdefghijklmnop`
- Password: `MySecurePassword123!`

Your connection string would be:
```
postgresql://postgres:MySecurePassword123!@db.abcdefghijklmnop.supabase.co:5432/postgres?sslmode=require
```

## Alternative: Check Connection Pooling

1. Go to **Settings** → **Database**
2. Look for **"Connection pooling"** section
3. There might be a connection string there (usually for connection pooling)
4. You can use the direct connection string format above instead

## Still Can't Find It?

Try these locations in Supabase:
- Settings → Database → Connection string
- Settings → Database → Connection info  
- Settings → API → Database section
- Settings → General → Project settings

If none of these work, you can always build it manually using the format above!

