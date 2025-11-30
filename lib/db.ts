import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// Validate DATABASE_URL
const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  throw new Error('DATABASE_URL environment variable is not set')
}

// Remove quotes if present (common mistake)
const cleanDatabaseUrl = databaseUrl.trim().replace(/^["']|["']$/g, '')

if (!cleanDatabaseUrl.startsWith('postgresql://') && !cleanDatabaseUrl.startsWith('postgres://')) {
  throw new Error(
    `Invalid DATABASE_URL: must start with postgresql:// or postgres://. Got: ${cleanDatabaseUrl.substring(0, 20)}...`
  )
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

