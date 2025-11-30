import { createClient } from "@supabase/supabase-js";

// Get environment variables - these MUST be set
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Validate required environment variables
if (!supabaseUrl) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL environment variable is not set");
}

if (!supabaseAnonKey) {
  throw new Error(
    "NEXT_PUBLIC_SUPABASE_ANON_KEY environment variable is not set"
  );
}

if (!supabaseServiceKey) {
  throw new Error("SUPABASE_SERVICE_ROLE_KEY environment variable is not set");
}

// Client for client-side operations (uses anon key, respects RLS)
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Admin client for server-side operations (uses service role key, bypasses RLS)
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

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
