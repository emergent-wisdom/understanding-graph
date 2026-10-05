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

/**
 * The anchor a synthetic Reader/CMP thinking block must open with.
 *
 * Defaults to the canonical seven-sentence Reader Core. A comparison arm can
 * declare its own anchor through UG_THINKING_IDENTITY (a wording variant or a
 * neutral kernel), or set UG_THINKING_IDENTITY=none for traces generated
 * without any anchor. Read on every call, so a host can change it per run.
 */
export function getThinkingIdentityAnchor(): string | null {
  const configured = process.env.UG_THINKING_IDENTITY?.trim();
  if (!configured) return THINKING_IDENTITY_PREAMBLE;
  if (configured.toLowerCase() === 'none') return null;
  return configured;
}

const APOSTROPHES = /[‘’ʼ]/g;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Word for word, but tolerant of apostrophe style and of the spaces or line
// breaks a model puts between the sentences.
function identityAnchorPattern(anchor: string): RegExp {
  const words = anchor.replace(APOSTROPHES, "'").trim().split(/\s+/);
  const body = words
    .map((word) => escapeRegExp(word).replace(/'/g, "['‘’ʼ]"))
    .join('\\s+');
  return new RegExp(`^\\s*${body}`);
}

export interface ThinkingIdentityMatch {
  /** The anchor that was required, or null when the run declares none. */
  anchor: string | null;
  matched: boolean;
  /** The thought after the anchor, trimmed. */
  rest: string;
}

export function matchThinkingIdentityAnchor(
  text: string,
  anchor: string | null = getThinkingIdentityAnchor(),
): ThinkingIdentityMatch {
  if (anchor === null) return { anchor, matched: true, rest: text.trim() };
  const match = identityAnchorPattern(anchor).exec(text);
  if (!match) return { anchor, matched: false, rest: text.trim() };
  return { anchor, matched: true, rest: text.slice(match[0].length).trim() };
}

/**
 * Why a thinking text fails the run's identity anchor, or null when it passes.
 * The whole anchor is required, followed by an actual thought: the opening
 * words alone are not a recital.
 */
export function thinkingIdentityProblem(text: string): string | null {
  const { anchor, matched, rest } = matchThinkingIdentityAnchor(text);
  if (anchor !== null && !matched) {
    return `IDENTITY ANCHOR VIOLATION: the thought must open with the complete identity anchor, word for word: "${anchor}"`;
  }
  if (!rest) {
    return anchor === null
      ? 'EMPTY THOUGHT: the thinking block has no content.'
      : 'EMPTY THOUGHT: the identity anchor must be followed by the actual thought.';
  }
  return null;
}

export function stripThinkingIdentityPreamble(text: string): string {
  const configured = getThinkingIdentityAnchor();
  for (const anchor of [configured, THINKING_IDENTITY_PREAMBLE]) {
    if (anchor === null) continue;
    const match = matchThinkingIdentityAnchor(text, anchor);
    if (match.matched) return match.rest;
  }
  return text.trim();
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
