import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '@/lib/supabase'

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get('code')
  const error = requestUrl.searchParams.get('error')
  const errorDescription = requestUrl.searchParams.get('error_description')
  const next = requestUrl.searchParams.get('next') || '/'

  // Handle OAuth errors
  if (error) {
    console.error('OAuth error:', error, errorDescription)
    return NextResponse.redirect(
      new URL(`/?error=${encodeURIComponent(errorDescription || error)}`, requestUrl.origin)
    )
  }

  if (code) {
    try {
      // Use the anon key client to exchange the code for a session
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
      const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      
      const supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
          autoRefreshToken: true,
          persistSession: true,
        },
      })

      const { data, error: exchangeError } = await supabaseClient.auth.exchangeCodeForSession(code)
      
      if (exchangeError) {
        console.error('Error exchanging code for session:', exchangeError)
        return NextResponse.redirect(
          new URL(`/?error=${encodeURIComponent(exchangeError.message)}`, requestUrl.origin)
        )
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
          const insertError = await admin.from('user').insert([
            {
              id: data.user.id,
              email: data.user.email!,
              name: data.user.user_metadata?.name || 
                    data.user.user_metadata?.full_name || 
                    data.user.user_metadata?.display_name ||
                    data.user.email?.split('@')[0] || 
                    'User',
              role: 'user',
            },
          ])

          if (insertError) {
            console.error('Error creating user record:', insertError)
            // Don't fail the auth flow if user creation fails
          }
        }
      }

      // Redirect to home page with success
      return NextResponse.redirect(new URL(next, requestUrl.origin))
    } catch (err: any) {
      console.error('Unexpected error in callback:', err)
      return NextResponse.redirect(
        new URL(`/?error=${encodeURIComponent(err.message || 'Authentication failed')}`, requestUrl.origin)
      )
    }
  }

  // No code provided, redirect to home
  return NextResponse.redirect(new URL('/', requestUrl.origin))
}

