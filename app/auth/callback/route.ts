import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get('code')
  const next = requestUrl.searchParams.get('next') || '/'

  if (code) {
    const { data, error } = await supabaseAdmin.auth.exchangeCodeForSession(code)
    
    if (error) {
      console.error('Error exchanging code for session:', error)
      return NextResponse.redirect(new URL(`/?error=${encodeURIComponent(error.message)}`, requestUrl.origin))
    }

    if (data.user) {
      // Check if user exists in database, if not create them
      const { data: existingUser } = await supabaseAdmin
        .from('user')
        .select('id')
        .eq('id', data.user.id)
        .single()

      if (!existingUser) {
        // Create user record
        await supabaseAdmin.from('user').insert([
          {
            id: data.user.id,
            email: data.user.email!,
            name: data.user.user_metadata?.name || data.user.user_metadata?.full_name || data.user.email?.split('@')[0] || 'User',
            role: 'user',
          },
        ])
      }
    }

    return NextResponse.redirect(new URL(next, requestUrl.origin))
  }

  return NextResponse.redirect(new URL('/', requestUrl.origin))
}

