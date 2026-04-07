import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { GraphNode, Project, TriggerType } from '@/types/graph'

type Theme = 'light' | 'dark' | 'system'

// All trigger types for filtering
export const ALL_TRIGGER_TYPES: TriggerType[] = [
  'foundation',
  'surprise',
  'tension',
  'consequence',
  'repetition',
  'question',
  'serendipity',
  'decision',
  'experiment',
  'analysis',
  'reference',
  'library',
  'randomness',
  'thinking',
  'prediction',
  'evaluation',
  'hypothesis',
  'model',
]

interface AppState {
  // Theme
  theme: Theme
  setTheme: (theme: Theme) => void

  // Project state
  currentProject: Project | null
  setCurrentProject: (project: Project | null) => void

  // Graph filters
  nodeLimit: number | null // null = show all, number = show newest N nodes
  setNodeLimit: (limit: number | null) => void

  // Timeline slider (bottom bar with configurable span)
  timelineExpanded: boolean // whether the bottom timeline bar is expanded
  timelineRange: [number, number] | null // [startIndex, endIndex] or null = show all
  timelineSpan: number // width of the viewing window (number of nodes)
  setTimelineExpanded: (expanded: boolean) => void
  setTimelineRange: (range: [number, number] | null) => void
  setTimelineSpan: (span: number) => void
  hiddenTriggerTypes: Set<TriggerType> // empty = show all, Set = hide these types
  showDocuments: boolean // whether to show document nodes
  showSuperseded: boolean // whether to show superseded (old version) nodes
  toggleTriggerType: (type: TriggerType) => void
  setShowDocuments: (show: boolean) => void
  setShowSuperseded: (show: boolean) => void
  resetFilters: () => void

  // Selection state
  selectedNodeId: string | null
  selectedEdgeId: string | null
  pendingFlyToNodeId: string | null // Set when we want graph to fly to a node
  pendingDocumentViewId: string | null // Set when we want to open document modal
  closeDocumentModalSignal: number // Increments to signal modal should close
  triggerCloseDocumentModal: () => void
  selectNode: (id: string | null) => void
  selectEdge: (id: string | null) => void
  selectAndFlyToNode: (id: string) => void // Select + trigger camera fly
  openDocumentView: (id: string) => void // Select + fly + open document modal
  flyToNode: (id: string) => void // Just fly to node without changing selection
  clearPendingFly: () => void
  clearPendingDocumentView: () => void
  clearSelection: () => void

  // Hovered state (for tooltips)
  hoveredNode: GraphNode | null
  setHoveredNode: (node: GraphNode | null) => void

  // Highlighted state (for commit hover)
  highlightedNodeIds: Set<string>
  highlightedEdgeIds: Set<string>
  setHighlightedIds: (nodeIds: string[], edgeIds: string[]) => void
  clearHighlightedIds: () => void

  // UI state
  leftSidebarOpen: boolean
  rightSidebarOpen: boolean
  toggleLeftSidebar: () => void
  toggleRightSidebar: () => void

  // Active tab in right panel
  activeTab: 'chat' | 'node' | 'db' | 'files'
  setActiveTab: (tab: 'chat' | 'node' | 'db' | 'files') => void

  // Thinking mode (Graph Mode vs Fluid Mode)
  thinkingMode: 'graph' | 'fluid'
  setThinkingMode: (mode: 'graph' | 'fluid') => void
}

// Apply theme to document
function applyTheme(theme: Theme) {
  const root = document.documentElement
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  const isDark = theme === 'dark' || (theme === 'system' && systemDark)

  if (isDark) {
    root.classList.add('dark')
  } else {
    root.classList.remove('dark')
  }
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      // Theme - default to dark
      theme: 'dark',
      setTheme: (theme) => {
        applyTheme(theme)
        set({ theme })
      },

      // Project
      currentProject: null,
      setCurrentProject: (project) =>
        set({
          currentProject: project,
          // Clear selection when switching projects - nodes from old project won't exist
          selectedNodeId: null,
          selectedEdgeId: null,
          pendingFlyToNodeId: null,
        }),

      // Graph filters
      nodeLimit: null,
      setNodeLimit: (limit) => set({ nodeLimit: limit }),

      // Timeline slider (bottom bar)
      timelineExpanded: false,
      timelineRange: null, // null = show all
      timelineSpan: 50, // default window size
      setTimelineExpanded: (expanded) => set({ timelineExpanded: expanded }),
      setTimelineRange: (range) => set({ timelineRange: range }),
      setTimelineSpan: (span) => set({ timelineSpan: span }),
      hiddenTriggerTypes: new Set<TriggerType>(),
      showDocuments: true,
      showSuperseded: false,
      toggleTriggerType: (type) =>
        set((s) => {
          const next = new Set(s.hiddenTriggerTypes)
          if (next.has(type)) {
            next.delete(type)
          } else {
            next.add(type)
          }
          return { hiddenTriggerTypes: next }
        }),
      setShowDocuments: (show) => set({ showDocuments: show }),
      setShowSuperseded: (show) => set({ showSuperseded: show }),
      resetFilters: () =>
        set({
          nodeLimit: null,
          hiddenTriggerTypes: new Set<TriggerType>(),
          showDocuments: true,
          showSuperseded: false,
        }),

      // Selection
      selectedNodeId: null,
      selectedEdgeId: null,
      pendingFlyToNodeId: null,
      pendingDocumentViewId: null,
      closeDocumentModalSignal: 0,
      triggerCloseDocumentModal: () =>
        set((s) => ({
          closeDocumentModalSignal: s.closeDocumentModalSignal + 1,
        })),
      selectNode: (id) =>
        set({ selectedNodeId: id, selectedEdgeId: null, activeTab: 'node' }),
      selectEdge: (id) =>
        set({ selectedEdgeId: id, selectedNodeId: null, activeTab: 'node' }),
      selectAndFlyToNode: (id) =>
        set((s) => ({
          selectedNodeId: id,
          selectedEdgeId: null,
          activeTab: 'node',
          pendingFlyToNodeId: id,
          closeDocumentModalSignal: s.closeDocumentModalSignal + 1, // Signal modal to close
        })),
      openDocumentView: (id) =>
        set({
          selectedNodeId: id,
          selectedEdgeId: null,
          activeTab: 'node',
          pendingFlyToNodeId: id,
          pendingDocumentViewId: id,
        }),
      flyToNode: (id) =>
        set((s) => ({
          pendingFlyToNodeId: id,
          closeDocumentModalSignal: s.closeDocumentModalSignal + 1, // Signal modal to close
        })),
      clearPendingFly: () => set({ pendingFlyToNodeId: null }),
      clearPendingDocumentView: () => set({ pendingDocumentViewId: null }),
      clearSelection: () => set({ selectedNodeId: null, selectedEdgeId: null }),

      // Hover
      hoveredNode: null,
      setHoveredNode: (node) => set({ hoveredNode: node }),

      // Highlighted (for commit hover)
      highlightedNodeIds: new Set(),
      highlightedEdgeIds: new Set(),
      setHighlightedIds: (nodeIds, edgeIds) =>
        set({
          highlightedNodeIds: new Set(nodeIds),
          highlightedEdgeIds: new Set(edgeIds),
        }),
      clearHighlightedIds: () =>
        set({
          highlightedNodeIds: new Set(),
          highlightedEdgeIds: new Set(),
        }),

      // Sidebars
      leftSidebarOpen: true,
      rightSidebarOpen: true,
      toggleLeftSidebar: () =>
        set((s) => ({ leftSidebarOpen: !s.leftSidebarOpen })),
      toggleRightSidebar: () =>
        set((s) => ({ rightSidebarOpen: !s.rightSidebarOpen })),

      // Tabs
      activeTab: 'chat',
      setActiveTab: (tab) => set({ activeTab: tab }),

      // Thinking mode
      thinkingMode: 'graph',
      setThinkingMode: (mode) => set({ thinkingMode: mode }),
    }),
    {
      name: 'app-settings',
      partialize: (state) => ({
        theme: state.theme,
        currentProject: state.currentProject,
        thinkingMode: state.thinkingMode,
      }),
      onRehydrateStorage: () => (state) => {
        if (state?.theme) {
          applyTheme(state.theme)
        }
        // Reload project on backend when restoring from localStorage
        if (state?.currentProject?.id) {
          fetch(`/api/projects/${state.currentProject.id}/load`, {
            method: 'POST',
          }).catch(console.error)
        }
      },
    },
  ),
)
