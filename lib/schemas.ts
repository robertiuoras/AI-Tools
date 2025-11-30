import { z } from 'zod'

export const toolSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().min(1, 'Description is required'),
  url: z.string().url('Must be a valid URL'),
  logoUrl: z.union([z.string().url('Must be a valid URL'), z.literal('')]).optional().nullable(),
  category: z.string().min(1, 'Category is required'),
  tags: z.string().optional().nullable(),
  traffic: z.enum(['low', 'medium', 'high', 'unknown']).optional().nullable(),
  revenue: z.enum(['free', 'freemium', 'paid', 'enterprise']).optional().nullable(),
  rating: z.number().min(0).max(5).optional().nullable(),
  estimatedVisits: z.number().int().positive().optional().nullable(),
}).transform((data) => {
  // Transform empty strings to null for string fields only
  // Note: traffic and revenue are enums, so they can't be empty strings
  return {
    ...data,
    logoUrl: (data.logoUrl === '' || data.logoUrl === null) ? null : data.logoUrl,
    tags: (data.tags === '' || data.tags === null) ? null : data.tags,
    // traffic and revenue are enums, so they're either the enum value or null/undefined
    traffic: data.traffic || null,
    revenue: data.revenue || null,
  }
})

export type ToolInput = z.infer<typeof toolSchema>

export const categories = [
  'Video Editing',
  'AI Automation',
  'SaaS',
  'Image Generation',
  'Code Assistants',
  'Writing',
  'Productivity',
  'Design',
  'Marketing',
  'Analytics',
  'Other',
] as const

export type Category = typeof categories[number]

