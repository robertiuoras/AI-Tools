# Quick Start Guide

## Initial Setup

1. **Install dependencies:**

   ```bash
   npm install
   ```

2. **Create environment file:**
   Create a `.env` file in the root directory with:

   ```env
   NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
   SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
   OPENAI_API_KEY=your-openai-key
   ```

   See `SUPABASE_SETUP.md` for instructions on getting these keys.

3. **Set up the database:**

   - Go to Supabase Dashboard → SQL Editor
   - Run the SQL script from `SUPABASE_SETUP.md` to create the `tool` table

4. **Start the development server:**

   ```bash
   npm run dev
   ```

5. **Open your browser:**
   Navigate to [http://localhost:3000](http://localhost:3000)

## First Steps

1. **Add your first tool:**

   - Go to `/admin` in your browser
   - Fill in the form with tool details
   - Click "Add Tool"

2. **Explore the directory:**

   - Use the search bar to find tools
   - Apply filters using the sidebar
   - Try different sorting options

3. **Toggle dark mode:**
   - Click the moon/sun icon in the navigation bar

## Sample Tool Data

Here's an example tool you can add to test:

- **Name:** ChatGPT
- **Description:** AI-powered conversational assistant for various tasks
- **URL:** https://chat.openai.com
- **Category:** Writing
- **Traffic:** High
- **Revenue:** Freemium
- **Rating:** 4.5

## Troubleshooting

### Database Issues

If you encounter database errors:

- Check that your Supabase environment variables are set correctly
- Verify the `tool` table exists in Supabase (Table Editor)
- Check Supabase project is active (not paused)

### Port Already in Use

If port 3000 is taken:

```bash
# Use a different port
PORT=3001 npm run dev
```

### Environment Variables Not Set

- Verify all Supabase keys are in your `.env` file
- Restart your dev server after adding environment variables

## Next Steps

- Add more tools to populate your directory
- Customize categories in `lib/schemas.ts`
- Deploy to Vercel for production
- See `SUPABASE_SETUP.md` for production deployment details
