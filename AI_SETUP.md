# AI-Powered URL Analysis Setup

The "Quick Add by URL" feature can automatically analyze websites and fill in tool information. Here's how to set it up:

## How It Works

1. **Basic Mode (No API Key Required)**
   - Scrapes website metadata (title, description, logo)
   - Uses keyword-based categorization
   - Simple revenue model detection
   - Works immediately without any setup

2. **AI Mode (With OpenAI API Key)**
   - Uses GPT-4o-mini to analyze the website
   - More accurate categorization
   - Better description generation
   - Smarter revenue model detection
   - Estimated ratings and traffic

## Setup Instructions

### Option 1: Use Without AI (Works Immediately)

No setup needed! The feature works with basic web scraping and keyword analysis.

### Option 2: Enable AI Analysis (Recommended)

1. **Get an OpenAI API Key:**
   - Go to [OpenAI Platform](https://platform.openai.com/)
   - Sign up or log in
   - Go to **API Keys** section
   - Click **"Create new secret key"**
   - Copy the key (starts with `sk-`)

2. **Add to Local Environment:**
   - Add to your `.env` file:
     ```env
     OPENAI_API_KEY="sk-your-key-here"
     ```

3. **Add to Vercel (for production):**
   - Go to Vercel Dashboard → Your Project
   - Settings → Environment Variables
   - Add:
     - **Name:** `OPENAI_API_KEY`
     - **Value:** Your OpenAI API key
     - **Environment:** All (Production, Preview, Development)
   - Save

4. **Restart your dev server:**
   ```bash
   npm run dev
   ```

## Usage

1. Go to `/admin` page
2. Find the **"Quick Add by URL"** section at the top
3. Paste a website URL (e.g., `https://chat.openai.com`)
4. Click **"Analyze"**
5. Wait a few seconds while it analyzes
6. Review the auto-filled form
7. Make any adjustments needed
8. Click **"Add Tool"** to save

## What Gets Analyzed

- ✅ **Name** - Extracted from page title or domain
- ✅ **Description** - Generated from page content or AI analysis
- ✅ **Category** - Determined from keywords or AI analysis
- ✅ **Tags** - Extracted relevant tags
- ✅ **Revenue Model** - Detected from pricing pages/keywords
- ✅ **Logo URL** - Found from favicon or og:image
- ✅ **Traffic** - Estimated (requires AI for accuracy)
- ✅ **Rating** - Estimated (requires AI)

## Cost Considerations

- **GPT-4o-mini** is very affordable (~$0.15 per 1M input tokens)
- Each analysis uses minimal tokens
- Typical cost: **$0.001-0.01 per analysis**
- You can set usage limits in OpenAI dashboard

## Troubleshooting

### "Failed to analyze URL"
- Check that the URL is accessible
- Some websites block automated requests
- Try a different URL or fill manually

### "AI analysis not working"
- Verify `OPENAI_API_KEY` is set correctly
- Check OpenAI dashboard for API usage/errors
- Ensure you have credits in your OpenAI account
- The feature falls back to basic analysis if AI fails

### "Categorization seems wrong"
- Review and adjust the category manually
- AI analysis improves with better website content
- You can always edit after auto-fill

## Alternative AI Providers

To use a different AI provider, modify `/app/api/tools/analyze/route.ts`:

- **Anthropic Claude** - Replace OpenAI API calls
- **Google Gemini** - Use Gemini API
- **Local Models** - Use Ollama or similar

The code structure supports easy swapping of AI providers.

