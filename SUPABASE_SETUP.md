# Supabase Setup Guide

Follow these steps to connect your Supabase database to your Next.js application.

## Step 1: Get Your Supabase Connection String

### Method 1: From Database Settings (Recommended)

1. Go to your [Supabase Dashboard](https://app.supabase.com)
2. Select your project
3. In the left sidebar, click **Settings** (⚙️ gear icon)
4. Click **Database** (under "Project Settings")
5. Scroll down to find **"Connection string"** or **"Connection info"** section
6. Look for tabs like "URI", "JDBC", "Golang", etc.
7. Click the **"URI"** tab
8. Copy the connection string - it will look like:
   ```
   postgresql://postgres:[YOUR-PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres
   ```

### Method 2: Build It Manually (If you can't find it)

If you don't see the connection string, you can build it manually:

1. **Get your Project Reference:**

   - Go to **Settings** → **General**
   - Look for **"Reference ID"** or **"Project ID"**
   - It looks like: `abcdefghijklmnop` (random letters/numbers)

2. **Get your Database Password:**

   - Go to **Settings** → **Database**
   - Look for **"Database password"** section
   - If you don't know it, click **"Reset database password"**
   - Copy the password (you'll only see it once!)

3. **Build the connection string:**

   ```
   postgresql://postgres:YOUR-PASSWORD@db.YOUR-PROJECT-REF.supabase.co:5432/postgres?sslmode=require
   ```

   Replace:

   - `YOUR-PASSWORD` with your actual database password
   - `YOUR-PROJECT-REF` with your project reference ID

### Method 3: From Project Settings → API

1. Go to **Settings** → **API**
2. Look for **"Database"** section
3. You might see connection details there
4. Or look for **"Connection pooling"** section which has connection strings

## Step 2: Format the Connection String

Replace `[YOUR-PASSWORD]` with your actual database password. If you don't know it:

- Go to **Settings** → **Database** → **Database password**
- Reset it if needed

The final connection string should look like:

```
postgresql://postgres:your-actual-password@db.abcdefghijklmnop.supabase.co:5432/postgres?sslmode=require
```

**Important:** Add `?sslmode=require` at the end for secure connections.

## Step 3: Set Up Environment Variables

### For Local Development:

1. Create or update your `.env` file in the project root:

   ```env
   DATABASE_URL="postgresql://postgres:your-password@db.your-project.supabase.co:5432/postgres?sslmode=require"
   NEXT_PUBLIC_APP_URL="http://localhost:3000"
   ```

2. **Never commit this file!** It should already be in `.gitignore`

### For Vercel Deployment:

1. Go to your [Vercel Dashboard](https://vercel.com/dashboard)
2. Select your project
3. Go to **Settings** → **Environment Variables**
4. Click **Add New**
5. Add:
   - **Name:** `DATABASE_URL`
   - **Value:** Your Supabase connection string (from Step 2)
   - **Environment:** Select all (Production, Preview, Development)
6. Click **Save**

## Step 4: Set Up the Database Schema

Run these commands in your terminal:

```bash
# 1. Generate Prisma Client
npm run db:generate

# 2. Push the schema to your Supabase database
npm run db:push
```

This will create the `Tool` table in your Supabase database.

## Step 5: Verify the Connection

1. Start your development server:

   ```bash
   npm run dev
   ```

2. Go to `http://localhost:3000/admin`
3. Try adding a tool - if it works, your connection is successful!

## Step 6: Test in Production

After deploying to Vercel:

1. The build should complete successfully
2. Visit your deployed site
3. Go to the admin page and add a tool
4. Check that tools appear on the main page

## Troubleshooting

### "Connection refused" or "Connection timeout"

- Check that your Supabase project is active (not paused)
- Verify the connection string is correct
- Make sure you added `?sslmode=require` at the end

### "Authentication failed"

- Double-check your database password
- Reset the password in Supabase if needed
- Make sure there are no extra spaces in the connection string

### "Relation does not exist"

- Run `npm run db:push` again to create the tables
- Check Supabase dashboard → **Table Editor** to see if the `Tool` table exists

### "SSL required"

- Make sure `?sslmode=require` is at the end of your connection string
- Supabase requires SSL connections

## Viewing Your Data

You can view your data in two ways:

1. **Supabase Dashboard:**

   - Go to **Table Editor** in your Supabase dashboard
   - You'll see the `Tool` table with all your data

2. **Prisma Studio:**
   ```bash
   npm run db:studio
   ```
   - Opens a local GUI at `http://localhost:5555`
   - Great for viewing and editing data locally

## Security Notes

- Never commit your `.env` file
- Use different passwords for development and production if possible
- Supabase connection strings include your password - keep them secret
- Consider using Supabase's connection pooling for better performance in production
