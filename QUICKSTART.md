# Quick Start Guide

## Initial Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Create environment file:**
   Create a `.env` file in the root directory with:
   ```env
   DATABASE_URL="file:./dev.db"
   NEXT_PUBLIC_APP_URL="http://localhost:3000"
   ```

3. **Initialize the database:**
   ```bash
   npm run db:generate
   npm run db:push
   ```

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
```bash
# Reset the database
rm prisma/dev.db
npm run db:push
```

### Port Already in Use
If port 3000 is taken:
```bash
# Use a different port
PORT=3001 npm run dev
```

### Prisma Client Not Generated
```bash
npm run db:generate
```

## Next Steps

- Add more tools to populate your directory
- Customize categories in `lib/schemas.ts`
- Deploy to Vercel for production
- Switch to PostgreSQL for better performance

