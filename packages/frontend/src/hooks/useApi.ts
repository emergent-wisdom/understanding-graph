import {
  keepPreviousData,
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { useAppStore } from '@/stores/appStore'
import type { Conversation, Document, GraphData, Project } from '@/types/graph'

const API_BASE = '/api'

type LoadedProject = Project & {
  loaded?: boolean
  meta?: { name?: string; goal?: string }
}

// Polling intervals for the "live dev tool" use-case. When the frontend is
// deployed as a read-only snapshot (e.g. the public emergentwisdom.org
// site, where the backend is replaced by prebaked static JSON), polling is
// worse than useless: every refetch returns identical data but creates new
// object references, which rebuilds the 3D node meshes and re-renders the
// DetailsPanel. That re-render unmounts and recreates the <NodeLink> spans
// that the user is currently hovering or clicking, producing a very
// visible hover/click "flicker" on every interval tick. Setting
// VITE_DISPLAY_ONLY=true at build time disables all polling so the static
// site renders once and stays put.
const DISPLAY_ONLY =
  // biome-ignore lint/suspicious/noExplicitAny: import.meta.env is Vite-injected
  (import.meta as any).env?.VITE_DISPLAY_ONLY === 'true' ||
  // biome-ignore lint/suspicious/noExplicitAny: Vite replaces this at build time
  (import.meta as any).env?.VITE_DISPLAY_ONLY === true
const pollInterval = (ms: number): number | false => (DISPLAY_ONLY ? false : ms)

// Transform snake_case API response to camelCase
// biome-ignore lint/suspicious/noExplicitAny: Generic transformation
function snakeToCamel(obj: any): any {
  if (obj === null || obj === undefined) return obj
  if (Array.isArray(obj)) return obj.map(snakeToCamel)
  if (typeof obj !== 'object') return obj

  const result: Record<string, unknown> = {}
  for (const key in obj) {
    const camelKey = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
    result[camelKey] = snakeToCamel(obj[key])
  }
  return result
}

// Fetch helpers
export function projectRequestHeaders(
  projectId: string | null | undefined,
): Record<string, string> {
  return projectId ? { 'X-Project-Id': projectId } : {}
}

export function scopedQueryKey(
  base: readonly unknown[],
  projectId: string | null | undefined,
  ...parts: readonly unknown[]
): readonly unknown[] {
  return [...base, projectId || null, ...parts]
}

function activeProjectHeaders(): Record<string, string> {
  return projectRequestHeaders(useAppStore.getState().currentProject?.id)
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(`${API_BASE}${url}`, {
    headers: activeProjectHeaders(),
  })
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
}

async function fetchJsonCamel<T>(url: string): Promise<T> {
  const res = await fetch(`${API_BASE}${url}`, {
    headers: activeProjectHeaders(),
  })
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  const data = await res.json()
  return snakeToCamel(data) as T
}

async function postJson<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${url}`, {
    method: 'POST',
    headers: {
      ...activeProjectHeaders(),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
}

// Query keys
export const queryKeys = {
  projects: ['projects'] as const,
  graph: ['graph'] as const,
  conversations: ['conversations'] as const,
  conversationRoot: ['conversation'] as const,
  conversation: (id: string) => ['conversation', id] as const,
  documents: ['documents'] as const,
  documentRoots: ['document-roots'] as const,
  nodes: ['node'] as const,
  node: (id: string) => ['node', id] as const,
  edges: ['edge'] as const,
  edge: (id: string) => ['edge', id] as const,
  commits: ['commits'] as const,
  search: ['search'] as const,
  dbSchema: ['db-schema'] as const,
  dbStats: ['db-stats'] as const,
  dbRows: ['db-rows'] as const,
}

export const PROJECT_SCOPED_QUERY_KEYS = [
  queryKeys.graph,
  queryKeys.conversations,
  queryKeys.conversationRoot,
  queryKeys.documents,
  queryKeys.documentRoots,
  queryKeys.nodes,
  queryKeys.edges,
  queryKeys.commits,
  queryKeys.search,
  queryKeys.dbSchema,
  queryKeys.dbStats,
  queryKeys.dbRows,
] as const

export async function invalidateProjectQueries(
  queryClient: QueryClient,
): Promise<void> {
  await Promise.all(
    PROJECT_SCOPED_QUERY_KEYS.map((queryKey) =>
      queryClient.invalidateQueries({ queryKey }),
    ),
  )
}

// Projects
export function useProjects() {
  return useQuery({
    queryKey: queryKeys.projects,
    queryFn: () => fetchJson<Project[]>('/projects'),
    refetchInterval: pollInterval(5000),
  })
}

export function useLoadProject() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (projectId: string) =>
      postJson<LoadedProject>(`/projects/${projectId}/load`),
    onSuccess: (result, projectId) => {
      // Update the request identity before invalidating queries. Every
      // refetch then carries the new project explicitly rather than racing a
      // Set-Cookie update or reusing the previous project's identity.
      useAppStore.getState().setCurrentProject({
        id: result.id || projectId,
        name: result.name || result.meta?.name || projectId,
        goal: result.goal || result.meta?.goal,
      })
      // Every data view below the project list is scoped to the active graph.
      // Invalidate them together so a project switch cannot retain stale
      // search, detail, history, document, or statistics results.
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects })
      void invalidateProjectQueries(queryClient)
    },
  })
}

// Graph data with polling
export function useGraph(enabled = true, showSuperseded = false) {
  const projectId = useAppStore((state) => state.currentProject?.id)
  return useQuery({
    queryKey: scopedQueryKey(queryKeys.graph, projectId, showSuperseded),
    queryFn: () =>
      fetchJson<GraphData>(
        `/graph${showSuperseded ? '?showSuperseded=true' : ''}`,
      ),
    enabled: enabled && Boolean(projectId),
    refetchInterval: pollInterval(3000), // Poll every 3 seconds (off in display-only)
    refetchIntervalInBackground: false, // Don't poll when tab is hidden
    staleTime: DISPLAY_ONLY ? Infinity : 1000, // Consider data fresh for 1 second
  })
}

// Conversations - API returns snake_case, transform to camelCase
export function useConversations(enabled = true) {
  const projectId = useAppStore((state) => state.currentProject?.id)
  return useQuery({
    queryKey: scopedQueryKey(queryKeys.conversations, projectId),
    queryFn: () => fetchJsonCamel<Conversation[]>('/conversations'),
    enabled: enabled && Boolean(projectId),
    refetchInterval: pollInterval(5000),
    staleTime: DISPLAY_ONLY ? Infinity : 2000,
  })
}

export function useConversation(id: string | null) {
  const projectId = useAppStore((state) => state.currentProject?.id)
  return useQuery({
    queryKey: scopedQueryKey(queryKeys.conversation(id || ''), projectId),
    queryFn: () => fetchJsonCamel<Conversation>(`/conversations/${id}`),
    enabled: Boolean(id && projectId),
    // Avoid the same flicker as useNode — the DetailsPanel pulls the
    // conversation for the active node and would otherwise blank out
    // momentarily on every selection change.
    placeholderData: keepPreviousData,
  })
}

// Documents - API returns snake_case
export function useDocuments(enabled = true) {
  const projectId = useAppStore((state) => state.currentProject?.id)
  return useQuery({
    queryKey: scopedQueryKey(queryKeys.documents, projectId),
    queryFn: () => fetchJsonCamel<Document[]>('/documents'),
    enabled: enabled && Boolean(projectId),
  })
}

// Document roots (files) - nodes with isDocRoot: true
export interface DocumentRoot {
  id: string
  title: string
  level?: string
  summary?: string
  fileType?: string
  createdAt?: string
}

export function useDocumentRoots(enabled = true) {
  const projectId = useAppStore((state) => state.currentProject?.id)
  return useQuery({
    queryKey: scopedQueryKey(queryKeys.documentRoots, projectId),
    queryFn: async () => {
      const response = await fetchJson<{
        roots: DocumentRoot[]
        count: number
      }>('/graph/documents')
      return response.roots
    },
    enabled: enabled && Boolean(projectId),
    refetchInterval: pollInterval(5000),
    staleTime: DISPLAY_ONLY ? Infinity : 2000,
  })
}

// Node details.
// placeholderData=keepPreviousData is load-bearing for NodeLink clicks in the
// DetailsPanel: when the user clicks a <NodeLink> in the currently-displayed
// node's content, `selectedNodeId` flips to the new id, React Query treats
// that as a brand-new query (no cache), and without placeholder data the
// hook briefly returns `{ data: undefined, isLoading: true }`. The
// DetailsPanel then renders its `if (nodeLoading) return <Loading/>` branch,
// which unmounts the clicked <NodeLink> out from under the user — the span
// you were hovering/clicking disappears, then reappears inside the newly
// fetched node's content. Visually this reads as a "flicker" on every
// subsequent click after the first. Keeping previous data around means
// `data` never goes undefined on queryKey change, so `isLoading` stays
// false, the DetailsPanel never falls into the Loading branch, and the
// panel smoothly swaps contents once the new fetch resolves.
export function useNode(id: string | null) {
  const projectId = useAppStore((state) => state.currentProject?.id)
  return useQuery({
    queryKey: scopedQueryKey(queryKeys.node(id || ''), projectId),
    queryFn: () => fetchJson<GraphData['nodes'][0]>(`/graph/nodes/${id}`),
    enabled: Boolean(id && projectId),
    placeholderData: keepPreviousData,
  })
}

// Edge details — same rationale as useNode for placeholderData.
export function useEdge(id: string | null) {
  const projectId = useAppStore((state) => state.currentProject?.id)
  return useQuery({
    queryKey: scopedQueryKey(queryKeys.edge(id || ''), projectId),
    queryFn: () => fetchJson<GraphData['edges'][0]>(`/graph/edges/${id}`),
    enabled: Boolean(id && projectId),
    placeholderData: keepPreviousData,
  })
}

// Semantic search
export interface SearchResult {
  id: string
  name: string
  similarity: number
  understanding?: string
  preview?: string
  regionId?: number
}

interface SearchResponse {
  query: string
  results: SearchResult[]
  count: number
  embeddingCoverage?: string
}

export function shouldFetchSemanticSearch(query: string, enabled = true) {
  return enabled && query.length >= 2
}

export function useSemanticSearch(query: string, limit = 10, enabled = true) {
  const projectId = useAppStore((state) => state.currentProject?.id)
  return useQuery({
    queryKey: scopedQueryKey(queryKeys.search, projectId, query, limit),
    queryFn: async () => {
      const response = await fetchJson<SearchResponse>(
        `/graph/embeddings/search?q=${encodeURIComponent(query)}&limit=${limit}`,
      )
      return response.results
    },
    enabled: shouldFetchSemanticSearch(query, enabled && Boolean(projectId)),
    staleTime: 30000, // Cache results for 30 seconds
  })
}

// Database schema
export interface DbTable {
  name: string
  rowCount: number
  columns: { name: string; type: string; primaryKey: boolean }[]
}

export function useDbSchema(enabled = true) {
  const projectId = useAppStore((state) => state.currentProject?.id)
  return useQuery({
    queryKey: scopedQueryKey(queryKeys.dbSchema, projectId),
    queryFn: () => fetchJson<{ tables: DbTable[] }>('/db/schema'),
    enabled: enabled && Boolean(projectId),
  })
}

// Database statistics
export interface DbStats {
  nodes: {
    total: number
    active: number
    archived: number
    byTrigger: Array<{ trigger: string | null; count: number; percent: number }>
  }
  edges: {
    total: number
    byType: Array<{ type: string | null; count: number; percent: number }>
  }
  commits: {
    total: number
    byAgent: Array<{ agent: string | null; count: number; percent: number }>
  }
  documents: {
    roots: number
    contentNodes: number
  }
  thinking: {
    total: number
    translated: number
  }
  revisions: {
    avgVersion: number
    maxVersion: number
  }
  connectivity: {
    mostConnected: Array<{ id: string; title: string; edgeCount: number }>
    orphanCount: number
  }
}

export function useDbStats(enabled = true) {
  const projectId = useAppStore((state) => state.currentProject?.id)
  return useQuery({
    queryKey: scopedQueryKey(queryKeys.dbStats, projectId),
    queryFn: () => fetchJson<DbStats>('/db/stats'),
    enabled: enabled && Boolean(projectId),
    refetchInterval: pollInterval(10000), // Poll every 10 seconds
    staleTime: DISPLAY_ONLY ? Infinity : 5000,
  })
}

export function useDbTableRows(
  tableName: string | null,
  options: {
    limit?: number
    offset?: number
    orderBy?: string
    orderDir?: 'asc' | 'desc'
    search?: string
  } = {},
) {
  const projectId = useAppStore((state) => state.currentProject?.id)
  const params = new URLSearchParams()
  if (options.limit) params.set('limit', String(options.limit))
  if (options.offset) params.set('offset', String(options.offset))
  if (options.orderBy) params.set('orderBy', options.orderBy)
  if (options.orderDir) params.set('orderDir', options.orderDir)
  if (options.search) params.set('search', options.search)

  return useQuery({
    queryKey: scopedQueryKey(queryKeys.dbRows, projectId, tableName, options),
    queryFn: () =>
      fetchJson<{
        rows: Record<string, unknown>[]
        total: number
        limit: number
        offset: number
      }>(`/db/tables/${tableName}/rows?${params}`),
    enabled: Boolean(tableName && projectId),
  })
}

// Commits
export interface Commit {
  id: string
  message: string
  agentName: string | null
  nodeIds: string[]
  edgeIds: string[]
  createdAt: string
}

export function useCommits(limit = 500, enabled = true) {
  const projectId = useAppStore((state) => state.currentProject?.id)
  return useQuery({
    queryKey: scopedQueryKey(queryKeys.commits, projectId, limit),
    queryFn: async () => {
      // API returns array directly (not wrapped)
      return fetchJsonCamel<Commit[]>(`/commits?limit=${limit}`)
    },
    enabled: enabled && Boolean(projectId),
    refetchInterval: pollInterval(5000),
    staleTime: DISPLAY_ONLY ? Infinity : 2000,
  })
}
