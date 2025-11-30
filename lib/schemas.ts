import { z } from 'zod'

// Pre-process schema to handle empty strings
const preprocessTool = z.preprocess((data: any) => {
  if (typeof data === 'object' && data !== null) {
    return {
      ...data,
      logoUrl: data.logoUrl === '' ? null : data.logoUrl,
      tags: data.tags === '' ? null : data.tags,
      traffic: data.traffic === '' ? null : data.traffic,
      revenue: data.revenue === '' ? null : data.revenue,
    }
  }
  return data
}, z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().min(1, 'Description is required'),
  url: z.string().url('Must be a valid URL'),
  logoUrl: z.union([z.string().url('Must be a valid URL'), z.null()]).optional().nullable(),
  category: z.string().min(1, 'Category is required'),
  tags: z.string().optional().nullable(),
  traffic: z.enum(['low', 'medium', 'high', 'unknown']).optional().nullable(),
  revenue: z.enum(['free', 'freemium', 'paid', 'enterprise']).optional().nullable(),
  rating: z.number().min(0).max(5).optional().nullable(),
  estimatedVisits: z.number().int().positive().optional().nullable(),
}))

export const toolSchema = preprocessTool

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

