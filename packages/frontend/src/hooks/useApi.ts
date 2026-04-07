import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Conversation, Document, GraphData, Project } from '@/types/graph'

const API_BASE = '/api'

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
async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(`${API_BASE}${url}`)
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
}

async function fetchJsonCamel<T>(url: string): Promise<T> {
  const res = await fetch(`${API_BASE}${url}`)
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  const data = await res.json()
  return snakeToCamel(data) as T
}

async function postJson<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${url}`, {
    method: 'POST',
    headers: body ? { 'Content-Type': 'application/json' } : {},
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
  conversation: (id: string) => ['conversation', id] as const,
  documents: ['documents'] as const,
  node: (id: string) => ['node', id] as const,
  edge: (id: string) => ['edge', id] as const,
  commits: ['commits'] as const,
}

// Projects
export function useProjects() {
  return useQuery({
    queryKey: queryKeys.projects,
    queryFn: () => fetchJson<Project[]>('/projects'),
  })
}

export function useLoadProject() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (projectId: string) =>
      postJson<{ meta: { name: string; goal?: string } }>(
        `/projects/${projectId}/load`,
      ),
    onSuccess: () => {
      // Invalidate graph and conversations when project changes
      queryClient.invalidateQueries({ queryKey: queryKeys.graph })
      queryClient.invalidateQueries({ queryKey: queryKeys.conversations })
      queryClient.invalidateQueries({ queryKey: queryKeys.documents })
    },
  })
}

// Graph data with polling
export function useGraph(enabled = true, showSuperseded = false) {
  return useQuery({
    queryKey: [...queryKeys.graph, showSuperseded],
    queryFn: () =>
      fetchJson<GraphData>(
        `/graph${showSuperseded ? '?showSuperseded=true' : ''}`,
      ),
    enabled,
    refetchInterval: 3000, // Poll every 3 seconds
    refetchIntervalInBackground: false, // Don't poll when tab is hidden
    staleTime: 1000, // Consider data fresh for 1 second
  })
}

// Conversations - API returns snake_case, transform to camelCase
export function useConversations(enabled = true) {
  return useQuery({
    queryKey: queryKeys.conversations,
    queryFn: () => fetchJsonCamel<Conversation[]>('/conversations'),
    enabled,
    refetchInterval: 5000,
    staleTime: 2000,
  })
}

export function useConversation(id: string | null) {
  return useQuery({
    queryKey: queryKeys.conversation(id || ''),
    queryFn: () => fetchJsonCamel<Conversation>(`/conversations/${id}`),
    enabled: !!id,
  })
}

// Documents - API returns snake_case
export function useDocuments(enabled = true) {
  return useQuery({
    queryKey: queryKeys.documents,
    queryFn: () => fetchJsonCamel<Document[]>('/documents'),
    enabled,
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
  return useQuery({
    queryKey: ['document-roots'],
    queryFn: async () => {
      const response = await fetchJson<{
        roots: DocumentRoot[]
        count: number
      }>('/graph/documents')
      return response.roots
    },
    enabled,
    refetchInterval: 5000,
    staleTime: 2000,
  })
}

// Node details
export function useNode(id: string | null) {
  return useQuery({
    queryKey: queryKeys.node(id || ''),
    queryFn: () => fetchJson<GraphData['nodes'][0]>(`/graph/nodes/${id}`),
    enabled: !!id,
  })
}

// Edge details
export function useEdge(id: string | null) {
  return useQuery({
    queryKey: queryKeys.edge(id || ''),
    queryFn: () => fetchJson<GraphData['edges'][0]>(`/graph/edges/${id}`),
    enabled: !!id,
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

export function useSemanticSearch(query: string, limit = 10) {
  return useQuery({
    queryKey: ['search', query, limit],
    queryFn: async () => {
      const response = await fetchJson<SearchResponse>(
        `/graph/embeddings/search?q=${encodeURIComponent(query)}&limit=${limit}`,
      )
      return response.results
    },
    enabled: query.length >= 2, // Only search with 2+ chars
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
  return useQuery({
    queryKey: ['db-schema'],
    queryFn: () => fetchJson<{ tables: DbTable[] }>('/db/schema'),
    enabled,
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
  return useQuery({
    queryKey: ['db-stats'],
    queryFn: () => fetchJson<DbStats>('/db/stats'),
    enabled,
    refetchInterval: 10000, // Poll every 10 seconds
    staleTime: 5000,
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
  const params = new URLSearchParams()
  if (options.limit) params.set('limit', String(options.limit))
  if (options.offset) params.set('offset', String(options.offset))
  if (options.orderBy) params.set('orderBy', options.orderBy)
  if (options.orderDir) params.set('orderDir', options.orderDir)
  if (options.search) params.set('search', options.search)

  return useQuery({
    queryKey: ['db-rows', tableName, options],
    queryFn: () =>
      fetchJson<{
        rows: Record<string, unknown>[]
        total: number
        limit: number
        offset: number
      }>(`/db/tables/${tableName}/rows?${params}`),
    enabled: !!tableName,
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

export function useCommits(limit = 500) {
  return useQuery({
    queryKey: [...queryKeys.commits, limit],
    queryFn: async () => {
      // API returns array directly (not wrapped)
      return fetchJsonCamel<Commit[]>(`/commits?limit=${limit}`)
    },
    refetchInterval: 5000,
    staleTime: 2000,
  })
}
