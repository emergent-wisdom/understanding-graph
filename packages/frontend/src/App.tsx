import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PanelLeft, PanelRight, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { DetailsPanel } from '@/components/DetailsPanel'
import { GraphCanvas } from '@/components/GraphCanvas'
import { SearchBar } from '@/components/SearchBar'
import { Sidebar } from '@/components/Sidebar'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/stores/appStore'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: true,
    },
  },
})

type MobilePanel = 'projects' | 'details' | null

function AppLayout() {
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>(null)
  const {
    leftSidebarOpen,
    rightSidebarOpen,
    toggleLeftSidebar,
    toggleRightSidebar,
    selectAndFlyToNode,
    selectEdge,
    selectedNodeId,
    selectedEdgeId,
    currentProject,
    setCurrentProject,
  } = useAppStore()

  // Track if we've processed initial URL params
  const initialUrlProcessed = useRef(false)

  // Handle URL parameters for deep linking to projects/nodes/edges (only on initial load)
  // Usage: http://localhost:5173/?project=myproject&node=n_abc123
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally only run on mount
  useEffect(() => {
    if (initialUrlProcessed.current) return
    initialUrlProcessed.current = true

    const params = new URLSearchParams(window.location.search)
    const projectId = params.get('project')
    const nodeId = params.get('node')
    const edgeId = params.get('edge')

    // Load project from URL if specified and different from current
    if (projectId && projectId !== currentProject?.id) {
      // Load the project via API
      fetch(`/api/projects/${projectId}/load`, { method: 'POST' })
        .then((res) => {
          if (res.ok) {
            setCurrentProject({ id: projectId, name: projectId })
            // After project loads, select node/edge
            if (nodeId) {
              setTimeout(() => selectAndFlyToNode(nodeId), 800)
            } else if (edgeId) {
              setTimeout(() => selectEdge(edgeId), 800)
            }
          }
        })
        .catch(console.error)
      return
    }

    // If no project change needed, just select node/edge
    if (nodeId) {
      setTimeout(() => selectAndFlyToNode(nodeId), 500)
    } else if (edgeId) {
      setTimeout(() => selectEdge(edgeId), 500)
    }
  }, [])

  // Update URL when project or selection changes (for shareable links)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    // Clear all first
    params.delete('project')
    params.delete('node')
    params.delete('edge')
    // Set project
    if (currentProject?.id) {
      params.set('project', currentProject.id)
    }
    // Set the active selection
    if (selectedNodeId) {
      params.set('node', selectedNodeId)
    } else if (selectedEdgeId) {
      params.set('edge', selectedEdgeId)
    }
    const newUrl = params.toString()
      ? `${window.location.pathname}?${params.toString()}`
      : window.location.pathname
    window.history.replaceState({}, '', newUrl)
  }, [selectedNodeId, selectedEdgeId, currentProject?.id])

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-bg-base">
      {/* Graph Canvas - Full screen background */}
      <GraphCanvas />

      {/* Small-screen navigation remains useful without crowding the graph. */}
      <div className="xl:hidden absolute top-2 left-2 right-2 z-[160] flex items-center gap-2">
        <button
          type="button"
          onClick={() => setMobilePanel('projects')}
          className="shrink-0 w-10 h-10 rounded-lg shadow-md flex items-center justify-center bg-bg-surface/90 backdrop-blur-md text-text-secondary border border-border-default"
          aria-label="Open projects"
          title="Projects"
        >
          <PanelLeft size={18} />
        </button>
        <div className="min-w-0 flex-1 rounded-lg shadow-md bg-bg-surface/90 backdrop-blur-md">
          <SearchBar compact enableShortcut={false} />
        </div>
        <button
          type="button"
          onClick={() => setMobilePanel('details')}
          className={cn(
            'shrink-0 w-10 h-10 rounded-lg shadow-md flex items-center justify-center',
            'bg-bg-surface/90 backdrop-blur-md border border-border-default',
            selectedNodeId || selectedEdgeId
              ? 'text-accent border-accent'
              : 'text-text-secondary',
          )}
          aria-label="Open graph details"
          title="Graph details"
        >
          <PanelRight size={18} />
        </button>
      </div>

      {mobilePanel && (
        <button
          type="button"
          onClick={() => setMobilePanel(null)}
          className="xl:hidden fixed inset-0 z-[180] bg-black/50"
          aria-label="Close mobile panel"
        />
      )}

      {/* Projects: fixed desktop sidebar, mobile drawer. */}
      <aside
        className={cn(
          'absolute top-0 left-0 h-full w-[min(92vw,360px)] xl:w-[280px] panel border-r',
          'transition-transform duration-300 ease-out z-[200] xl:z-50',
          mobilePanel === 'projects'
            ? 'visible translate-x-0'
            : 'invisible -translate-x-full',
          leftSidebarOpen
            ? 'xl:visible xl:translate-x-0'
            : 'xl:invisible xl:-translate-x-full',
        )}
      >
        <div className="xl:hidden h-12 px-4 flex items-center justify-between border-b border-border-subtle">
          <span className="text-sm font-semibold text-text-primary">
            Projects
          </span>
          <button
            type="button"
            onClick={() => setMobilePanel(null)}
            className="p-2 -mr-2 rounded-md text-text-muted hover:text-text-primary hover:bg-bg-muted"
            aria-label="Close projects"
          >
            <X size={18} />
          </button>
        </div>
        <div className="h-[calc(100%-3rem)] xl:h-full">
          <Sidebar onNavigate={() => setMobilePanel(null)} />
        </div>
      </aside>

      {/* Left Toggle Button — hidden on mobile */}
      <button
        type="button"
        onClick={toggleLeftSidebar}
        className={cn(
          'hidden xl:flex absolute top-4 z-[100]',
          'w-9 h-9 rounded-lg shadow-sm',
          'items-center justify-center',
          'bg-bg-surface/60 text-text-muted border border-border-subtle',
          'hover:bg-bg-surface hover:text-text-primary hover:shadow-md hover:border-border-default',
          'opacity-50 hover:opacity-100',
          'transition-all duration-200 ease-out',
          leftSidebarOpen ? 'left-[292px]' : 'left-4',
        )}
        title={leftSidebarOpen ? 'Close sidebar' : 'Open sidebar'}
      >
        <PanelLeft
          size={16}
          className={cn(
            'transition-transform duration-200',
            !leftSidebarOpen && 'rotate-180',
          )}
        />
      </button>

      {/* Details: fixed desktop panel, mobile drawer. */}
      <aside
        className={cn(
          'absolute top-0 right-0 h-full w-[min(92vw,360px)] xl:w-[360px] panel border-l',
          'transition-transform duration-300 ease-out z-[200] xl:z-50',
          mobilePanel === 'details'
            ? 'visible translate-x-0'
            : 'invisible translate-x-full',
          rightSidebarOpen
            ? 'xl:visible xl:translate-x-0'
            : 'xl:invisible xl:translate-x-full',
        )}
      >
        <div className="xl:hidden h-12 px-4 flex items-center justify-between border-b border-border-subtle">
          <span className="text-sm font-semibold text-text-primary">
            Graph details
          </span>
          <button
            type="button"
            onClick={() => setMobilePanel(null)}
            className="p-2 -mr-2 rounded-md text-text-muted hover:text-text-primary hover:bg-bg-muted"
            aria-label="Close graph details"
          >
            <X size={18} />
          </button>
        </div>
        <div className="h-[calc(100%-3rem)] xl:h-full">
          <DetailsPanel />
        </div>
      </aside>

      {/* Right Toggle Button — hidden on mobile */}
      <button
        type="button"
        onClick={toggleRightSidebar}
        className={cn(
          'hidden xl:flex absolute top-4 z-[100]',
          'w-9 h-9 rounded-lg shadow-sm',
          'items-center justify-center',
          'bg-bg-surface/60 text-text-muted border border-border-subtle',
          'hover:bg-bg-surface hover:text-text-primary hover:shadow-md hover:border-border-default',
          'opacity-50 hover:opacity-100',
          'transition-all duration-200 ease-out',
          rightSidebarOpen ? 'right-[372px]' : 'right-4',
        )}
        title={rightSidebarOpen ? 'Close panel' : 'Open panel'}
      >
        <PanelRight
          size={16}
          className={cn(
            'transition-transform duration-200',
            !rightSidebarOpen && 'rotate-180',
          )}
        />
      </button>
    </div>
  )
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppLayout />
    </QueryClientProvider>
  )
}

export default App
