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
import type { Tool } from '@prisma/client'
import { Loader2, Plus, Trash2, Edit2, Sparkles } from 'lucide-react'

export default function AdminPage() {
  const router = useRouter()
  const [tools, setTools] = useState<Tool[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [quickAddUrl, setQuickAddUrl] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
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
    setSubmitting(true)

    try {
      // Validate required fields
      if (!formData.name || !formData.description || !formData.url || !formData.category) {
        alert('Please fill in all required fields: Name, Description, URL, and Category')
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
        const errorMessage = errorData.details || errorData.error || errorData.message || `HTTP error! status: ${response.status}`
        console.error('API Error:', errorData)
        throw new Error(errorMessage)
      }

      const result = await response.json()
      console.log('Tool saved successfully:', result)

      resetForm()
      await fetchTools()
      alert(editingId ? 'Tool updated successfully!' : 'Tool added successfully!')
    } catch (error) {
      console.error('Error saving tool:', error)
      const errorMessage = error instanceof Error 
        ? error.message 
        : 'Unknown error occurred. Check console for details.'
      alert(`Failed to save tool: ${errorMessage}`)
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

    setAnalyzing(true)
    try {
      const response = await fetch('/api/tools/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: quickAddUrl }),
      })

      if (!response.ok) {
        throw new Error('Failed to analyze URL')
      }

      const data = await response.json()
      
      console.log('Analysis result:', data)

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
        rating: data.rating?.toString() || '',
        estimatedVisits: data.estimatedVisits?.toString() || '',
      })

      setQuickAddUrl('')
      // Silently fill the form - no popup
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (error) {
      console.error('Error analyzing URL:', error)
      alert('Failed to analyze URL. Please fill in the form manually.')
    } finally {
      setAnalyzing(false)
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
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        handleQuickAdd()
                      }
                    }}
                    disabled={analyzing}
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    onClick={handleQuickAdd}
                    disabled={analyzing || !quickAddUrl.trim()}
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

        <Card>
          <CardHeader>
            <CardTitle>All Tools ({tools.length})</CardTitle>
            <CardDescription>Manage existing tools in the directory</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : tools.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">
                No tools yet. Add your first tool!
              </p>
            ) : (
              <div className="space-y-2 max-h-[600px] overflow-y-auto">
                {tools.map((tool) => (
                  <div
                    key={tool.id}
                    className="flex items-center justify-between rounded-lg border p-4"
                  >
                    <div className="flex-1">
                      <h3 className="font-semibold">{tool.name}</h3>
                      <p className="text-sm text-muted-foreground line-clamp-1">
                        {tool.description}
                      </p>
                      <div className="mt-1 flex gap-2">
                        <span className="text-xs text-muted-foreground">
                          {tool.category}
                        </span>
                        {tool.rating && (
                          <span className="text-xs text-muted-foreground">
                            ⭐ {tool.rating.toFixed(1)}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleEdit(tool)}
                      >
                        <Edit2 className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDelete(tool.id)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

