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
      // Type assertion to work around Proxy type issues
      const admin = supabaseAdmin as any
      
      // Check if user exists in database, if not create them
      const { data: existingUser } = await admin
        .from('user')
        .select('id')
        .eq('id', data.user.id)
        .single()

      if (!existingUser) {
        // Create user record
        await admin.from('user').insert([
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

