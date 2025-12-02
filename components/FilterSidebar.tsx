'use client'

import { useState } from 'react'
import { X, Heart } from 'lucide-react'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { categories } from '@/lib/schemas'
import { cn } from '@/lib/utils'

interface FilterSidebarProps {
  selectedCategory: string | null
  onCategoryChange: (category: string | null) => void
  selectedTraffic: string[]
  onTrafficChange: (traffic: string[]) => void
  selectedRevenue: string[]
  onRevenueChange: (revenue: string[]) => void
  favoritesOnly: boolean
  onFavoritesToggle: () => void
  user: any
  className?: string
}

const trafficOptions = ['low', 'medium', 'high', 'unknown'] as const
const revenueOptions = ['free', 'freemium', 'paid', 'enterprise'] as const

export function FilterSidebar({
  selectedCategory,
  onCategoryChange,
  selectedTraffic,
  onTrafficChange,
  selectedRevenue,
  onRevenueChange,
  favoritesOnly,
  onFavoritesToggle,
  user,
  className,
}: FilterSidebarProps) {
  const [isOpen, setIsOpen] = useState(false)

  const handleTrafficToggle = (value: string) => {
    if (selectedTraffic.includes(value)) {
      onTrafficChange(selectedTraffic.filter((t) => t !== value))
    } else {
      onTrafficChange([...selectedTraffic, value])
    }
  }

  const handleRevenueToggle = (value: string) => {
    if (selectedRevenue.includes(value)) {
      onRevenueChange(selectedRevenue.filter((r) => r !== value))
    } else {
      onRevenueChange([...selectedRevenue, value])
    }
  }

  const clearAll = () => {
    onCategoryChange(null)
    onTrafficChange([])
    onRevenueChange([])
  }

  const hasActiveFilters =
    selectedCategory || selectedTraffic.length > 0 || selectedRevenue.length > 0

  return (
    <>
      {/* Mobile filter button */}
      <Button
        variant="outline"
        onClick={() => setIsOpen(true)}
        className="lg:hidden mb-4"
      >
        Filters
        {hasActiveFilters && (
          <Badge variant="secondary" className="ml-2">
            {[selectedCategory, ...selectedTraffic, ...selectedRevenue].filter(Boolean).length}
          </Badge>
        )}
      </Button>

      {/* Mobile overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/50 lg:hidden"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed left-0 top-0 z-50 h-full w-80 transform border-r border-border bg-background/95 backdrop-blur-sm transition-transform duration-300 lg:relative lg:z-auto lg:translate-x-0',
          isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
          className
        )}
      >
        <div className="sticky top-0 h-screen overflow-y-auto p-6">
          <div className="mb-6 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Filters</h2>
            <div className="flex items-center gap-2">
              {hasActiveFilters && (
                <Button variant="ghost" size="sm" onClick={clearAll}>
                  Clear all
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsOpen(false)}
                className="lg:hidden"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {user && (
            <div className="mb-6">
              <Button
                variant={favoritesOnly ? "default" : "outline"}
                size="sm"
                onClick={onFavoritesToggle}
                className="w-full gap-2"
              >
                <Heart className={`h-4 w-4 ${favoritesOnly ? "fill-current" : ""}`} />
                {favoritesOnly ? "Showing Favorites" : "Show Favorites"}
              </Button>
            </div>
          )}

          <Accordion type="multiple" defaultValue={['category', 'revenue', 'traffic']}>
            <AccordionItem value="category">
              <AccordionTrigger>Category</AccordionTrigger>
              <AccordionContent>
                <div className="space-y-3">
                  <Label
                    className={cn(
                      'flex items-center space-x-2 cursor-pointer rounded-md p-2 hover:bg-accent',
                      !selectedCategory && 'bg-accent'
                    )}
                  >
                    <Checkbox
                      checked={!selectedCategory}
                      onCheckedChange={() => onCategoryChange(null)}
                    />
                    <span>All Categories</span>
                  </Label>
                  {categories.map((category) => (
                    <Label
                      key={category}
                      className={cn(
                        'flex items-center space-x-2 cursor-pointer rounded-md p-2 hover:bg-accent',
                        selectedCategory === category && 'bg-accent'
                      )}
                    >
                      <Checkbox
                        checked={selectedCategory === category}
                        onCheckedChange={() =>
                          onCategoryChange(selectedCategory === category ? null : category)
                        }
                      />
                      <span>{category}</span>
                    </Label>
                  ))}
                </div>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="revenue">
              <AccordionTrigger>Revenue Model</AccordionTrigger>
              <AccordionContent>
                <div className="space-y-3">
                  {revenueOptions.map((revenue) => (
                    <Label
                      key={revenue}
                      className="flex items-center space-x-2 cursor-pointer rounded-md p-2 hover:bg-accent"
                    >
                      <Checkbox
                        checked={selectedRevenue.includes(revenue)}
                        onCheckedChange={() => handleRevenueToggle(revenue)}
                      />
                      <span className="capitalize">{revenue}</span>
                    </Label>
                  ))}
                </div>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="traffic">
              <AccordionTrigger>Traffic</AccordionTrigger>
              <AccordionContent>
                <div className="space-y-3">
                  {trafficOptions.map((traffic) => (
                    <Label
                      key={traffic}
                      className="flex items-center space-x-2 cursor-pointer rounded-md p-2 hover:bg-accent"
                    >
                      <Checkbox
                        checked={selectedTraffic.includes(traffic)}
                        onCheckedChange={() => handleTrafficToggle(traffic)}
                      />
                      <span className="capitalize">{traffic}</span>
                    </Label>
                  ))}
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>

          {/* Active filters display */}
          {hasActiveFilters && (
            <div className="mt-6 space-y-2">
              <h3 className="text-sm font-medium">Active Filters</h3>
              <div className="flex flex-wrap gap-2">
                {selectedCategory && (
                  <Badge variant="secondary" className="gap-1">
                    {selectedCategory}
                    <button
                      onClick={() => onCategoryChange(null)}
                      className="ml-1 rounded-full hover:bg-background"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                )}
                {selectedTraffic.map((traffic) => (
                  <Badge key={traffic} variant="secondary" className="gap-1 capitalize">
                    {traffic}
                    <button
                      onClick={() => handleTrafficToggle(traffic)}
                      className="ml-1 rounded-full hover:bg-background"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
                {selectedRevenue.map((revenue) => (
                  <Badge key={revenue} variant="secondary" className="gap-1 capitalize">
                    {revenue}
                    <button
                      onClick={() => handleRevenueToggle(revenue)}
                      className="ml-1 rounded-full hover:bg-background"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>
      </aside>
    </>
  )
}

