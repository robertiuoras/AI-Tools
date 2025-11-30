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

    // Try to find logo/favicon
    let logoUrl: string | null = null
    const logoMatch = html.match(/<link[^>]*rel=["'](?:icon|shortcut icon|apple-touch-icon)["'][^>]*href=["']([^"']+)["']/i)
    if (logoMatch) {
      const logoPath = logoMatch[1]
      logoUrl = logoPath.startsWith('http') ? logoPath : new URL(logoPath, url).toString()
    } else {
      // Try og:image
      const ogImageMatch = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i)
      if (ogImageMatch) {
        logoUrl = ogImageMatch[1]
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

  if (!openaiApiKey) {
    // Fallback to rule-based analysis if no API key
    console.log('⚠️ OpenAI API key not found. Using basic analysis. Add OPENAI_API_KEY to .env for better results.')
    console.log('Current env vars:', Object.keys(process.env).filter(k => k.includes('OPENAI')))
    return analyzeWithoutAI(url, title, description, pricingContent, pageContent)
  }
  
  console.log('✨ Using AI analysis with OpenAI')
  console.log('API Key present:', openaiApiKey.substring(0, 7) + '...')

  try {
    const pricingContext = pricingContent 
      ? `\n\nPricing Page Content (for revenue model analysis):\n${pricingContent.substring(0, 2000)}`
      : ''
    
    const pageContext = pageContent
      ? `\n\nMain Page Content (first 2000 chars for context):\n${pageContent.substring(0, 2000)}`
      : ''

    const prompt = `Analyze this AI tool website and provide structured information. Pay special attention to the pricing model:

URL: ${url}
Title: ${title}
Description: ${description || 'No description available'}${pricingContext}${pageContext}

IMPORTANT - Revenue Model Analysis:
- "free": Completely free with no paid options (e.g., open source, free forever)
- "freemium": Has a free tier/plan AND paid plans (e.g., free plan + pro/paid tiers)
- "paid": Only paid plans, no free tier (e.g., subscription required, one-time purchase)
- "enterprise": Enterprise/business focused with custom pricing (e.g., contact sales, enterprise plans)
- null: Cannot determine from available information

Look for indicators like:
- Free tier mentions, free plan, free forever → "freemium" or "free"
- Pricing pages with multiple tiers including free → "freemium"
- "Contact sales", "Enterprise", "Custom pricing" → "enterprise"
- Only paid plans, subscription required → "paid"
- Completely open source, no pricing → "free"

Please provide a JSON response with:
1. "name": A clean, concise name for the tool (max 50 chars)
2. "description": A 2-3 sentence description of what the tool does
3. "category": One of these exact categories: ${categories.join(', ')}
4. "tags": Comma-separated relevant tags (3-5 tags, e.g., "ai, automation, productivity")
5. "revenue": One of: "free", "freemium", "paid", "enterprise", or null if unknown (be precise based on pricing info)
6. "traffic": Estimate as "low", "medium", "high", or "unknown" (based on popularity indicators)
7. "rating": A number between 0-5 (or null if unknown, estimate based on quality indicators)
8. "estimatedVisits": Estimated monthly visits as a number (or null, estimate based on popularity)

IMPORTANT: Always provide tags, even if generic. Always try to determine revenue model from pricing content. Provide estimates for traffic and rating when possible.

Return ONLY valid JSON, no markdown formatting.`

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

    if (!response.ok) {
      throw new Error('OpenAI API error')
    }

    const data = await response.json()
    const content = JSON.parse(data.choices[0].message.content)

    return {
      name: content.name || title,
      description: content.description || description,
      category: content.category || 'Other',
      tags: content.tags || '',
      revenue: content.revenue || null,
      traffic: content.traffic || 'unknown',
      rating: content.rating || null,
      estimatedVisits: content.estimatedVisits || null,
    }
  } catch (error) {
    console.error('AI analysis error:', error)
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
  if (combined.includes('popular') || combined.includes('millions') || combined.includes('millions of users')) {
    traffic = 'high'
  } else if (combined.includes('thousands') || combined.includes('growing') || combined.includes('trending')) {
    traffic = 'medium'
  }

  // Estimate rating (very basic, AI would do better)
  let rating: number | null = null
  const ratingMatch = combined.match(/(\d+\.?\d*)\s*(?:star|rating|score|out of 5)/i)
  if (ratingMatch) {
    const parsed = parseFloat(ratingMatch[1])
    if (parsed >= 0 && parsed <= 5) {
      rating = parsed
    }
  } else if (combined.includes('excellent') || combined.includes('great') || combined.includes('top rated')) {
    rating = 4.5
  } else if (combined.includes('good') || combined.includes('recommended')) {
    rating = 4.0
  }

  return {
    name: title || new URL(url).hostname.replace('www.', ''),
    description: description || 'AI tool description',
    category,
    tags: extractTags(combined),
    revenue,
    traffic,
    rating,
    estimatedVisits: null,
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
    const { url } = await request.json()

    if (!url || typeof url !== 'string') {
      return NextResponse.json({ error: 'URL is required' }, { status: 400 })
    }

    // Validate URL
    let validUrl: URL
    try {
      validUrl = new URL(url.startsWith('http') ? url : `https://${url}`)
    } catch {
      return NextResponse.json({ error: 'Invalid URL' }, { status: 400 })
    }

    // Scrape basic info (including pricing page)
    const scraped = await scrapeWebsiteInfo(validUrl.toString())

    // Analyze with AI or fallback
    const analysis = await analyzeWithAI(
      validUrl.toString(),
      scraped.title,
      scraped.description,
      scraped.pricingContent,
      scraped.pageContent
    )

    const result: AnalysisResult = {
      name: analysis.name || scraped.title || validUrl.hostname.replace('www.', ''),
      description: analysis.description || scraped.description || 'AI tool',
      category: analysis.category || 'Other',
      tags: analysis.tags || '',
      revenue: analysis.revenue || null,
      traffic: analysis.traffic || 'unknown',
      rating: analysis.rating || null,
      estimatedVisits: analysis.estimatedVisits || null,
      logoUrl: analysis.logoUrl || scraped.logoUrl || null,
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

