import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '@/lib/supabase'

/** Returns Supabase user id when Authorization Bearer is an admin; otherwise null. */
export async function requireAdminUserId(request: NextRequest): Promise<string | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const authHeader = request.headers.get('authorization')
  if (!authHeader) return null
  const token = authHeader.replace('Bearer ', '')
  const client = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const {
    data: { user },
  } = await client.auth.getUser(token)
  if (!user) return null
  const admin = supabaseAdmin as any
  const { data: row } = await admin
    .from('user')
    .select('role')
    .eq('id', user.id)
    .single()
  if ((row as { role?: string } | null)?.role !== 'admin') return null
  return user.id
}
