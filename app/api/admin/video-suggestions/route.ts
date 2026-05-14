import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdminUserId } from '@/lib/admin-auth'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const adminId = await requireAdminUserId(request)
  if (!adminId) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  }

  const admin = supabaseAdmin as any
  const { data, error } = await admin
    .from('video_suggestion')
    .select('id, url, normalized_url, note, status, created_at, suggested_by_user_id')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })

  if (error) {
    if (error.code === '42P01' || error.message?.includes('does not exist')) {
      return NextResponse.json(
        {
          error: 'video_suggestion table missing',
          hint: 'Run supabase/sql/supabase-migration-video-suggestions.sql',
        },
        { status: 500 },
      )
    }
    console.error('[admin/video-suggestions]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data ?? [])
}
