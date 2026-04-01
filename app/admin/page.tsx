'use client'

import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
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
import { categories, videoCategories } from '@/lib/schemas'
import { toolCategoryBadgeClass } from '@/lib/tool-category-styles'
import { toolCategoryList } from '@/lib/tool-categories'
import type { Tool, Video } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { Loader2, Plus, Trash2, Edit2, Sparkles, RefreshCw, Star, Youtube, Music2, Check } from 'lucide-react'

/** Shared tool form → API body (matches handleSubmit / PUT). */
type AdminToolFormState = {
  name: string
  description: string
  url: string
  logoUrl: string
  categories: string[]
  tags: string
  traffic: string
  revenue: string
  rating: string
  estimatedVisits: string
}

function buildToolPayload(
  fd: AdminToolFormState,
  editingId: string | null,
  tools: Tool[],
):
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; reason: 'incomplete' | 'duplicate'; existingName?: string } {
  if (
    !fd.name?.trim() ||
    !fd.description?.trim() ||
    !fd.url?.trim() ||
    fd.categories.length === 0
  ) {
    return { ok: false, reason: 'incomplete' }
  }

  const normalizedUrl = fd.url.trim().toLowerCase().replace(/\/$/, '')
  const existingTool = tools.find((tool) => {
    const existingUrl = tool.url.toLowerCase().replace(/\/$/, '')
    return existingUrl === normalizedUrl && tool.id !== editingId
  })
  if (existingTool) {
    return {
      ok: false,
      reason: 'duplicate',
      existingName: existingTool.name,
    }
  }

  const payload: Record<string, unknown> = {
    name: fd.name.trim(),
    description: fd.description.trim(),
    url: fd.url.trim(),
    categories: fd.categories,
  }

  if (fd.logoUrl && fd.logoUrl.trim()) {
    payload.logoUrl = fd.logoUrl.trim()
  }
  if (fd.tags && fd.tags.trim()) {
    payload.tags = fd.tags.trim()
  }
  if (fd.traffic && fd.traffic.trim()) {
    payload.traffic = fd.traffic
  }
  if (fd.revenue && fd.revenue.trim()) {
    payload.revenue = fd.revenue
  }
  if (fd.rating && fd.rating.trim()) {
    const ratingNum = parseFloat(fd.rating)
    if (!isNaN(ratingNum) && ratingNum >= 0 && ratingNum <= 5) {
      payload.rating = ratingNum
    }
  }
  if (fd.estimatedVisits && fd.estimatedVisits.trim()) {
    const visitsNum = parseInt(fd.estimatedVisits, 10)
    if (!isNaN(visitsNum) && visitsNum > 0) {
      payload.estimatedVisits = visitsNum
    }
  }

  return { ok: true, payload }
}

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
  const [adminCategoryFilter, setAdminCategoryFilter] = useState<string>('all')
  const [adminCreatedSort, setAdminCreatedSort] = useState<'newest' | 'oldest'>('newest')
  const [adminRevenueFilter, setAdminRevenueFilter] = useState<
    'all' | 'free' | 'freemium' | 'paid' | 'enterprise' | 'unset'
  >('all')
  const [customCategoryInput, setCustomCategoryInput] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  const [lastRequestTime, setLastRequestTime] = useState<number>(0)
  const [cooldownRemaining, setCooldownRemaining] = useState<number>(0)
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    url: '',
    logoUrl: '',
    categories: [] as string[],
    tags: '',
    traffic: '',
    revenue: '',
    rating: '',
    estimatedVisits: '',
  })

  const [autoSaveStatus, setAutoSaveStatus] = useState<
    'idle' | 'pending' | 'saving' | 'saved'
  >('idle')
  const formDataRef = useRef(formData)
  const toolsRef = useRef(tools)
  const editingIdRef = useRef(editingId)
  const editBaselineRef = useRef<string | null>(null)
  const autoSaveDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const autoSaveGenerationRef = useRef(0)
  const autoSaveSavedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const addToastRef = useRef(addToast)
  addToastRef.current = addToast

  formDataRef.current = formData
  toolsRef.current = tools
  editingIdRef.current = editingId

  // Videos tab state
  const [adminTab, setAdminTab] = useState<'tools' | 'videos'>('tools')
  const [videos, setVideos] = useState<Video[]>([])
  const [videosLoading, setVideosLoading] = useState(false)
  const [videoQuickAddUrl, setVideoQuickAddUrl] = useState('')
  const [videoAnalyzing, setVideoAnalyzing] = useState(false)
  const [videoSubmitting, setVideoSubmitting] = useState(false)
  const [editingVideoId, setEditingVideoId] = useState<string | null>(null)
  const [videoSearchQuery, setVideoSearchQuery] = useState('')
  const [videoThumbnailGenerating, setVideoThumbnailGenerating] = useState(false)
  const [videoThumbImgError, setVideoThumbImgError] = useState(false)
  const [videoFormData, setVideoFormData] = useState({
    title: '',
    url: '',
    category: 'Other' as (typeof videoCategories)[number],
    source: 'youtube' as 'youtube' | 'tiktok',
    youtuberName: '',
    subscriberCount: '',
    channelThumbnailUrl: '',
    channelVideoCount: '',
    verified: false,
    tags: '',
    description: '',
  })

  const videoFormDataRef = useRef(videoFormData)
  const editingVideoIdRef = useRef<string | null>(editingVideoId)
  videoFormDataRef.current = videoFormData
  editingVideoIdRef.current = editingVideoId

  const [videoAutoAddSeconds, setVideoAutoAddSeconds] = useState<number | null>(null)
  const videoAutoAddIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  )
  const videoAutoAddSessionRef = useRef(0)
  const submitVideoCoreRef = useRef<() => Promise<boolean>>(async () => false)
  const startVideoAutoAddCountdownRef = useRef<() => void>(() => {})

  const clearVideoAutoAdd = useCallback(() => {
    if (videoAutoAddIntervalRef.current) {
      clearInterval(videoAutoAddIntervalRef.current)
      videoAutoAddIntervalRef.current = null
    }
    setVideoAutoAddSeconds(null)
  }, [])

  useEffect(() => {
    return () => {
      if (videoAutoAddIntervalRef.current) {
        clearInterval(videoAutoAddIntervalRef.current)
        videoAutoAddIntervalRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession()

      if (!session) {
        setAuthLoading(false)
        router.push('/')
        return
      }

      const { data: userData, error } = await supabase
        .from('user')
        .select('role')
        .eq('id', session.user.id)
        .single()

      if (error || !userData || (userData?.role !== 'admin')) {
        setAuthLoading(false)
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
    fetchVideos()
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

  /** Debounced auto-save when editing an existing tool */
  useEffect(() => {
    if (!editingId) {
      if (autoSaveDebounceRef.current) {
        clearTimeout(autoSaveDebounceRef.current)
        autoSaveDebounceRef.current = null
      }
      return
    }

    const builtNow = buildToolPayload(formData, editingId, tools)
    if (!builtNow.ok) {
      if (autoSaveDebounceRef.current) {
        clearTimeout(autoSaveDebounceRef.current)
        autoSaveDebounceRef.current = null
      }
      setAutoSaveStatus('idle')
      return
    }
    const snapshotNow = JSON.stringify(builtNow.payload)
    if (snapshotNow === editBaselineRef.current) {
      if (autoSaveDebounceRef.current) {
        clearTimeout(autoSaveDebounceRef.current)
        autoSaveDebounceRef.current = null
      }
      setAutoSaveStatus('idle')
      return
    }

    if (autoSaveDebounceRef.current) {
      clearTimeout(autoSaveDebounceRef.current)
    }

    setAutoSaveStatus('pending')

    autoSaveDebounceRef.current = setTimeout(() => {
      autoSaveDebounceRef.current = null
      const id = editingIdRef.current
      if (!id) return

      const fd = formDataRef.current
      const toolsNow = toolsRef.current
      const b = buildToolPayload(fd, id, toolsNow)
      if (!b.ok) {
        if (b.reason === 'duplicate') {
          addToastRef.current({
            variant: 'warning',
            title: 'Duplicate URL',
            description: b.existingName
              ? `A tool with this URL already exists: ${b.existingName}.`
              : 'Another tool already uses this URL.',
          })
        }
        setAutoSaveStatus('idle')
        return
      }
      const snap = JSON.stringify(b.payload)
      if (snap === editBaselineRef.current) {
        setAutoSaveStatus('idle')
        return
      }

      const gen = ++autoSaveGenerationRef.current
      setAutoSaveStatus('saving')

      void (async () => {
        try {
          const response = await fetch(`/api/tools/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(b.payload),
          })

          if (gen !== autoSaveGenerationRef.current) return

          if (!response.ok) {
            const errorData = await response.json().catch(() => ({}))
            if (response.status === 409) {
              const errorMessage =
                errorData.message || 'A tool with this URL already exists'
              addToastRef.current({
                variant: 'error',
                title: 'Duplicate URL',
                description: errorMessage,
              })
            } else {
              const errorMessage =
                errorData.details ||
                errorData.error ||
                errorData.message ||
                `HTTP error! status: ${response.status}`
              addToastRef.current({
                variant: 'error',
                title: 'Auto-save failed',
                description: errorMessage,
              })
            }
            setAutoSaveStatus('idle')
            return
          }

          editBaselineRef.current = snap
          await fetchTools()

          if (gen !== autoSaveGenerationRef.current) return

          setAutoSaveStatus('saved')
          if (autoSaveSavedTimerRef.current) {
            clearTimeout(autoSaveSavedTimerRef.current)
          }
          autoSaveSavedTimerRef.current = setTimeout(() => {
            autoSaveSavedTimerRef.current = null
            setAutoSaveStatus((s) => (s === 'saved' ? 'idle' : s))
          }, 2000)
        } catch (err) {
          if (gen !== autoSaveGenerationRef.current) return
          console.error('Auto-save error:', err)
          const msg =
            err instanceof Error ? err.message : 'Unknown error occurred'
          addToastRef.current({
            variant: 'error',
            title: 'Auto-save failed',
            description: msg,
          })
          setAutoSaveStatus('idle')
        }
      })()
    }, 650)

    return () => {
      if (autoSaveDebounceRef.current) {
        clearTimeout(autoSaveDebounceRef.current)
        autoSaveDebounceRef.current = null
      }
    }
  }, [formData, editingId, tools])

  const fetchVideos = async () => {
    setVideosLoading(true)
    try {
      const response = await fetch('/api/videos')
      const data = await response.json()
      setVideos(Array.isArray(data) ? data : [])
    } catch (error) {
      console.error('Error fetching videos:', error)
      setVideos([])
    } finally {
      setVideosLoading(false)
    }
  }

  const filteredAdminTools = useMemo(() => {
    let list = [...tools]
    const q = searchQuery.trim().toLowerCase()
    if (q) {
      list = list.filter(
        (tool) =>
          tool.name.toLowerCase().includes(q) ||
          tool.description.toLowerCase().includes(q) ||
          toolCategoryList(tool).some((c) => c.toLowerCase().includes(q)) ||
          (tool.tags && tool.tags.toLowerCase().includes(q)) ||
          tool.url.toLowerCase().includes(q),
      )
    }
    if (adminCategoryFilter !== 'all') {
      list = list.filter((t) =>
        toolCategoryList(t).includes(adminCategoryFilter),
      )
    }
    if (adminRevenueFilter !== 'all') {
      if (adminRevenueFilter === 'unset') {
        list = list.filter((t) => !t.revenue)
      } else {
        list = list.filter((t) => t.revenue === adminRevenueFilter)
      }
    }
    list.sort((a, b) => {
      const ta = new Date(a.createdAt || 0).getTime()
      const tb = new Date(b.createdAt || 0).getTime()
      return adminCreatedSort === 'newest' ? tb - ta : ta - tb
    })
    return list
  }, [
    tools,
    searchQuery,
    adminCategoryFilter,
    adminRevenueFilter,
    adminCreatedSort,
  ])

  const adminFiltersActive =
    adminCategoryFilter !== 'all' ||
    adminRevenueFilter !== 'all' ||
    adminCreatedSort !== 'newest'

  const sortSelectedCategories = (selected: string[]) => {
    const known = selected.filter((c) =>
      categories.includes(c as (typeof categories)[number]),
    )
    const unknown = selected.filter(
      (c) => !categories.includes(c as (typeof categories)[number]),
    )
    const sortedKnown = [...known].sort(
      (a, b) =>
        categories.indexOf(a as (typeof categories)[number]) -
        categories.indexOf(b as (typeof categories)[number]),
    )
    return [...sortedKnown, ...unknown]
  }

  const availableAdminCategories = useMemo(() => {
    const seen = new Set<string>(categories as readonly string[])
    for (const tool of tools) {
      for (const c of toolCategoryList(tool)) {
        if (c?.trim()) seen.add(c.trim())
      }
    }
    for (const c of formData.categories) {
      if (c?.trim()) seen.add(c.trim())
    }
    if (adminCategoryFilter !== 'all' && adminCategoryFilter.trim()) {
      seen.add(adminCategoryFilter.trim())
    }
    return sortSelectedCategories(Array.from(seen))
  }, [tools, formData.categories, adminCategoryFilter])

  const toggleToolCategory = (cat: string) => {
    setFormData((prev) => {
      const has = prev.categories.includes(cat)
      const next = has
        ? prev.categories.filter((c) => c !== cat)
        : sortSelectedCategories([...prev.categories, cat])
      return { ...prev, categories: next }
    })
  }

  const addCustomCategory = () => {
    const raw = customCategoryInput.trim()
    if (!raw) return
    const existing = availableAdminCategories.find(
      (c) => c.toLowerCase() === raw.toLowerCase(),
    )
    toggleToolCategory(existing ?? raw)
    setCustomCategoryInput('')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (editingId) return

    setSubmitting(true)

    try {
      const built = buildToolPayload(formData, null, tools)
      if (!built.ok) {
        if (built.reason === 'incomplete') {
          addToast({
            variant: 'warning',
            title: 'Missing Required Fields',
            description:
              'Please fill in Name, Description, URL, and at least one category',
          })
        } else if (built.reason === 'duplicate') {
          addToast({
            variant: 'warning',
            title: 'Duplicate URL',
            description: built.existingName
              ? `A tool with this URL already exists: ${built.existingName}. Please edit the existing tool instead.`
              : 'A tool with this URL already exists.',
          })
        }
        setSubmitting(false)
        return
      }

      const payload = built.payload
      console.log('Submitting payload:', payload)

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
    if (autoSaveDebounceRef.current) {
      clearTimeout(autoSaveDebounceRef.current)
      autoSaveDebounceRef.current = null
    }
    if (autoSaveSavedTimerRef.current) {
      clearTimeout(autoSaveSavedTimerRef.current)
      autoSaveSavedTimerRef.current = null
    }
    const nextForm = {
      name: tool.name,
      description: tool.description,
      url: tool.url,
      logoUrl: tool.logoUrl || '',
      categories: toolCategoryList(tool),
      tags: tool.tags || '',
      traffic: tool.traffic || '',
      revenue: tool.revenue || '',
      rating: tool.rating?.toString() || '',
      estimatedVisits: tool.estimatedVisits?.toString() || '',
    }
    setEditingId(tool.id)
    setFormData(nextForm)
    const b = buildToolPayload(nextForm, tool.id, tools)
    editBaselineRef.current = b.ok ? JSON.stringify(b.payload) : ''
    setAutoSaveStatus('idle')
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

  /** Heuristic for paste-to-fetch (YouTube / TikTok). */
  const isLikelyVideoUrlText = (s: string) => {
    const t = s.trim().toLowerCase()
    if (!t) return false
    return (
      t.includes('youtube.com') ||
      t.includes('youtu.be') ||
      t.includes('tiktok.com') ||
      t.includes('vm.tiktok.com')
    )
  }

  const resetVideoForm = useCallback(() => {
    clearVideoAutoAdd()
    setVideoThumbImgError(false)
    setVideoFormData({
      title: '',
      url: '',
      category: 'Other',
      source: 'youtube',
      youtuberName: '',
      subscriberCount: '',
      channelThumbnailUrl: '',
      channelVideoCount: '',
      verified: false,
      tags: '',
      description: '',
    })
    setEditingVideoId(null)
  }, [clearVideoAutoAdd])

  const submitVideoCore = useCallback(async (): Promise<boolean> => {
    const fd = videoFormDataRef.current
    const editId = editingVideoIdRef.current
    if (!fd.title.trim() || !fd.url.trim() || !fd.category) {
      addToast({
        variant: 'warning',
        title: 'Missing fields',
        description: 'Title, URL, and Category are required.',
      })
      return false
    }
    setVideoSubmitting(true)
    try {
      const payload: Record<string, unknown> = {
        title: fd.title.trim(),
        url: fd.url.trim(),
        category: fd.category,
        source: fd.source,
        youtuberName: fd.youtuberName.trim() || null,
        subscriberCount: fd.subscriberCount.trim()
          ? parseInt(fd.subscriberCount, 10)
          : null,
        channelThumbnailUrl: fd.channelThumbnailUrl?.trim() || null,
        channelVideoCount: fd.channelVideoCount.trim()
          ? parseInt(fd.channelVideoCount, 10)
          : null,
        verified: fd.verified || null,
        tags: fd.tags.trim() || null,
        description: fd.description.trim() || null,
      }
      const url = editId ? `/api/videos/${editId}` : '/api/videos'
      const method = editId ? 'PUT' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) {
        if (res.status === 409) {
          addToast({
            variant: 'error',
            title: 'Duplicate URL',
            description: data.message || 'This video URL already exists.',
          })
          return false
        }
        throw new Error(data.message || data.error || data.details || 'Failed to save video')
      }
      resetVideoForm()
      await fetchVideos()
      return true
    } catch (err) {
      addToast({
        variant: 'error',
        title: 'Failed to save video',
        description: err instanceof Error ? err.message : 'Please try again.',
      })
      return false
    } finally {
      setVideoSubmitting(false)
    }
  }, [addToast, resetVideoForm])

  const startVideoAutoAddCountdown = useCallback(() => {
    clearVideoAutoAdd()
    const mySession = videoAutoAddSessionRef.current
    let left = 5
    setVideoAutoAddSeconds(left)
    videoAutoAddIntervalRef.current = setInterval(() => {
      left -= 1
      if (left <= 0) {
        if (videoAutoAddIntervalRef.current) {
          clearInterval(videoAutoAddIntervalRef.current)
          videoAutoAddIntervalRef.current = null
        }
        setVideoAutoAddSeconds(null)
        if (videoAutoAddSessionRef.current !== mySession) return
        if (editingVideoIdRef.current) return
        void submitVideoCoreRef.current()
        return
      }
      setVideoAutoAddSeconds(left)
    }, 1000)
  }, [clearVideoAutoAdd])

  submitVideoCoreRef.current = submitVideoCore
  startVideoAutoAddCountdownRef.current = startVideoAutoAddCountdown

  const runVideoAnalyzeFromUrl = async (
    rawUrl: string,
    options?: { clearQuickField?: boolean },
  ) => {
    const clearQuick = options?.clearQuickField !== false
    if (!rawUrl.trim()) {
      addToast({ variant: 'warning', title: 'URL Required', description: 'Paste a YouTube or TikTok video URL.' })
      return
    }
    if (videoAnalyzing) return
    videoAutoAddSessionRef.current += 1
    clearVideoAutoAdd()
    setVideoAnalyzing(true)
    try {
      let urlToFetch = rawUrl.trim()
      if (!urlToFetch.startsWith('http://') && !urlToFetch.startsWith('https://')) {
        urlToFetch = `https://${urlToFetch}`
      }
      const res = await fetch('/api/videos/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: urlToFetch }),
      })
      const data = await res.json()
      if (!res.ok) {
        addToast({
          variant: 'error',
          title: 'Could not fetch video',
          description: data.error || res.statusText,
        })
        return
      }
      setVideoFormData((prev) => ({
        ...prev,
        url: data.url || urlToFetch,
        title: data.title || '',
        source: data.source === 'tiktok' ? 'tiktok' : 'youtube',
        youtuberName: data.youtuberName || '',
        subscriberCount: data.subscriberCount != null ? String(data.subscriberCount) : '',
        description: data.description || '',
        channelThumbnailUrl: data.channelThumbnailUrl || '',
        channelVideoCount: data.channelVideoCount != null ? String(data.channelVideoCount) : prev.channelVideoCount,
        verified: data.verified === true,
        category: data.suggestedCategory && videoCategories.includes(data.suggestedCategory as any)
          ? (data.suggestedCategory as (typeof videoCategories)[number])
          : prev.category,
        tags: data.suggestedTags ?? prev.tags,
      }))
      if (clearQuick) setVideoQuickAddUrl('')
      window.scrollTo({ top: 0, behavior: 'smooth' })

      addToast({
        variant: 'success',
        title: 'Video details loaded',
        description: `Saving automatically in 5s — edit the form or press Cancel to stop.`,
        duration: 6000,
      })

      const filledTitle = (data.title || '').trim()
      const filledUrl = (data.url || urlToFetch).trim()
      if (!editingVideoIdRef.current && filledTitle && filledUrl) {
        window.setTimeout(() => {
          if (editingVideoIdRef.current) return
          startVideoAutoAddCountdownRef.current()
        }, 50)
      }
    } catch (e) {
      addToast({
        variant: 'error',
        title: 'Failed to fetch video info',
        description: e instanceof Error ? e.message : 'Please try again.',
      })
    } finally {
      setVideoAnalyzing(false)
    }
  }

  const handleVideoAnalyze = () => {
    void runVideoAnalyzeFromUrl(videoQuickAddUrl)
  }

  const handleVideoSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    clearVideoAutoAdd()
    await submitVideoCore()
  }

  const handleEditVideo = (video: Video) => {
    clearVideoAutoAdd()
    setEditingVideoId(video.id)
    setVideoThumbImgError(false)
    setVideoFormData({
      title: video.title,
      url: video.url,
      category: video.category as (typeof videoCategories)[number],
      source: (video as { source?: 'youtube' | 'tiktok' }).source === 'tiktok' ? 'tiktok' : 'youtube',
      youtuberName: video.youtuberName || '',
      subscriberCount: video.subscriberCount != null ? String(video.subscriberCount) : '',
      channelThumbnailUrl: (video as { channelThumbnailUrl?: string | null }).channelThumbnailUrl || '',
      channelVideoCount:
        (video as { channelVideoCount?: number | null }).channelVideoCount != null
          ? String((video as { channelVideoCount?: number | null }).channelVideoCount)
          : '',
      verified: (video as { verified?: boolean | null }).verified === true,
      tags: video.tags || '',
      description: video.description || '',
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  /** Extract YouTube video ID for fallback thumbnail */
  const getYouTubeVideoIdFromUrl = (url: string): string | null => {
    try {
      const u = new URL(url.trim())
      if (u.hostname.includes('youtube.com')) {
        const v = u.searchParams.get('v')
        if (v) return v
        const parts = u.pathname.split('/').filter(Boolean)
        const id = parts[parts.length - 1]
        return id && id !== 'watch' ? id : null
      }
      if (u.hostname === 'youtu.be') return u.pathname.replace(/^\//, '') || null
      return null
    } catch {
      return null
    }
  }

  const handleGenerateChannelThumbnail = async () => {
    const url = videoFormData.url?.trim()
    if (!url) {
      addToast({ variant: 'warning', title: 'Video URL required', description: 'Enter the video URL above first, then click Generate.' })
      return
    }
    setVideoThumbnailGenerating(true)
    try {
      let urlToFetch = url
      if (!urlToFetch.startsWith('http://') && !urlToFetch.startsWith('https://')) urlToFetch = `https://${urlToFetch}`
      const res = await fetch('/api/videos/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: urlToFetch }),
      })
      const data = await res.json()
      let thumb = data.channelThumbnailUrl || null
      if (!thumb && (urlToFetch.includes('youtube.com') || urlToFetch.includes('youtu.be'))) {
        const videoId = getYouTubeVideoIdFromUrl(urlToFetch)
        if (videoId) thumb = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
      }
      if (thumb) {
        setVideoThumbImgError(false)
        setVideoFormData((prev) => ({ ...prev, channelThumbnailUrl: thumb }))
        addToast({ variant: 'success', title: 'Profile picture set', description: 'Channel thumbnail has been filled in.' })
      } else {
        addToast({ variant: 'warning', title: 'No thumbnail found', description: 'Using video thumbnail as fallback for YouTube if available.' })
        const videoId = getYouTubeVideoIdFromUrl(urlToFetch)
        if (videoId) {
          setVideoThumbImgError(false)
          setVideoFormData((prev) => ({ ...prev, channelThumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` }))
        }
      }
    } catch (e) {
      addToast({ variant: 'error', title: 'Failed to fetch', description: e instanceof Error ? e.message : 'Could not fetch thumbnail.' })
    } finally {
      setVideoThumbnailGenerating(false)
    }
  }

  const handleDeleteVideo = async (id: string) => {
    if (!confirm('Delete this video?')) return
    try {
      await fetch(`/api/videos/${id}`, { method: 'DELETE' })
      await fetchVideos()
      if (editingVideoId === id) resetVideoForm()
    } catch (error) {
      addToast({
        variant: 'error',
        title: 'Failed to delete video',
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
        categories:
          Array.isArray(data.categories) && data.categories.length > 0
            ? data.categories
            : [data.category || 'Other'],
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
      const analyzedCategories =
        Array.isArray(data.categories) && data.categories.length > 0
          ? data.categories
          : data.category
            ? [data.category]
            : []
      if (
        data.name &&
        data.description &&
        data.url &&
        analyzedCategories.length > 0 &&
        !editingId
      ) {
        const payload: any = {
          name: data.name.trim(),
          description: data.description.trim(),
          url: data.url.trim(),
          categories: analyzedCategories,
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
          categories:
            Array.isArray(data.categories) && data.categories.length > 0
              ? data.categories
              : [data.category || 'Other'],
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
    if (autoSaveDebounceRef.current) {
      clearTimeout(autoSaveDebounceRef.current)
      autoSaveDebounceRef.current = null
    }
    if (autoSaveSavedTimerRef.current) {
      clearTimeout(autoSaveSavedTimerRef.current)
      autoSaveSavedTimerRef.current = null
    }
    editBaselineRef.current = null
    setAutoSaveStatus('idle')
    setFormData({
      name: '',
      description: '',
      url: '',
      logoUrl: '',
      categories: [],
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
    <div className="min-h-screen bg-gradient-to-b from-muted/30 via-background to-muted/20">
      <div className="container mx-auto px-4 py-8 max-w-7xl">
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold mb-2 tracking-tight">
              <span className="bg-gradient-to-r from-violet-600 to-fuchsia-600 dark:from-violet-400 dark:to-fuchsia-400 bg-clip-text text-transparent">Admin Dashboard</span>
            </h1>
            <p className="text-muted-foreground text-sm sm:text-base">
              Add, edit, or remove AI tools and videos from the directory
            </p>
          </div>
          <div className="flex rounded-xl border border-border/80 bg-card/80 shadow-sm p-1">
            <button
              type="button"
              onClick={() => setAdminTab('tools')}
              className={`rounded-lg px-5 py-2.5 text-sm font-semibold transition-all flex items-center gap-2 ${adminTab === 'tools' ? 'bg-gradient-to-r from-violet-500/90 to-fuchsia-500/90 text-white shadow-md' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'}`}
            >
              Tools
            </button>
            <button
              type="button"
              onClick={() => setAdminTab('videos')}
              className={`rounded-lg px-5 py-2.5 text-sm font-semibold transition-all flex items-center gap-2 ${adminTab === 'videos' ? 'bg-gradient-to-r from-violet-500/90 to-fuchsia-500/90 text-white shadow-md' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'}`}
            >
              <Youtube className="h-4 w-4" />
              Videos
            </button>
          </div>
        </div>

      {adminTab === 'tools' && (
      <div className="grid gap-8 lg:grid-cols-2">
        <Card className="border-border/60 shadow-lg shadow-black/5 dark:shadow-black/20 bg-card/95">
          <CardHeader className="pb-4">
            <CardTitle className="text-xl flex flex-wrap items-center gap-3">
              <span>{editingId ? 'Edit Tool' : 'Add New Tool'}</span>
              {editingId && (
                <span
                  className="flex items-center gap-2 font-normal text-muted-foreground"
                  style={{ fontSize: 'calc(0.875rem + 5px)' }}
                >
                  {(autoSaveStatus === 'pending' || autoSaveStatus === 'saving') && (
                    <>
                      <Loader2
                        className="animate-spin text-primary"
                        style={{ width: 'calc(1rem + 5px)', height: 'calc(1rem + 5px)' }}
                        aria-hidden
                      />
                      <span>Saving…</span>
                    </>
                  )}
                  {autoSaveStatus === 'saved' && (
                    <>
                      <Check
                        className="text-emerald-600 dark:text-emerald-400"
                        style={{ width: 'calc(1rem + 5px)', height: 'calc(1rem + 5px)' }}
                        aria-hidden
                      />
                      <span className="text-emerald-600 dark:text-emerald-400">Saved</span>
                    </>
                  )}
                </span>
              )}
            </CardTitle>
            <CardDescription>
              {editingId
                ? 'Changes save automatically after you stop typing or changing categories'
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
            <form
              onSubmit={(e) => {
                e.preventDefault()
                if (!editingId) void handleSubmit(e)
              }}
              className="space-y-4"
            >
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
                <Label>Categories *</Label>
                <p className="text-xs text-muted-foreground">
                  Pick one or more. Order follows the list (first = primary badge on the home page).
                </p>
                <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
                  <div className="grid max-h-52 grid-cols-1 gap-1.5 overflow-y-auto pr-1 sm:grid-cols-2">
                    {availableAdminCategories.map((cat, catIdx) => {
                      const checked = formData.categories.includes(cat)
                      const fieldId = `admin-tool-cat-${catIdx}`
                      return (
                        <label
                          key={cat}
                          htmlFor={fieldId}
                          className={cn(
                            'flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1.5 transition-colors',
                            checked
                              ? 'border-primary/40 bg-background shadow-sm'
                              : 'border-transparent hover:bg-background/60',
                          )}
                        >
                          <Checkbox
                            id={fieldId}
                            checked={checked}
                            onCheckedChange={() => toggleToolCategory(cat)}
                          />
                          <Badge
                            variant="outline"
                            className={cn(
                              'pointer-events-none text-xs font-medium capitalize',
                              toolCategoryBadgeClass(cat),
                            )}
                          >
                            {cat}
                          </Badge>
                        </label>
                      )
                    })}
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <Input
                      value={customCategoryInput}
                      onChange={(e) => setCustomCategoryInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          addCustomCategory()
                        }
                      }}
                      placeholder="Add new category (e.g. Betting)"
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={addCustomCategory}
                      disabled={!customCategoryInput.trim()}
                    >
                      Add
                    </Button>
                  </div>
                </div>
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

              <div className="flex flex-wrap items-center gap-2">
                {!editingId && (
                  <Button type="submit" disabled={submitting}>
                    {submitting ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Plus className="mr-2 h-4 w-4" />
                        Add Tool
                      </>
                    )}
                  </Button>
                )}
                {editingId && (
                  <Button type="button" variant="outline" onClick={resetForm}>
                    Cancel
                  </Button>
                )}
              </div>
            </form>
          </CardContent>
        </Card>

        <Card className="flex flex-col h-full border-border/60 shadow-lg shadow-black/5 dark:shadow-black/20 bg-card/95">
          <CardHeader className="flex-shrink-0">
            <CardTitle className="text-xl">All Tools ({tools.length})</CardTitle>
            <CardDescription>
              Manage existing tools in the directory
              {tools.length > 0 && (
                <>
                  {' '}
                  · Showing{' '}
                  <span className="font-medium text-foreground">
                    {filteredAdminTools.length}
                  </span>{' '}
                  of {tools.length}
                </>
              )}
            </CardDescription>
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
                <div className="mb-4 flex-shrink-0 space-y-3">
                  <Input
                    placeholder="Search tools by name, description, or category..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full"
                  />
                  <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
                    <div className="grid flex-1 min-w-[10rem] gap-1.5">
                      <Label className="text-xs text-muted-foreground">
                        Category
                      </Label>
                      <Select
                        value={adminCategoryFilter}
                        onValueChange={setAdminCategoryFilter}
                      >
                        <SelectTrigger className="h-9 w-full">
                          <SelectValue placeholder="Category" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All categories</SelectItem>
                          {availableAdminCategories.map((cat) => (
                            <SelectItem key={cat} value={cat}>
                              {cat}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid flex-1 min-w-[10rem] gap-1.5">
                      <Label className="text-xs text-muted-foreground">
                        Created
                      </Label>
                      <Select
                        value={adminCreatedSort}
                        onValueChange={(v) =>
                          setAdminCreatedSort(v as 'newest' | 'oldest')
                        }
                      >
                        <SelectTrigger className="h-9 w-full">
                          <SelectValue placeholder="Sort by date" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="newest">Newest first</SelectItem>
                          <SelectItem value="oldest">Oldest first</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid flex-1 min-w-[10rem] gap-1.5">
                      <Label className="text-xs text-muted-foreground">
                        Revenue
                      </Label>
                      <Select
                        value={adminRevenueFilter}
                        onValueChange={(v) =>
                          setAdminRevenueFilter(
                            v as
                              | 'all'
                              | 'free'
                              | 'freemium'
                              | 'paid'
                              | 'enterprise'
                              | 'unset',
                          )
                        }
                      >
                        <SelectTrigger className="h-9 w-full">
                          <SelectValue placeholder="Revenue model" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All revenue models</SelectItem>
                          <SelectItem value="free">Free</SelectItem>
                          <SelectItem value="freemium">Freemium</SelectItem>
                          <SelectItem value="paid">Paid</SelectItem>
                          <SelectItem value="enterprise">Enterprise</SelectItem>
                          <SelectItem value="unset">Not set</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {(adminFiltersActive || searchQuery.trim()) && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-9 shrink-0 sm:mb-0"
                        onClick={() => {
                          setSearchQuery('')
                          setAdminCategoryFilter('all')
                          setAdminRevenueFilter('all')
                          setAdminCreatedSort('newest')
                        }}
                      >
                        Clear filters
                      </Button>
                    )}
                  </div>
                </div>
                <div className="relative min-h-0 flex-1">
                  <div
                    className="scrollbar-thin space-y-2 overflow-y-auto pb-3 pr-2"
                    style={{
                      maxHeight: 'min(70vh, calc(8.45 * (80px + 8px)))',
                    }}
                  >
                    {filteredAdminTools.map((tool) => (
                  <div
                    key={tool.id}
                    className="flex items-start justify-between rounded-xl border border-border/60 p-4 hover:bg-muted/40 hover:border-violet-200 dark:hover:border-violet-800/50 transition-all min-h-[80px]"
                  >
                    <div className="flex-1 min-w-0 pr-4">
                      <h3 className="font-semibold truncate">{tool.name}</h3>
                      <p className="text-sm text-muted-foreground line-clamp-2 mt-1">
                        {tool.description}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5 gap-y-1">
                        {toolCategoryList(tool).map((c) => (
                          <Badge
                            key={c}
                            variant="outline"
                            className={cn(
                              'text-[11px] font-medium capitalize',
                              toolCategoryBadgeClass(c),
                            )}
                          >
                            {c}
                          </Badge>
                        ))}
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
                  <div
                    className="pointer-events-none absolute bottom-0 left-0 right-2 h-12 rounded-b-lg bg-gradient-to-t from-card to-transparent dark:from-card"
                    aria-hidden
                  />
                </div>
                {filteredAdminTools.length === 0 && (
                  <p className="text-center text-muted-foreground py-8">
                    No tools match your search or filters.
                  </p>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>
      )}

      {adminTab === 'videos' && (
      <div className="grid gap-8 lg:grid-cols-2">
        <Card className="border-border/60 shadow-lg shadow-black/5 dark:shadow-black/20 bg-card/95">
          <CardHeader className="pb-4">
            <CardTitle className="text-xl">{editingVideoId ? 'Edit Video' : 'Add Video'}</CardTitle>
            <CardDescription>
              {editingVideoId ? 'Update the video below' : 'Paste a YouTube or TikTok URL to fetch title and channel, then add to the directory'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!editingVideoId && (
              <div className="mb-6 p-4 rounded-lg border bg-gradient-to-r from-red-50 to-orange-50 dark:from-red-950/20 dark:to-orange-950/20">
                <div className="flex items-center gap-2 mb-2">
                  <Youtube className="h-4 w-4 text-red-600 dark:text-red-400" />
                  <Music2 className="h-4 w-4 text-pink-600 dark:text-pink-400" />
                  <Label className="font-semibold">Add Video by URL</Label>
                </div>
                <p className="text-sm text-muted-foreground mb-3">
                  Paste a YouTube or TikTok URL to auto-fetch and fill the form (same as Quick Add by URL for AI tools)—or type a URL and click Fetch info.
                </p>
                <div className="flex gap-2">
                  <Input
                    placeholder="YouTube or TikTok URL (e.g. youtube.com/watch?v=... or tiktok.com/...)"
                    value={videoQuickAddUrl}
                    onChange={(e) => setVideoQuickAddUrl(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleVideoAnalyze())}
                    onPaste={(e) => {
                      const text = e.clipboardData.getData('text/plain').trim()
                      if (!isLikelyVideoUrlText(text)) return
                      e.preventDefault()
                      setVideoQuickAddUrl(text)
                      void runVideoAnalyzeFromUrl(text, { clearQuickField: true })
                    }}
                    disabled={videoAnalyzing || videoSubmitting}
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    onClick={handleVideoAnalyze}
                    disabled={videoAnalyzing || videoSubmitting || !videoQuickAddUrl.trim()}
                    variant="default"
                  >
                    {videoAnalyzing ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Fetch
                      </>
                    ) : (
                      'Fetch info'
                    )}
                  </Button>
                </div>
              </div>
            )}
            <form onSubmit={handleVideoSubmit} className="space-y-4">
              {videoAutoAddSeconds !== null && !editingVideoId ? (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
                  <span>
                    Saving this video automatically in <strong>{videoAutoAddSeconds}</strong>s — edit fields below or cancel.
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="shrink-0 border-amber-300 bg-white hover:bg-amber-100 dark:border-amber-700 dark:bg-transparent dark:hover:bg-amber-900/50"
                    onClick={clearVideoAutoAdd}
                  >
                    Cancel auto-save
                  </Button>
                </div>
              ) : null}
              <div className="space-y-2">
                <Label htmlFor="video-title">Title *</Label>
                <Input
                  id="video-title"
                  value={videoFormData.title}
                  onChange={(e) => setVideoFormData({ ...videoFormData, title: e.target.value })}
                  placeholder="Video title"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="video-url">Video URL * (YouTube or TikTok)</Label>
                <Input
                  id="video-url"
                  type="url"
                  value={videoFormData.url}
                  onChange={(e) => setVideoFormData({ ...videoFormData, url: e.target.value })}
                  onPaste={(e) => {
                    if (editingVideoId) return
                    const text = e.clipboardData.getData('text/plain').trim()
                    if (!isLikelyVideoUrlText(text)) return
                    e.preventDefault()
                    void runVideoAnalyzeFromUrl(text, { clearQuickField: false })
                  }}
                  placeholder="https://www.youtube.com/watch?v=... or https://www.tiktok.com/..."
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="video-source">Source</Label>
                <Select
                  value={videoFormData.source}
                  onValueChange={(v) => setVideoFormData({ ...videoFormData, source: v as 'youtube' | 'tiktok' })}
                >
                  <SelectTrigger id="video-source">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="youtube">YouTube</SelectItem>
                    <SelectItem value="tiktok">TikTok</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="video-category">Category *</Label>
                <Select
                  value={videoFormData.category}
                  onValueChange={(v) => setVideoFormData({ ...videoFormData, category: v as (typeof videoCategories)[number] })}
                >
                  <SelectTrigger id="video-category">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {videoCategories.map((cat) => (
                      <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="video-youtuber">Channel / Creator name</Label>
                <Input
                  id="video-youtuber"
                  value={videoFormData.youtuberName}
                  onChange={(e) => setVideoFormData({ ...videoFormData, youtuberName: e.target.value })}
                  placeholder="Channel name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="video-subs">Subscribers / followers</Label>
                <Input
                  id="video-subs"
                  type="number"
                  min={0}
                  value={videoFormData.subscriberCount}
                  onChange={(e) => setVideoFormData({ ...videoFormData, subscriberCount: e.target.value })}
                  placeholder="e.g. 1000000"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="video-channel-thumb">Channel profile picture URL</Label>
                <div className="flex flex-wrap gap-2 items-start">
                  <Input
                    id="video-channel-thumb"
                    type="url"
                    value={videoFormData.channelThumbnailUrl}
                    onChange={(e) => { setVideoThumbImgError(false); setVideoFormData({ ...videoFormData, channelThumbnailUrl: e.target.value }) }}
                    placeholder="https://yt3.ggpht.com/... or use Generate"
                    className="flex-1 min-w-[200px]"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleGenerateChannelThumbnail}
                    disabled={videoThumbnailGenerating || !videoFormData.url?.trim()}
                    className="shrink-0"
                  >
                    {videoThumbnailGenerating ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      'Generate'
                    )}
                  </Button>
                  <div className="h-12 w-12 rounded-full overflow-hidden border-2 border-border flex-shrink-0 bg-muted flex items-center justify-center text-muted-foreground text-xs">
                    {videoFormData.channelThumbnailUrl && !videoThumbImgError ? (
                      <img
                        src={videoFormData.channelThumbnailUrl}
                        alt="Channel"
                        className="h-full w-full object-cover"
                        onError={() => setVideoThumbImgError(true)}
                      />
                    ) : (
                      <span>?</span>
                    )}
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">Missing profile pic? Paste the video URL above and click Generate to fetch channel thumbnail or use video frame.</p>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="video-verified"
                  checked={videoFormData.verified}
                  onChange={(e) => setVideoFormData({ ...videoFormData, verified: e.target.checked })}
                  className="h-4 w-4 rounded border-border"
                />
                <Label htmlFor="video-verified" className="cursor-pointer">Verified (manual)</Label>
              </div>
              <div className="space-y-2">
                <Label htmlFor="video-tags">Tags (comma-separated)</Label>
                <Input
                  id="video-tags"
                  value={videoFormData.tags}
                  onChange={(e) => setVideoFormData({ ...videoFormData, tags: e.target.value })}
                  placeholder="motivation, success, ..."
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="video-desc">Short description (one line, max 200 chars)</Label>
                <Input
                  id="video-desc"
                  value={videoFormData.description}
                  onChange={(e) => setVideoFormData({ ...videoFormData, description: e.target.value })}
                  placeholder="AI-generated or manual one-line summary"
                  maxLength={200}
                />
              </div>
              <div className="flex gap-2">
                <Button type="submit" disabled={videoSubmitting}>
                  {videoSubmitting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Saving...
                    </>
                  ) : editingVideoId ? (
                    'Update Video'
                  ) : (
                    <>
                      <Plus className="mr-2 h-4 w-4" />
                      Add Video
                    </>
                  )}
                </Button>
                {editingVideoId && (
                  <Button type="button" variant="outline" onClick={resetVideoForm}>
                    Cancel
                  </Button>
                )}
              </div>
            </form>
          </CardContent>
        </Card>

        <Card className="flex flex-col h-full border-border/60 shadow-lg shadow-black/5 dark:shadow-black/20 bg-card/95">
          <CardHeader className="flex-shrink-0">
            <CardTitle className="text-xl">All Videos ({videos.length})</CardTitle>
            <CardDescription>Manage videos shown on /videos</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col flex-1 min-h-0 p-6">
            {videosLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : videos.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">
                No videos yet. Add one via the form.
              </p>
            ) : (
              <>
                <div className="mb-4 flex-shrink-0">
                  <Input
                    placeholder="Search videos..."
                    value={videoSearchQuery}
                    onChange={(e) => setVideoSearchQuery(e.target.value)}
                    className="w-full"
                  />
                </div>
                <div className="flex-1 overflow-y-auto pr-2 space-y-2" style={{ maxHeight: 'calc(9 * (80px + 8px))' }}>
                  {videos
                    .filter((v) => {
                      if (!videoSearchQuery.trim()) return true
                      const q = videoSearchQuery.toLowerCase()
                      return (
                        v.title.toLowerCase().includes(q) ||
                        (v.description && v.description.toLowerCase().includes(q)) ||
                        (v.youtuberName && v.youtuberName.toLowerCase().includes(q)) ||
                        v.url.toLowerCase().includes(q)
                      )
                    })
                    .map((video) => (
                      <div
                        key={video.id}
                        className="flex items-start justify-between rounded-xl border border-border/60 p-4 hover:bg-muted/40 hover:border-violet-200 dark:hover:border-violet-800/50 transition-all min-h-[80px]"
                      >
                        <div className="flex-1 min-w-0 pr-4">
                          <h3 className="font-semibold truncate">{video.title}</h3>
                          <p className="text-sm text-muted-foreground line-clamp-2 mt-1">
                            {video.description || video.url}
                          </p>
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <span className="text-xs text-muted-foreground">{video.category}</span>
                            <span className="text-xs text-muted-foreground capitalize">
                              {(video as { source?: string }).source === 'tiktok' ? 'TikTok' : 'YouTube'}
                            </span>
                            {video.youtuberName && (
                              <span className="text-xs text-muted-foreground">{video.youtuberName}</span>
                            )}
                          </div>
                        </div>
                        <div className="flex gap-2 flex-shrink-0">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleEditVideo(video)}
                            title="Edit video"
                          >
                            <Edit2 className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDeleteVideo(video.id)}
                            title="Delete video"
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </div>
                    ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
      )}
      </div>
    </div>
  )
}

