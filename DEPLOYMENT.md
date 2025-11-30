# Deployment Guide

## Important: Database Setup for Vercel

**SQLite will NOT work on Vercel** because Vercel's file system is read-only. You need to use a hosted database service.

### Option 1: PostgreSQL (Recommended)

1. **Set up a PostgreSQL database:**
   - Use [Vercel Postgres](https://vercel.com/docs/storage/vercel-postgres) (easiest)
   - Or use [Supabase](https://supabase.com), [Neon](https://neon.tech), or [Railway](https://railway.app)

2. **Update `prisma/schema.prisma`:**
   ```prisma
   datasource db {
     provider = "postgresql"
     url      = env("DATABASE_URL")
   }
   ```

3. **Set environment variable in Vercel:**
   - Go to your Vercel project settings
   - Add `DATABASE_URL` with your PostgreSQL connection string
   - Format: `postgresql://user:password@host:5432/database?sslmode=require`

4. **Run migrations:**
   ```bash
   npx prisma migrate dev --name init
   ```

5. **Push schema changes:**
   ```bash
   npx prisma db push
   ```

### Option 2: Use Vercel Postgres (Easiest)

1. In your Vercel project dashboard, go to Storage
2. Create a new Postgres database
3. Vercel will automatically set the `DATABASE_URL` environment variable
4. Update your Prisma schema to use `postgresql` provider
5. Run migrations

### Database Migration Steps

After setting up PostgreSQL:

```bash
# Generate Prisma Client
npx prisma generate

# Create and run migrations
npx prisma migrate dev --name init

# Or push schema directly (for development)
npx prisma db push
```

### Environment Variables

Make sure these are set in Vercel:

- `DATABASE_URL` - Your PostgreSQL connection string
- `NEXT_PUBLIC_APP_URL` - Your app URL (optional, for development)

### Troubleshooting

**Error: "Failed to fetch tools"**
- Check that `DATABASE_URL` is set correctly in Vercel
- Verify the database is accessible
- Check Vercel build logs for Prisma errors

**Error: "Prisma Client not generated"**
- The `postinstall` script should handle this automatically
- If issues persist, add `prisma generate` to your build command

**Database connection errors:**
- Ensure your database allows connections from Vercel's IP ranges
- Check SSL requirements (most hosted databases require SSL)
- Verify credentials are correct

