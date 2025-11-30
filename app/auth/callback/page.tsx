'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

export default function AuthCallbackPage() {
  const router = useRouter()

  useEffect(() => {
    const handleAuthCallback = async () => {
      try {
        // Check if we have a code in the URL (PKCE flow)
        const urlParams = new URLSearchParams(window.location.search)
        const code = urlParams.get('code')

        if (code) {
          // Exchange code for session
          const { data, error } = await supabase.auth.exchangeCodeForSession(code)
          
          if (error) {
            console.error('Error exchanging code:', error)
            router.push(`/?error=${encodeURIComponent(error.message)}`)
            return
          }

          if (data.user) {
            // Create user record if it doesn't exist
            const { data: existingUser } = await supabase
              .from('user')
              .select('id')
              .eq('id', data.user.id)
              .single()

            if (!existingUser) {
              await supabase.from('user').insert([
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
            }
          }

          // Redirect to home
          router.push('/')
        } else {
          // Check if we have tokens in the hash (implicit flow)
          const hashParams = new URLSearchParams(window.location.hash.substring(1))
          const accessToken = hashParams.get('access_token')
          const refreshToken = hashParams.get('refresh_token')

          if (accessToken && refreshToken) {
            // Set the session manually
            const { data, error } = await supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken,
            })

            if (error) {
              console.error('Error setting session:', error)
              router.push(`/?error=${encodeURIComponent(error.message)}`)
              return
            }

            if (data.user) {
              // Create user record if it doesn't exist
              const { data: existingUser } = await supabase
                .from('user')
                .select('id')
                .eq('id', data.user.id)
                .single()

              if (!existingUser) {
                await supabase.from('user').insert([
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
              }
            }

            // Clear the hash and redirect
            window.history.replaceState({}, '', '/')
            router.push('/')
          } else {
            // No code or tokens, redirect to home
            router.push('/')
          }
        }
      } catch (error: any) {
        console.error('Error in auth callback:', error)
        router.push(`/?error=${encodeURIComponent(error.message || 'Authentication failed')}`)
      }
    }

    handleAuthCallback()
  }, [router])

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
        <p className="text-muted-foreground">Completing sign in...</p>
      </div>
    </div>
  )
}

