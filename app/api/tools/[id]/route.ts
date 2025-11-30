import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { toolSchema } from '@/lib/schemas'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { data: tool, error } = await supabaseAdmin
      .from('tool')
      .select('*')
      .eq('id', params.id)
      .single()

    if (error || !tool) {
      return NextResponse.json({ error: 'Tool not found' }, { status: 404 })
    }

    return NextResponse.json(tool)
  } catch (error) {
    console.error('Error fetching tool:', error)
    return NextResponse.json(
      { error: 'Failed to fetch tool' },
      { status: 500 }
    )
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json()
    const validatedData = toolSchema.parse(body)

    // Prepare data for Supabase - handle null values
    const updateData: any = {
      name: validatedData.name,
      description: validatedData.description,
      url: validatedData.url,
      category: validatedData.category,
      logoUrl: validatedData.logoUrl || null,
      tags: validatedData.tags || null,
      traffic: validatedData.traffic || null,
      revenue: validatedData.revenue || null,
      rating: validatedData.rating ?? null,
      estimatedVisits: validatedData.estimatedVisits ?? null,
      updatedAt: new Date().toISOString(), // Update timestamp
    }

    const { data: tool, error } = await supabaseAdmin
      .from('tool')
      .update(updateData)
      .eq('id', params.id)
      .select()
      .single()

    if (error) {
      console.error('Error updating tool:', error)
      return NextResponse.json(
        { error: 'Failed to update tool', details: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json(tool)
  } catch (error) {
    console.error('Error updating tool:', error)
    if (error && typeof error === 'object' && 'issues' in error) {
      return NextResponse.json(
        { error: 'Validation error', details: error },
        { status: 400 }
      )
    }
    return NextResponse.json(
      { error: 'Failed to update tool' },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { error } = await supabaseAdmin
      .from('tool')
      .delete()
      .eq('id', params.id)

    if (error) {
      console.error('Error deleting tool:', error)
      return NextResponse.json(
        { error: 'Failed to delete tool', details: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting tool:', error)
    return NextResponse.json(
      { error: 'Failed to delete tool' },
      { status: 500 }
    )
  }
}

