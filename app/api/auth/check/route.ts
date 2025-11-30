import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { createClient } from '@supabase/supabase-js'

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization')
    
    if (!authHeader) {
      return NextResponse.json({ user: null, role: null })
    }

    const token = authHeader.replace('Bearer ', '')
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    
    const client = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: { Authorization: `Bearer ${token}` },
      },
    })

    const { data: { user }, error: userError } = await client.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ user: null, role: null })
    }

    // Get user role from database
    const { data: userData, error: dbError } = await supabaseAdmin
      .from('user')
      .select('role')
      .eq('id', user.id)
      .single()

    if (dbError || !userData) {
      return NextResponse.json({ user: user.id, role: 'user' })
    }

    const role = (userData as { role?: string })?.role || 'user'

    return NextResponse.json({
      user: user.id,
      role: role,
    })
  } catch (error) {
    console.error('Error checking auth:', error)
    return NextResponse.json({ user: null, role: null })
  }
}

