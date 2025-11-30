# Debugging Guide

## Issue: "Add Tool" Not Saving

### Check Browser Console

1. Open your browser's Developer Tools (F12 or Cmd+Option+I)
2. Go to the **Console** tab
3. Try to add a tool
4. Look for error messages

### Common Issues

#### 1. Validation Errors
**Error:** "Validation error" or "Name is required"

**Solution:**
- Make sure all required fields are filled:
  - Name ✅
  - Description ✅
  - URL ✅
  - Category ✅

#### 2. Database Connection Error
**Error:** "Failed to create tool" or Prisma errors

**Solution:**
- Check that your database is running
- Verify `DATABASE_URL` in `.env` is correct
- Try running: `npm run db:push`

#### 3. Network Error
**Error:** "Failed to fetch" or network errors

**Solution:**
- Check that your dev server is running (`npm run dev`)
- Verify the API route is accessible
- Check for CORS errors

### Debug Steps

1. **Check the console logs:**
   - You should see: "Submitting payload: ..."
   - Then: "Tool saved successfully: ..."
   - Or: Error messages

2. **Check the Network tab:**
   - Open Developer Tools → Network tab
   - Try adding a tool
   - Look for the `/api/tools` request
   - Check the response status and body

3. **Check server logs:**
   - Look at your terminal where `npm run dev` is running
   - You should see API request logs

## Issue: OpenAI Not Being Used

### Check 1: Environment Variable

1. **Verify `.env` file exists:**
   ```bash
   cat .env | grep OPENAI
   ```

2. **Should see:**
   ```
   OPENAI_API_KEY="sk-..."
   ```

3. **If not present:**
   - Add it to `.env`
   - Restart your dev server

### Check 2: Server Logs

When analyzing a URL, check your terminal:

**With API key:**
```
✨ Using AI analysis with OpenAI
API Key present: sk-xxxxx...
```

**Without API key:**
```
⚠️ OpenAI API key not found. Using basic analysis.
```

### Check 3: Restart Server

After adding `OPENAI_API_KEY`:
1. Stop the server (Ctrl+C)
2. Start again: `npm run dev`
3. Environment variables are loaded on startup

### Check 4: Vercel (Production)

If deployed to Vercel:
1. Go to Vercel Dashboard
2. Your Project → Settings → Environment Variables
3. Verify `OPENAI_API_KEY` is set
4. Redeploy if you just added it

## Quick Test

### Test Form Submission:
1. Fill in:
   - Name: "Test Tool"
   - Description: "A test tool"
   - URL: "https://example.com"
   - Category: "Other"
2. Click "Add Tool"
3. Check console for errors
4. Check if tool appears in the list

### Test OpenAI:
1. Go to `/admin`
2. Paste a URL in "Quick Add"
3. Click "Analyze"
4. Check terminal for "✨ Using AI analysis" message
5. If you see "⚠️ OpenAI API key not found", add it to `.env`

## Still Not Working?

1. **Share the console error** - Copy the exact error message
2. **Share server logs** - What appears in your terminal
3. **Check database** - Run `npm run db:studio` to see if tools are being created

