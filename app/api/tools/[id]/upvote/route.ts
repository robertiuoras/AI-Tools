import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { createClient } from '@supabase/supabase-js'

// Create a client that can read auth tokens from cookies
function getSupabaseClient(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  
  // Get auth token from Authorization header or cookie
  const authHeader = request.headers.get('authorization')
  const token = authHeader?.replace('Bearer ', '')
  
  const client = createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    },
  })
  
  return client
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // Get user from session
    const client = getSupabaseClient(request)
    const { data: { session }, error: sessionError } = await client.auth.getSession()
    
    if (sessionError || !session?.user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const userId = session.user.id
    const toolId = params.id

    // Type assertion to work around Proxy type issues
    const admin = supabaseAdmin as any
    
    // Check if upvote already exists
    const { data: existing } = await admin
      .from('upvote')
      .select('id')
      .eq('userId', userId)
      .eq('toolId', toolId)
      .single()

    if (existing) {
      return NextResponse.json(
        { error: 'Already upvoted' },
        { status: 400 }
      )
    }

    // Create upvote
    const { error: insertError } = await admin
      .from('upvote')
      .insert([{ userId, toolId }])

    if (insertError) {
      console.error('Error creating upvote:', insertError)
      return NextResponse.json(
        { error: 'Failed to upvote' },
        { status: 500 }
      )
    }

    // Get updated upvote count
    const { count } = await admin
      .from('upvote')
      .select('*', { count: 'exact', head: true })
      .eq('toolId', toolId)

    return NextResponse.json({
      upvoteCount: count || 0,
      userUpvoted: true,
    })
  } catch (error: any) {
    console.error('Error in POST upvote:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // Get user from session
    const client = getSupabaseClient(request)
    const { data: { session }, error: sessionError } = await client.auth.getSession()
    
    if (sessionError || !session?.user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const userId = session.user.id
    const toolId = params.id

    // Type assertion to work around Proxy type issues
    const admin = supabaseAdmin as any
    
    // Delete upvote
    const { error: deleteError } = await admin
      .from('upvote')
      .delete()
      .eq('userId', userId)
      .eq('toolId', toolId)

    if (deleteError) {
      console.error('Error deleting upvote:', deleteError)
      return NextResponse.json(
        { error: 'Failed to remove upvote' },
        { status: 500 }
      )
    }

    // Get updated upvote count
    const { count } = await admin
      .from('upvote')
      .select('*', { count: 'exact', head: true })
      .eq('toolId', toolId)

    return NextResponse.json({
      upvoteCount: count || 0,
      userUpvoted: false,
    })
  } catch (error: any) {
    console.error('Error in DELETE upvote:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

