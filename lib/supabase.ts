import { createClient, SupabaseClient } from "@supabase/supabase-js";

// NEXT_PUBLIC_* vars are inlined at build time on Vercel. Set them in the dashboard and redeploy.
// Use placeholders when missing so createClient() doesn't throw; requests will fail until vars are set.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder-anon-key";

// Client for client-side operations (uses anon key, respects RLS)
export const supabase: SupabaseClient = createClient(supabaseUrl, supabaseAnonKey);

// Admin client for server-side operations only (uses service role key, bypasses RLS)
// Only create this on the server side to avoid exposing the service role key to the client
let supabaseAdminInstance: ReturnType<typeof createClient> | null = null;

function createSupabaseAdmin(): ReturnType<typeof createClient> {
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  if (!supabaseServiceKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY environment variable is not set");
  }

  return createClient(supabaseUrl!, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

// Type for supabaseAdmin - always returns a client, but throws on client-side
export const supabaseAdmin: ReturnType<typeof createClient> = (() => {
  // Only create admin client on server side
  if (typeof window !== 'undefined') {
    // Return a proxy that throws if any method is called on the client
    return new Proxy({} as ReturnType<typeof createClient>, {
      get() {
        throw new Error('supabaseAdmin can only be used on the server side. Make sure you are importing it in a server component or API route.');
      },
    }) as ReturnType<typeof createClient>;
  }

  // Server-side: create the admin client
  if (!supabaseAdminInstance) {
    supabaseAdminInstance = createSupabaseAdmin();
  }

  return supabaseAdminInstance;
})() as ReturnType<typeof createClient>;

// Type definitions matching our database schema
export interface Tool {
  id: string;
  name: string;
  description: string;
  url: string;
  logoUrl: string | null;
  category: string;
  tags: string | null;
  traffic: "low" | "medium" | "high" | "unknown" | null;
  revenue: "free" | "freemium" | "paid" | "enterprise" | null;
  rating: number | null;
  estimatedVisits: number | null;
  createdAt: string;
  updatedAt: string;
  upvoteCount?: number;
  downvoteCount?: number;
  userUpvoted?: boolean;
  userDownvoted?: boolean;
  userFavorited?: boolean;
}

export type VideoSource = "youtube" | "tiktok";

export interface Video {
  id: string;
  title: string;
  url: string;
  category: string;
  source?: VideoSource | null;
  youtuberName: string | null;
  subscriberCount: number | null;
  channelThumbnailUrl: string | null;
  channelVideoCount: number | null;
  verified: boolean | null;
  tags: string | null;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface User {
  id: string;
  email: string;
  name: string | null;
  role: "user" | "admin";
  createdAt: string;
  updatedAt: string;
}

export interface Upvote {
  id: string;
  userId: string;
  toolId: string;
  createdAt: string;
}

export interface Comment {
  id: string;
  userId: string;
  toolId: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  user?: User;
}

export interface NotePage {
  id: string;
  userId: string;
  title: string;
  favorite: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Note {
  id: string;
  userId: string;
  pageId: string;
  title: string;
  content: string;
  favorite: boolean;
  createdAt: string;
  updatedAt: string;
}
