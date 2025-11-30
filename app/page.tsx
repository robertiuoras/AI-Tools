'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Hero } from '@/components/Hero'
import { ToolCard } from '@/components/ToolCard'
import { SearchBar } from '@/components/SearchBar'
import { FilterSidebar } from '@/components/FilterSidebar'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { supabase } from '@/lib/supabase'
import type { Tool } from '@/lib/supabase'

type SortOption = 'alphabetical' | 'newest' | 'popular' | 'traffic' | 'upvotes'
type SortOrder = 'asc' | 'desc'

export default function HomePage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [tools, setTools] = useState<Tool[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [selectedTraffic, setSelectedTraffic] = useState<string[]>([])
  const [selectedRevenue, setSelectedRevenue] = useState<string[]>([])
  const [sort, setSort] = useState<SortOption>('alphabetical')
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc')

  // Handle OAuth callback if tokens are in the hash
  useEffect(() => {
    const handleAuthCallback = async () => {
      // Check if we have tokens in the hash
      if (typeof window !== 'undefined' && window.location.hash) {
        const hashParams = new URLSearchParams(window.location.hash.substring(1))
        const accessToken = hashParams.get('access_token')
        const refreshToken = hashParams.get('refresh_token')

        if (accessToken && refreshToken) {
          try {
            // Set the session
            const { data, error } = await supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken,
            })

            if (error) {
              console.error('Error setting session:', error)
              return
            }

            if (data.user) {
              // Create user record if it doesn't exist
              const { data: existingUser } = await supabase
                .from('user')
                .select('id')
                .eq('id', data.user.id)
                .single()

              if (!existingUser) {
                await supabase.from('user').insert([
                  {
                    id: data.user.id,
                    email: data.user.email!,
                    name: data.user.user_metadata?.name || 
                          data.user.user_metadata?.full_name || 
                          data.user.user_metadata?.display_name ||
                          data.user.email?.split('@')[0] || 
                          'User',
                    role: 'user',
                  },
                ])
              }
            }

            // Clear the hash and reload to show logged in state
            window.history.replaceState({}, '', '/')
            window.location.reload()
          } catch (error: any) {
            console.error('Error in auth callback:', error)
          }
        }
      }
    }

    handleAuthCallback()
  }, [])

  const fetchTools = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (selectedCategory) params.append('category', selectedCategory)
      selectedTraffic.forEach((t) => params.append('traffic', t))
      selectedRevenue.forEach((r) => params.append('revenue', r))
      if (search) params.append('search', search)
      params.append('sort', sort)
      params.append('order', sortOrder)

      const response = await fetch(`/api/tools?${params.toString()}`)
      
      if (!response.ok) {
        console.error('Failed to fetch tools:', response.statusText)
        setTools([])
        return
      }

      const data = await response.json()
      
      // Ensure data is an array
      if (Array.isArray(data)) {
        setTools(data)
      } else {
        console.error('Invalid response format:', data)
        setTools([])
      }
    } catch (error) {
      console.error('Error fetching tools:', error)
      setTools([])
    } finally {
      setLoading(false)
    }
  }, [selectedCategory, selectedTraffic, selectedRevenue, search, sort, sortOrder])

  useEffect(() => {
    fetchTools()
  }, [fetchTools])

  return (
    <div className="flex min-h-screen flex-col">
      <Hero />
      <div className="container mx-auto px-4 py-8">
        <div className="flex flex-col gap-6 lg:flex-row">
          <div className="lg:w-80">
            <FilterSidebar
              selectedCategory={selectedCategory}
              onCategoryChange={setSelectedCategory}
              selectedTraffic={selectedTraffic}
              onTrafficChange={setSelectedTraffic}
              selectedRevenue={selectedRevenue}
              onRevenueChange={setSelectedRevenue}
            />
          </div>

          <div className="flex-1 space-y-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <SearchBar value={search} onChange={setSearch} />
              <div className="flex items-center gap-2">
                <Select value={sort} onValueChange={(v) => setSort(v as SortOption)}>
                  <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder="Sort by" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="alphabetical">Alphabetical</SelectItem>
                    <SelectItem value="newest">Newest</SelectItem>
                    <SelectItem value="popular">Most Popular</SelectItem>
                    <SelectItem value="traffic">Highest Traffic</SelectItem>
                    <SelectItem value="upvotes">Most Upvoted</SelectItem>
                  </SelectContent>
                </Select>
                <Select
                  value={sortOrder}
                  onValueChange={(v) => setSortOrder(v as SortOrder)}
                >
                  <SelectTrigger className="w-[100px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="asc">A-Z</SelectItem>
                    <SelectItem value="desc">Z-A</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {loading ? (
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {[...Array(8)].map((_, i) => (
                  <div
                    key={i}
                    className="h-64 animate-pulse rounded-lg border bg-muted"
                  />
                ))}
              </div>
            ) : tools.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <p className="text-lg text-muted-foreground">
                  No tools found. Try adjusting your filters or search.
                </p>
              </div>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  Showing {tools.length} tool{tools.length !== 1 ? 's' : ''}
                </p>
                <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {tools.map((tool, index) => (
                    <ToolCard key={tool.id} tool={tool} index={index} />
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

