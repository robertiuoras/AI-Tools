import { NextResponse } from 'next/server'

// Mark this route as dynamic
export const dynamic = 'force-dynamic'

export async function GET() {
  const diagnostics: any = {
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
    checks: {},
  }

  // Check 1: DATABASE_URL exists
  diagnostics.checks.databaseUrlExists = !!process.env.DATABASE_URL

  // Check 2: DATABASE_URL format
  if (process.env.DATABASE_URL) {
    try {
      const url = new URL(process.env.DATABASE_URL)
      diagnostics.checks.urlFormat = 'valid'
      diagnostics.checks.protocol = url.protocol
      diagnostics.checks.hostname = url.hostname
      diagnostics.checks.port = url.port || '5432'
      diagnostics.checks.username = url.username
      diagnostics.checks.database = url.pathname
      diagnostics.checks.hasSslMode = url.search.includes('sslmode')
      diagnostics.checks.sslModeValue = url.searchParams.get('sslmode')
      diagnostics.checks.fullUrlPreview = `${url.protocol}//${url.username}@${url.hostname}:${url.port || '5432'}${url.pathname}${url.search}`
    } catch (e) {
      diagnostics.checks.urlFormat = 'invalid'
      diagnostics.checks.urlError = e instanceof Error ? e.message : String(e)
    }
  }

  // Check 3: Try Supabase connection (we're using Supabase API now, not Prisma)
  try {
    const { supabaseAdmin } = await import('@/lib/supabase')
    diagnostics.checks.supabaseImport = 'success'
    
    // Check 4: Try actual connection
    try {
      const admin = supabaseAdmin as any
      const { data, error } = await admin.from('tool').select('id').limit(1)
      
      if (error) {
        diagnostics.checks.connection = 'failed'
        diagnostics.checks.connectionError = error.message
        diagnostics.checks.connectionErrorCode = error.code
      } else {
        diagnostics.checks.connection = 'success'
        diagnostics.checks.query = 'success'
        
        // Get count
        const { count } = await admin
          .from('tool')
          .select('*', { count: 'exact', head: true })
        diagnostics.checks.toolCount = count || 0
      }
    } catch (connError: any) {
      diagnostics.checks.connection = 'failed'
      diagnostics.checks.connectionError = connError.message
      diagnostics.checks.connectionErrorCode = connError.code
      diagnostics.checks.connectionErrorName = connError.name
    }
  } catch (importError: any) {
    diagnostics.checks.supabaseImport = 'failed'
    diagnostics.checks.importError = importError.message
  }

  // Check 5: Environment info
  diagnostics.checks.vercel = !!process.env.VERCEL
  diagnostics.checks.nodeEnv = process.env.NODE_ENV

  return NextResponse.json(diagnostics, {
    status: diagnostics.checks.connection === 'success' ? 200 : 500,
  })
}

