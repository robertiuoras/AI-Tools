import { NextRequest, NextResponse } from 'next/server'
import { categories, normalizeToolCategory } from '@/lib/schemas'

/** Normalize + dedupe AI category output; cap length; primary = first. */
function categoriesFromAiContent(content: {
  categories?: unknown
  category?: unknown
}): string[] {
  let list: string[] = []
  if (Array.isArray(content.categories) && content.categories.length > 0) {
    list = content.categories.map((c) => normalizeToolCategory(String(c)))
  } else if (content.category != null && String(content.category).trim()) {
    list = [normalizeToolCategory(String(content.category))]
  } else {
    list = ['Other']
  }
  const seen = new Set<string>()
  const out: string[] = []
  for (const c of list) {
    if (c && !seen.has(c)) {
      seen.add(c)
      out.push(c)
    }
  }
  return out.slice(0, 5)
}

interface AnalysisResult {
  name: string
  description: string
  /** Primary category (same as categories[0]) */
  category: string
  /** 1–5 labels from the allowed list, best match first */
  categories: string[]
  tags: string
  revenue: 'free' | 'freemium' | 'paid' | 'enterprise' | null
  traffic: 'low' | 'medium' | 'high' | 'unknown'
  rating: number | null
  estimatedVisits: number | null
  logoUrl: string | null
  _debug?: {
    usedOpenAI: boolean
    apiKeyFound: boolean
    error?: string
    scrapingFailed?: boolean
    scrapingError?: string
  }
}

/**
 * Try to fetch pricing page content
 */
async function fetchPricingInfo(baseUrl: string): Promise<string> {
  try {
    const urlObj = new URL(baseUrl)
    const pricingPaths = ['/pricing', '/plans', '/prices', '/subscribe', '/purchase', '/buy']
    
    for (const path of pricingPaths) {
      const pricingUrl = `${urlObj.origin}${path}`
      try {
        console.log('🔍 [Pricing] Trying:', pricingUrl)
        const response = await fetch(pricingUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          },
          signal: AbortSignal.timeout(5000), // 5 second timeout
        })
      
      if (response.ok) {
        const html = await response.text()
        // Extract text content (remove HTML tags)
        const text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .toLowerCase()
        
        if (text.length > 100) {
          // Limit pricing content to reduce tokens
          return text.substring(0, 2000) // Reduced from unlimited to 2000 chars
        }
      }
    } catch (error) {
      // Continue to next path
      console.log('⚠️ [Pricing] Failed to fetch:', pricingUrl, error instanceof Error ? error.message : String(error))
      continue
    }
  }
  } catch (error) {
    console.error('❌ [Pricing] Error in fetchPricingInfo:', error)
  }
  
  return ''
}

/**
 * Extract basic info from website metadata
 */
async function scrapeWebsiteInfo(url: string): Promise<{
  title: string
  description: string
  logoUrl: string | null
  pricingContent: string
  pageContent: string
}> {
  try {
    // Validate and normalize URL
    let validUrl: URL
    try {
      // Ensure URL has protocol
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = `https://${url}`
      }
      validUrl = new URL(url)
      console.log('🌐 [Scrape] Fetching URL:', validUrl.toString())
    } catch (error) {
      console.error('❌ [Scrape] Invalid URL format:', url, error)
      return { title: '', description: '', logoUrl: null, pricingContent: '', pageContent: '' }
    }

    const response = await fetch(validUrl.toString(), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
      },
      signal: AbortSignal.timeout(15000), // 15 second timeout
    })
    
    if (!response.ok) {
      console.error('❌ [Scrape] HTTP error:', response.status, response.statusText)
      console.error('❌ [Scrape] Response headers:', Object.fromEntries(response.headers.entries()))
      
      // Create error with context
      const error = new Error(`HTTP ${response.status}: ${response.statusText}`) as Error & {
        statusCode?: number
        errorType?: string
        isWebsiteError?: boolean
      }
      error.statusCode = response.status
      error.isWebsiteError = true
      
      // Categorize error
      if (response.status === 429) {
        error.errorType = 'website_rate_limit'
      } else if (response.status === 403) {
        error.errorType = 'website_blocked'
      } else if (response.status >= 500) {
        error.errorType = 'website_server_error'
      } else {
        error.errorType = 'website_error'
      }
      
      throw error
    }
    
    const html = await response.text()
    console.log('✅ [Scrape] Successfully fetched HTML, length:', html.length)
    
    if (html.length < 100) {
      console.warn('⚠️ [Scrape] HTML content is very short, may be blocked or invalid')
    }

    // Extract title
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i)
    const title = titleMatch ? titleMatch[1].trim() : ''

    // Extract meta description
    const descMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i)
    const description = descMatch ? descMatch[1].trim() : ''

    // Extract page content for better analysis (reduced for token optimization)
    let pageContent = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .substring(0, 3000) // Reduced from 5000 to 3000 chars for token optimization
      .toLowerCase()

    // Try to find logo/favicon with multiple fallback methods
    let logoUrl: string | null = null
    const urlObj = new URL(url)
    
    // Method 1: Try favicon link tags (multiple variations)
    const faviconPatterns = [
      /<link[^>]*rel=["'](?:icon|shortcut icon|apple-touch-icon|apple-touch-icon-precomposed)["'][^>]*href=["']([^"']+)["']/i,
      /<link[^>]*href=["']([^"']+)["'][^>]*rel=["'](?:icon|shortcut icon|apple-touch-icon)["']/i,
    ]
    
    for (const pattern of faviconPatterns) {
      const match = html.match(pattern)
      if (match) {
        const logoPath = match[1]
        try {
          logoUrl = logoPath.startsWith('http') 
            ? logoPath 
            : new URL(logoPath, url).toString()
          // Verify it's a valid URL
          if (logoUrl) break
        } catch (e) {
          continue
        }
      }
    }
    
    // Method 2: Try og:image (often higher quality)
    if (!logoUrl) {
      const ogImageMatch = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i)
      if (ogImageMatch) {
        try {
          logoUrl = ogImageMatch[1]
        } catch (e) {
          // Continue to next method
        }
      }
    }
    
    // Method 3: Try common favicon paths
    if (!logoUrl) {
      const commonPaths = [
        '/favicon.ico',
        '/favicon.png',
        '/logo.png',
        '/logo.svg',
        '/apple-touch-icon.png',
        '/images/logo.png',
        '/assets/logo.png',
        '/static/logo.png',
      ]
      
      for (const path of commonPaths) {
        try {
          const testUrl = new URL(path, url).toString()
          // We'll let the frontend handle 404s, but construct valid URLs
          logoUrl = testUrl
          break
        } catch (e) {
          continue
        }
      }
    }
    
    // Method 4: Try to find logo in common class/id patterns
    if (!logoUrl) {
      const logoImgMatch = html.match(/<img[^>]*(?:class|id)=["'][^"']*logo[^"']*["'][^>]*src=["']([^"']+)["']/i)
      if (logoImgMatch) {
        try {
          const logoPath = logoImgMatch[1]
          logoUrl = logoPath.startsWith('http') 
            ? logoPath 
            : new URL(logoPath, url).toString()
        } catch (e) {
          // Continue
        }
      }
    }

    // Try to get pricing information
    console.log('🔍 [Scrape] Fetching pricing info...')
    const pricingContent = await fetchPricingInfo(validUrl.toString())
    console.log('✅ [Scrape] Pricing content length:', pricingContent.length)

    return { title, description, logoUrl, pricingContent, pageContent }
  } catch (error) {
    console.error('❌ [Scrape] Error scraping website:', error)
    console.error('❌ [Scrape] Error type:', error instanceof Error ? error.constructor.name : typeof error)
    console.error('❌ [Scrape] Error message:', error instanceof Error ? error.message : String(error))
    if (error instanceof Error && 'cause' in error) {
      console.error('❌ [Scrape] Error cause:', error.cause)
    }
    // Re-throw error instead of returning empty data
    throw error
  }
}

/**
 * Use AI to analyze and categorize the tool
 */
async function analyzeWithAI(
  url: string,
  title: string,
  description: string,
  pricingContent: string,
  pageContent: string
): Promise<Partial<AnalysisResult>> {
  // Check for API key in multiple possible locations
  const openaiApiKey = process.env.OPENAI_API_KEY || process.env.NEXT_PUBLIC_OPENAI_API_KEY

  console.log('🔍 [OpenAI Check] ==========================================')
  console.log('🔍 [OpenAI Check] Checking for OpenAI API key...')
  console.log('🔍 [OpenAI Check] OPENAI_API_KEY exists:', !!process.env.OPENAI_API_KEY)
  console.log('🔍 [OpenAI Check] NEXT_PUBLIC_OPENAI_API_KEY exists:', !!process.env.NEXT_PUBLIC_OPENAI_API_KEY)
  console.log('🔍 [OpenAI Check] Final key exists:', !!openaiApiKey)
  console.log('🔍 [OpenAI Check] Key length:', openaiApiKey?.length || 0)
  console.log('🔍 [OpenAI Check] Key starts with:', openaiApiKey?.substring(0, 10) || 'N/A')
  console.log('🔍 [OpenAI Check] Key format valid:', openaiApiKey?.startsWith('sk-') || false)
  console.log('🔍 [OpenAI Check] Environment:', process.env.NODE_ENV)
  console.log('🔍 [OpenAI Check] All OPENAI env vars:', Object.keys(process.env).filter(k => k.toUpperCase().includes('OPENAI')))
  console.log('🔍 [OpenAI Check] ==========================================')

  if (!openaiApiKey) {
    // OpenAI is required - no fallback
    console.error('❌ [OpenAI] ==========================================')
    console.error('❌ [OpenAI] API key not found!')
    console.error('❌ [OpenAI] Checked: OPENAI_API_KEY and NEXT_PUBLIC_OPENAI_API_KEY')
    console.error('❌ [OpenAI] OpenAI is REQUIRED - no fallback available')
    console.error('❌ [OpenAI] To fix: Add OPENAI_API_KEY to your environment variables')
    console.error('❌ [OpenAI] ==========================================')
    throw new Error('OPENAI_API_KEY is required. Please add it to your environment variables.')
  }

  // Validate API key format
  if (!openaiApiKey.startsWith('sk-')) {
    console.error('❌ [OpenAI] ==========================================')
    console.error('❌ [OpenAI] Invalid API key format!')
    console.error('❌ [OpenAI] OpenAI API keys should start with "sk-"')
    console.error('❌ [OpenAI] API key provided starts with:', openaiApiKey.substring(0, 5))
    console.error('❌ [OpenAI] OpenAI is REQUIRED - no fallback available')
    console.error('❌ [OpenAI] ==========================================')
    throw new Error('Invalid OpenAI API key format. Key must start with "sk-"')
  }
  
  console.log('✨ [OpenAI] ==========================================')
  console.log('✨ [OpenAI] ✅ API KEY FOUND AND VALID!')
  console.log('✨ [OpenAI] Using AI analysis with OpenAI')
  console.log('✨ [OpenAI] API Key present (first 10 chars):', openaiApiKey.substring(0, 10) + '...')
  console.log('✨ [OpenAI] API Key format: Valid (starts with sk-)')
  console.log('✨ [OpenAI] Model: gpt-4o-mini')
  console.log('✨ [OpenAI] ==========================================')

  try {
    // Optimize token usage - only send essential content
    const pricingContext = pricingContent 
      ? `\nPricing: ${pricingContent.substring(0, 1000)}`
      : ''
    
    const pageContext = pageContent
      ? `\nContent: ${pageContent.substring(0, 1000)}`
      : ''

    // Optimized prompt - concise but effective
    const prompt = `Analyze AI tool. Return JSON only.

URL: ${url}
Title: ${title}
Desc: ${description || 'N/A'}${pricingContext}${pageContext}

Revenue (MUST be accurate):
- "free": No paid options (open source, free forever)
- "freemium": Free tier + paid plans
- "paid": Only paid, no free
- "enterprise": Custom pricing, contact sales
- null: Cannot determine

Visits (search for numbers):
- Look for: "X million visits/users", "X million monthly", "XM visits"
- Convert users to visits: "2.5M users" = 7.5M visits (3x multiplier)
- If "millions" mentioned → 2-5M
- If "hundreds of thousands" → 300K-800K
- If "thousands" → 10K-50K
- Well-known tool → 1M-5M
- New/niche → 10K-100K
- null only if no indicators

Allowed categories (each entry in "categories" MUST be copied exactly from this list):
${categories.map((c) => `- "${c}"`).join('\n')}

Return JSON:
{
  "name": "Tool name (max 50 chars)",
  "description": "2-3 sentence description",
  "categories": ["Best fit", "Second fit", "Optional third"],
  "tags": "ai, tag1, tag2 (3-5 tags)",
  "revenue": "free|freemium|paid|enterprise|null",
  "traffic": "low|medium|high|unknown",
  "rating": 0-5 or null,
  "estimatedVisits": number or null
}

Rules:
- Revenue: Analyze pricing carefully
- Visits: Provide number if any indicators exist
- Tags: Always provide (even if generic)
- categories: 2–4 strings when the tool clearly spans multiple areas (e.g. SaaS + Productivity + AI Automation); 1 string if only one fits. Order by relevance (first = primary). Every value must match the allowed list exactly — spelling and spacing. No duplicates. Never use pipes inside strings.
- Return ONLY valid JSON, no markdown formatting`

    console.log('🚀 [OpenAI] ==========================================')
    console.log('🚀 [OpenAI] Making API request to OpenAI...')
    console.log('🚀 [OpenAI] Request URL:', 'https://api.openai.com/v1/chat/completions')
    console.log('🚀 [OpenAI] Prompt length:', prompt.length)
    console.log('🚀 [OpenAI] Pricing content length:', pricingContent.length)
    console.log('🚀 [OpenAI] Page content length:', pageContent.length)
    console.log('🚀 [OpenAI] Authorization header:', `Bearer ${openaiApiKey.substring(0, 10)}...`)
    console.log('🚀 [OpenAI] ==========================================')

    const requestBody = {
      model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'Analyze AI tools. Return valid JSON only.',
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0.3, // Lower temperature for more consistent, focused responses (saves tokens)
        response_format: { type: 'json_object' },
        max_tokens: 650, // Room for multi-category arrays
    }

    console.log('📤 [OpenAI] Request body (without prompt):', JSON.stringify({
      ...requestBody,
      messages: requestBody.messages.map(m => ({
        ...m,
        content: m.content.substring(0, 100) + '...'
      }))
    }, null, 2))

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${openaiApiKey}`,
      },
      body: JSON.stringify(requestBody),
    })

    console.log('📥 [OpenAI] ==========================================')
    console.log('📥 [OpenAI] Response status:', response.status)
    console.log('📥 [OpenAI] Response ok:', response.ok)
    console.log('📥 [OpenAI] Response headers:', Object.fromEntries(response.headers.entries()))

    if (!response.ok) {
      const errorText = await response.text()
      console.error('❌ [OpenAI] API error response:', errorText)
      console.error('❌ [OpenAI] Status:', response.status)
      console.error('❌ [OpenAI] Status text:', response.statusText)
      console.error('❌ [OpenAI] Response headers:', Object.fromEntries(response.headers.entries()))
      
      // Parse error for better handling
      let errorDetails: any = {}
      try {
        errorDetails = JSON.parse(errorText)
        console.error('❌ [OpenAI] Parsed error details:', JSON.stringify(errorDetails, null, 2))
      } catch (e) {
        console.error('❌ [OpenAI] Error response is not JSON:', errorText)
        errorDetails = { raw: errorText }
      }
      
      // Extract error message and type
      const rateLimitError = errorDetails?.error || errorDetails
      const message = rateLimitError?.message || errorText || 'Unknown error'
      const errorType = errorDetails?.error?.type || errorDetails?.type || 'unknown'
      const errorCode = errorDetails?.error?.code || errorDetails?.code
      
      // Check for different types of errors
      const isBillingError = message.includes('billing') || 
                            message.includes('payment') || 
                            message.includes('insufficient_quota') ||
                            errorCode === 'insufficient_quota' ||
                            response.status === 402
      
      const isOrgLimitError = message.includes('organization') ||
                             message.includes('org') ||
                             errorType === 'organization_quota_exceeded'
      
      const isAuthError = response.status === 401 || 
                         message.includes('invalid_api_key') ||
                         message.includes('authentication') ||
                         errorCode === 'invalid_api_key'
      
      // Handle rate limit errors specifically (429)
      if (response.status === 429 && !isBillingError && !isOrgLimitError) {
        // Check for retry-after header
        const retryAfterHeader = response.headers.get('retry-after')
        const retryAfter = retryAfterHeader || message.match(/try again in ([\d\w\s]+)/i)?.[1] || null
        
        console.error('❌ [OpenAI] ==========================================')
        console.error('❌ [OpenAI] RATE LIMIT EXCEEDED (429)!')
        console.error('❌ [OpenAI] Retry-After header:', retryAfterHeader || 'not provided')
        console.error('❌ [OpenAI] Retry after from message:', retryAfter)
        console.error('❌ [OpenAI] Full error message:', message)
        console.error('❌ [OpenAI] Error type:', errorType)
        console.error('❌ [OpenAI] Error code:', errorCode)
        console.error('❌ [OpenAI] Full error object:', JSON.stringify(errorDetails, null, 2))
        console.error('❌ [OpenAI] This is likely an RPM (Requests Per Minute) limit')
        console.error('❌ [OpenAI] Check your tier and limits at: https://platform.openai.com/account/limits')
        console.error('❌ [OpenAI] Check your usage at: https://platform.openai.com/usage')
        console.error('❌ [OpenAI] ==========================================')
        
        // More detailed error message
        let errorMsg = `OpenAI Rate Limit (429): ${message}`
        if (retryAfterHeader) {
          errorMsg += `. Retry after ${retryAfterHeader} seconds.`
        } else if (retryAfter) {
          errorMsg += `. Retry after ${retryAfter}.`
        }
        errorMsg += ` Check your limits at https://platform.openai.com/account/limits`
        
        // Throw error with additional context that will be caught by the POST handler
        const error = new Error(errorMsg) as Error & { 
          statusCode?: number
          details?: any
          retryAfter?: string | null
          errorType?: string
        }
        error.statusCode = 429
        error.details = errorDetails
        error.retryAfter = retryAfterHeader || retryAfter
        error.errorType = 'rate_limit'
        throw error
      }
      
      // Handle billing/quota errors
      if (isBillingError || response.status === 402) {
        console.error('❌ [OpenAI] ==========================================')
        console.error('❌ [OpenAI] BILLING/QUOTA ERROR!')
        console.error('❌ [OpenAI] This is NOT a rate limit - it\'s a billing issue')
        console.error('❌ [OpenAI] Error message:', message)
        console.error('❌ [OpenAI] Error type:', errorType)
        console.error('❌ [OpenAI] Error code:', errorCode)
        console.error('❌ [OpenAI] Full error object:', JSON.stringify(errorDetails, null, 2))
        console.error('❌ [OpenAI] Check your billing at: https://platform.openai.com/account/billing')
        console.error('❌ [OpenAI] Check your usage at: https://platform.openai.com/usage')
        console.error('❌ [OpenAI] ==========================================')
        
        const error = new Error(`OpenAI Billing/Quota Error: ${message}. This is NOT a rate limit. Check your billing and usage limits at https://platform.openai.com/account/billing`) as Error & {
          statusCode?: number
          details?: any
          errorType?: string
        }
        error.statusCode = response.status
        error.details = errorDetails
        error.errorType = 'billing'
        throw error
      }
      
      // Handle organization limit errors
      if (isOrgLimitError) {
        console.error('❌ [OpenAI] ==========================================')
        console.error('❌ [OpenAI] ORGANIZATION LIMIT ERROR!')
        console.error('❌ [OpenAI] This is an organization-level limit, not a rate limit')
        console.error('❌ [OpenAI] Error message:', message)
        console.error('❌ [OpenAI] Error type:', errorType)
        console.error('❌ [OpenAI] Error code:', errorCode)
        console.error('❌ [OpenAI] Full error object:', JSON.stringify(errorDetails, null, 2))
        console.error('❌ [OpenAI] Check your organization settings at: https://platform.openai.com/org-settings')
        console.error('❌ [OpenAI] ==========================================')
        
        const error = new Error(`OpenAI Organization Limit: ${message}. Check your organization settings at https://platform.openai.com/org-settings`) as Error & {
          statusCode?: number
          details?: any
          errorType?: string
        }
        error.statusCode = response.status
        error.details = errorDetails
        error.errorType = 'organization_limit'
        throw error
      }
      
      // Handle auth errors
      if (isAuthError) {
        console.error('❌ [OpenAI] ==========================================')
        console.error('❌ [OpenAI] AUTHENTICATION ERROR!')
        console.error('❌ [OpenAI] Error message:', message)
        console.error('❌ [OpenAI] Error type:', errorType)
        console.error('❌ [OpenAI] Error code:', errorCode)
        console.error('❌ [OpenAI] Full error object:', JSON.stringify(errorDetails, null, 2))
        console.error('❌ [OpenAI] Check your API key at: https://platform.openai.com/api-keys')
        console.error('❌ [OpenAI] ==========================================')
        
        const error = new Error(`OpenAI Authentication Error: ${message}. Check your API key at https://platform.openai.com/api-keys`) as Error & {
          statusCode?: number
          details?: any
          errorType?: string
        }
        error.statusCode = response.status
        error.details = errorDetails
        error.errorType = 'authentication'
        throw error
      }
      
      // For other errors, throw with context
      console.error('❌ [OpenAI] ==========================================')
      console.error('❌ [OpenAI] UNKNOWN ERROR!')
      console.error('❌ [OpenAI] Status:', response.status)
      console.error('❌ [OpenAI] Error message:', message)
      console.error('❌ [OpenAI] Error type:', errorType)
      console.error('❌ [OpenAI] Error code:', errorCode)
      console.error('❌ [OpenAI] Full error object:', JSON.stringify(errorDetails, null, 2))
      console.error('❌ [OpenAI] ==========================================')
      
      const error = new Error(`OpenAI API error (${response.status}): ${message}. Full details: ${JSON.stringify(errorDetails)}`) as Error & {
        statusCode?: number
        details?: any
        errorType?: string
      }
      error.statusCode = response.status
      error.details = errorDetails
      error.errorType = 'unknown'
      throw error
    }

    const data = await response.json()
    console.log('✅ [OpenAI] ==========================================')
    console.log('✅ [OpenAI] ✅ API RESPONSE RECEIVED SUCCESSFULLY!')
    console.log('✅ [OpenAI] Response ID:', data.id)
    console.log('✅ [OpenAI] Model used:', data.model)
    console.log('✅ [OpenAI] Usage:', JSON.stringify(data.usage, null, 2))
    console.log('✅ [OpenAI] Choices count:', data.choices?.length || 0)
    
    if (!data.choices || data.choices.length === 0) {
      throw new Error('OpenAI API returned no choices')
    }
    
    const content = JSON.parse(data.choices[0].message.content)
    console.log('✅ [OpenAI] Parsed content:', JSON.stringify(content, null, 2))
    console.log('✅ [OpenAI] ==========================================')

    const cats = categoriesFromAiContent(content)
    const result = {
      name: content.name || title,
      description: content.description || description,
      categories: cats,
      category: cats[0],
      tags: content.tags || '',
      revenue: content.revenue || null,
      traffic: content.traffic || 'unknown',
      rating: content.rating || null,
      estimatedVisits: content.estimatedVisits || null,
      _debug: {
        usedOpenAI: true,
        apiKeyFound: true,
      }
    }
    
    console.log('✅ [OpenAI] Final analysis result:', JSON.stringify(result, null, 2))
    console.log('✅ [OpenAI] Analysis complete!')
    console.log('✅ [OpenAI] ✅✅✅ OPENAI WAS SUCCESSFULLY USED ✅✅✅')
    
    return result
  } catch (error) {
    console.error('❌ [OpenAI] AI analysis error:', error)
    console.error('❌ [OpenAI] Error type:', error instanceof Error ? error.constructor.name : typeof error)
    console.error('❌ [OpenAI] Error message:', error instanceof Error ? error.message : String(error))
    console.error('❌ [OpenAI] OpenAI is REQUIRED - rethrowing error')
    throw error // Re-throw error since OpenAI is required
  }
}


export async function POST(request: NextRequest) {
  try {
    console.log('📋 [Analyze] Starting URL analysis...')
    const { url } = await request.json()
    console.log('📋 [Analyze] Received URL:', url)

    if (!url || typeof url !== 'string') {
      console.error('❌ [Analyze] Invalid URL provided')
      return NextResponse.json({ error: 'URL is required' }, { status: 400 })
    }

    // Validate URL - ensure it's a proper URL
    let validUrl: URL
    try {
      // Normalize URL - add protocol if missing
      let normalizedUrl = url.trim()
      if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
        normalizedUrl = `https://${normalizedUrl}`
      }
      validUrl = new URL(normalizedUrl)
      console.log('✅ [Analyze] Valid URL:', validUrl.toString())
      console.log('✅ [Analyze] URL hostname:', validUrl.hostname)
    } catch (error) {
      console.error('❌ [Analyze] Invalid URL format:', url, error)
      return NextResponse.json({ 
        error: `Invalid URL: ${url}`,
        details: error instanceof Error ? error.message : String(error)
      }, { status: 400 })
    }

    // Scrape basic info (including pricing page)
    console.log('🔍 [Analyze] Scraping website info...')
    let scraped
    let scrapingFailed = false
    let scrapingError: any = null
    
    try {
      scraped = await scrapeWebsiteInfo(validUrl.toString())
      console.log('✅ [Analyze] Scraped info:', {
        title: scraped.title,
        description: scraped.description?.substring(0, 100),
        logoUrl: scraped.logoUrl,
        pricingContentLength: scraped.pricingContent.length,
        pageContentLength: scraped.pageContent.length,
      })
    } catch (error) {
      console.error('❌ [Analyze] Error scraping website:', error)
      scrapingFailed = true
      scrapingError = error
      
      const errorMessage = error instanceof Error ? error.message : String(error)
      const statusCode = (error as any)?.statusCode || 500
      const errorType = (error as any)?.errorType || 'website_error'
      const isWebsiteError = (error as any)?.isWebsiteError || false
      
      // For website rate limits and blocking, we'll still try OpenAI with just the URL
      // But for other errors, we might want to fail fast
      const canStillUseOpenAI = errorType === 'website_rate_limit' || 
                                 errorType === 'website_blocked' ||
                                 (statusCode === 429 && isWebsiteError) ||
                                 errorMessage.includes('CORS') ||
                                 errorMessage.includes('blocked')
      
      if (!canStillUseOpenAI) {
        // For timeouts, network errors, etc., return error immediately
        if (errorMessage.includes('timeout') || errorMessage.includes('aborted')) {
          return NextResponse.json({
            error: 'Website request timed out. The website may be slow or unreachable.',
            details: errorMessage,
            errorType: 'timeout',
            suggestion: 'Try again later or fill in the form manually.'
          }, { status: 408 })
        }
        
        if (errorMessage.includes('Failed to fetch') || errorMessage.includes('network') || errorMessage.includes('ECONNREFUSED') || errorMessage.includes('ENOTFOUND')) {
          return NextResponse.json({
            error: 'Could not reach the website. The URL may be invalid or the site may be down.',
            details: errorMessage,
            errorType: 'network_error',
            suggestion: 'Check the URL and try again, or fill in the form manually.'
          }, { status: 503 })
        }
        
        return NextResponse.json({
          error: 'Could not access website content. The site may require authentication or block automated requests.',
          details: errorMessage,
          errorType: errorType,
          suggestion: 'Please fill in the form manually with the tool information.'
        }, { status: statusCode })
      }
      
      // For rate limits and blocking, create minimal scraped data and continue
      console.log('⚠️ [Analyze] Scraping failed, but will attempt OpenAI analysis with URL only')
      scraped = {
        title: validUrl.hostname.replace('www.', '').replace('.com', '').replace('.ai', ''),
        description: '',
        logoUrl: null,
        pricingContent: '',
        pageContent: '',
      }
    }

    // Analyze with OpenAI (required - no fallback)
    console.log('🤖 [Analyze] Starting OpenAI analysis...')
    console.log('🤖 [Analyze] Scraped data summary:', {
      hasTitle: !!scraped.title,
      hasDescription: !!scraped.description,
      hasPricingContent: scraped.pricingContent.length > 0,
      hasPageContent: scraped.pageContent.length > 0,
      scrapingFailed: scrapingFailed,
    })
    
    let analysis
    try {
      analysis = await analyzeWithAI(
        validUrl.toString(),
        scraped.title,
        scraped.description,
        scraped.pricingContent,
        scraped.pageContent
      )
      console.log('✅ [Analyze] OpenAI analysis complete:', JSON.stringify(analysis, null, 2))
    } catch (error) {
      console.error('❌ [Analyze] OpenAI analysis failed:', error)
      const errorMessage = error instanceof Error ? error.message : String(error)
      const statusCode = (error as any)?.statusCode || 500
      const errorDetails = (error as any)?.details
      const retryAfter = (error as any)?.retryAfter
      const errorType = (error as any)?.errorType || 'unknown'
      
      // If scraping also failed, include that info
      let combinedError = errorMessage
      if (scrapingFailed && scrapingError) {
        const scrapingErrorMsg = scrapingError instanceof Error ? scrapingError.message : String(scrapingError)
        const scrapingErrorType = (scrapingError as any)?.errorType || 'website_error'
        
        if (scrapingErrorType === 'website_rate_limit') {
          combinedError = `Website rate limit prevented scraping, and ${errorMessage.toLowerCase()}`
        } else if (scrapingErrorType === 'website_blocked') {
          combinedError = `Website blocked scraping, and ${errorMessage.toLowerCase()}`
        }
      }
      
      // Handle different error types with specific messages
      if (errorType === 'billing') {
        return NextResponse.json({
          error: combinedError,
          details: errorDetails,
          errorType: 'billing',
          scrapingFailed: scrapingFailed,
          suggestion: 'This is a billing/quota issue, NOT a rate limit. Check your billing and usage at https://platform.openai.com/account/billing'
        }, { status: statusCode })
      }
      
      if (errorType === 'organization_limit') {
        return NextResponse.json({
          error: combinedError,
          details: errorDetails,
          errorType: 'organization_limit',
          scrapingFailed: scrapingFailed,
          suggestion: 'This is an organization-level limit. Check your organization settings at https://platform.openai.com/org-settings'
        }, { status: statusCode })
      }
      
      if (errorType === 'authentication') {
        return NextResponse.json({
          error: combinedError,
          details: errorDetails,
          errorType: 'authentication',
          scrapingFailed: scrapingFailed,
          suggestion: 'Check your API key at https://platform.openai.com/api-keys'
        }, { status: statusCode })
      }
      
      // Handle rate limit errors specifically
      if (statusCode === 429 || errorType === 'rate_limit') {
        return NextResponse.json({
          error: combinedError,
          details: errorDetails,
          retryAfter: retryAfter,
          errorType: 'rate_limit',
          scrapingFailed: scrapingFailed,
          suggestion: 'This is an RPM (requests per minute) limit. Even with balance, low-tier accounts have low RPM limits. Check your tier at platform.openai.com/account/limits'
        }, { status: 429 })
      }
      
      return NextResponse.json({
        error: 'Failed to analyze with OpenAI',
        details: errorDetails || errorMessage,
        errorType: errorType,
        scrapingFailed: scrapingFailed,
        suggestion: errorMessage.includes('API key') 
          ? 'Please check your OPENAI_API_KEY environment variable'
          : `OpenAI API error (${statusCode}). Check the details above or try again later.`
      }, { status: statusCode })
    }

    const cats =
      analysis.categories && analysis.categories.length > 0
        ? analysis.categories
        : categoriesFromAiContent({
            category: analysis.category,
          })
    const result: AnalysisResult = {
      name: analysis.name || scraped.title || validUrl.hostname.replace('www.', ''),
      description: analysis.description || scraped.description || 'AI tool',
      categories: cats,
      category: cats[0],
      tags: analysis.tags || '',
      revenue: analysis.revenue ?? null,
      traffic: analysis.traffic ?? 'unknown',
      rating: analysis.rating ?? null,
      estimatedVisits: analysis.estimatedVisits ?? null,
      logoUrl: analysis.logoUrl || scraped.logoUrl || null,
      _debug: {
        usedOpenAI: analysis._debug?.usedOpenAI ?? true,
        apiKeyFound: analysis._debug?.apiKeyFound ?? true,
        error: analysis._debug?.error,
        scrapingFailed: scrapingFailed,
        scrapingError: scrapingFailed ? (scrapingError instanceof Error ? scrapingError.message : String(scrapingError)) : undefined,
      },
    }

    console.log('📊 [Analyze] Final result:', JSON.stringify(result, null, 2))
    console.log('📊 [Analyze] OpenAI was used:', result._debug?.usedOpenAI ? '✅ YES' : '❌ NO')
    if (result._debug?.error) {
      console.log('📊 [Analyze] Error reason:', result._debug.error)
    }
    
    return NextResponse.json({ ...result, url: validUrl.toString() })
  } catch (error) {
    console.error('❌ [Analyze] Unexpected error:', error)
    console.error('❌ [Analyze] Error type:', error instanceof Error ? error.constructor.name : typeof error)
    console.error('❌ [Analyze] Error message:', error instanceof Error ? error.message : String(error))
    return NextResponse.json(
      { 
        error: 'Failed to analyze URL',
        details: error instanceof Error ? error.message : String(error),
        suggestion: 'Please try again or fill the form manually.'
      },
      { status: 500 }
    )
  }
}

