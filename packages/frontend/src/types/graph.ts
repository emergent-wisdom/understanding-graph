export type TriggerType =
  | 'foundation'
  | 'surprise'
  | 'tension'
  | 'consequence'
  | 'repetition'
  | 'question'
  | 'serendipity'
  | 'decision'
  | 'experiment'
  | 'analysis'
  | 'reference'
  | 'library'
  | 'randomness'
  | 'thinking'
  | 'prediction'
  | 'evaluation'
  | 'hypothesis'
  | 'model'

export interface Reference {
  url?: string
  title?: string
  accessed?: string
  // Cross-project reference fields
  project?: string
  nodeId?: string
}

export interface GraphNode {
  id: string
  title: string
  trigger?: TriggerType
  why?: string
  understanding?: string
  validated?: boolean
  active: boolean
  version: number
  conversationId?: string
  createdAt?: string
  updatedAt?: string
  references?: Reference[]
  // Document fields
  content?: string
  summary?: string
  level?: string
  isDocRoot?: boolean
  fileType?: string // e.g., 'py', 'js', 'ts', 'md'
  metadata?: Record<string, unknown> // Flexible key-value store (thought_fluid, etc.)
}

export interface GraphEdge {
  id: string
  from: string
  to: string
  type:
    | 'relates'
    | 'supersedes'
    | 'next'
    | 'contains'
    | 'expresses'
    | 'contradicts'
    | 'refines'
    | 'implements'
    | 'contextualizes'
    | 'questions'
    | 'answers'
    | 'learned_from'
    | 'validates'
    | 'invalidates'
    | 'diverse_from'
    | 'abstracts_from'
  explanation?: string
  why?: string
  active: boolean
  version: number
  conversationId?: string
  createdAt?: string
}

export interface Project {
  id: string
  name: string
  goal?: string
}

export interface Conversation {
  id: string
  query: string
  response?: string
  createdAt: string
  metadata?: Record<string, unknown>
}

export interface Document {
  hash: string
  originalName: string
  mimeType?: string
  sizeBytes?: number
  uploadedAt: string
  conversationId?: string
}

// Graph visualization types
export interface GraphData {
  nodes: GraphNode[]
  edges: GraphEdge[]
  supersededNodeIds?: string[] // IDs of nodes that have been superseded
}

export interface VisNode {
  id: string
  x?: number
  y?: number
  data: GraphNode
}

export interface VisEdge {
  source: string
  target: string
  data: GraphEdge
}
