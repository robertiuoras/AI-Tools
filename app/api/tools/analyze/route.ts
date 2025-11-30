import { NextRequest, NextResponse } from 'next/server'
import { categories } from '@/lib/schemas'

interface AnalysisResult {
  name: string
  description: string
  category: string
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
        
        if (text.length > 100) { // Only return if we got substantial content
          return text
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
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      signal: AbortSignal.timeout(10000), // 10 second timeout
    })
    
    if (!response.ok) {
      console.error('❌ [Scrape] HTTP error:', response.status, response.statusText)
      return { title: '', description: '', logoUrl: null, pricingContent: '', pageContent: '' }
    }
    
    const html = await response.text()
    console.log('✅ [Scrape] Successfully fetched HTML, length:', html.length)

    // Extract title
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i)
    const title = titleMatch ? titleMatch[1].trim() : ''

    // Extract meta description
    const descMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i)
    const description = descMatch ? descMatch[1].trim() : ''

    // Extract page content for better analysis
    let pageContent = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .substring(0, 5000) // Limit to first 5000 chars
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
    return { title: '', description: '', logoUrl: null, pricingContent: '', pageContent: '' }
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
    const pricingContext = pricingContent 
      ? `\n\nPricing Page Content (for revenue model analysis):\n${pricingContent.substring(0, 2000)}`
      : ''
    
    const pageContext = pageContent
      ? `\n\nMain Page Content (first 2000 chars for context):\n${pageContent.substring(0, 2000)}`
      : ''

    const prompt = `Analyze this AI tool website and provide structured information. Pay EXTREME attention to finding accurate revenue model and visit statistics.

URL: ${url}
Title: ${title}
Description: ${description || 'No description available'}${pricingContext}${pageContext}

CRITICAL - Revenue Model Analysis (MUST be accurate):
Carefully examine the pricing content and page content for EXACT pricing structure:
- "free": Completely free with NO paid options whatsoever (e.g., open source, free forever, no pricing page)
- "freemium": Has BOTH a free tier/plan AND paid plans (e.g., "Free plan" + "Pro $X/month" or "Free tier" + "Premium")
- "paid": ONLY paid plans, NO free tier (e.g., "Starting at $X/month", subscription required, one-time purchase, no free option mentioned)
- "enterprise": Enterprise/business focused with custom pricing (e.g., "Contact sales", "Enterprise plans", "Custom pricing", "Request demo")
- null: ONLY if you truly cannot determine from the available content

Look for EXACT indicators:
- "Free plan" or "Free tier" + any paid plans → "freemium"
- Multiple pricing tiers with one being "Free" → "freemium"
- Only "$X/month" or "Subscribe" with no free option → "paid"
- "Contact sales" or "Enterprise" as primary option → "enterprise"
- No pricing page, completely open source → "free"

CRITICAL - Estimated Visits Analysis (MUST search thoroughly):
Search the page content and pricing content for EXACT numbers:
1. Look for explicit mentions: "X million visits", "X million users", "X million monthly", "XM visits", "XK visits"
2. Look for user counts: "X million users", "X thousand users", "X users"
3. Look for traffic indicators: "X million page views", "X million visitors", "serving X million"
4. If you find a number, use it directly (convert: "2.5M users" = 2,500,000, assume 3 visits/user/month = 7,500,000 visits)
5. If no explicit number but mentions "millions" → estimate 2-5M
6. If mentions "hundreds of thousands" → estimate 300K-800K
7. If mentions "thousands" → estimate 10K-50K
8. If well-known tool with press coverage → estimate 1M-5M
9. If newer/niche tool → estimate 10K-100K
10. Only use null if truly no indicators found

Please provide a JSON response with:
1. "name": A clean, concise name for the tool (max 50 chars)
2. "description": A 2-3 sentence description of what the tool does
3. "category": One of these exact categories: ${categories.join(', ')}
4. "tags": Comma-separated relevant tags (3-5 tags, e.g., "ai, automation, productivity")
5. "revenue": One of: "free", "freemium", "paid", "enterprise", or null (MUST be accurate based on pricing analysis)
6. "traffic": Estimate as "low", "medium", "high", or "unknown" (based on popularity indicators, press coverage, user mentions)
7. "rating": A number between 0-5 (or null if unknown, estimate based on quality indicators, reviews, or general perception)
8. "estimatedVisits": A NUMBER (not null unless truly unknown). Search thoroughly for explicit visit/user numbers. If found, use them. If not found but indicators exist, provide reasonable estimate based on traffic level and popularity.

IMPORTANT: 
- Revenue model MUST be accurate - carefully analyze pricing content
- Estimated visits MUST be a number if any indicators exist (don't default to null)
- Always provide tags, even if generic
- Be thorough in searching for visit/user statistics

Return ONLY valid JSON, no markdown formatting.`

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
          content:
            'You are an expert at analyzing AI tools and categorizing them. Always respond with valid JSON only.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.7,
      response_format: { type: 'json_object' },
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
      throw new Error(`OpenAI API error: ${response.status} - ${errorText}`)
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

    const result = {
      name: content.name || title,
      description: content.description || description,
      category: content.category || 'Other',
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
      return NextResponse.json({ error: `Invalid URL: ${url}` }, { status: 400 })
    }

    // Scrape basic info (including pricing page)
    console.log('🔍 [Analyze] Scraping website info...')
    const scraped = await scrapeWebsiteInfo(validUrl.toString())
    console.log('✅ [Analyze] Scraped info:', {
      title: scraped.title,
      description: scraped.description?.substring(0, 100),
      logoUrl: scraped.logoUrl,
      pricingContentLength: scraped.pricingContent.length,
      pageContentLength: scraped.pageContent.length,
    })

    // Analyze with OpenAI (required - no fallback)
    console.log('🤖 [Analyze] Starting OpenAI analysis...')
    console.log('🤖 [Analyze] Scraped data summary:', {
      hasTitle: !!scraped.title,
      hasDescription: !!scraped.description,
      hasPricingContent: scraped.pricingContent.length > 0,
      hasPageContent: scraped.pageContent.length > 0,
    })
    
    const analysis = await analyzeWithAI(
      validUrl.toString(),
      scraped.title,
      scraped.description,
      scraped.pricingContent,
      scraped.pageContent
    )
    console.log('✅ [Analyze] OpenAI analysis complete:', JSON.stringify(analysis, null, 2))

    const result: AnalysisResult = {
      name: analysis.name || scraped.title || validUrl.hostname.replace('www.', ''),
      description: analysis.description || scraped.description || 'AI tool',
      category: analysis.category || 'Other',
      tags: analysis.tags || '',
      revenue: analysis.revenue ?? null,
      traffic: analysis.traffic ?? 'unknown',
      rating: analysis.rating ?? null,
      estimatedVisits: analysis.estimatedVisits ?? null,
      logoUrl: analysis.logoUrl || scraped.logoUrl || null,
      _debug: analysis._debug,
    }

    console.log('📊 [Analyze] Final result:', JSON.stringify(result, null, 2))
    console.log('📊 [Analyze] OpenAI was used:', result._debug?.usedOpenAI ? '✅ YES' : '❌ NO')
    if (result._debug?.error) {
      console.log('📊 [Analyze] Error reason:', result._debug.error)
    }
    
    return NextResponse.json({ ...result, url: validUrl.toString() })
  } catch (error) {
    console.error('Error analyzing URL:', error)
    return NextResponse.json(
      { error: 'Failed to analyze URL' },
      { status: 500 }
    )
  }
}

