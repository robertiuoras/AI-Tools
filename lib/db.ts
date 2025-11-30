import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// Validate DATABASE_URL
const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  console.error('❌ DATABASE_URL environment variable is not set')
  throw new Error('DATABASE_URL environment variable is not set')
}

// Remove quotes if present (common mistake)
const cleanDatabaseUrl = databaseUrl.trim().replace(/^["']|["']$/g, '')

if (!cleanDatabaseUrl.startsWith('postgresql://') && !cleanDatabaseUrl.startsWith('postgres://')) {
  console.error('❌ Invalid DATABASE_URL format:', cleanDatabaseUrl.substring(0, 50))
  throw new Error(
    `Invalid DATABASE_URL: must start with postgresql:// or postgres://. Got: ${cleanDatabaseUrl.substring(0, 20)}...`
  )
}

// Log connection info (without password) - helps debug Vercel issues
try {
  const urlObj = new URL(cleanDatabaseUrl)
  const safeUrl = `${urlObj.protocol}//${urlObj.username}@${urlObj.hostname}:${urlObj.port}${urlObj.pathname}${urlObj.search}`
  console.log('🔌 Database connection:', safeUrl)
  console.log('🔌 Hostname:', urlObj.hostname)
  console.log('🔌 Port:', urlObj.port)
  console.log('🔌 Has SSL mode:', urlObj.search.includes('sslmode'))
} catch (e) {
  console.error('❌ Error parsing DATABASE_URL:', e)
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasources: {
      db: {
        url: cleanDatabaseUrl,
      },
    },
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

// Log connection attempt in production for debugging
if (process.env.NODE_ENV === 'production') {
  console.log('🔍 Attempting database connection...')
  console.log('🔍 Hostname:', new URL(cleanDatabaseUrl).hostname)
  console.log('🔍 Port:', new URL(cleanDatabaseUrl).port || '5432')
  console.log('🔍 Has SSL:', cleanDatabaseUrl.includes('sslmode=require'))
}

