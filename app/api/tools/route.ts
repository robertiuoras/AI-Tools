import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
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

    let where: any = {}

    if (category) {
      where.category = category
    }

    if (traffic.length > 0) {
      where.traffic = { in: traffic }
    }

    if (revenue.length > 0) {
      where.revenue = { in: revenue }
    }

    // Note: SQLite doesn't support case-insensitive search natively
    // For production with PostgreSQL, add mode: 'insensitive' to contains queries

    let orderBy: any = {}
    if (sort === 'alphabetical') {
      orderBy.name = order
    } else if (sort === 'newest') {
      orderBy.createdAt = order === 'asc' ? 'desc' : 'asc'
    } else if (sort === 'popular') {
      orderBy.rating = order === 'asc' ? 'desc' : 'asc'
    } else if (sort === 'traffic') {
      orderBy.estimatedVisits = order === 'asc' ? 'desc' : 'asc'
    }

    let tools = await prisma.tool.findMany({
      where,
      orderBy,
    })

    // Apply case-insensitive search filter in memory for SQLite compatibility
    if (search) {
      const searchLower = search.toLowerCase()
      tools = tools.filter(
        (tool) =>
          tool.name.toLowerCase().includes(searchLower) ||
          tool.description.toLowerCase().includes(searchLower) ||
          (tool.tags && tool.tags.toLowerCase().includes(searchLower))
      )
    }

    return NextResponse.json(tools)
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

    // Prepare data for Prisma - ensure types match schema exactly
    const prismaData: any = {
      name: validatedData.name,
      description: validatedData.description,
      url: validatedData.url,
      category: validatedData.category,
    }

    // Handle optional fields - convert empty strings to null
    if (validatedData.logoUrl && validatedData.logoUrl.trim()) {
      prismaData.logoUrl = validatedData.logoUrl.trim()
    } else {
      prismaData.logoUrl = null
    }

    if (validatedData.tags && validatedData.tags.trim()) {
      prismaData.tags = validatedData.tags.trim()
    } else {
      prismaData.tags = null
    }

    if (validatedData.traffic) {
      prismaData.traffic = validatedData.traffic
    } else {
      prismaData.traffic = null
    }

    if (validatedData.revenue) {
      prismaData.revenue = validatedData.revenue
    } else {
      prismaData.revenue = null
    }

    if (validatedData.rating !== undefined && validatedData.rating !== null) {
      prismaData.rating = validatedData.rating
    } else {
      prismaData.rating = null
    }

    if (validatedData.estimatedVisits !== undefined && validatedData.estimatedVisits !== null) {
      prismaData.estimatedVisits = validatedData.estimatedVisits
    } else {
      prismaData.estimatedVisits = null
    }

    console.log('Prisma data:', JSON.stringify(prismaData, null, 2))

    const tool = await prisma.tool.create({
      data: prismaData,
    })

    console.log('Tool created successfully:', tool.id)
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
    
    // Handle Prisma errors
    if (error instanceof Error) {
      console.error('Prisma error details:', {
        name: error.name,
        message: error.message,
        stack: error.stack,
      })
      
      // Extract more details from Prisma errors
      let errorMessage = error.message
      if (error.message.includes('Invalid')) {
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

