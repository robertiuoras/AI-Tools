import { prisma } from '@/lib/db'
import { NextResponse } from 'next/server'

export async function GET() {
  try {
    // Check if DATABASE_URL is set
    const hasDatabaseUrl = !!process.env.DATABASE_URL
    const databaseUrlPreview = process.env.DATABASE_URL 
      ? process.env.DATABASE_URL.substring(0, 50) + '...' 
      : 'NOT SET'
    
    // Try to connect
    const count = await prisma.tool.count()
    
    return NextResponse.json({ 
      success: true,
      message: 'Database connection successful!',
      toolCount: count,
      databaseUrlSet: hasDatabaseUrl,
      databaseUrlPreview,
      timestamp: new Date().toISOString(),
    })
  } catch (error: any) {
    return NextResponse.json({ 
      success: false,
      error: error.message,
      errorName: error.name,
      databaseUrlSet: !!process.env.DATABASE_URL,
      databaseUrlPreview: process.env.DATABASE_URL 
        ? process.env.DATABASE_URL.substring(0, 50) + '...' 
        : 'NOT SET',
      timestamp: new Date().toISOString(),
    }, { status: 500 })
  }
}

