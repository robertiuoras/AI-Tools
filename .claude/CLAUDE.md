# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Start dev server (Next.js, port 3000)
npm run build        # Production build
npm run typecheck    # TypeScript check without emit
npm run lint         # ESLint
npm run db:generate  # Prisma client generation
npm run db:push      # Push Prisma schema to DB
npm run db:studio    # Prisma Studio GUI
```

> **Local dev note:** The project path `/Users/robertiuoras/AI Tools` contains a space, which causes Turbopack to crash with `Invalid distDirRoot: ""`. Use `npm run dev -- --webpack` or deploy to Vercel where the path has no spaces.

## Architecture

**Stack:** Next.js 16.1.6 App Router · React 18 · TypeScript 5.5 · Supabase (PostgreSQL + Auth) · Prisma 6.x · Tailwind CSS 3 · shadcn/ui

**Route groups** under `app/`:
- `(home)/` — AI tools directory (main landing page)
- `videos/` — curated YouTube/TikTok library
- `notes/` — collaborative notes (Liveblocks + TipTap + Yjs)
- `prompts/` — prompt analyser/improver
- `admin/` — admin dashboard (tool & video suggestion review)
- `projects/` — standalone mini-apps (AI video summariser, CS2 skin analyser, AI betting bot)
- `news/` — news feed
- `auth/` — auth callback

**API routes** live under `app/api/` and follow the same folder structure as pages. ~67 routes total.

## Key Patterns

### Supabase clients (`lib/supabase.ts`)
- `supabase` — anon key, respects RLS, safe to use client-side
- `supabaseAdmin` — service role key, bypasses RLS, **server-side only** (throws if called in browser)
- Most API routes cast `supabaseAdmin as any` to avoid TS type gaps when the DB schema isn't fully typed

### Admin auth (`lib/admin-auth.ts`)
```ts
const adminId = await requireAdminUserId(request)
if (!adminId) return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
```
Validates the `Authorization: Bearer <token>` header against Supabase auth, then checks `user.role === 'admin'` in the `user` table.

### Rate limiting (`lib/api-rate-limit.ts`)
In-memory sliding windows per IP. Call at the top of any POST/AI route:
```ts
const limited = enforceApiRateLimit(request, 'video_summary')
if (limited) return limited  // returns NextResponse with status 429 (JSON, not SSE)
```
Returns `null` if not limited. When consuming SSE endpoints on the client, **always check `res.ok` and `content-type` before entering the SSE reader** — a 429 is JSON, not a stream.

### SSE streaming
AI routes (video summariser, prompt tools) stream via `text/event-stream`. Client pattern:
```ts
if (!res.ok || !contentType.includes('text/event-stream')) {
  // parse JSON error, show to user
  return
}
// then consume the reader
```

### Auth flow
Supabase Auth → `AuthSessionProvider` (context) → `/api/user/ensure` (upserts row in `user` table) → `/api/auth/check` (returns role) → role cached in localStorage.

## Database

Two ORM layers coexist:
- **Prisma** — schema at `prisma/schema.prisma`, used for Prisma Studio and migrations on some tables
- **Supabase JS** — used directly in all API routes (Prisma is not used at runtime)

Schema migrations that can't go through Prisma are in `supabase/sql/` as `.sql` files — run manually in the Supabase SQL editor.

Key tables: `tool`, `video`, `user`, `upvote`, `note`, `note_page`, `note_share`, `prompt_history`, `video_suggestion`, `tool_suggestion`

## Environment Variables

Required in `.env.local` (and Vercel dashboard):
```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
DATABASE_URL
OPENAI_API_KEY
YOUTUBE_API_KEY
LIVEBLOCKS_SECRET_KEY
RESEND_API_KEY
NEXT_PUBLIC_SITE_URL
```

Optional: `RATE_LIMIT_DISABLED=true` (disables all rate limiting in dev), `RATE_LIMIT_*_PER_MINUTE/HOUR` overrides for each kind.

## Notable Libraries

- **youtubei.js v17** + **youtube-transcript v1.3.0** — transcript fetching for the AI video summariser; Whisper fallback when no caption track exists
- **Liveblocks + Yjs + TipTap** — real-time collaborative notes
- **Excalidraw** — whiteboard within the notes section
- **jspdf** — PDF export from notes
- **Resend** — transactional email
- **Framer Motion** — UI animations
- **Zod** — runtime validation on API boundaries

## Pre-commit hooks

Husky runs lint-staged on every commit: ESLint `--fix` on `.ts/.tsx` files and `tsc --noEmit` for type checking. Fix TypeScript errors before committing.
