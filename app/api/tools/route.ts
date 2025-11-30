import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase'
import { toolSchema } from '@/lib/schemas'

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const category = searchParams.get('category')
    const traffic = searchParams.getAll('traffic')
    const revenue = searchParams.getAll('revenue')
    const search = searchParams.get('search')
    const sort = searchParams.get('sort') || 'alphabetical'
    const order = searchParams.get('order') || 'asc'


    // Build Supabase query
    // Note: Supabase table names are case-sensitive. Use lowercase 'tool' if that's what's in your database
    let query = supabaseAdmin.from('tool').select('*')

    // Apply filters
    if (category) {
      query = query.eq('category', category)
    }

    if (traffic.length > 0) {
      query = query.in('traffic', traffic)
    }

    if (revenue.length > 0) {
      query = query.in('revenue', revenue)
    }

    // Apply search filter
    if (search) {
      const searchLower = search.toLowerCase()
      // Supabase doesn't support OR queries easily, so we'll filter in memory
      // For better performance, you could use full-text search if enabled
    }

    // Apply sorting
    if (sort === 'alphabetical') {
      query = query.order('name', { ascending: order === 'asc' })
    } else if (sort === 'newest') {
      query = query.order('createdAt', { ascending: order !== 'asc' })
    } else if (sort === 'popular') {
      query = query.order('rating', { ascending: order === 'asc', nullsFirst: false })
    } else if (sort === 'traffic') {
      query = query.order('estimatedVisits', { ascending: order === 'asc', nullsFirst: false })
    }

    const { data: tools, error } = await query

    if (error) {
      console.error('❌ Supabase error fetching tools:', error)
      return NextResponse.json([], { status: 200 })
    }

    // Apply case-insensitive search filter in memory
    let filteredTools = tools || []
    if (search) {
      const searchLower = search.toLowerCase()
      filteredTools = filteredTools.filter(
        (tool: any) =>
          tool.name?.toLowerCase().includes(searchLower) ||
          tool.description?.toLowerCase().includes(searchLower) ||
          (tool.tags && tool.tags.toLowerCase().includes(searchLower))
      )
    }

    return NextResponse.json(filteredTools)
  } catch (error) {
    console.error('❌ Error fetching tools:', error)
    console.error('Error type:', error instanceof Error ? error.name : typeof error)
    console.error('Error message:', error instanceof Error ? error.message : String(error))
    
    // Return empty array with 200 status to prevent frontend crashes
    // The frontend will show "No tools found" which is better UX than crashing
    // In production, you might want to log this to an error tracking service
    return NextResponse.json([], { status: 200 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    console.log('Received tool data:', body)
    
    const validatedData = toolSchema.parse(body)
    console.log('Validated data:', validatedData)

    // Generate ID for Supabase (Supabase doesn't auto-generate like Prisma)
    const id = randomUUID()

    // Prepare data for Supabase - ensure types match schema exactly
    const supabaseData: any = {
      id,
      name: validatedData.name,
      description: validatedData.description,
      url: validatedData.url,
      category: validatedData.category,
    }

    // Handle optional fields - convert empty strings to null
    if (validatedData.logoUrl && validatedData.logoUrl.trim()) {
      supabaseData.logoUrl = validatedData.logoUrl.trim()
    } else {
      supabaseData.logoUrl = null
    }

    if (validatedData.tags && validatedData.tags.trim()) {
      supabaseData.tags = validatedData.tags.trim()
    } else {
      supabaseData.tags = null
    }

    if (validatedData.traffic) {
      supabaseData.traffic = validatedData.traffic
    } else {
      supabaseData.traffic = null
    }

    if (validatedData.revenue) {
      supabaseData.revenue = validatedData.revenue
    } else {
      supabaseData.revenue = null
    }

    if (validatedData.rating !== undefined && validatedData.rating !== null) {
      supabaseData.rating = validatedData.rating
    } else {
      supabaseData.rating = null
    }

    if (validatedData.estimatedVisits !== undefined && validatedData.estimatedVisits !== null) {
      supabaseData.estimatedVisits = validatedData.estimatedVisits
    } else {
      supabaseData.estimatedVisits = null
    }

    // Add timestamps
    const now = new Date().toISOString()
    supabaseData.createdAt = now
    supabaseData.updatedAt = now

    console.log('Supabase data:', JSON.stringify(supabaseData, null, 2))

    const { data: tool, error } = await supabaseAdmin
      .from('tool')
      .insert(supabaseData)
      .select()
      .single()

    if (error) {
      console.error('❌ Supabase error creating tool:', error)
      return NextResponse.json(
        {
          error: 'Failed to create tool',
          message: error.message,
          details: error,
        },
        { status: 500 }
      )
    }

    console.log('Tool created successfully:', tool?.id)
    return NextResponse.json(tool, { status: 201 })
  } catch (error) {
    console.error('Error creating tool:', error)
    console.error('Error type:', typeof error)
    console.error('Error name:', error instanceof Error ? error.name : 'Unknown')
    console.error('Full error:', JSON.stringify(error, Object.getOwnPropertyNames(error), 2))
    
    // Handle Zod validation errors
    if (error && typeof error === 'object' && 'issues' in error) {
      const zodError = error as { issues: Array<{ path: string[]; message: string }> }
      const errorMessages = zodError.issues.map(issue => 
        `${issue.path.join('.')}: ${issue.message}`
      ).join(', ')
      
      return NextResponse.json(
        { 
          error: 'Validation error', 
          details: errorMessages,
          issues: zodError.issues 
        },
        { status: 400 }
      )
    }
    
    // Handle Supabase errors
    if (error instanceof Error) {
      console.error('Supabase error details:', {
        name: error.name,
        message: error.message,
        stack: error.stack,
      })
      
      // Extract more details from Supabase errors
      let errorMessage = error.message
      if (error.message.includes('Invalid') || error.message.includes('violates')) {
        errorMessage = `Database error: ${error.message}. Check that all required fields are provided and data types are correct.`
      }
      
      return NextResponse.json(
        { 
          error: 'Failed to create tool', 
          message: errorMessage,
          details: error.stack,
        },
        { status: 500 }
      )
    }
    
    return NextResponse.json(
      { error: 'Failed to create tool', message: 'Unknown error', details: String(error) },
      { status: 500 }
    )
  }
}

