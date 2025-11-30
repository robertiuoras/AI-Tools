# Check Vercel Logs to Debug Connection

## Step 1: Check Vercel Function Logs

1. Go to [Vercel Dashboard](https://vercel.com/dashboard)
2. Click your **AI Tools** project
3. Go to **Logs** tab (or **Functions** tab)
4. Look for recent API requests to `/api/tools`
5. Check the logs for:
   - `🔌 Database connection:` - shows what URL is being used
   - `❌ DATABASE_URL environment variable is not set` - means variable not set
   - Connection errors

## Step 2: Check What DATABASE_URL Vercel Has

The logs should show:
```
🔌 Database connection: postgresql://postgres@db.zocojjlmjhaegmluqnpu.supabase.co:5432/postgres?sslmode=require
```

**If you DON'T see this log:**
- DATABASE_URL is not set in Vercel
- Or it's not being read

**If you DO see this log but still get connection errors:**
- Supabase might be blocking Vercel IPs
- Or network/firewall issue

## Step 3: Check Supabase Network Settings

1. Go to [Supabase Dashboard](https://app.supabase.com)
2. Click your project
3. Go to **Settings** → **Database**
4. Look for:
   - **"Network Restrictions"** or **"IP Allowlist"**
   - **"Connection Pooling"** settings
   - Make sure nothing is blocking external connections

5. Check **"Database Settings"**:
   - Should allow connections from anywhere
   - Or Vercel IPs should be allowed

## Step 4: Try Direct Connection Test from Vercel

Create a test API route to verify connection:

**File: `app/api/test-db/route.ts`**
```typescript
import { prisma } from '@/lib/db'
import { NextResponse } from 'next/server'

export async function GET() {
  try {
    const count = await prisma.tool.count()
    return NextResponse.json({ 
      success: true, 
      count,
      databaseUrl: process.env.DATABASE_URL ? 'Set' : 'Not set',
      hostname: process.env.DATABASE_URL?.split('@')[1]?.split(':')[0] || 'Unknown'
    })
  } catch (error: any) {
    return NextResponse.json({ 
      success: false, 
      error: error.message,
      databaseUrl: process.env.DATABASE_URL ? 'Set' : 'Not set',
    }, { status: 500 })
  }
}
```

Then visit: `https://your-site.vercel.app/api/test-db`

This will show you:
- If DATABASE_URL is set
- What hostname it's trying to connect to
- The actual error

## Step 5: Verify Supabase Project is Active

1. Supabase Dashboard
2. Check project status
3. If paused, resume it
4. Wait 2-3 minutes after resuming

## Step 6: Check Supabase Connection String Again

1. Supabase Dashboard → Settings → Database
2. **"Connection string"** section
3. Click **"URI"** tab
4. Copy the connection string
5. Make sure password matches what's in Vercel

## Most Likely Issues

1. **DATABASE_URL not set in Vercel** - Check logs for "not set" message
2. **Supabase project paused** - Resume it
3. **Network restrictions** - Check Supabase network settings
4. **Wrong password** - Reset and update Vercel

