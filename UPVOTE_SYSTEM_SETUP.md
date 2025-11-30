# Upvote System Setup Guide

## What Was Implemented

### 1. Fixed User Creation

- Enhanced error logging in auth callback
- User records are now properly created when signing in with Google or email/password
- Added better error handling for duplicate users

### 2. Upvote System Features

- **Daily Limit**: Users can upvote up to 3 different tools per day
- **Daily Reset**: Upvotes reset at midnight (users can upvote again the next day)
- **Monthly Reset**: All upvotes reset at the start of each month
- **Timer Display**: Shows countdown to daily and monthly resets on the landing page

### 3. Admin Role System

- Created API endpoint `/api/admin/set-role` to assign admin roles
- First user can set themselves as admin (if no admins exist)
- Existing admins can change other users' roles

## Database Migration Required

**IMPORTANT**: You must run the SQL migration before the upvote system will work!

1. Go to your Supabase Dashboard
2. Navigate to **SQL Editor**
3. Run the contents of `upvote-system-migration.sql`

This migration will:

- Add `upvotedAt` timestamp to track when upvotes were made
- Add `monthlyResetDate` to track which month the upvote belongs to
- Create indexes for efficient queries
- Update existing upvotes with timestamps

## How to Set Admin Role

### Option 1: Via API (Recommended)

1. Get your user ID from Supabase Dashboard → Authentication → Users
2. Make a POST request to `/api/admin/set-role`:
   ```bash
   curl -X POST http://localhost:3000/api/admin/set-role \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
     -d '{"userId": "YOUR_USER_ID", "role": "admin"}'
   ```

### Option 2: Direct Database Update

1. Go to Supabase Dashboard → Table Editor → `user` table
2. Find your user record
3. Change `role` from `user` to `admin`
4. Save

## Monthly Reset Automation

The monthly reset happens automatically when:

- The system checks `monthlyResetDate` and only counts upvotes from the current month
- Old upvotes are filtered out in queries

To manually trigger a monthly reset (optional):

- Call `POST /api/admin/reset-monthly-upvotes` (admin only)

## Testing the System

1. **Test Daily Limit**:

   - Log in as a user
   - Try to upvote 4 different tools
   - You should see an error after the 3rd upvote

2. **Test Daily Reset**:

   - Upvote 3 tools
   - Wait until midnight (or change system date)
   - You should be able to upvote again

3. **Test Monthly Reset**:

   - Upvotes from previous months won't be counted
   - Only upvotes from the current month are shown

4. **Test Timer**:
   - Check the landing page
   - You should see a timer showing time until daily and monthly reset

## Troubleshooting

### User not showing in user table

- Check browser console for errors
- Verify RLS policies allow user creation
- Check Supabase logs for insert errors

### Can't access admin page

- Make sure your user has `role = 'admin'` in the `user` table
- Use the `/api/admin/set-role` endpoint or update directly in Supabase

### Upvotes not resetting

- Make sure you ran the SQL migration
- Check that `upvotedAt` and `monthlyResetDate` columns exist
- Verify the date filtering logic in API routes

### Timer not showing

- Check that `UpvoteTimer` component is imported in `app/page.tsx`
- Verify the component is rendered in the layout

## Files Changed

- `app/api/tools/[id]/upvote/route.ts` - Added daily limit and monthly reset logic
- `app/api/tools/route.ts` - Filter upvotes by current month
- `app/auth/callback/page.tsx` - Enhanced user creation with better error handling
- `components/ToolCard.tsx` - Updated to send auth token with upvote requests
- `components/UpvoteTimer.tsx` - New component showing reset timers
- `app/page.tsx` - Added UpvoteTimer to landing page
- `app/api/admin/set-role/route.ts` - New endpoint for role management
- `upvote-system-migration.sql` - Database migration script
