'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useToast } from '@/components/ui/toaster'
import { categories } from '@/lib/schemas'
import type { Tool } from '@/lib/supabase'
import { Loader2, Plus, Trash2, Edit2, Sparkles, RefreshCw, Star } from 'lucide-react'

export default function AdminPage() {
  const router = useRouter()
  const { addToast } = useToast()
  const [tools, setTools] = useState<Tool[]>([])
  const [loading, setLoading] = useState(true)
  const [authLoading, setAuthLoading] = useState(true)
  const [isAdmin, setIsAdmin] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [quickAddUrl, setQuickAddUrl] = useState('')
  const [bulkUrls, setBulkUrls] = useState('')
  const [bulkProcessing, setBulkProcessing] = useState(false)
  const [bulkProgress, setBulkProgress] = useState({ current: 0, total: 0, currentUrl: '' })
  const [editingId, setEditingId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  const [lastRequestTime, setLastRequestTime] = useState<number>(0)
  const [cooldownRemaining, setCooldownRemaining] = useState<number>(0)
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    url: '',
    logoUrl: '',
    category: '',
    tags: '',
    traffic: '',
    revenue: '',
    rating: '',
    estimatedVisits: '',
  })

  useEffect(() => {
    // Check authentication and admin role
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      
      if (!session) {
        router.push('/')
        return
      }

      // Get user role
      const { data: userData, error } = await supabase
        .from('user')
        .select('role')
        .eq('id', session.user.id)
        .single()

      if (error || !userData || userData.role !== 'admin') {
        addToast({
          variant: 'error',
          title: 'Access Denied',
          description: 'Admin role required to access this page.',
        })
        router.push('/')
        return
      }

      setIsAdmin(true)
      setAuthLoading(false)
    }

    checkAuth()
    fetchTools()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router])

  const fetchTools = async () => {
    try {
      const response = await fetch('/api/tools')
      const data = await response.json()
      setTools(data)
    } catch (error) {
      console.error('Error fetching tools:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)

    try {
      // Validate required fields
      if (!formData.name || !formData.description || !formData.url || !formData.category) {
        addToast({
          variant: 'warning',
          title: 'Missing Required Fields',
          description: 'Please fill in all required fields: Name, Description, URL, and Category',
        })
        setSubmitting(false)
        return
      }

      // Check for duplicate URL (normalize URL for comparison)
      const normalizedUrl = formData.url.trim().toLowerCase().replace(/\/$/, '') // Remove trailing slash
      const existingTool = tools.find(tool => {
        const existingUrl = tool.url.toLowerCase().replace(/\/$/, '')
        return existingUrl === normalizedUrl && tool.id !== editingId
      })
      
      if (existingTool) {
        addToast({
          variant: 'warning',
          title: 'Duplicate URL',
          description: `A tool with this URL already exists: ${existingTool.name}. Please edit the existing tool instead.`,
        })
        setSubmitting(false)
        return
      }

      // Clean up empty strings and convert to proper types
      const payload: any = {
        name: formData.name.trim(),
        description: formData.description.trim(),
        url: formData.url.trim(),
        category: formData.category,
      }

      // Optional fields - only include if they have values
      if (formData.logoUrl && formData.logoUrl.trim()) {
        payload.logoUrl = formData.logoUrl.trim()
      }
      if (formData.tags && formData.tags.trim()) {
        payload.tags = formData.tags.trim()
      }
      if (formData.traffic && formData.traffic.trim()) {
        payload.traffic = formData.traffic
      }
      if (formData.revenue && formData.revenue.trim()) {
        payload.revenue = formData.revenue
      }
      if (formData.rating && formData.rating.trim()) {
        const ratingNum = parseFloat(formData.rating)
        if (!isNaN(ratingNum) && ratingNum >= 0 && ratingNum <= 5) {
          payload.rating = ratingNum
        }
      }
      if (formData.estimatedVisits && formData.estimatedVisits.trim()) {
        const visitsNum = parseInt(formData.estimatedVisits)
        if (!isNaN(visitsNum) && visitsNum > 0) {
          payload.estimatedVisits = visitsNum
        }
      }

      console.log('Submitting payload:', payload)

      const url = editingId ? `/api/tools/${editingId}` : '/api/tools'
      const method = editingId ? 'PUT' : 'POST'

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        // Handle duplicate URL error (409 status)
        if (response.status === 409) {
          const errorMessage = errorData.message || 'A tool with this URL already exists'
          addToast({
            variant: 'error',
            title: 'Duplicate URL',
            description: `${errorMessage}. Please use a different URL or edit the existing tool.`,
          })
          setSubmitting(false)
          return
        }
        const errorMessage = errorData.details || errorData.error || errorData.message || `HTTP error! status: ${response.status}`
        console.error('API Error:', errorData)
        throw new Error(errorMessage)
      }

      const result = await response.json()
      console.log('Tool saved successfully:', result)

      // Wait a bit for the database to update
      await new Promise(resolve => setTimeout(resolve, 500))
      
      resetForm()
      await fetchTools()
      setIsProcessing(false)
      // No success popup - only show errors
    } catch (error) {
      console.error('Error saving tool:', error)
      const errorMessage = error instanceof Error 
        ? error.message 
        : 'Unknown error occurred. Check console for details.'
      alert(`Failed to save tool: ${errorMessage}`)
      setIsProcessing(false)
    } finally {
      setSubmitting(false)
    }
  }

  const handleEdit = (tool: Tool) => {
    setEditingId(tool.id)
    setFormData({
      name: tool.name,
      description: tool.description,
      url: tool.url,
      logoUrl: tool.logoUrl || '',
      category: tool.category,
      tags: tool.tags || '',
      traffic: tool.traffic || '',
      revenue: tool.revenue || '',
      rating: tool.rating?.toString() || '',
      estimatedVisits: tool.estimatedVisits?.toString() || '',
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this tool?')) return

    try {
      await fetch(`/api/tools/${id}`, { method: 'DELETE' })
      fetchTools()
    } catch (error) {
      console.error('Error deleting tool:', error)
      addToast({
        variant: 'error',
        title: 'Failed to Delete Tool',
        description: 'Please try again.',
      })
    }
  }

  // Cooldown system - enforce minimum delay between requests
  // Reduced for paid accounts - if you have balance, you likely have higher limits
  // Free tier: ~3 RPM = 20s delay, Paid tier: 500+ RPM = 3s delay
  const MIN_REQUEST_DELAY = 3000 // 3 seconds between requests (conservative for paid accounts)
  
  useEffect(() => {
    if (cooldownRemaining > 0) {
      const interval = setInterval(() => {
        setCooldownRemaining((prev) => {
          if (prev <= 1) {
            return 0
          }
          return prev - 1
        })
      }, 1000)
      return () => clearInterval(interval)
    }
  }, [cooldownRemaining])

  const handleQuickAdd = async () => {
    if (!quickAddUrl.trim()) {
      addToast({
        variant: 'warning',
        title: 'URL Required',
        description: 'Please enter a URL to analyze.',
      })
      return
    }

    // Prevent multiple simultaneous analyses
    if (analyzing || isProcessing) {
      addToast({
        variant: 'info',
        title: 'Already Processing',
        description: 'Please wait for the current request to complete.',
      })
      return
    }

    // Check cooldown (only if we have a recent request)
    if (lastRequestTime > 0) {
      const timeSinceLastRequest = Date.now() - lastRequestTime
      if (timeSinceLastRequest < MIN_REQUEST_DELAY) {
        const remaining = Math.ceil((MIN_REQUEST_DELAY - timeSinceLastRequest) / 1000)
        setCooldownRemaining(remaining)
        addToast({
          variant: 'info',
          title: 'Rate Limit Protection',
          description: `Please wait ${remaining} second${remaining !== 1 ? 's' : ''} before making another request.`,
          duration: 3000,
        })
        return
      }
    }

    setAnalyzing(true)
    setIsProcessing(true)
    try {
      // Normalize URL (add https:// if missing)
      let urlToAnalyze = quickAddUrl.trim()
      if (!urlToAnalyze.startsWith('http://') && !urlToAnalyze.startsWith('https://')) {
        urlToAnalyze = `https://${urlToAnalyze}`
      }

      // Retry logic for rate limits
      let retries = 3
      let response: Response | null = null
      let lastError: string | null = null
      let errorData: any = {} // Store error data from first read
      let errorType = 'unknown'
      
      while (retries > 0) {
        try {
          response = await fetch('/api/tools/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: urlToAnalyze }),
          })
          
          if (response.ok) {
            break // Success, exit retry loop
          }
          
          // Parse error data ONCE and store it
          try {
            errorData = await response.json()
            errorType = errorData.errorType || 'unknown'
            lastError = errorData.error || errorData.details || errorData.suggestion || `HTTP ${response.status}`
          } catch (e) {
            // Response might not be JSON
            lastError = `HTTP ${response.status}: ${response.statusText || 'Unknown error'}`
            if (response.status === 429) {
              errorType = 'website_rate_limit' // Default assumption for 429
            }
          }
          
          if (response.status === 429) {
            // Only retry for OpenAI rate limits, not website rate limits
            if (errorType === 'website_rate_limit') {
              // Website rate limit - don't retry
              break
            }
            // Rate limited - wait with exponential backoff
            const waitTime = Math.pow(2, 3 - retries) * 2000 // 2s, 4s, 8s
            console.log(`Rate limited for ${urlToAnalyze}, waiting ${waitTime}ms before retry ${4 - retries}/3`)
            setAnalyzing(true) // Keep showing analyzing state
            await new Promise(resolve => setTimeout(resolve, waitTime))
            retries--
            continue
          } else {
            // Other error, don't retry
            break
          }
        } catch (fetchError) {
          lastError = fetchError instanceof Error ? fetchError.message : 'Network error'
          retries--
          if (retries > 0) {
            await new Promise(resolve => setTimeout(resolve, 1000))
          }
        }
      }
      
      if (!response || !response.ok) {
        // Use stored error data (already parsed)
        let errorMessage = lastError || errorData.error || `HTTP ${response?.status || 'Unknown'}`
        
        // Refine error type based on error message if needed
        if (errorType === 'unknown') {
          if (errorMessage.includes('Website rate limit') || (errorMessage.includes('website') && errorMessage.includes('rate limit'))) {
            errorType = 'website_rate_limit'
          } else if (response?.status === 429 && !errorMessage.includes('OpenAI')) {
            // 429 but not explicitly OpenAI - likely website
            errorType = 'website_rate_limit'
          } else if (errorMessage.includes('OpenAI')) {
            errorType = 'rate_limit'
          }
        }
        
        // Use error message from errorData if available
        if (errorData.error && !errorMessage.includes(errorData.error)) {
          errorMessage = errorData.error
        }
        
        console.error('❌ Analysis error:', errorMessage)
        console.error('❌ Error type:', errorType)
        console.error('❌ Response status:', response?.status)
        console.error('❌ Error data:', errorData)
        
        // Create error with type information
        const error = new Error(errorMessage) as Error & { errorType?: string; errorData?: any }
        error.errorType = errorType
        error.errorData = errorData
        throw error
      }

      const data = await response.json()
      
      // Update last request time and set cooldown
      setLastRequestTime(Date.now())
      setCooldownRemaining(Math.ceil(MIN_REQUEST_DELAY / 1000))
      
      console.log('Analysis result:', data)
      
      // Log OpenAI usage status
      if (data._debug) {
        if (data._debug.usedOpenAI) {
          console.log('✅ OpenAI was used for analysis!')
          if (data._debug.scrapingFailed) {
            console.warn('⚠️ Website scraping failed, but OpenAI analysis succeeded with URL only')
            addToast({
              variant: 'info',
              title: 'Analysis Complete (Limited Data)',
              description: 'The website blocked our scraping, but we analyzed it using AI with just the URL. Please review and fill in any missing details manually.',
              duration: 8000,
            })
          }
        } else {
          console.warn('⚠️ OpenAI was NOT used. Reason:', data._debug.error || 'Unknown')
          console.warn('⚠️ Using basic analysis instead.')
        }
      } else {
        console.warn('⚠️ No debug info available - cannot determine if OpenAI was used')
      }

      // Auto-fill the form with analyzed data
      setFormData({
        name: data.name || '',
        description: data.description || '',
        url: data.url || quickAddUrl,
        logoUrl: data.logoUrl || '',
        category: data.category || 'Other',
        tags: data.tags || '',
        traffic: data.traffic || '',
        revenue: data.revenue || '',
        rating: data.rating !== null && data.rating !== undefined ? data.rating.toString() : '',
        estimatedVisits: data.estimatedVisits !== null && data.estimatedVisits !== undefined ? data.estimatedVisits.toString() : '',
      })
      
      console.log('Filled form data:', {
        revenue: data.revenue,
        traffic: data.traffic,
        rating: data.rating,
        estimatedVisits: data.estimatedVisits,
      })

      setQuickAddUrl('')
      // Silently fill the form - no popup
      window.scrollTo({ top: 0, behavior: 'smooth' })
      
      // Auto-submit immediately (no cooldown)
      if (data.name && data.description && data.url && data.category && !editingId) {
        const payload: any = {
          name: data.name.trim(),
          description: data.description.trim(),
          url: data.url.trim(),
          category: data.category,
        }

        // Optional fields
        if (data.logoUrl && data.logoUrl.trim()) {
          payload.logoUrl = data.logoUrl.trim()
        }
        if (data.tags && data.tags.trim()) {
          payload.tags = data.tags.trim()
        }
        if (data.traffic && data.traffic.trim()) {
          payload.traffic = data.traffic
        }
        if (data.revenue && data.revenue.trim()) {
          payload.revenue = data.revenue
        }
        if (data.rating !== null && data.rating !== undefined) {
          payload.rating = data.rating
        }
        if (data.estimatedVisits !== null && data.estimatedVisits !== undefined) {
          payload.estimatedVisits = data.estimatedVisits
        }

        // Submit immediately
        setSubmitting(true)
        setIsProcessing(true)
        try {
          const response = await fetch('/api/tools', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })

          if (!response.ok) {
            const errorData = await response.json().catch(() => ({}))
            if (response.status === 409) {
              const errorMessage = errorData.message || 'A tool with this URL already exists'
              addToast({
                variant: 'error',
                title: 'Duplicate URL',
                description: `${errorMessage}. Please use a different URL or edit the existing tool.`,
              })
              setSubmitting(false)
              setIsProcessing(false)
              return
            }
            const errorMessage = errorData.details || errorData.error || errorData.message || `HTTP error! status: ${response.status}`
            throw new Error(errorMessage)
          }

          await fetchTools()
          resetForm()
        } catch (error) {
          console.error('Error saving tool:', error)
          const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
          addToast({
            variant: 'error',
            title: 'Failed to Save Tool',
            description: errorMessage,
          })
        } finally {
          setSubmitting(false)
          setIsProcessing(false)
        }
      }
    } catch (error) {
      console.error('Error analyzing URL:', error)
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      const errorType = (error as any)?.errorType || 'unknown'
      const errorData = (error as any)?.errorData || {}
      
      // Show user-friendly error messages based on error type
      if (errorType === 'website_rate_limit') {
        // Check if OpenAI analysis still succeeded despite scraping failure
        const scrapingFailed = errorData.scrapingFailed || false
        
        if (scrapingFailed) {
          addToast({
            variant: 'warning',
            title: 'Website Rate Limited - Using AI Analysis',
            description: `The website is rate limiting our scraping, but we're still trying to analyze it with AI using just the URL. If the analysis is incomplete, you can fill in the form manually.`,
            duration: 8000,
          })
        } else {
          addToast({
            variant: 'warning',
            title: 'Website Rate Limit (Not OpenAI)',
            description: `The website itself is rate limiting our requests, not OpenAI. ${errorMessage}\n\nWait a few minutes and try again, or fill in the form manually.`,
            duration: 10000,
          })
        }
        // Don't set cooldown for website rate limits - it's not our API
      } else if (errorType === 'billing' || errorMessage.includes('Billing') || errorMessage.includes('insufficient_quota')) {
        addToast({
          variant: 'error',
          title: 'OpenAI Billing/Quota Issue',
          description: `This is NOT a rate limit - it's a billing or quota issue. ${errorMessage}\n\nCheck your billing and usage at platform.openai.com/account/billing`,
          duration: 12000,
        })
      } else if (errorType === 'organization_limit') {
        addToast({
          variant: 'error',
          title: 'OpenAI Organization Limit',
          description: `This is an organization-level limit, not a rate limit. ${errorMessage}\n\nCheck your organization settings at platform.openai.com/org-settings`,
          duration: 12000,
        })
      } else if (errorType === 'rate_limit' || (errorMessage.includes('429') && !errorMessage.includes('Website')) || errorMessage.includes('Rate Limit') || errorMessage.includes('rate limit') || errorMessage.includes('Too Many Requests')) {
        // Extract retry time if available
        const retryMatch = errorMessage.match(/try again in ([\d\w\s]+)/i)
        const retryTime = retryMatch ? retryMatch[1] : null
        
        // Parse retry time to seconds
        let retrySeconds = 60 // Default 1 minute
        if (retryTime) {
          const minutesMatch = retryTime.match(/(\d+)\s*m/i)
          const secondsMatch = retryTime.match(/(\d+)\s*s/i)
          if (minutesMatch) {
            retrySeconds = parseInt(minutesMatch[1]) * 60
          } else if (secondsMatch) {
            retrySeconds = parseInt(secondsMatch[1])
          }
        }
        
        addToast({
          variant: 'error',
          title: 'OpenAI Rate Limit Reached',
          description: `You've hit OpenAI's RPM (Requests Per Minute) limit, not token limit. ${retryTime ? `Wait ${retryTime}` : 'Wait 1-2 minutes'} before trying again.\n\nThis is likely an RPM limit. Check your tier at platform.openai.com/account/limits`,
          duration: 10000,
        })
        
        // Set cooldown based on retry time, but cap at 2 minutes
        const cooldownSeconds = Math.min(retrySeconds, 120)
        setLastRequestTime(Date.now())
        setCooldownRemaining(cooldownSeconds)
      } else if (errorMessage.includes('API key')) {
        addToast({
          variant: 'error',
          title: 'OpenAI API Key Issue',
          description: `${errorMessage}. Please check your OPENAI_API_KEY in Vercel environment variables.`,
          duration: 8000,
        })
      } else if (errorMessage.includes('scrape') || errorMessage.includes('Failed to scrape')) {
        addToast({
          variant: 'warning',
          title: 'Website Scraping Failed',
          description: `Could not fetch website content for ${quickAddUrl}. The website may be blocking requests or unreachable. You can still fill the form manually.`,
          duration: 6000,
        })
      } else {
        addToast({
          variant: 'error',
          title: 'Failed to Analyze URL',
          description: `${errorMessage}. Please fill in the form manually.`,
          duration: 6000,
        })
      }
      
      setIsProcessing(false)
    } finally {
      setAnalyzing(false)
    }
  }

  const handleBulkAdd = async () => {
    // Parse URLs - normalize them (add https:// if missing)
    const urls = bulkUrls
      .split('\n')
      .map(url => {
        url = url.trim()
        if (!url) return null
        // Add https:// if no protocol
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
          url = `https://${url}`
        }
        // Basic URL validation
        try {
          new URL(url)
          return url
        } catch {
          return null
        }
      })
      .filter((url): url is string => url !== null)
    
    if (urls.length === 0) {
      addToast({
        variant: 'warning',
        title: 'No Valid URLs',
        description: 'Please enter at least one valid URL (one per line). URLs can be with or without https://',
      })
      return
    }

    setBulkProcessing(true)
    setBulkProgress({ current: 0, total: urls.length, currentUrl: '' })

    let successCount = 0
    let errorCount = 0
    const errors: string[] = []

    for (let i = 0; i < urls.length; i++) {
      const url = urls[i]
      setBulkProgress({ current: i + 1, total: urls.length, currentUrl: url })

      try {
        setAnalyzing(true)
        
        // Retry logic for rate limits
        let retries = 3
        let response: Response | null = null
        let lastError: string | null = null
        
        while (retries > 0) {
          try {
            response = await fetch('/api/tools/analyze', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ url }),
            })
            
            if (response.ok) {
              break // Success, exit retry loop
            }
            
            const errorData = await response.json().catch(() => ({}))
            lastError = errorData.error || errorData.message || `HTTP ${response.status}`
            
            if (response.status === 429) {
              // Rate limited - wait with exponential backoff
              const waitTime = Math.pow(2, 3 - retries) * 2000 // 2s, 4s, 8s
              console.log(`Rate limited for ${url}, waiting ${waitTime}ms before retry ${4 - retries}/3`)
              await new Promise(resolve => setTimeout(resolve, waitTime))
              retries--
              continue
            } else {
              // Other error, don't retry
              break
            }
          } catch (fetchError) {
            lastError = fetchError instanceof Error ? fetchError.message : 'Network error'
            retries--
            if (retries > 0) {
              await new Promise(resolve => setTimeout(resolve, 1000))
            }
          }
        }
        
        if (!response || !response.ok) {
          const errorMessage = lastError || `HTTP ${response?.status || 'Unknown'}`
          // Better error messages
          if (errorMessage.includes('scrape') || errorMessage.includes('Failed to scrape')) {
            errors.push(`${url}: Website could not be accessed (may be blocking requests)`)
          } else if (errorMessage.includes('429') || errorMessage.includes('Rate Limit')) {
            errors.push(`${url}: Rate limit reached (retried 3 times)`)
          } else {
            errors.push(`${url}: ${errorMessage}`)
          }
          errorCount++
          continue
        }

        const data = await response.json()

        // Submit the tool
        const payload: any = {
          name: data.name || '',
          description: data.description || '',
          url: data.url || url,
          category: data.category || 'Other',
        }

        if (data.logoUrl) payload.logoUrl = data.logoUrl
        if (data.tags) payload.tags = data.tags
        if (data.traffic) payload.traffic = data.traffic
        if (data.revenue) payload.revenue = data.revenue
        if (data.rating !== null && data.rating !== undefined) payload.rating = data.rating
        if (data.estimatedVisits !== null && data.estimatedVisits !== undefined) payload.estimatedVisits = data.estimatedVisits

        const submitResponse = await fetch('/api/tools', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })

        if (submitResponse.ok) {
          successCount++
        } else {
          const errorData = await submitResponse.json().catch(() => ({}))
          const errorMessage = errorData.message || errorData.error || `HTTP ${submitResponse.status}`
          errors.push(`${url}: ${errorMessage}`)
          errorCount++
        }

        // Update last request time for cooldown tracking
        setLastRequestTime(Date.now())
        
        // Delay between bulk requests to avoid rate limits
        // Reduced to 5 seconds for paid accounts (if you have balance, you likely have higher limits)
        if (i < urls.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 5000)) // 5 seconds between bulk requests
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error'
        errors.push(`${url}: ${errorMessage}`)
        errorCount++
      } finally {
        setAnalyzing(false)
      }
    }

    await fetchTools()
    setBulkUrls('')
    setBulkProcessing(false)
    setBulkProgress({ current: 0, total: 0, currentUrl: '' })

    // Show summary
    if (successCount > 0 && errorCount === 0) {
      addToast({
        variant: 'success',
        title: 'Bulk Add Complete',
        description: `Successfully added ${successCount} tool${successCount !== 1 ? 's' : ''}!`,
        duration: 5000,
      })
    } else if (errorCount > 0 && successCount === 0) {
      addToast({
        variant: 'error',
        title: 'Bulk Add Failed',
        description: `Failed to add ${errorCount} tool${errorCount !== 1 ? 's' : ''}. ${errors.slice(0, 2).join('; ')}${errors.length > 2 ? ` and ${errors.length - 2} more` : ''}`,
        duration: 8000,
      })
    } else if (errorCount > 0) {
      addToast({
        variant: 'warning',
        title: 'Bulk Add Partially Complete',
        description: `Added ${successCount} tool${successCount !== 1 ? 's' : ''}, but ${errorCount} failed. ${errors.slice(0, 2).join('; ')}${errors.length > 2 ? ` and ${errors.length - 2} more` : ''}`,
        duration: 8000,
      })
    }
  }

  const resetForm = () => {
    setFormData({
      name: '',
      description: '',
      url: '',
      logoUrl: '',
      category: '',
      tags: '',
      traffic: '',
      revenue: '',
      rating: '',
      estimatedVisits: '',
    })
    setEditingId(null)
    setQuickAddUrl('')
    setIsProcessing(false)
  }

  if (authLoading || loading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
            <p className="text-muted-foreground">Loading...</p>
          </div>
        </div>
      </div>
    )
  }

  if (!isAdmin) {
    return null
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Admin Dashboard</h1>
        <p className="text-muted-foreground">
          Add, edit, or remove AI tools from the directory
        </p>
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{editingId ? 'Edit Tool' : 'Add New Tool'}</CardTitle>
            <CardDescription>
              {editingId
                ? 'Update the tool information below'
                : 'Fill in the details to add a new AI tool'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!editingId && (
              <div className="mb-6 space-y-4">
                <div className="p-4 rounded-lg border bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-indigo-950/20 dark:to-purple-950/20">
                  <div className="flex items-center gap-2 mb-2">
                    <Sparkles className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                    <Label className="font-semibold">Quick Add by URL</Label>
                  </div>
                  <p className="text-sm text-muted-foreground mb-3">
                    Paste a website URL and let AI analyze it to auto-fill the form
                  </p>
                  {cooldownRemaining > 0 && (
                    <div className="mb-3 p-2 rounded-md bg-yellow-50 dark:bg-yellow-950/20 border border-yellow-200 dark:border-yellow-800">
                      <p className="text-sm text-yellow-700 dark:text-yellow-300">
                        ⏱️ Cooldown: {cooldownRemaining} second{cooldownRemaining !== 1 ? 's' : ''} remaining before next request
                      </p>
                    </div>
                  )}
                  <div className="flex gap-2">
                    <Input
                      placeholder="https://example.com"
                      value={quickAddUrl}
                      onChange={(e) => setQuickAddUrl(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !analyzing && !isProcessing) {
                          e.preventDefault()
                          handleQuickAdd()
                        }
                      }}
                      disabled={analyzing || isProcessing || bulkProcessing}
                      className="flex-1"
                    />
                    <Button
                      type="button"
                      onClick={handleQuickAdd}
                      disabled={analyzing || isProcessing || bulkProcessing || !quickAddUrl.trim() || cooldownRemaining > 0}
                      variant="default"
                    >
                      {analyzing ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Analyzing...
                        </>
                      ) : (
                        <>
                          <Sparkles className="mr-2 h-4 w-4" />
                          Analyze
                        </>
                      )}
                    </Button>
                  </div>
                </div>

                <div className="p-4 rounded-lg border bg-gradient-to-r from-green-50 to-blue-50 dark:from-green-950/20 dark:to-blue-950/20">
                  <div className="flex items-center gap-2 mb-2">
                    <Plus className="h-4 w-4 text-green-600 dark:text-green-400" />
                    <Label className="font-semibold">Bulk Add URLs</Label>
                  </div>
                  <p className="text-sm text-muted-foreground mb-3">
                    Add multiple tools at once. Enter one URL per line.
                  </p>
                  <textarea
                    placeholder="https://example1.com&#10;example2.com&#10;https://example3.com"
                    value={bulkUrls}
                    onChange={(e) => setBulkUrls(e.target.value)}
                    disabled={analyzing || isProcessing || bulkProcessing}
                    className="flex min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 mb-3 font-mono text-xs"
                  />
                  {bulkProcessing && (
                    <div className="mb-3 p-2 rounded-md bg-green-100 dark:bg-green-900/30 border border-green-200 dark:border-green-800">
                      <p className="text-sm text-green-700 dark:text-green-300 flex items-center gap-2">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Processing {bulkProgress.current} of {bulkProgress.total}...
                        {bulkProgress.currentUrl && (
                          <span className="text-xs ml-2 truncate max-w-md">
                            {bulkProgress.currentUrl}
                          </span>
                        )}
                      </p>
                    </div>
                  )}
                  <Button
                    type="button"
                    onClick={handleBulkAdd}
                    disabled={analyzing || isProcessing || bulkProcessing || !bulkUrls.trim()}
                    variant="default"
                    className="w-full"
                  >
                    {bulkProcessing ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Processing...
                      </>
                    ) : (
                      <>
                        <Plus className="mr-2 h-4 w-4" />
                        Bulk Add ({bulkUrls.split('\n').filter(url => url.trim().length > 0).length} URLs)
                      </>
                    )}
                  </Button>
                </div>
                  <div className="text-xs text-muted-foreground space-y-1">
                    <p>💡 AI analysis available. Add OPENAI_API_KEY to .env for enhanced results.</p>
                    <p className="text-blue-600 dark:text-blue-400">
                      ℹ️ Rate Limits: You have 2 types of limits - RPM (requests/min) and TPM (tokens/min). Even with balance, low-tier accounts have low RPM limits. Check your tier at platform.openai.com/account/limits
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="mt-2"
                      onClick={async () => {
                        try {
                          const response = await fetch('/api/openai/test')
                          const data = await response.json()
                          if (data.success) {
                            addToast({
                              variant: 'success',
                              title: 'API Key Valid',
                              description: `Your API key is working. ${data.modelsAvailable} models available.`,
                            })
                          } else {
                            addToast({
                              variant: 'error',
                              title: 'API Key Issue',
                              description: `${data.error}: ${data.suggestion || data.details || ''}`,
                              duration: 8000,
                            })
                          }
                        } catch (error: any) {
                          addToast({
                            variant: 'error',
                            title: 'Test Failed',
                            description: error.message || 'Could not test API key',
                          })
                        }
                      }}
                    >
                      Test API Key
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={async () => {
                        try {
                          const session = await supabase.auth.getSession()
                          const token = (await session).data.session?.access_token
                          const response = await fetch('/api/admin/reset-monthly-upvotes', {
                            method: 'POST',
                            headers: {
                              'Content-Type': 'application/json',
                              Authorization: `Bearer ${token}`,
                            },
                          })
                          const data = await response.json()
                          if (response.ok) {
                            addToast({
                              variant: 'success',
                              title: 'Monthly Reset Complete',
                              description: 'All upvotes from previous months have been reset.',
                            })
                          } else {
                            throw new Error(data.error || 'Failed to reset')
                          }
                        } catch (error: any) {
                          addToast({
                            variant: 'error',
                            title: 'Reset Failed',
                            description: error.message || 'Could not reset monthly upvotes',
                          })
                        }
                      }}
                      className="gap-2"
                    >
                      <RefreshCw className="h-4 w-4" />
                      Reset Monthly Upvotes
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={async () => {
                        try {
                          const session = await supabase.auth.getSession()
                          const token = (await session).data.session?.access_token
                          const response = await fetch('/api/admin/add-missing-ratings', {
                            method: 'POST',
                            headers: {
                              'Content-Type': 'application/json',
                              Authorization: `Bearer ${token}`,
                            },
                          })
                          const data = await response.json()
                          if (response.ok) {
                            addToast({
                              variant: 'success',
                              title: 'Ratings Added',
                              description: `Processed ${data.processed} tools. ${data.successCount} ratings added, ${data.errorCount} errors.`,
                              duration: 8000,
                            })
                            fetchTools() // Refresh tools list
                          } else {
                            throw new Error(data.error || 'Failed to add ratings')
                          }
                        } catch (error: any) {
                          addToast({
                            variant: 'error',
                            title: 'Add Ratings Failed',
                            description: error.message || 'Could not add missing ratings',
                          })
                        }
                      }}
                      className="gap-2"
                    >
                      <Star className="h-4 w-4" />
                      Add Missing Ratings
                    </Button>
                  </div>
              </div>
            )}
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Name *</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Description *</Label>
                <textarea
                  id="description"
                  className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  value={formData.description}
                  onChange={(e) =>
                    setFormData({ ...formData, description: e.target.value })
                  }
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="url">URL *</Label>
                <Input
                  id="url"
                  type="url"
                  value={formData.url}
                  onChange={(e) => setFormData({ ...formData, url: e.target.value })}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="logoUrl">Logo URL</Label>
                <Input
                  id="logoUrl"
                  type="url"
                  value={formData.logoUrl}
                  onChange={(e) =>
                    setFormData({ ...formData, logoUrl: e.target.value })
                  }
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="category">Category *</Label>
                <Select
                  value={formData.category}
                  onValueChange={(value) =>
                    setFormData({ ...formData, category: value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a category" />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((cat) => (
                      <SelectItem key={cat} value={cat}>
                        {cat}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="tags">Tags (comma-separated)</Label>
                <Input
                  id="tags"
                  value={formData.tags}
                  onChange={(e) => setFormData({ ...formData, tags: e.target.value })}
                  placeholder="tag1, tag2, tag3"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="traffic">Traffic</Label>
                  <Select
                    value={formData.traffic}
                    onValueChange={(value) =>
                      setFormData({ ...formData, traffic: value })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                      <SelectItem value="unknown">Unknown</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="revenue">Revenue Model</Label>
                  <Select
                    value={formData.revenue}
                    onValueChange={(value) =>
                      setFormData({ ...formData, revenue: value })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="free">Free</SelectItem>
                      <SelectItem value="freemium">Freemium</SelectItem>
                      <SelectItem value="paid">Paid</SelectItem>
                      <SelectItem value="enterprise">Enterprise</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="rating">Rating (0-5)</Label>
                  <Input
                    id="rating"
                    type="number"
                    min="0"
                    max="5"
                    step="0.1"
                    value={formData.rating}
                    onChange={(e) =>
                      setFormData({ ...formData, rating: e.target.value })
                    }
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="estimatedVisits">Estimated Visits/Month</Label>
                  <Input
                    id="estimatedVisits"
                    type="number"
                    value={formData.estimatedVisits}
                    onChange={(e) =>
                      setFormData({ ...formData, estimatedVisits: e.target.value })
                    }
                  />
                </div>
              </div>

              <div className="flex gap-2">
                <Button type="submit" disabled={submitting}>
                  {submitting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Saving...
                    </>
                  ) : editingId ? (
                    'Update Tool'
                  ) : (
                    <>
                      <Plus className="mr-2 h-4 w-4" />
                      Add Tool
                    </>
                  )}
                </Button>
                {editingId && (
                  <Button type="button" variant="outline" onClick={resetForm}>
                    Cancel
                  </Button>
                )}
              </div>
            </form>
          </CardContent>
        </Card>

        <Card className="flex flex-col h-full">
          <CardHeader className="flex-shrink-0">
            <CardTitle>All Tools ({tools.length})</CardTitle>
            <CardDescription>Manage existing tools in the directory</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col flex-1 min-h-0 p-6">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : tools.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">
                No tools yet. Add your first tool!
              </p>
            ) : (
              <>
                <div className="mb-4 flex-shrink-0">
                  <Input
                    placeholder="Search tools by name, description, or category..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full"
                  />
                </div>
                <div className="flex-1 overflow-y-auto pr-2 space-y-2" style={{ maxHeight: 'calc(9 * (80px + 8px))' }}>
                  {tools
                    .filter((tool) => {
                      if (!searchQuery.trim()) return true
                      const query = searchQuery.toLowerCase()
                      return (
                        tool.name.toLowerCase().includes(query) ||
                        tool.description.toLowerCase().includes(query) ||
                        tool.category.toLowerCase().includes(query) ||
                        (tool.tags && tool.tags.toLowerCase().includes(query)) ||
                        tool.url.toLowerCase().includes(query)
                      )
                    })
                    .map((tool) => (
                  <div
                    key={tool.id}
                    className="flex items-start justify-between rounded-lg border p-4 hover:bg-accent/50 transition-colors min-h-[80px]"
                  >
                    <div className="flex-1 min-w-0 pr-4">
                      <h3 className="font-semibold truncate">{tool.name}</h3>
                      <p className="text-sm text-muted-foreground line-clamp-2 mt-1">
                        {tool.description}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span className="text-xs text-muted-foreground">
                          {tool.category}
                        </span>
                        {tool.rating && (
                          <span className="text-xs text-muted-foreground">
                            ⭐ {tool.rating.toFixed(1)}
                          </span>
                        )}
                        {tool.revenue && (
                          <span className="text-xs text-muted-foreground capitalize">
                            {tool.revenue}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2 flex-shrink-0">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleEdit(tool)}
                        title="Edit tool"
                      >
                        <Edit2 className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDelete(tool.id)}
                        title="Delete tool"
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                    ))}
                </div>
                {tools.filter((tool) => {
                  if (!searchQuery.trim()) return true
                  const query = searchQuery.toLowerCase()
                  return (
                    tool.name.toLowerCase().includes(query) ||
                    tool.description.toLowerCase().includes(query) ||
                    tool.category.toLowerCase().includes(query) ||
                    (tool.tags && tool.tags.toLowerCase().includes(query)) ||
                    tool.url.toLowerCase().includes(query)
                  )
                }).length === 0 && searchQuery.trim() && (
                  <p className="text-center text-muted-foreground py-8">
                    No tools match your search.
                  </p>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

