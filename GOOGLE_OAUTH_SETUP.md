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

## Step 3: Configure OAuth Consent Screen (IMPORTANT - Sets App Name)

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Navigate to **APIs & Services** → **OAuth consent screen**
4. If you haven't configured it yet, click **Configure Consent Screen**
5. Choose **External** (unless you have a Google Workspace)
6. Fill in the OAuth consent screen:
   - **App name: "AI Tools"** ⭐ This is what users see: "to continue to AI Tools"
   - App logo: (Optional - upload your app logo for a better look)
   - User support email: Your email
   - Developer contact: Your email
   - App domain (optional): Your website domain
   - Authorized domains: Add your domain (e.g., `your-domain.com`)
7. Click **Save and Continue** through all the steps (Scopes, Test users, Summary)
8. **Note**: If you already configured the consent screen, you can edit it by going to **APIs & Services** → **OAuth consent screen** → **Edit App**

## Step 4: Create Google OAuth Credentials

1. In Google Cloud Console, navigate to **APIs & Services** → **Credentials**
2. Click **Create Credentials** → **OAuth client ID**
3. If you haven't configured the OAuth consent screen yet, you'll be prompted to do so (follow Step 3 above)
4. Once the consent screen is configured, create OAuth client ID:
   - Choose **External** (unless you have a Google Workspace)
   - Fill in:
     - **App name: "AI Tools"** (This is what users will see - "to continue to AI Tools")
     - App logo: (Optional - upload your app logo)
     - User support email: Your email
     - Developer contact: Your email
   - Click **Save and Continue** through the steps
   - **Important**: The "App name" field is what appears in the Google sign-in screen where it says "to continue to [App name]"
   - Application type: **Web application**
   - Name: "AI Tools"
   - **Authorized JavaScript origins**:
     - `https://zocojjlmjhaegmluqnpu.supabase.co` (your Supabase URL)
   - **Authorized redirect URIs** (CRITICAL - must include Supabase callback):
     - `https://zocojjlmjhaegmluqnpu.supabase.co/auth/v1/callback` (Supabase callback - REQUIRED!)
     - `http://localhost:3000/auth/callback` (for local development - optional)
     - `https://your-vercel-domain.vercel.app/auth/callback` (your production domain - optional)
5. Click **Create**
6. Copy the **Client ID** and **Client Secret**

## Step 5: Add Credentials to Supabase

1. Back in Supabase Dashboard → **Authentication** → **Providers** → **Google**
2. Paste your **Client ID** from Google Cloud Console
3. Paste your **Client Secret** from Google Cloud Console
4. Click **Save**

## Step 6: Update Redirect URLs in Supabase

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

## Step 7: No Additional Environment Variables Needed

You don't need any additional environment variables! The Google OAuth is configured in Supabase, and your app uses the Supabase client which handles it automatically.

## Step 8: Test

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

- [ ] **OAuth consent screen configured with App name: "AI Tools"** ⭐ (This changes "to continue to..." text)
- [ ] Google provider enabled in Supabase
- [ ] **Supabase callback URL copied**: `https://zocojjlmjhaegmluqnpu.supabase.co/auth/v1/callback`
- [ ] Google OAuth credentials created in Google Cloud Console
- [ ] **Supabase callback URL added to Google OAuth redirect URIs** (REQUIRED!)
- [ ] Client ID and Secret added to Supabase
- [ ] Site URL set in Supabase URL Configuration
- [ ] Redirect URLs added in Supabase URL Configuration
- [ ] Tested the sign-in flow

## Important Notes

### Changing "to continue to..." Text

The text "to continue to zocojjlmjhaegmluqnpu.supabase.co" is controlled by the **App name** in your Google OAuth consent screen.

**To change it to "AI Tools":**

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Select your project
3. Navigate to **APIs & Services** → **OAuth consent screen**
4. Click **Edit App** (or configure if not done yet)
5. Change the **App name** field to: **"AI Tools"**
6. Optionally upload an app logo
7. Click **Save**
8. The change may take a few minutes to propagate

After this, users will see: **"to continue to AI Tools"** instead of the Supabase URL.

### Supabase Callback URL

⚠️ **The Supabase callback URL (`https://zocojjlmjhaegmluqnpu.supabase.co/auth/v1/callback`) MUST be in your Google OAuth redirect URIs!**

This is because:

1. User clicks "Sign in with Google"
2. Google redirects to Supabase: `https://zocojjlmjhaegmluqnpu.supabase.co/auth/v1/callback`
3. Supabase processes the OAuth and creates the session
4. Supabase then redirects to your app: `https://your-domain.com/auth/callback`
5. Your app's callback route creates the user record in the database

If the Supabase callback URL is missing from Google OAuth, you'll get the "fallback website" error!
