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
    console.error('Error fetching tools:', error)
    // Return empty array instead of error object to prevent frontend crashes
    // In production, you might want to log this to an error tracking service
    return NextResponse.json([], { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    console.log('Received tool data:', body)
    
    const validatedData = toolSchema.parse(body)
    console.log('Validated data:', validatedData)

    const tool = await prisma.tool.create({
      data: validatedData,
    })

    console.log('Tool created successfully:', tool.id)
    return NextResponse.json(tool, { status: 201 })
  } catch (error) {
    console.error('Error creating tool:', error)
    
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
      return NextResponse.json(
        { error: 'Failed to create tool', message: error.message },
        { status: 500 }
      )
    }
    
    return NextResponse.json(
      { error: 'Failed to create tool', message: 'Unknown error' },
      { status: 500 }
    )
  }
}

