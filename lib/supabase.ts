import { createClient } from "@supabase/supabase-js";

// Get environment variables - these MUST be set
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Validate required environment variables (client-side)
if (!supabaseUrl) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL environment variable is not set");
}

if (!supabaseAnonKey) {
  throw new Error(
    "NEXT_PUBLIC_SUPABASE_ANON_KEY environment variable is not set"
  );
}

// Client for client-side operations (uses anon key, respects RLS)
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

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

// Type definitions matching our Prisma schema
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
  upvoteCount?: number; // Added for upvote count
  userUpvoted?: boolean; // Added to check if current user upvoted
  userFavorited?: boolean; // Added to check if current user favorited
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
