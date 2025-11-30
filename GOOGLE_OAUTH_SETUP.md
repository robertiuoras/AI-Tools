# Google OAuth Setup Guide

## Step 1: Enable Google Provider in Supabase

1. Go to your Supabase Dashboard: https://supabase.com/dashboard
2. Select your project
3. Navigate to **Authentication** → **Providers** (in the left sidebar)
4. Find **Google** in the list of providers
5. Click **Enable** or toggle it on
6. You'll see a form with:
   - **Client ID (for OAuth)**
   - **Client Secret (for OAuth)**

## Step 2: Get Your Supabase Callback URL (IMPORTANT!)

**This is the most important step!** Supabase handles the OAuth flow first, then redirects to your app.

1. Go to your Supabase Dashboard
2. Navigate to **Authentication** → **URL Configuration**
3. Find your **Site URL** - it should be: `https://zocojjlmjhaegmluqnpu.supabase.co` (or similar)
4. The **Supabase callback URL** is: `https://zocojjlmjhaegmluqnpu.supabase.co/auth/v1/callback`
5. **Copy this URL** - you'll need it for Google OAuth setup

## Step 3: Create Google OAuth Credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Navigate to **APIs & Services** → **Credentials**
4. Click **Create Credentials** → **OAuth client ID**
5. If prompted, configure the OAuth consent screen first:
   - Choose **External** (unless you have a Google Workspace)
   - Fill in:
     - App name: "AI Tools Directory" (or your app name)
     - User support email: Your email
     - Developer contact: Your email
   - Click **Save and Continue** through the steps
6. Back to Credentials, create OAuth client ID:
   - Application type: **Web application**
   - Name: "AI Tools Directory"
   - **Authorized JavaScript origins**:
     - `https://zocojjlmjhaegmluqnpu.supabase.co` (your Supabase URL)
   - **Authorized redirect URIs** (CRITICAL - must include Supabase callback):
     - `https://zocojjlmjhaegmluqnpu.supabase.co/auth/v1/callback` (Supabase callback - REQUIRED!)
     - `http://localhost:3000/auth/callback` (for local development - optional)
     - `https://your-vercel-domain.vercel.app/auth/callback` (your production domain - optional)
7. Click **Create**
8. Copy the **Client ID** and **Client Secret**

## Step 4: Add Credentials to Supabase

1. Back in Supabase Dashboard → **Authentication** → **Providers** → **Google**
2. Paste your **Client ID** from Google Cloud Console
3. Paste your **Client Secret** from Google Cloud Console
4. Click **Save**

## Step 5: Update Redirect URLs in Supabase

1. In Supabase Dashboard → **Authentication** → **URL Configuration**
2. Under **Site URL**, set it to your app's URL:
   - For local: `http://localhost:3000`
   - For production: `https://your-vercel-domain.vercel.app`
3. Under **Redirect URLs**, add:
   - `http://localhost:3000/auth/callback` (for local development)
   - `https://your-vercel-domain.vercel.app/auth/callback` (your production domain)
   - `http://localhost:3000/**` (wildcard for local - optional)
   - `https://your-vercel-domain.vercel.app/**` (wildcard for production - optional)
4. Click **Save**

## Step 6: No Additional Environment Variables Needed

You don't need any additional environment variables! The Google OAuth is configured in Supabase, and your app uses the Supabase client which handles it automatically.

## Step 7: Test

1. Go to your app
2. Click **Sign Up** or **Login**
3. Click **Google** button
4. You should be redirected to Google's sign-in page
5. After signing in, you'll be redirected back to your app

## Troubleshooting

### Error: "redirect_uri_mismatch" or "fallback website"

- **CRITICAL**: The Supabase callback URL MUST be in Google OAuth redirect URIs: `https://zocojjlmjhaegmluqnpu.supabase.co/auth/v1/callback`
- Make sure you added it exactly as shown (with `/auth/v1/callback` at the end)
- Your app's callback URL is optional but recommended: `https://your-domain.com/auth/callback`
- Double-check there are no typos or extra spaces

### Error: "Unsupported provider"

- Make sure Google provider is enabled in Supabase Dashboard
- Make sure you saved the Client ID and Client Secret in Supabase

### Error: "Invalid client"

- Double-check your Client ID and Client Secret in Supabase
- Make sure they match what's in Google Cloud Console

## Quick Checklist

- [ ] Google provider enabled in Supabase
- [ ] **Supabase callback URL copied**: `https://zocojjlmjhaegmluqnpu.supabase.co/auth/v1/callback`
- [ ] Google OAuth credentials created in Google Cloud Console
- [ ] **Supabase callback URL added to Google OAuth redirect URIs** (REQUIRED!)
- [ ] Client ID and Secret added to Supabase
- [ ] Site URL set in Supabase URL Configuration
- [ ] Redirect URLs added in Supabase URL Configuration
- [ ] Tested the sign-in flow

## Important Notes

⚠️ **The Supabase callback URL (`https://zocojjlmjhaegmluqnpu.supabase.co/auth/v1/callback`) MUST be in your Google OAuth redirect URIs!**

This is because:

1. User clicks "Sign in with Google"
2. Google redirects to Supabase: `https://zocojjlmjhaegmluqnpu.supabase.co/auth/v1/callback`
3. Supabase processes the OAuth and creates the session
4. Supabase then redirects to your app: `https://your-domain.com/auth/callback`
5. Your app's callback route creates the user record in the database

If the Supabase callback URL is missing from Google OAuth, you'll get the "fallback website" error!
