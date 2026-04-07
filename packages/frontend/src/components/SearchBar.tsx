import { useCallback, useEffect, useRef, useState } from 'react'
import { type SearchResult, useSemanticSearch } from '@/hooks/useApi'
import { useAppStore } from '@/stores/appStore'

export function SearchBar() {
  const [query, setQuery] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const { selectAndFlyToNode } = useAppStore()

  // Debounce the search query
  const [debouncedQuery, setDebouncedQuery] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 200)
    return () => clearTimeout(timer)
  }, [query])

  const { data: results, isLoading } = useSemanticSearch(debouncedQuery, 8)

  const handleSelect = useCallback(
    (result: SearchResult) => {
      selectAndFlyToNode(result.id)
      setIsOpen(false)
      setQuery('')
      inputRef.current?.blur()
    },
    [selectAndFlyToNode],
  )

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!results?.length) return

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setSelectedIndex((i) => Math.min(i + 1, results.length - 1))
          break
        case 'ArrowUp':
          e.preventDefault()
          setSelectedIndex((i) => Math.max(i - 1, 0))
          break
        case 'Enter':
          e.preventDefault()
          if (results[selectedIndex]) {
            handleSelect(results[selectedIndex])
          }
          break
        case 'Escape':
          e.preventDefault()
          setIsOpen(false)
          setQuery('')
          inputRef.current?.blur()
          break
      }
    },
    [results, selectedIndex, handleSelect],
  )

  // Global keyboard shortcut: Cmd/Ctrl + K to focus search
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
        setIsOpen(true)
      }
    }
    window.addEventListener('keydown', handleGlobalKeyDown)
    return () => window.removeEventListener('keydown', handleGlobalKeyDown)
  }, [])

  // Reset selection when results change
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional - reset on results change
  useEffect(() => {
    setSelectedIndex(0)
  }, [results])

  const showDropdown = isOpen && query.length >= 2

  return (
    <div className="relative">
      <div className="flex items-center gap-2">
        <div className="relative">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setIsOpen(true)
            }}
            onFocus={() => setIsOpen(true)}
            onBlur={() => {
              // Delay to allow click on results
              setTimeout(() => setIsOpen(false), 150)
            }}
            onKeyDown={handleKeyDown}
            placeholder="Search nodes... (⌘K)"
            className="w-56 px-3 py-1.5 text-xs bg-bg-muted border border-border-subtle rounded-md
                       text-text-primary placeholder:text-text-muted
                       focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30
                       focus:w-72 transition-all"
          />
          {isLoading && (
            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-accent pointer-events-none">
              ...
            </span>
          )}
        </div>
      </div>

      {/* Dropdown results */}
      {showDropdown && (
        <div className="absolute top-full left-0 mt-1 w-72 bg-bg-surface border border-border-default rounded-lg shadow-lg overflow-hidden z-[200]">
          {isLoading ? (
            <div className="px-3 py-2 text-xs text-text-muted">
              Searching...
            </div>
          ) : results?.length ? (
            <ul className="max-h-64 overflow-y-auto">
              {results.map((result, index) => (
                <li key={result.id}>
                  <button
                    type="button"
                    onMouseDown={() => handleSelect(result)}
                    onMouseEnter={() => setSelectedIndex(index)}
                    className={`w-full px-3 py-2 text-left transition-colors ${
                      index === selectedIndex
                        ? 'bg-accent-muted'
                        : 'hover:bg-bg-muted'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-text-primary truncate">
                        {result.name}
                      </span>
                      <span className="text-[10px] text-text-muted shrink-0">
                        {Math.round(result.similarity * 100)}%
                      </span>
                    </div>
                    {(result.preview || result.understanding) && (
                      <p className="text-[11px] text-text-muted mt-0.5 line-clamp-1">
                        {result.preview || result.understanding}
                      </p>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          ) : debouncedQuery.length >= 2 ? (
            <div className="px-3 py-2 text-xs text-text-muted">
              No results for "{debouncedQuery}"
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}
