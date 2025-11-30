import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://zocojjlmjhaegmluqnpu.supabase.co'
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpvY29qamxtamhhZWdtbHVxbnB1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ0NDgxMzUsImV4cCI6MjA4MDAyNDEzNX0.oV-QrNpkvjxiF4cUIsnYFbD-CySNDlTtGDuGh3CjEj0'

// Use service role key for server-side operations (bypasses RLS)
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpvY29qamxtamhhZWdtbHVxbnB1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NDQ0ODEzNSwiZXhwIjoyMDgwMDI0MTM1fQ.E-VJ0fzYlLIRXUCyLjExIHHw8FSE4KUycKjM6Hby_jk'

// Client for client-side operations (uses anon key, respects RLS)
export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Admin client for server-side operations (uses service role key, bypasses RLS)
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
})

// Type definitions matching our Prisma schema
export interface Tool {
  id: string
  name: string
  description: string
  url: string
  logoUrl: string | null
  category: string
  tags: string | null
  traffic: 'low' | 'medium' | 'high' | 'unknown' | null
  revenue: 'free' | 'freemium' | 'paid' | 'enterprise' | null
  rating: number | null
  estimatedVisits: number | null
  createdAt: string
  updatedAt: string
}

