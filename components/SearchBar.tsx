'use client'

import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

interface SearchBarProps {
  value: string
  onChange: (value: string) => void
  className?: string
  placeholder?: string
  suggestions?: string[]
  onSelectSuggestion?: (value: string) => void
  onSubmit?: (value: string) => void
}

export function SearchBar({
  value,
  onChange,
  className,
  placeholder = 'Search tools by name, description, or tags...',
  suggestions,
  onSelectSuggestion,
  onSubmit,
}: SearchBarProps) {
  const [open, setOpen] = useState(false)

  const filteredSuggestions = useMemo(() => {
    if (!suggestions || !value.trim()) return []
    const lower = value.toLowerCase()
    const unique = Array.from(new Set(suggestions))
    return unique.filter((s) => s.toLowerCase().includes(lower)).slice(0, 8)
  }, [suggestions, value])

  const handleSelect = (text: string) => {
    onChange(text)
    onSelectSuggestion?.(text)
    setOpen(false)
  }

  return (
    <div className={cn('relative', className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            const trimmed = value.trim()
            if (trimmed && onSubmit) {
              e.preventDefault()
              onSubmit(trimmed)
            }
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            const trimmed = value.trim()
            if (trimmed) {
              e.preventDefault()
              // Delegate to parent for handling chips / filters
              ;(typeof (onSelectSuggestion) === 'function' ? null : null)
            }
          }
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 100)}
        className="w-full rounded-full border border-border/70 bg-background/80 pl-10 pr-9 text-sm shadow-sm transition-all focus:border-rose-400 focus:ring-2 focus:ring-rose-200 dark:focus:ring-rose-900/60"
      />
      {value && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => {
            onChange('')
            onSelectSuggestion?.('')
          }}
          className="absolute right-2.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full bg-muted text-[11px] text-muted-foreground shadow-sm transition-colors hover:bg-foreground hover:text-background cursor-pointer"
        >
          ×
        </button>
      )}
      {open && filteredSuggestions.length > 0 && (
        <div className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border bg-popover text-sm shadow-md">
          {filteredSuggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => handleSelect(s)}
              className="flex w-full items-center justify-between px-3 py-1.5 text-left hover:bg-accent"
            >
              <span className="truncate">{s}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

