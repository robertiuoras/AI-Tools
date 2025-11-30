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
}

/**
 * Try to fetch pricing page content
 */
async function fetchPricingInfo(baseUrl: string): Promise<string> {
  const pricingPaths = ['/pricing', '/plans', '/prices', '/subscribe', '/purchase', '/buy']
  const urlObj = new URL(baseUrl)
  
  for (const path of pricingPaths) {
    try {
      const pricingUrl = `${urlObj.origin}${path}`
      const response = await fetch(pricingUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
        signal: AbortSignal.timeout(3000), // 3 second timeout
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
      continue
    }
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
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      signal: AbortSignal.timeout(5000), // 5 second timeout
    })
    const html = await response.text()

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
    const pricingContent = await fetchPricingInfo(url)

    return { title, description, logoUrl, pricingContent, pageContent }
  } catch (error) {
    console.error('Error scraping website:', error)
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
  const openaiApiKey = process.env.OPENAI_API_KEY

  console.log('🔍 [OpenAI Check] Checking for OpenAI API key...')
  console.log('🔍 [OpenAI Check] OPENAI_API_KEY exists:', !!openaiApiKey)
  console.log('🔍 [OpenAI Check] OPENAI_API_KEY length:', openaiApiKey?.length || 0)
  console.log('🔍 [OpenAI Check] OPENAI_API_KEY starts with:', openaiApiKey?.substring(0, 10) || 'N/A')
  console.log('🔍 [OpenAI Check] OPENAI_API_KEY format valid:', openaiApiKey?.startsWith('sk-') || false)

  if (!openaiApiKey) {
    // Fallback to rule-based analysis if no API key
    console.log('⚠️ [OpenAI] API key not found. Using basic analysis. Add OPENAI_API_KEY to .env for better results.')
    console.log('⚠️ [OpenAI] Current env vars with OPENAI:', Object.keys(process.env).filter(k => k.includes('OPENAI')))
    console.log('⚠️ [OpenAI] Environment:', process.env.NODE_ENV)
    console.log('⚠️ [OpenAI] All env vars (first 20):', Object.keys(process.env).sort().slice(0, 20).join(', '))
    return analyzeWithoutAI(url, title, description, pricingContent, pageContent)
  }

  // Validate API key format
  if (!openaiApiKey.startsWith('sk-')) {
    console.error('❌ [OpenAI] Invalid API key format. OpenAI API keys should start with "sk-"')
    console.error('❌ [OpenAI] API key provided starts with:', openaiApiKey.substring(0, 5))
    return analyzeWithoutAI(url, title, description, pricingContent, pageContent)
  }
  
  console.log('✨ [OpenAI] Using AI analysis with OpenAI')
  console.log('✨ [OpenAI] API Key present (first 10 chars):', openaiApiKey.substring(0, 10) + '...')
  console.log('✨ [OpenAI] API Key format: Valid (starts with sk-)')
  console.log('✨ [OpenAI] Model: gpt-4o-mini')

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

    console.log('🚀 [OpenAI] Making API request to OpenAI...')
    console.log('🚀 [OpenAI] Request URL:', 'https://api.openai.com/v1/chat/completions')
    console.log('🚀 [OpenAI] Prompt length:', prompt.length)
    console.log('🚀 [OpenAI] Pricing content length:', pricingContent.length)
    console.log('🚀 [OpenAI] Page content length:', pageContent.length)

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${openaiApiKey}`,
      },
      body: JSON.stringify({
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
      }),
    })

    console.log('📥 [OpenAI] Response status:', response.status)
    console.log('📥 [OpenAI] Response ok:', response.ok)

    if (!response.ok) {
      const errorText = await response.text()
      console.error('❌ [OpenAI] API error response:', errorText)
      throw new Error(`OpenAI API error: ${response.status} - ${errorText}`)
    }

    const data = await response.json()
    console.log('✅ [OpenAI] API response received')
    console.log('✅ [OpenAI] Response ID:', data.id)
    console.log('✅ [OpenAI] Model used:', data.model)
    console.log('✅ [OpenAI] Usage:', JSON.stringify(data.usage, null, 2))
    
    const content = JSON.parse(data.choices[0].message.content)
    console.log('✅ [OpenAI] Parsed content:', JSON.stringify(content, null, 2))

    const result = {
      name: content.name || title,
      description: content.description || description,
      category: content.category || 'Other',
      tags: content.tags || '',
      revenue: content.revenue || null,
      traffic: content.traffic || 'unknown',
      rating: content.rating || null,
      estimatedVisits: content.estimatedVisits || null,
    }
    
    console.log('✅ [OpenAI] Final analysis result:', JSON.stringify(result, null, 2))
    console.log('✅ [OpenAI] Analysis complete!')
    
    return result
  } catch (error) {
    console.error('❌ [OpenAI] AI analysis error:', error)
    console.error('❌ [OpenAI] Error type:', error instanceof Error ? error.constructor.name : typeof error)
    console.error('❌ [OpenAI] Error message:', error instanceof Error ? error.message : String(error))
    console.error('❌ [OpenAI] Falling back to basic analysis...')
    return analyzeWithoutAI(url, title, description, pricingContent, pageContent)
  }
}

/**
 * Fallback analysis without AI
 */
function analyzeWithoutAI(
  url: string,
  title: string,
  description: string,
  pricingContent: string,
  pageContent: string
): Partial<AnalysisResult> {
  // Simple keyword-based categorization
  const urlLower = url.toLowerCase()
  const titleLower = title.toLowerCase()
  const descLower = description.toLowerCase()
  const pricingLower = pricingContent.toLowerCase()
  const pageLower = pageContent.toLowerCase()
  const combined = `${urlLower} ${titleLower} ${descLower} ${pricingLower} ${pageLower}`

  let category = 'Other'
  const categoryKeywords: Record<string, string[]> = {
    'Video Editing': ['video', 'edit', 'film', 'movie', 'clip'],
    'Image Generation': ['image', 'generate', 'art', 'picture', 'photo', 'ai art', 'dalle', 'midjourney'],
    'Code Assistants': ['code', 'programming', 'developer', 'coding', 'github copilot', 'cursor'],
    'Writing': ['write', 'text', 'content', 'blog', 'article', 'copy', 'gpt', 'chatgpt'],
    'AI Automation': ['automate', 'workflow', 'bot', 'automation', 'zapier'],
    'Productivity': ['productivity', 'task', 'todo', 'organize', 'manage'],
    'Design': ['design', 'ui', 'ux', 'figma', 'sketch'],
    'Marketing': ['marketing', 'seo', 'social', 'ad', 'campaign'],
    'Analytics': ['analytics', 'data', 'insight', 'metric', 'track'],
  }

  for (const [cat, keywords] of Object.entries(categoryKeywords)) {
    if (keywords.some((keyword) => combined.includes(keyword))) {
      category = cat
      break
    }
  }

  // Enhanced revenue detection with pricing page analysis
  let revenue: 'free' | 'freemium' | 'paid' | 'enterprise' | null = null
  
  // Check for enterprise indicators (highest priority)
  const enterpriseKeywords = ['enterprise', 'business plan', 'contact sales', 'custom pricing', 'request demo', 'sales team']
  if (enterpriseKeywords.some(keyword => combined.includes(keyword))) {
    revenue = 'enterprise'
  }
  // Check for freemium (free tier + paid plans)
  else if (
    (combined.includes('free') || combined.includes('free tier') || combined.includes('free plan')) &&
    (combined.includes('pro') || combined.includes('premium') || combined.includes('paid') || 
     combined.includes('subscription') || combined.includes('$') || combined.includes('pricing') ||
     combined.includes('plan') || combined.includes('tier'))
  ) {
    revenue = 'freemium'
  }
  // Check for completely free (no paid options)
  else if (
    (combined.includes('free') || combined.includes('open source') || combined.includes('free forever')) &&
    !combined.includes('pro') && !combined.includes('premium') && !combined.includes('paid') &&
    !combined.includes('subscription') && !combined.includes('$') && !combined.includes('pricing')
  ) {
    revenue = 'free'
  }
  // Check for paid only (no free tier)
  else if (
    (combined.includes('subscription') || combined.includes('$') || combined.includes('pricing') ||
     combined.includes('paid') || combined.includes('purchase') || combined.includes('buy')) &&
    !combined.includes('free') && !combined.includes('free tier') && !combined.includes('free plan')
  ) {
    revenue = 'paid'
  }

  // Estimate traffic based on common indicators
  let traffic: 'low' | 'medium' | 'high' | 'unknown' = 'unknown'
  if (combined.includes('popular') || combined.includes('millions') || combined.includes('millions of users') || combined.includes('millions of')) {
    traffic = 'high'
  } else if (combined.includes('thousands') || combined.includes('growing') || combined.includes('trending') || combined.includes('100k') || combined.includes('500k')) {
    traffic = 'medium'
  } else if (combined.includes('users') || combined.includes('active')) {
    traffic = 'medium'
  } else if (combined.includes('small') || combined.includes('new') || combined.includes('startup')) {
    traffic = 'low'
  }

  // Estimate rating (very basic, AI would do better)
  let rating: number | null = null
  const ratingMatch = combined.match(/(\d+\.?\d*)\s*(?:star|rating|score|out of 5)/i)
  if (ratingMatch) {
    const parsed = parseFloat(ratingMatch[1])
    if (parsed >= 0 && parsed <= 5) {
      rating = parsed
    }
  } else if (combined.includes('excellent') || combined.includes('great') || combined.includes('top rated') || combined.includes('best')) {
    rating = 4.5
  } else if (combined.includes('good') || combined.includes('recommended') || combined.includes('highly')) {
    rating = 4.0
  } else if (combined.includes('well') || combined.includes('solid')) {
    rating = 3.5
  }

  // Estimate visits with improved heuristics
  let estimatedVisits: number | null = null
  
  // Method 1: Look for explicit visit/user numbers in text
  const visitPatterns = [
    /(\d+(?:\.\d+)?)\s*(?:million|m)\s*(?:visits|users|monthly|per month|monthly visits)/i,
    /(\d+(?:\.\d+)?)\s*(?:thousand|k)\s*(?:visits|users|monthly|per month|monthly visits)/i,
    /(\d+(?:,\d{3})*)\s*(?:visits|users|monthly|per month)/i,
    /(?:visits|users|monthly)[:\s]+(\d+(?:\.\d+)?)\s*(?:million|m)/i,
    /(?:visits|users|monthly)[:\s]+(\d+(?:\.\d+)?)\s*(?:thousand|k)/i,
  ]
  
  for (const pattern of visitPatterns) {
    const match = combined.match(pattern)
    if (match) {
      const num = parseFloat(match[1].replace(/,/g, ''))
      const text = match[0].toLowerCase()
      if (text.includes('million') || text.includes('m')) {
        estimatedVisits = Math.round(num * 1000000)
        break
      } else if (text.includes('thousand') || text.includes('k')) {
        estimatedVisits = Math.round(num * 1000)
        break
      } else if (num > 1000) {
        estimatedVisits = Math.round(num)
        break
      }
    }
  }
  
  // Method 2: Look for user count indicators
  if (estimatedVisits === null) {
    const userPatterns = [
      /(\d+(?:\.\d+)?)\s*(?:million|m)\s*(?:users|customers|subscribers)/i,
      /(\d+(?:\.\d+)?)\s*(?:thousand|k)\s*(?:users|customers|subscribers)/i,
      /(?:over|more than|above)\s+(\d+(?:\.\d+)?)\s*(?:million|m)\s*(?:users|customers)/i,
      /(?:over|more than|above)\s+(\d+(?:\.\d+)?)\s*(?:thousand|k)\s*(?:users|customers)/i,
    ]
    
    for (const pattern of userPatterns) {
      const match = combined.match(pattern)
      if (match) {
        const num = parseFloat(match[1])
        const text = match[0].toLowerCase()
        // Convert users to estimated visits (users typically visit multiple times)
        if (text.includes('million') || text.includes('m')) {
          estimatedVisits = Math.round(num * 1000000 * 3) // Assume 3 visits per user per month
          break
        } else if (text.includes('thousand') || text.includes('k')) {
          estimatedVisits = Math.round(num * 1000 * 3)
          break
        }
      }
    }
  }
  
  // Method 3: Look for traffic indicators and estimate
  if (estimatedVisits === null) {
    // Check for specific traffic mentions
    if (combined.includes('millions of visitors') || combined.includes('millions of users')) {
      estimatedVisits = 5000000 // Conservative estimate for "millions"
    } else if (combined.includes('hundreds of thousands')) {
      estimatedVisits = 500000
    } else if (combined.includes('tens of thousands')) {
      estimatedVisits = 50000
    } else if (combined.includes('thousands of')) {
      estimatedVisits = 5000
    }
  }
  
  // Method 4: Set estimates based on traffic level with better ranges
  if (estimatedVisits === null) {
    if (traffic === 'high') {
      // High traffic: 500K - 5M range
      estimatedVisits = 2000000
    } else if (traffic === 'medium') {
      // Medium traffic: 50K - 500K range
      estimatedVisits = 250000
    } else if (traffic === 'low') {
      // Low traffic: 5K - 50K range
      estimatedVisits = 25000
    }
  }

  return {
    name: title || new URL(url).hostname.replace('www.', ''),
    description: description || 'AI tool description',
    category,
    tags: extractTags(combined),
    revenue,
    traffic,
    rating,
    estimatedVisits,
  }
}

function extractTags(text: string): string {
  const tagKeywords: Record<string, string[]> = {
    'ai': ['ai', 'artificial intelligence', 'machine learning', 'ml', 'neural'],
    'automation': ['automation', 'automate', 'workflow', 'bot'],
    'productivity': ['productivity', 'efficient', 'streamline', 'optimize'],
    'saas': ['saas', 'software as a service', 'cloud', 'web app'],
    'api': ['api', 'integration', 'developer', 'sdk'],
    'collaboration': ['collaboration', 'team', 'share', 'workspace'],
    'analytics': ['analytics', 'data', 'insights', 'metrics', 'tracking'],
  }
  
  const found: string[] = []
  for (const [tag, keywords] of Object.entries(tagKeywords)) {
    if (keywords.some(keyword => text.includes(keyword))) {
      found.push(tag)
    }
  }
  
  // Always include 'ai' if not already found
  if (!found.includes('ai') && text.includes('ai')) {
    found.unshift('ai')
  }
  
  return found.slice(0, 5).join(', ') || 'ai, tool'
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

    // Validate URL
    let validUrl: URL
    try {
      validUrl = new URL(url.startsWith('http') ? url : `https://${url}`)
      console.log('✅ [Analyze] Valid URL:', validUrl.toString())
    } catch {
      console.error('❌ [Analyze] Invalid URL format')
      return NextResponse.json({ error: 'Invalid URL' }, { status: 400 })
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

    // Analyze with AI or fallback
    console.log('🤖 [Analyze] Starting AI analysis...')
    const analysis = await analyzeWithAI(
      validUrl.toString(),
      scraped.title,
      scraped.description,
      scraped.pricingContent,
      scraped.pageContent
    )
    console.log('✅ [Analyze] Analysis complete:', JSON.stringify(analysis, null, 2))

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
    }

    console.log('Analysis result:', result)
    return NextResponse.json({ ...result, url: validUrl.toString() })
  } catch (error) {
    console.error('Error analyzing URL:', error)
    return NextResponse.json(
      { error: 'Failed to analyze URL' },
      { status: 500 }
    )
  }
}

