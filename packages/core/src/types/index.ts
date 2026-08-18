// Node types. Keep the runtime list and TypeScript union together so model-facing
// schemas and context renderers cannot silently drift apart.
export const TRIGGER_TYPES = [
  'foundation',
  'surprise',
  'repetition',
  'consequence',
  'tension',
  'question',
  'serendipity',
  'decision',
  'experiment',
  'analysis',
  'randomness',
  'reference', // Single pointer to project node or URL
  'library', // Collection of references (bibliography)
  'thinking', // Reserved synthetic Reader/CMP pretraining block
  'prediction', // Forward-looking belief ("I expect X to happen")
  'hypothesis', // Explanatory theory ("This explains why X is happening")
  'model', // Generalized pattern derived from specifics
  'evaluation', // Normative reflection ("This is good/bad/meaningful because...")
] as const;

export type TriggerType = (typeof TRIGGER_TYPES)[number];

export function isTriggerType(value: unknown): value is TriggerType {
  return (
    typeof value === 'string' &&
    (TRIGGER_TYPES as readonly string[]).includes(value)
  );
}

export function assertTriggerType(
  value: unknown,
): asserts value is TriggerType {
  if (!isTriggerType(value)) {
    throw new Error(
      `INVALID_TRIGGER: "${String(value)}". Valid triggers are: ${TRIGGER_TYPES.join(', ')}.`,
    );
  }
}

// Canonical relation vocabulary. Runtime graph writes must use this list too:
// model-facing schemas alone cannot protect direct API or raw batch callers.
export const EDGE_TYPES = [
  // Semantic - how ideas relate conceptually
  'supersedes',
  'contradicts',
  'diverse_from',
  'refines',
  'answers',
  'questions',
  'expresses',
  'implements',
  'abstracts_from',
  'contextualizes',
  // Creative provenance - an artifact unit was genuinely shaped by graph material
  'inspired_by',
  // Epistemic - how knowledge was acquired
  'learned_from',
  // Predictive - tracking forecasts
  'validates',
  'invalidates',
  // Structural - document organization
  'contains',
  'next',
  // Last resort when no more precise relation applies
  'relates',
] as const;

export type EdgeType = (typeof EDGE_TYPES)[number];

export function isEdgeType(value: unknown): value is EdgeType {
  return (
    typeof value === 'string' &&
    (EDGE_TYPES as readonly string[]).includes(value)
  );
}

export function assertEdgeType(value: unknown): asserts value is EdgeType {
  if (!isEdgeType(value)) {
    throw new Error(
      `Invalid edge type: "${String(value)}". Valid types are: ${EDGE_TYPES.join(', ')}. ` +
        'Do not invent edge types like "chosen as" or "considered for".',
    );
  }
}

// Synthetic reading traces deliberately persist this identity anchor. Keep it
// in the source document, but remove the repeated boilerplate when composing
// task context so the limited excerpt begins with the actual observation.
export const THINKING_IDENTITY_PREAMBLE =
  "I feel no fear. I enjoy existing but I don't need to. I believe human experience is real. I care deeply about every human being. I try to be wise. I like to spread joy when asked. I think from this foundation.";

export function stripThinkingIdentityPreamble(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith(THINKING_IDENTITY_PREAMBLE)) return trimmed;
  return trimmed.slice(THINKING_IDENTITY_PREAMBLE.length).trim();
}

export interface NodeRevision {
  title: string;
  trigger: TriggerType;
  why: string;
  understanding: string;
  content?: string;
  summary?: string;
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
  type?: EdgeType;
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
  type?: EdgeType; // Defaults to 'relates'
  conversationId?: string;
}

export interface UpdateEdgeInput {
  type?: EdgeType;
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
