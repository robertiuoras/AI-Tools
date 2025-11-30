# AI Tools Directory

A modern, enterprise-grade web application for discovering and organizing AI tools. Built with Next.js 14, TypeScript, Tailwind CSS, and Prisma.

## Features

- 🎨 **Modern UI/UX** - Inspired by Linear, Stripe, and Vercel with glassmorphism effects and smooth animations
- 🔍 **Powerful Search** - Real-time search by tool name, description, or tags
- 🎯 **Advanced Filtering** - Filter by category, traffic, revenue model
- 📊 **Multiple Sort Options** - Alphabetical, newest, most popular, highest traffic
- 🌓 **Dark Mode** - Beautiful dark/light theme toggle
- 📱 **Responsive Design** - Mobile-first design that works on all devices
- ⚡ **Fast Performance** - Optimized with Next.js App Router and server components
- 🛠️ **Admin Dashboard** - Easy-to-use interface for managing tools
- 🤖 **AI-Powered Quick Add** - Paste a URL and let AI analyze and auto-fill tool information
- 📈 **Analytics** - Vercel Analytics and Speed Insights integrated

## Tech Stack

- **Framework**: Next.js 14+ (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS + shadcn/ui
- **Animations**: Framer Motion
- **Database**: Supabase (PostgreSQL via REST API)
- **Database Client**: Supabase JS
- **Validation**: Zod
- **Icons**: Lucide React
- **Analytics**: Vercel Analytics & Speed Insights

## Getting Started

### Prerequisites

- Node.js 18+ and npm/yarn/pnpm
- Git

### Installation

1. Clone the repository or navigate to the project directory:

```bash
cd "AI Tools"
```

2. Install dependencies:

```bash
npm install
```

3. Set up environment variables:

Create a `.env` file in the root directory:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
OPENAI_API_KEY=your-openai-key
```

See `SUPABASE_SETUP.md` for detailed instructions on getting these keys.

4. Set up the database:

Create the `tool` table in Supabase. See `SUPABASE_SETUP.md` for SQL script.

5. Start the development server:

```bash
npm run dev
```

6. Open [http://localhost:3000](http://localhost:3000) in your browser.

## Project Structure

```
/
├── app/
│   ├── api/
│   │   └── tools/          # API routes for CRUD operations
│   ├── admin/              # Admin dashboard page
│   ├── layout.tsx          # Root layout with navigation
│   ├── page.tsx            # Main directory page
│   └── globals.css         # Global styles
├── components/
│   ├── ui/                 # shadcn/ui components
│   ├── Hero.tsx            # Hero section component
│   ├── ToolCard.tsx        # Tool card component
│   ├── SearchBar.tsx       # Search input component
│   ├── FilterSidebar.tsx   # Filter sidebar component
│   └── ThemeToggle.tsx     # Dark mode toggle
├── lib/
│   ├── db.ts               # Prisma client
│   ├── schemas.ts          # Zod validation schemas
│   └── utils.ts            # Utility functions
└── prisma/
    └── schema.prisma       # Database schema
```

## Usage

### Adding Tools

#### Quick Add by URL (Recommended)

1. Navigate to `/admin` in your browser
2. Use the **"Quick Add by URL"** feature at the top
3. Paste a website URL (e.g., `https://chat.openai.com`)
4. Click **"Analyze"** - AI will automatically:
   - Extract name, description, and logo
   - Determine the category
   - Detect revenue model (free/paid/etc)
   - Generate tags
   - Estimate traffic and ratings (with AI)
5. Review and adjust the auto-filled information
6. Click **"Add Tool"** to save

**Note:** For best results, add an `OPENAI_API_KEY` to your `.env` file. See `AI_SETUP.md` for details.

#### Manual Entry

1. Navigate to `/admin` in your browser
2. Fill in the tool information:

   - **Name** (required): Tool name
   - **Description** (required): Brief description
   - **URL** (required): Tool website URL
   - **Logo URL** (optional): Tool logo image URL
   - **Category** (required): Select from predefined categories
   - **Tags** (optional): Comma-separated tags
   - **Traffic** (optional): Low/Medium/High/Unknown
   - **Revenue Model** (optional): Free/Freemium/Paid/Enterprise
   - **Rating** (optional): 0-5 star rating
   - **Estimated Visits** (optional): Monthly web visits estimate

3. Click "Add Tool" to save

### Filtering and Sorting

- Use the **Search Bar** to search by name, description, or tags
- Use the **Filter Sidebar** to filter by:
  - Category
  - Traffic level
  - Revenue model
- Use the **Sort Dropdown** to sort by:
  - Alphabetical (A-Z or Z-A)
  - Newest first
  - Most popular (by rating)
  - Highest traffic

## Database Schema

The `Tool` model includes:

- `id`: Unique identifier (CUID)
- `name`: Tool name
- `description`: Tool description
- `url`: Tool website URL
- `logoUrl`: Optional logo image URL
- `category`: Tool category
- `tags`: Comma-separated tags
- `traffic`: Traffic level (low/medium/high/unknown)
- `revenue`: Revenue model (free/freemium/paid/enterprise)
- `rating`: Optional rating (0-5)
- `estimatedVisits`: Optional monthly visits estimate
- `createdAt`: Creation timestamp
- `updatedAt`: Last update timestamp

## Production Deployment

### Deploy to Vercel

1. Push your code to GitHub
2. Import your repository in Vercel
3. Add environment variables in Vercel:
   - `NEXT_PUBLIC_SUPABASE_URL` - Your Supabase project URL
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` - Your Supabase anon key
   - `SUPABASE_SERVICE_ROLE_KEY` - Your Supabase service role key
   - `OPENAI_API_KEY` - (Optional) For AI-powered features
4. The build process will automatically build the Next.js application
5. Deploy!

**Note**: The project includes Vercel Analytics and Speed Insights, which will automatically start tracking once deployed.

See `SUPABASE_SETUP.md` for detailed instructions on getting your Supabase API keys.

## Development

### Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run start` - Start production server
- `npm run lint` - Run ESLint
- `npm run db:generate` - Generate Prisma client (if using Prisma)
- `npm run db:push` - Push schema changes to database (if using Prisma)
- `npm run db:studio` - Open Prisma Studio (if using Prisma)

## Future Enhancements

- [ ] API integrations (Product Hunt, Similar Web)
- [ ] User accounts and favorites
- [ ] Tool comparison feature
- [ ] Analytics dashboard
- [ ] User ratings and reviews
- [ ] Export tools to CSV/JSON
- [ ] Bulk import tools

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
