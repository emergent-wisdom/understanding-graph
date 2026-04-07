// Node types
export type TriggerType =
  | 'foundation'
  | 'surprise'
  | 'repetition'
  | 'consequence'
  | 'tension'
  | 'question'
  | 'serendipity'
  | 'decision'
  | 'experiment'
  | 'analysis'
  | 'randomness'
  | 'reference' // Single pointer to project node or URL
  | 'library' // Collection of references (bibliography)
  | 'thinking' // AI reasoning trace during chronological reading
  | 'prediction' // Forward-looking belief ("I expect X to happen")
  | 'hypothesis' // Explanatory theory ("This explains why X is happening")
  | 'model' // Generalized pattern derived from specifics
  | 'evaluation'; // Normative reflection ("This is good/bad/meaningful because...")

export interface NodeRevision {
  title: string;
  trigger: TriggerType;
  why: string;
  understanding: string;
  version: number;
  timestamp: string;
  revisionWhy?: string;
}

export interface GraphNode {
  id: string;
  title: string;
  trigger: TriggerType;
  why: string;
  understanding: string;
  refs: string[];
  conversationId?: string;
  active: boolean;
  version: number;
  validated?: boolean | null;
  sourceElements?: string[];
  createdAt: string;
  updatedAt: string;
  revisions: NodeRevision[];
  // Document fields
  content?: string | null; // Full content for rendering (documents use this, thinking nodes map thought→content)
  summary?: string | null; // Compressed version for context loading
  level?: string | null; // Hierarchy level: "document", "section", "paragraph", etc.
  isDocRoot?: boolean | null; // Marks entry points for documents
}

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  explanation: string;
  why?: string;
  type?: string; // Edge types: relates, next, contains, expresses, supersedes, contradicts, refines, implements, contextualizes, questions, answers, learned_from, validates, invalidates, abstracts_from
  refs: string[];
  conversationId?: string;
  active: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

// SQLite types
export interface Conversation {
  id: string;
  query: string;
  response?: string | null;
  created_at: string;
  metadata?: Record<string, unknown>;
}

export interface Document {
  hash: string;
  original_name: string;
  mime_type?: string | null;
  size_bytes?: number | null;
  uploaded_at: string;
  conversation_id?: string | null;
}

export interface EventLogEntry {
  seq: number;
  timestamp: string;
  action: 'created' | 'revised' | 'superseded' | 'archived' | 'purged';
  entity_type: 'node' | 'edge' | 'batch';
  entity_id: string;
  conversation_id?: string | null;
  summary?: string | null;
  details?: Record<string, unknown> | null;
  // Joined fields when includeConversations=true
  user_query?: string;
  ai_response?: string;
}

export interface ToolCall {
  id: number;
  session_id: string;
  tool_name: string;
  arguments: Record<string, unknown>;
  result?: unknown;
  error?: string | null;
  duration_ms?: number | null;
  created_at: string;
}

// Graph context types
export interface GraphProject {
  id: string;
  name: string;
  goal?: string;
  createdAt: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// Create/update DTOs
export interface CreateNodeInput {
  title: string;
  trigger: TriggerType;
  why: string;
  understanding: string;
  conversationId?: string;
  sourceElements?: string[];
  // Document fields
  content?: string;
  summary?: string;
  level?: string;
  isDocRoot?: boolean;
}

export interface UpdateNodeInput {
  title?: string;
  trigger?: TriggerType;
  why?: string;
  understanding?: string;
  validated?: boolean;
  revisionWhy?: string;
  conversationId?: string;
  // Document fields
  content?: string;
  summary?: string;
  level?: string;
  isDocRoot?: boolean;
}

export interface CreateEdgeInput {
  from: string;
  to: string;
  explanation: string;
  why?: string;
  type?: string; // Edge type (defaults to 'relates')
  conversationId?: string;
}

export interface UpdateEdgeInput {
  type?: string;
  explanation?: string;
  why?: string;
  revisionWhy?: string;
  conversationId?: string;
}

// Analysis types
export interface GraphAnalysis {
  centrality: Array<{
    nodeId: string;
    title: string;
    inDegree: number;
    outDegree: number;
    total: number;
  }>;
  cycles: Array<{ nodes: string[]; description: string }>;
  bridges: Array<{ edge: GraphEdge; fromCluster: string; toCluster: string }>;
  isolatedNodes: GraphNode[];
  openQuestions: GraphNode[];
  serendipityNodes: { validated: GraphNode[]; unvalidated: GraphNode[] };
  statistics: {
    totalNodes: number;
    totalEdges: number;
    triggerDistribution: Record<TriggerType, number>;
    density: number;
  };
}
