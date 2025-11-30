'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
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
  const [submitting, setSubmitting] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [quickAddUrl, setQuickAddUrl] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [autoSubmitTimer, setAutoSubmitTimer] = useState<NodeJS.Timeout | null>(null)
  const [countdown, setCountdown] = useState<number | null>(null)
  const [countdownInterval, setCountdownInterval] = useState<NodeJS.Timeout | null>(null)
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
    fetchTools()
  }, [])

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
    
    // Clear auto-submit timer if it exists (user submitted manually)
    if (autoSubmitTimer) {
      clearTimeout(autoSubmitTimer)
      setAutoSubmitTimer(null)
    }
    
    // Clear countdown
    if (countdownInterval) {
      clearInterval(countdownInterval)
      setCountdownInterval(null)
    }
    setCountdown(null)
    
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
    // Clear auto-submit timer when editing
    if (autoSubmitTimer) {
      clearTimeout(autoSubmitTimer)
      setAutoSubmitTimer(null)
    }
    
    // Clear countdown
    if (countdownInterval) {
      clearInterval(countdownInterval)
      setCountdownInterval(null)
    }
    setCountdown(null)
    
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
      const response = await fetch('/api/tools/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: quickAddUrl }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        const errorMessage = errorData.details || errorData.error || errorData.suggestion || 'Failed to analyze URL'
        console.error('❌ Analysis error:', errorData)
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
      
      // Auto-submit after 3 seconds for quick bulk adding
      // Clear any existing timer first
      if (autoSubmitTimer) {
        clearTimeout(autoSubmitTimer)
        setAutoSubmitTimer(null)
      }
      
      // Start countdown
      setCountdown(3)
      let currentCountdown = 3
      const interval = setInterval(() => {
        currentCountdown -= 1
        if (currentCountdown <= 0) {
          clearInterval(interval)
          setCountdownInterval(null)
          setCountdown(null)
        } else {
          setCountdown(currentCountdown)
        }
      }, 1000)
      setCountdownInterval(interval)
      
      // Store the form data that was just set (for the timer closure)
      const formDataToSubmit = {
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
      }
      
      const timer = setTimeout(async () => {
        // Clear countdown when timer fires
        if (countdownInterval) {
          clearInterval(countdownInterval)
          setCountdownInterval(null)
        }
        setCountdown(null)
        
        // Validate required fields before auto-submitting
        // Use the stored form data, not the closure's data variable
        if (formDataToSubmit.name && formDataToSubmit.description && formDataToSubmit.url && formDataToSubmit.category && !editingId) {
          // Temporarily set formData to ensure handleSubmit has the right data
          // Since state updates are async, we'll use the stored data directly
          const currentFormData = formDataToSubmit
          
          // Create payload from the stored form data
          const payload: any = {
            name: currentFormData.name.trim(),
            description: currentFormData.description.trim(),
            url: currentFormData.url.trim(),
            category: currentFormData.category,
          }

          // Optional fields - only include if they have values
          if (currentFormData.logoUrl && currentFormData.logoUrl.trim()) {
            payload.logoUrl = currentFormData.logoUrl.trim()
          }
          if (currentFormData.tags && currentFormData.tags.trim()) {
            payload.tags = currentFormData.tags.trim()
          }
          if (currentFormData.traffic && currentFormData.traffic.trim()) {
            payload.traffic = currentFormData.traffic
          }
          if (currentFormData.revenue && currentFormData.revenue.trim()) {
            payload.revenue = currentFormData.revenue
          }
          if (currentFormData.rating && currentFormData.rating.trim()) {
            const ratingNum = parseFloat(currentFormData.rating)
            if (!isNaN(ratingNum) && ratingNum >= 0 && ratingNum <= 5) {
              payload.rating = ratingNum
            }
          }
          if (currentFormData.estimatedVisits && currentFormData.estimatedVisits.trim()) {
            const visitsNum = parseInt(currentFormData.estimatedVisits)
            if (!isNaN(visitsNum) && visitsNum > 0) {
              payload.estimatedVisits = visitsNum
            }
          }

          console.log('Auto-submitting payload:', payload)

          // Clear countdown
          if (countdownInterval) {
            clearInterval(countdownInterval)
            setCountdownInterval(null)
          }
          setCountdown(null)
          
          // Submit directly to API
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
            
            // Reset processing state after everything is done
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
      }, 3000)
      
      setAutoSubmitTimer(timer)
    } catch (error) {
      console.error('Error analyzing URL:', error)
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      
      // Show user-friendly error messages
      if (errorMessage.includes('Rate Limit') || errorMessage.includes('rate limit')) {
        alert(`⚠️ OpenAI Rate Limit Reached\n\n${errorMessage}\n\nPlease wait a few minutes or add a payment method to increase your limits.\n\nYou can still fill the form manually.`)
      } else if (errorMessage.includes('API key')) {
        alert(`⚠️ OpenAI API Key Issue\n\n${errorMessage}\n\nPlease check your OPENAI_API_KEY in Vercel environment variables.`)
      } else {
        alert(`Failed to analyze URL: ${errorMessage}\n\nPlease fill in the form manually.`)
      }
      
      setIsProcessing(false)
    } finally {
      setAnalyzing(false)
      // Keep isProcessing true until auto-submit completes
    }
  }

  const resetForm = () => {
    // Clear auto-submit timer if it exists
    if (autoSubmitTimer) {
      clearTimeout(autoSubmitTimer)
      setAutoSubmitTimer(null)
    }
    
    // Clear countdown
    if (countdownInterval) {
      clearInterval(countdownInterval)
      setCountdownInterval(null)
    }
    setCountdown(null)
    
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
  
  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (autoSubmitTimer) {
        clearTimeout(autoSubmitTimer)
      }
      if (countdownInterval) {
        clearInterval(countdownInterval)
      }
    }
  }, [autoSubmitTimer, countdownInterval])

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
              <div className="mb-6 p-4 rounded-lg border bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-indigo-950/20 dark:to-purple-950/20">
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
                    disabled={analyzing || isProcessing}
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    onClick={handleQuickAdd}
                    disabled={analyzing || isProcessing || !quickAddUrl.trim()}
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
                {countdown !== null && countdown > 0 && (
                  <div className="mt-3 p-2 rounded-md bg-indigo-100 dark:bg-indigo-900/30 border border-indigo-200 dark:border-indigo-800">
                    <p className="text-sm text-indigo-700 dark:text-indigo-300 flex items-center gap-2">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Auto-submitting in <span className="font-bold text-indigo-900 dark:text-indigo-100">{countdown}</span> second{countdown !== 1 ? 's' : ''}...
                    </p>
                  </div>
                )}
                <p className="text-xs text-muted-foreground mt-2">
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

