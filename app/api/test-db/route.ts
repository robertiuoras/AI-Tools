import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

// Mark this route as dynamic
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    // Check if DATABASE_URL is set
    const hasDatabaseUrl = !!process.env.DATABASE_URL
    let databaseUrlPreview = 'NOT SET'
    let hostname = 'unknown'
    let port = 'unknown'
    let hasSslMode = false
    
    if (process.env.DATABASE_URL) {
      try {
        const url = new URL(process.env.DATABASE_URL)
        hostname = url.hostname
        port = url.port || '5432'
        hasSslMode = url.search.includes('sslmode')
        databaseUrlPreview = `${url.protocol}//${url.username}@${hostname}:${port}${url.pathname}${url.search}`
      } catch (e) {
        databaseUrlPreview = process.env.DATABASE_URL.substring(0, 50) + '...'
      }
    }
    
    // Test Supabase connection
    const admin = supabaseAdmin as any
    
    // Try to query with timeout
    const { count, error } = await Promise.race([
      admin.from('tool').select('*', { count: 'exact', head: true }),
      new Promise<{ count: null; error: Error }>((_, reject) => 
        setTimeout(() => reject(new Error('Connection timeout after 10 seconds')), 10000)
      ),
    ]) as { count: number | null; error?: any }
    
    if (error) {
      throw error
    }
    
    return NextResponse.json({ 
      success: true,
      message: 'Database connection successful!',
      toolCount: count,
      databaseUrlSet: hasDatabaseUrl,
      databaseUrlPreview,
      hostname,
      port,
      hasSslMode,
      timestamp: new Date().toISOString(),
    })
  } catch (error: any) {
    return NextResponse.json({ 
      success: false,
      error: error.message,
      errorName: error.name,
      errorCode: error.code,
      databaseUrlSet: !!process.env.DATABASE_URL,
      databaseUrlPreview: process.env.DATABASE_URL 
        ? (() => {
            try {
              const url = new URL(process.env.DATABASE_URL!)
              return `${url.protocol}//${url.username}@${url.hostname}:${url.port || '5432'}${url.pathname}${url.search}`
            } catch {
              return process.env.DATABASE_URL!.substring(0, 50) + '...'
            }
          })()
        : 'NOT SET',
      hostname: process.env.DATABASE_URL ? (() => {
        try {
          return new URL(process.env.DATABASE_URL!).hostname
        } catch {
          return 'unknown'
        }
      })() : 'unknown',
      hasSslMode: process.env.DATABASE_URL ? process.env.DATABASE_URL.includes('sslmode') : false,
      timestamp: new Date().toISOString(),
    }, { status: 500 })
  }
}

