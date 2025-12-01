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
import { categories } from '@/lib/schemas'
import type { Tool } from '@/lib/supabase'
import { Loader2, Plus, Trash2, Edit2, Sparkles } from 'lucide-react'

export default function AdminPage() {
  const router = useRouter()
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
        alert('Access denied. Admin role required.')
        router.push('/')
        return
      }

      setIsAdmin(true)
      setAuthLoading(false)
    }

    checkAuth()
    fetchTools()
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
        alert('Please fill in all required fields: Name, Description, URL, and Category')
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
        alert(`A tool with this URL already exists: ${existingTool.name}\n\nPlease edit the existing tool instead.`)
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
          alert(`❌ ${errorMessage}\n\nPlease use a different URL or edit the existing tool.`)
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
      alert('Failed to delete tool. Please try again.')
    }
  }

  const handleQuickAdd = async () => {
    if (!quickAddUrl.trim()) {
      alert('Please enter a URL')
      return
    }

    // Prevent multiple simultaneous analyses
    if (analyzing || isProcessing) {
      console.log('Already processing, please wait...')
      return
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
          
          const errorData = await response.json().catch(() => ({}))
          lastError = errorData.details || errorData.error || errorData.suggestion || `HTTP ${response.status}`
          
          if (response.status === 429) {
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
        const errorMessage = lastError || `HTTP ${response?.status || 'Unknown'}`
        console.error('❌ Analysis error:', errorMessage)
        throw new Error(errorMessage)
      }

      const data = await response.json()
      
      console.log('Analysis result:', data)
      
      // Log OpenAI usage status
      if (data._debug) {
        if (data._debug.usedOpenAI) {
          console.log('✅ OpenAI was used for analysis!')
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
              alert(`❌ ${errorMessage}\n\nPlease use a different URL or edit the existing tool.`)
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
          alert(`Failed to save tool: ${errorMessage}`)
        } finally {
          setSubmitting(false)
          setIsProcessing(false)
        }
      }
    } catch (error) {
      console.error('Error analyzing URL:', error)
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      
      // Show user-friendly error messages
      if (errorMessage.includes('429') || errorMessage.includes('Rate Limit') || errorMessage.includes('rate limit') || errorMessage.includes('Too Many Requests')) {
        alert(`⚠️ Rate Limit Reached\n\n${errorMessage}\n\nI've already retried 3 times with increasing delays.\n\nPlease wait a few minutes before trying again, or:\n- Add a payment method to increase your OpenAI limits\n- Fill in the form manually\n- Try using the bulk add feature (it has better rate limit handling)`)
      } else if (errorMessage.includes('API key')) {
        alert(`⚠️ OpenAI API Key Issue\n\n${errorMessage}\n\nPlease check your OPENAI_API_KEY in Vercel environment variables.`)
      } else {
        alert(`Failed to analyze URL: ${errorMessage}\n\nPlease fill in the form manually.`)
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
      alert('Please enter at least one valid URL (one per line). URLs can be with or without https://')
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
          errors.push(`${url}: ${errorMessage}`)
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

        // Small delay between requests to avoid rate limits
        if (i < urls.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000))
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
    const summary = `Bulk add complete!\n\n✅ Success: ${successCount}\n❌ Errors: ${errorCount}`
    if (errors.length > 0) {
      alert(`${summary}\n\nErrors:\n${errors.slice(0, 10).join('\n')}${errors.length > 10 ? `\n... and ${errors.length - 10} more` : ''}`)
    } else {
      alert(summary)
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
                      disabled={analyzing || isProcessing || bulkProcessing || !quickAddUrl.trim()}
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
                <p className="text-xs text-muted-foreground">
                  💡 AI analysis available. Add OPENAI_API_KEY to .env for enhanced results.
                </p>
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

