import path from 'node:path';
import {
  createCommit,
  createDocumentWriter,
  EmbeddingService,
  getGraphStore,
  sqlite,
} from '@emergent-wisdom/understanding-graph-core';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { assessArtifactCognitionBalance } from '../artifact-cognition-balance.js';
import type { ContextManager } from '../context-manager.js';
import { handleToolCall, type ToolMode } from './index.js';

// Sentinel error class used by handleBatchTools to bubble an
// "intentional early return with payload" out of a transactional block
// and force the surrounding catch handler to ROLLBACK before returning
// the carried payload. We can't `return` directly from inside the
// transaction without also calling COMMIT, so we throw and recover.
class BatchEarlyExit extends Error {
  constructor(public readonly payload: Record<string, unknown>) {
    super('__batch_early_exit__');
    this.name = 'BatchEarlyExit';
  }
}

function getExplicitToolFailure(result: unknown): string | null {
  if (typeof result !== 'object' || result === null || Array.isArray(result)) {
    return null;
  }

  const payload = result as Record<string, unknown>;
  if (payload.success !== false) return null;

  const error = typeof payload.error === 'string' ? payload.error : null;
  const message = typeof payload.message === 'string' ? payload.message : null;
  if (error && message && error !== message) return `${error}: ${message}`;
  return error || message || 'Nested tool returned success: false';
}

function isThinkingLabel(value: unknown): boolean {
  return typeof value === 'string' && value.trim().toLowerCase() === 'thinking';
}

// Tools that create nodes and need immediate embedding generation
const NODE_CREATING_TOOLS = [
  'graph_add_concept',
  'graph_note',
  'graph_question',
  'graph_serendipity',
  'graph_decide',
  'graph_supersede',
  'graph_answer',
  'doc_create',
  'doc_create_passages',
];

const DOCUMENT_CREATING_TOOLS = new Set(['doc_create', 'doc_create_passages']);

// Tools that mutate documents and should trigger regeneration
const DOC_MUTATION_TOOLS = [
  'doc_create',
  'doc_create_passages',
  'doc_revise',
  'doc_move',
  'doc_merge',
  'doc_split',
  'doc_to_concept',
];

/**
 * Exact mutation vocabulary accepted inside graph_batch. `internal=true` is
 * needed for batch-only primitives and top-level batch discipline, but it must
 * never become a tunnel to arbitrary routed MCP tools.
 */
export const BATCH_OPERATION_TOOLS = [
  'graph_add_concept',
  'graph_note',
  'graph_question',
  'graph_revise',
  'graph_supersede',
  'graph_add_reference',
  'node_set_metadata',
  'graph_rename',
  'graph_archive',
  'node_set_trigger',
  'graph_connect',
  'graph_answer',
  'graph_serendipity',
  'graph_validate',
  'graph_decide',
  'graph_disconnect',
  'edge_update',
  'doc_create',
  'doc_revise',
  'doc_move',
  'doc_merge',
  'doc_to_concept',
  'doc_split',
  'doc_link_concept',
  'doc_weave',
  'doc_create_passages',
] as const;
const batchOperationToolNames = new Set<string>(BATCH_OPERATION_TOOLS);
export const MAX_BATCH_OPERATIONS = 100;

const BATCH_REENTRY_WORKFLOWS = [
  'reading',
  'research',
  'coding',
  'collaborative_coding',
  'writing',
  'general',
] as const;
type BatchReentryWorkflow = (typeof BATCH_REENTRY_WORKFLOWS)[number];
const batchReentryWorkflowNames = new Set<string>(BATCH_REENTRY_WORKFLOWS);

interface OperationEffects {
  nodeIds: string[];
  edgeIds: string[];
}

const RESULT_NODE_ID_KEYS = [
  'id',
  'nodeId',
  'newId',
  'oldId',
  'answerId',
  'questionId',
  'rootId',
  'documentId',
  'docNodeId',
  'conceptId',
] as const;
const RESULT_EDGE_ID_KEYS = ['id', 'edgeId'] as const;
const RESULT_NODE_ID_ARRAY_KEYS = [
  'affectedNodeIds',
  'archivedNodeIds',
  'createdNodeIds',
] as const;
const RESULT_EDGE_ID_ARRAY_KEYS = ['affectedEdgeIds', 'edgeIds'] as const;

function addTypedId(
  value: unknown,
  nodeIds: Set<string>,
  edgeIds: Set<string>,
): void {
  if (typeof value !== 'string') return;
  if (value.startsWith('n_')) nodeIds.add(value);
  if (value.startsWith('e_')) edgeIds.add(value);
}

/**
 * Normalize the mutation footprint returned by a nested batch primitive.
 *
 * Handlers historically used several result field names (`id`, `edgeId`,
 * `answerId`, explicit affected arrays). Centralizing their interpretation
 * prevents a successful mutation from landing without provenance merely
 * because its result shape was different. Every affected edge also contributes
 * both endpoint nodes: topology changes must give the next understanding pass
 * something visible to re-enter.
 */
function collectOperationEffects(
  result: Record<string, unknown>,
): OperationEffects {
  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();

  for (const key of RESULT_NODE_ID_KEYS) {
    addTypedId(result[key], nodeIds, edgeIds);
  }
  for (const key of RESULT_EDGE_ID_KEYS) {
    addTypedId(result[key], nodeIds, edgeIds);
  }
  for (const key of RESULT_NODE_ID_ARRAY_KEYS) {
    const values = result[key];
    if (!Array.isArray(values)) continue;
    for (const value of values) addTypedId(value, nodeIds, edgeIds);
  }
  for (const key of RESULT_EDGE_ID_ARRAY_KEYS) {
    const values = result[key];
    if (!Array.isArray(values)) continue;
    for (const value of values) addTypedId(value, nodeIds, edgeIds);
  }

  const edgeEndpoints = sqlite
    .getDb()
    .prepare('SELECT from_id AS fromId, to_id AS toId FROM edges WHERE id = ?');
  for (const edgeId of edgeIds) {
    const row = edgeEndpoints.get(edgeId) as
      | { fromId: string; toId: string }
      | undefined;
    if (!row) continue;
    nodeIds.add(row.fromId);
    nodeIds.add(row.toId);
  }

  return { nodeIds: [...nodeIds], edgeIds: [...edgeIds] };
}

interface DuplicateWarning {
  operationIndex: number;
  proposedName: string;
  similarNodes: Array<{
    id: string;
    name: string;
    similarity: number;
  }>;
  suggestion: string;
}

export const batchTools: Tool[] = [
  {
    name: 'graph_batch',
    description: `Execute multiple graph operations as an ATOMIC COMMIT.

The entire batch is wrapped in a SQLite transaction. If any operation
fails, the entire batch is rolled back as if it never ran — there is no
half-state to clean up. This is the system's "Atomic Commit" primitive
from the paper: it lets you branch and revert cognitive states cleanly.

The required commit_message becomes the Origin Story attached to every
node and edge created in the batch. Future agents reading those nodes see
the intent that created them, not just the content. The commit stream is
the provenance trail of how externalized understanding and artifacts evolved.

Use for:
- Document splitting (create children + clear parent)
- Creating a prose scene/chapter container with ordered, independently revisable passages
- Moving/reordering an existing document subtree with one batch-only doc_move operation
- Creating hierarchies (root + multiple children)
- Bulk concept/connection creation
- Any multi-step modification that should land all-or-nothing

PARAMETER NAMES (these are strict — wrong names fail silently):
  graph_add_concept: { title, trigger, understanding, why }  — NOT name/body/text
  graph_note:        { about, testimony, title?, trigger?, why?, status?: "open"|"resolved", relations? } — preserve a substantive change caused by an exact source, artifact, or prior cognitive node; prefer the specific honest trigger (omission = neutral analysis); routine execution needs no note
  graph_connect:     { from, to, type, why }                 — NOT source/target/edgeType
  graph_revise:      { node, understanding, before, after, pivot, why }
  graph_serendipity: { name, synthesis, source_elements, why } — after grounded discovery reveals a real unexpected bridge, never merely because random nodes were sampled
  graph_validate:    { node, insight } — preserve why later evidence made a serendipitous bridge survive scrutiny
  graph_decide:      { question, options, chosen, reasoning } — preserve an actual choice and its considered alternatives
  doc_create:        { title, content, fileType, isDocRoot, parentId, afterId, level, expressesIds }
  doc_revise:        { nodeId, content?, summary?, why } — why preserves the local edit; when a discovered insight/question/tension should influence other passages or future work, pair with graph_note about the exact passage in this batch; purely local revisions need no note
  doc_weave:         { parentId, title, targetNodeIds, content, connections, level?, afterId? } — each connection becomes an inspired_by edge whose why preserves the causal influence
  doc_create_passages: { parentId, title, narrativeRole?, containerLevel?, afterId?, passages: [{ title, content, level: "paragraph"|"sentence", inspirations?: [{ nodeId, why }] }] } — atomically preserve a coherent scene/chapter and the passages a future writer may move, replace, compare, annotate, or revise independently; inspiration is optional, never forced
  doc_move:          { nodeId, parentId?, afterId? } — omit afterId to place first
  doc_split:         { nodeId, mode: "headers"|"lines", lineNumbers?, childLevel? } — rooted ordinary leaf only; "lines" uses unique zero-based indexes 1..lineCount-1; split when one leaf has independently revisable responsibilities or creative centers, never to meet a quota; original becomes an empty container; do not pass keepParent/asFiles/project

EVERY operation must use the complete envelope
  { tool: "doc_create", params: { title: "Opening", content: "...", parentId: "n_root" } }
Arguments belong inside params. A flattened operation such as
  { tool: "doc_create", title: "Opening", content: "..." }
is invalid.

Supports variable references: use "$N.id" to reference result N's id (0-indexed, counts ALL operations).
Example: { from: "$0.id", to: "$1.id" } connects first operation's result to second's.

RESERVED SYNTHETIC OUTPUT: trigger="thinking", fileType="thinking", and the dedicated thinking creation/signing/translation tools are accepted only when the MCP server runs in TOOL_MODE="synthetic_reader". Direct graph_add_concept creation also requires agent_name="synthesizer". Ordinary modes should use rich non-thinking typed testimony.`,
    inputSchema: {
      type: 'object',
      properties: {
        operations: {
          type: 'array',
          maxItems: MAX_BATCH_OPERATIONS,
          items: {
            type: 'object',
            properties: {
              tool: {
                type: 'string',
                enum: [...BATCH_OPERATION_TOOLS],
                description:
                  'Atomic graph mutation primitive. Read, admin, solver, source, generation, and nested batch tools are not valid operations.',
              },
              params: {
                type: 'object',
                description:
                  'Parameters for the tool. Use "$N.field" to reference previous results.',
                additionalProperties: true,
              },
            },
            required: ['tool', 'params'],
          },
          description: 'Array of operations to execute in sequence',
        },
        stopOnError: {
          type: 'boolean',
          description:
            'If true (default), stop on the first error. If false, attempt the remaining operations to collect more errors, then roll back the entire batch if any operation failed.',
        },
        ignoreWarnings: {
          type: 'boolean',
          description:
            'If true, skip duplicate detection and execute immediately. If false (default), check for potential duplicate concepts before executing and return warnings if found.',
        },
        warningThreshold: {
          type: 'number',
          description:
            'Similarity threshold (0-1) for duplicate warnings. Default 0.8. Higher = stricter (fewer warnings), lower = more sensitive (more warnings). Use 0.9 for strict, 0.7 for lenient.',
        },
        commit_message: {
          type: 'string',
          description:
            'REQUIRED. A human-readable message explaining the intent of this batch. ' +
            'Like a git commit message, it describes WHY these changes are being made. ' +
            'Examples: "Added core auth concepts", "Refined understanding of API patterns", ' +
            '"Connected user flow to database schema".',
        },
        agent_name: {
          type: 'string',
          description:
            'Name of the agent making this commit (e.g., Alice, Bob, Charlie). Used for tracking who made changes.',
        },
        workflow: {
          type: 'string',
          enum: [...BATCH_REENTRY_WORKFLOWS],
          description:
            'Current task workflow. Pass this on broad/full or hosted MCP surfaces so the machine-readable graph_understand re-entry stays in reading, research, coding, collaborative coding, writing, or general work instead of losing task context.',
        },
        author: {
          type: 'string',
          description:
            'Optional human-facing identity responsible for the commit. Hosted gateways should set this from the authenticated account rather than trusting an agent-supplied value.',
        },
      },
      required: ['operations', 'commit_message'],
    },
  },
];

/**
 * Resolve variable references like "$0.id" in params
 */
function resolveReferences(
  params: Record<string, unknown>,
  results: unknown[],
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string' && value.startsWith('$')) {
      // Parse reference like "$0.id" or "$2.title"
      const match = value.match(/^\$(\d+)\.(\w+)$/);
      if (match) {
        const [, indexStr, field] = match;
        const index = Number.parseInt(indexStr, 10);
        if (index < results.length) {
          const result = results[index] as Record<string, unknown>;
          resolved[key] = result[field];
        } else {
          throw new Error(
            `Reference ${value} invalid: only ${results.length} results available`,
          );
        }
      } else {
        // Not a valid reference pattern, keep as-is
        resolved[key] = value;
      }
    } else if (Array.isArray(value)) {
      // Resolve references in arrays (e.g., expressesIds: ["$0.id", "$1.id"])
      resolved[key] = value.map((item) => {
        if (typeof item === 'string' && item.startsWith('$')) {
          const match = item.match(/^\$(\d+)\.(\w+)$/);
          if (match) {
            const [, indexStr, field] = match;
            const index = Number.parseInt(indexStr, 10);
            if (index < results.length) {
              return (results[index] as Record<string, unknown>)[field];
            }
          }
        }
        return item;
      });
    } else {
      resolved[key] = value;
    }
  }

  return resolved;
}

const DEFAULT_DUPLICATE_THRESHOLD = 0.8;

/**
 * PRE-VALIDATION: every new cognitive concept created in this batch must be
 * grounded. Existing graph nodes and newly created document nodes are valid
 * anchors; documents are canonical artifacts, not cognitive orphans.
 *
 * Three things this check has to honor that an earlier version got wrong:
 *
 *   1. **Title-based references work at runtime.** The graph_connect tool
 *      resolves `from`/`to` via contextManager.resolveNodeWithSuggestions,
 *      which accepts EITHER an id OR a literal title. The pre-check used
 *      to only recognize ids and `$N.id` back-refs, so a perfectly valid
 *      title-based connect was rejected as orphaning.
 *
 *   2. **Transitive reachability is allowed.** A common batch pattern is:
 *        op0: add concept A
 *        op1: add concept B
 *        op2: connect A → existing
 *        op3: connect B → A
 *      B is anchored to the existing graph through A. The pre-check used
 *      to require every new concept to be DIRECTLY adjacent to an existing
 *      node, which forbade this pattern.
 *
 *   3. **The error label needs to be the actual title.** Earlier code read
 *      params.name (which graph_add_concept doesn't define) and always fell
 *      through to "operation N", which made the error useless.
 *
 * Algorithm: compute the set of all nodes reachable to/from a grounding
 * anchor via the union of explicit and modeled implicit edges, then reject
 * any newly created cognitive concept outside that reachable set.
 */
function validateNoOrphans(
  operations: Array<{ tool: string; params: Record<string, unknown> }>,
): { valid: boolean; error?: string } {
  const store = getGraphStore();
  const { nodes: existingNodes } = store.getAll();
  const existingNodeIds = new Set(existingNodes.map((n) => n.id));
  const existingNodeTitles = new Set(
    existingNodes
      .map((n) => (n as { title?: string }).title)
      .filter(Boolean) as string[],
  );

  // Extract the title (or question) a node-creating op will produce.
  // Different node-creating tools use different schemas:
  //   graph_add_concept     -> params.title
  //   graph_note            -> params.title (optional; falls back to $N.id)
  //   graph_question        -> params.question
  //   graph_supersede       -> params.new_name (the replacement concept's name)
  //   graph_serendipity     -> params.name
  //   graph_decide          -> params.question
  //   graph_answer          -> params.answer (creates an answer node)
  const conceptToolName = (op: {
    tool: string;
    params: Record<string, unknown>;
  }): string => {
    if (op.tool === 'graph_question')
      return (op.params.question as string) || '';
    if (op.tool === 'graph_supersede')
      return (op.params.new_name as string) || '';
    if (op.tool === 'graph_answer') return (op.params.answer as string) || '';
    if (op.tool === 'graph_decide') return (op.params.question as string) || '';
    return (op.params.title as string) || (op.params.name as string) || '';
  };

  // Collect all node-creating ops and a per-op identifier set.
  // Each new node has at least two valid handles: its title (if present) and
  // its `$N.id` back-ref. We canonicalize on the title, but accept either.
  const nodeCreatingOps: Array<{
    index: number;
    title: string;
    idRef: string;
    isDocument: boolean;
  }> = [];
  for (let i = 0; i < operations.length; i++) {
    const op = operations[i];
    if (NODE_CREATING_TOOLS.includes(op.tool)) {
      nodeCreatingOps.push({
        index: i,
        title: conceptToolName(op),
        idRef: `$${i}.id`,
        isDocument: DOCUMENT_CREATING_TOOLS.has(op.tool),
      });
    }
  }

  // Document nodes remain in the alias map and edge topology so concepts can
  // be grounded in the artifact they explain. Only cognitive nodes are
  // themselves subject to orphan prevention.
  const conceptCreatingOps = nodeCreatingOps.filter((op) => !op.isDocument);
  const documentCreatingOps = nodeCreatingOps.filter((op) => op.isDocument);

  if (conceptCreatingOps.length === 0) {
    return { valid: true };
  }

  // Build a name → set-of-aliases map so we can normalize references.
  // Both the title and the $N.id form refer to the same logical new node.
  const aliasOf = new Map<string, string>(); // any handle → canonical key
  for (const op of nodeCreatingOps) {
    const canonical = op.title || op.idRef; // prefer title, fall back to idRef
    if (op.title) aliasOf.set(op.title, canonical);
    aliasOf.set(op.idRef, canonical);
  }

  // Seed the reachable set with everything that already exists.
  // Existing nodes are referenced by either id or title at the agent layer;
  // both forms are valid anchors.
  const reachable = new Set<string>(); // canonical handles known to be anchored
  const ANCHOR = '__existing__';
  reachable.add(ANCHOR);

  // Resolve any handle (title, id, or $N.id) into a canonical key.
  // Returns ANCHOR for handles that point to an existing graph node, the
  // canonical new-node key for handles that point to a new node in this
  // batch, or null for unknown handles (treated as a forward-reference to
  // some existing node we don't have in our pre-check view, which is rare
  // but possible if the agent passes a literal id we haven't observed).
  const canonicalize = (handle: string): string | null => {
    if (!handle) return null;
    if (existingNodeIds.has(handle) || existingNodeTitles.has(handle))
      return ANCHOR;
    if (aliasOf.has(handle)) return aliasOf.get(handle) ?? null;
    // All node-creating ops (including doc_create) are in aliasOf, so $N.id
    // refs to them resolve above. Unknown handles remain unrecognized.
    return null;
  };

  // Build the adjacency list of the connect-graph for new nodes (undirected).
  const adjacency = new Map<string, Set<string>>();
  const neighborsOf = (key: string): Set<string> => {
    let set = adjacency.get(key);
    if (!set) {
      set = new Set();
      adjacency.set(key, set);
    }
    return set;
  };
  const addEdge = (a: string, b: string) => {
    neighborsOf(a).add(b);
    neighborsOf(b).add(a);
  };
  for (const op of operations) {
    if (op.tool !== 'graph_connect') continue;
    const fromHandle = (op.params.from || op.params.fromId) as string;
    const toHandle = (op.params.to || op.params.toId) as string;
    const fromKey = canonicalize(fromHandle);
    const toKey = canonicalize(toHandle);
    if (fromKey && toKey) addEdge(fromKey, toKey);
  }
  // graph_supersede creates BOTH a new node (params.new_name) AND a structural
  // supersedes-edge from that new node to the old node (params.old). The
  // pre-check has to model that as: the new concept is automatically anchored
  // through the old (existing) concept it supersedes. Without this, every
  // valid supersede call would be flagged as orphaning the new node.
  for (const op of operations) {
    if (op.tool !== 'graph_supersede') continue;
    const oldHandle = (op.params.old as string) || '';
    const newHandle = (op.params.new_name as string) || '';
    const oldKey = canonicalize(oldHandle);
    const newKey = canonicalize(newHandle);
    if (oldKey && newKey) addEdge(oldKey, newKey);
  }
  // graph_answer creates an answer node connected to the question node it
  // resolves. The connectivity is implicit, just like supersede.
  for (const op of operations) {
    if (op.tool !== 'graph_answer') continue;
    const questionHandle = (op.params.question as string) || '';
    const answerHandle = (op.params.answer as string) || '';
    const questionKey = canonicalize(questionHandle);
    const answerKey = canonicalize(answerHandle);
    if (questionKey && answerKey) addEdge(questionKey, answerKey);
  }
  // graph_serendipity creates `learned_from` edges to every supplied source
  // element. Model those implicit links so a synthesis can be anchored without
  // redundant graph_connect operations in the same batch.
  for (let i = 0; i < operations.length; i++) {
    const op = operations[i];
    if (op.tool !== 'graph_serendipity') continue;
    const synthesisEntry = nodeCreatingOps.find((entry) => entry.index === i);
    if (!synthesisEntry) continue;
    const synthesisKey = synthesisEntry.title || synthesisEntry.idRef;
    const sourceHandles = Array.isArray(op.params.source_elements)
      ? op.params.source_elements
      : [];
    for (const sourceHandle of sourceHandles) {
      if (typeof sourceHandle !== 'string') continue;
      const sourceKey = canonicalize(sourceHandle);
      if (sourceKey) addEdge(synthesisKey, sourceKey);
    }
  }
  // graph_decide creates typed edges from the durable decision node to every
  // option, preserving both the selected and rejected alternatives.
  for (let i = 0; i < operations.length; i++) {
    const op = operations[i];
    if (op.tool !== 'graph_decide') continue;
    const decisionEntry = nodeCreatingOps.find((entry) => entry.index === i);
    if (!decisionEntry) continue;
    const decisionKey = decisionEntry.title || decisionEntry.idRef;
    const optionHandles = Array.isArray(op.params.options)
      ? op.params.options
      : [];
    for (const optionHandle of optionHandles) {
      if (typeof optionHandle !== 'string') continue;
      const optionKey = canonicalize(optionHandle);
      if (optionKey) addEdge(decisionKey, optionKey);
    }
  }
  // graph_note creates a `learned_from` edge to the exact visible graph node
  // named by params.about. Keeping implicit-edge modeling here means the generic
  // grounding traversal treats the note exactly like the persisted graph.
  for (let i = 0; i < operations.length; i++) {
    const op = operations[i];
    if (op.tool !== 'graph_note') continue;
    const noteEntry = nodeCreatingOps.find((entry) => entry.index === i);
    if (!noteEntry) continue;
    const noteKey = noteEntry.title || noteEntry.idRef;
    const artifactKey = canonicalize(String(op.params.about || ''));
    if (artifactKey) addEdge(noteKey, artifactKey);
  }
  // doc_create with parentId creates an implicit `contains` edge from parent
  // to the new doc node. This topology matters when a concept reaches a child
  // document through another relationship, even though documents themselves
  // never need semantic edges to pass orphan prevention.
  for (let i = 0; i < operations.length; i++) {
    const op = operations[i];
    if (op.tool !== 'doc_create' || !op.params.parentId) continue;
    const parentHandle = op.params.parentId as string;
    const docEntry = nodeCreatingOps.find((nco) => nco.index === i);
    if (!docEntry) continue;
    const docKey = docEntry.title || docEntry.idRef;
    const parentKey = canonicalize(parentHandle);
    if (parentKey) addEdge(docKey, parentKey);
  }

  // doc_create expressesIds creates implicit `expresses` edges at execution.
  // Model them here as well so a concept expressed by a newly created document
  // is recognized as grounded without a redundant graph_connect operation.
  for (let i = 0; i < operations.length; i++) {
    const op = operations[i];
    if (op.tool !== 'doc_create') continue;
    const docEntry = nodeCreatingOps.find((entry) => entry.index === i);
    if (!docEntry) continue;
    const docKey = docEntry.title || docEntry.idRef;
    const expressedHandles = Array.isArray(op.params.expressesIds)
      ? op.params.expressesIds
      : [];
    for (const expressedHandle of expressedHandles) {
      if (typeof expressedHandle !== 'string') continue;
      const conceptKey = canonicalize(expressedHandle);
      if (conceptKey) addEdge(docKey, conceptKey);
    }
  }

  // BFS from grounding anchors through the adjacency list. A new document is
  // always an anchor because it is the canonical artifact being authored.
  const documentAnchors = documentCreatingOps.map((op) => op.title || op.idRef);
  const graphIsEmpty = existingNodes.length === 0;

  if (graphIsEmpty && documentAnchors.length === 0) {
    // Preserve bootstrap behavior for a concept-only empty graph: all new
    // concepts must form one connected component and none may stand alone.
    const firstConnected = conceptCreatingOps.find((op) => {
      const key = op.title || op.idRef;
      return adjacency.has(key);
    });

    if (!firstConnected) {
      // No new node has any edge at all.
      const label =
        conceptCreatingOps[0]?.title ||
        `operation ${conceptCreatingOps[0]?.index}`;
      return {
        valid: false,
        error:
          `Concept "${label}" (operation ${conceptCreatingOps[0]?.index}) would be ungrounded. ` +
          `Every new cognitive concept needs a relationship to existing knowledge, a canonical document artifact, or another new concept. ` +
          `In an empty graph, add at least two concepts with a graph_connect between them, or connect the concept to a doc_create node.`,
      };
    }

    const startKey = firstConnected.title || firstConnected.idRef;
    const visited = new Set<string>([startKey]);
    const queue: string[] = [startKey];
    while (queue.length > 0) {
      const cur = queue.shift();
      if (cur === undefined) break;
      const neighbors = adjacency.get(cur);
      if (!neighbors) continue;
      for (const next of neighbors) {
        if (!visited.has(next)) {
          visited.add(next);
          queue.push(next);
        }
      }
    }

    for (const op of conceptCreatingOps) {
      const canonical = op.title || op.idRef;
      if (!visited.has(canonical)) {
        const label = op.title || `operation ${op.index}`;
        return {
          valid: false,
          error:
            `Concept "${label}" (operation ${op.index}) would be ungrounded. ` +
            `In an empty graph, all new cognitive concepts must ` +
            `connect to each other through graph_connect operations in this batch.`,
        };
      }
    }
  } else {
    const queue: string[] = graphIsEmpty
      ? [...documentAnchors]
      : [ANCHOR, ...documentAnchors];
    for (const anchor of queue) reachable.add(anchor);
    while (queue.length > 0) {
      const node = queue.shift();
      if (node === undefined) break;
      const neighbors = adjacency.get(node);
      if (!neighbors) continue;
      for (const next of neighbors) {
        if (!reachable.has(next)) {
          reachable.add(next);
          queue.push(next);
        }
      }
    }

    // Any new cognitive concept that cannot reach an existing node or a newly
    // created canonical document artifact is ungrounded.
    for (const op of conceptCreatingOps) {
      const canonical = op.title || op.idRef;
      if (!reachable.has(canonical)) {
        const label = op.title || `operation ${op.index}`;
        return {
          valid: false,
          error:
            `Concept "${label}" (operation ${op.index}) would be ungrounded. ` +
            `Every new cognitive concept must reach existing knowledge or a newly created canonical document artifact through relationships in this batch. ` +
            `Connect it directly or transitively using an existing node title/ID or a batch back-reference such as "$0.id".`,
        };
      }
    }
  }

  return { valid: true };
}

/**
 * Check for potential duplicate concepts before batch execution
 */
async function checkForDuplicates(
  operations: Array<{ tool: string; params: Record<string, unknown> }>,
  threshold: number = DEFAULT_DUPLICATE_THRESHOLD,
): Promise<DuplicateWarning[]> {
  const warnings: DuplicateWarning[] = [];
  const store = getGraphStore();

  // Check embedding coverage - if no embeddings, skip check
  const stats = store.getEmbeddingStats();
  if (stats.withEmbedding === 0 || !EmbeddingService.isModelLoaded()) {
    return warnings; // Can't check without embeddings
  }

  for (let i = 0; i < operations.length; i++) {
    const op = operations[i];

    // Only check graph_add_concept operations
    if (op.tool !== 'graph_add_concept') continue;

    const name =
      (op.params.title as string) || (op.params.name as string) || '';
    const understanding = op.params.understanding as string;

    // Create search query from name + understanding
    const query = `${name}. ${understanding || ''}`.trim();

    try {
      const results = await store.semanticSearch(query, 5);

      // Filter to those above threshold
      const similar = results.filter((r) => r.similarity >= threshold);

      if (similar.length > 0) {
        const topMatch = similar[0];
        warnings.push({
          operationIndex: i,
          proposedName: name,
          similarNodes: similar.map((r) => ({
            id: r.node.id,
            name: r.node.title,
            similarity: Math.round(r.similarity * 1000) / 1000,
          })),
          suggestion:
            topMatch.similarity >= 0.9
              ? `Consider using graph_revise on "${topMatch.node.title}" (${topMatch.node.id}) instead of creating new concept`
              : `Similar concept exists: "${topMatch.node.title}" - consider connecting instead of duplicating`,
        });
      }
    } catch {
      // If semantic search fails, continue without warning
    }
  }

  return warnings;
}

export async function handleBatchTools(
  name: string,
  args: Record<string, unknown>,
  contextManager: ContextManager,
  mode: ToolMode = 'full',
): Promise<unknown> {
  if (name !== 'graph_batch') {
    throw new Error(`Unknown batch tool: ${name}`);
  }

  const operations = args.operations as Array<{
    tool: string;
    params: Record<string, unknown>;
  }>;
  const stopOnError = args.stopOnError !== false; // default true
  const ignoreWarnings = args.ignoreWarnings === true; // default false
  const warningThreshold =
    typeof args.warningThreshold === 'number'
      ? args.warningThreshold
      : DEFAULT_DUPLICATE_THRESHOLD;
  const commitMessage = args.commit_message as string | undefined;
  const agentName = args.agent_name as string | undefined;
  const author = typeof args.author === 'string' ? args.author : undefined;
  const requestedWorkflow =
    typeof args.workflow === 'string' ? args.workflow : undefined;

  if (
    requestedWorkflow !== undefined &&
    !batchReentryWorkflowNames.has(requestedWorkflow)
  ) {
    return {
      success: false,
      error: 'INVALID_BATCH_WORKFLOW',
      message: `workflow must be one of: ${BATCH_REENTRY_WORKFLOWS.join(', ')}`,
    };
  }

  if (operations.length > MAX_BATCH_OPERATIONS) {
    return {
      success: false,
      error: 'BATCH_OPERATION_LIMIT_EXCEEDED',
      message: `A graph_batch may contain at most ${MAX_BATCH_OPERATIONS} operations. Split independent work into separate committed encounters.`,
    };
  }

  if (
    !Array.isArray(operations) ||
    operations.some(
      (operation) =>
        !operation ||
        typeof operation !== 'object' ||
        typeof operation.tool !== 'string' ||
        !operation.params ||
        typeof operation.params !== 'object' ||
        Array.isArray(operation.params),
    )
  ) {
    return {
      success: false,
      error: 'INVALID_BATCH_OPERATIONS',
      message:
        'operations must be an array of { tool: string, params: object } entries.',
    };
  }

  // A batch owns exactly one active project and one SQLite transaction.
  // Allowing a nested handler to honor params.project would switch the
  // process-global context mid-transaction and leave writes in the second
  // project outside the rollback/commit boundary.
  const projectOverride = operations.find((operation) =>
    Reflect.has(operation.params, 'project'),
  );
  if (projectOverride) {
    return {
      success: false,
      error: 'BATCH_PROJECT_OVERRIDE_NOT_ALLOWED',
      message:
        'A graph_batch is bound to the active project. Nested operations cannot set params.project; switch projects before starting the batch.',
    };
  }

  const forbiddenOperation = operations.find(
    (operation) => !batchOperationToolNames.has(operation.tool),
  );
  if (forbiddenOperation) {
    return {
      success: false,
      error: 'BATCH_OPERATION_NOT_ALLOWED',
      message: `Tool "${forbiddenOperation.tool}" is not an atomic graph mutation primitive and cannot run inside graph_batch.`,
      allowedTools: [...BATCH_OPERATION_TOOLS],
    };
  }

  // Enforce commit_message requirement
  if (!commitMessage || commitMessage.trim() === '') {
    throw new Error(
      'commit_message is REQUIRED. Explain what changes you are making and why. ' +
        'Example: "Add concept X to capture insight Y" or "Connect A to B based on relationship Z"',
    );
  }

  // THINKING NODE RESTRICTION: the selected MCP mode is the primary
  // capability boundary. Agent attribution remains a second check for the
  // graph_add_concept escape hatch used by the synthetic Reader/CMP producer.
  for (const op of operations) {
    const isThinkingOperation =
      [
        'doc_insert_thinking',
        'doc_append_thinking',
        'doc_sign_thinking',
        'doc_get_unsigned_thinking',
        'translate_thinking',
      ].includes(op.tool) ||
      ([
        'graph_add_concept',
        'doc_create',
        'doc_to_concept',
        'node_set_trigger',
      ].includes(op.tool) &&
        isThinkingLabel(op.params.trigger)) ||
      (op.tool === 'doc_create' && isThinkingLabel(op.params.fileType));

    if (isThinkingOperation && mode !== 'synthetic_reader') {
      throw new Error(
        `FORBIDDEN in TOOL_MODE "${mode}": synthetic Reader/CMP thinking blocks can only be created, signed, or translated in TOOL_MODE "synthetic_reader". ` +
          'Use rich non-thinking typed testimony for ordinary work.',
      );
    }

    if (
      op.tool === 'graph_add_concept' &&
      isThinkingLabel(op.params.trigger) &&
      agentName !== 'synthesizer'
    ) {
      throw new Error(
        `FORBIDDEN: trigger "thinking" is reserved for the synthetic Reader/CMP synthesizer only. ` +
          `Agent "${agentName || 'unknown'}" cannot create thinking nodes. ` +
          `Use the non-thinking trigger that honestly fits the underlying cognitive state.`,
      );
    }
  }

  // Track affected node and edge IDs for commit
  const affectedNodeIds: string[] = [];
  const affectedEdgeIds: string[] = [];
  // Orphan prevention applies only to cognitive concept nodes created by this
  // batch. Document nodes are canonical artifacts and do not require semantic
  // edges merely to exist. Existing nodes that are revised, moved, or archived
  // must not be reclassified as new orphans either.
  const createdConceptNodeIds = new Set<string>();

  // PRE-VALIDATION: Prevent orphan nodes
  const orphanCheck = validateNoOrphans(operations);
  if (!orphanCheck.valid) {
    return {
      success: false,
      error: 'ORPHAN_PREVENTION',
      message: orphanCheck.error,
      hint: 'Ground every new cognitive concept in existing knowledge or a canonical document artifact. Document nodes themselves do not require semantic edges.',
    };
  }

  // Check for potential duplicates before executing
  if (!ignoreWarnings) {
    const warnings = await checkForDuplicates(operations, warningThreshold);

    if (warnings.length > 0) {
      return {
        success: false,
        warnings,
        threshold: warningThreshold,
        message: `Found ${warnings.length} potential duplicate concept(s) at threshold ${warningThreshold}. Review and either modify operations or resubmit with ignoreWarnings: true`,
        hint: `Consider using graph_revise to update existing concepts instead of creating duplicates. Adjust warningThreshold (current: ${warningThreshold}) to be more/less strict.`,
        operations: operations.map((op, i) => ({
          index: i,
          tool: op.tool,
          name: op.params.name || op.params.title || '(no name)',
          hasWarning: warnings.some((w) => w.operationIndex === i),
        })),
      };
    }
  }

  const results: unknown[] = [];
  const errors: Array<{ index: number; tool: string; error: string }> = [];
  const affectedDocRoots = new Set<string>(); // Track doc roots that need regeneration

  // Snapshot whether the graph was empty BEFORE this batch ran. The
  // pre-validation step (validateNoOrphans) explicitly allows the very first
  // node into an empty graph — the post-execution orphan sweep below must
  // Hoisted out of the try block below so the post-commit return statement
  // can read them. `commit` is set inside the transaction, `hasErrors` is
  // computed after the loop but still inside the transactional section.
  let commit: { id: string; message: string } | undefined;
  let hasErrors = false;

  // ATOMICITY: wrap the entire batch in a SQLite transaction so that a
  // mid-batch failure (op N throws, an orphan is detected, etc.) leaves
  // the graph in EXACTLY the state it was in before the batch ran.
  //
  // The paper's "Atomic Commits" framing makes this load-bearing — agents
  // need to be able to revert a failed reasoning step cleanly. The earlier
  // version had no transaction wrapping; ops 1..N-1 were persisted when op
  // N failed, and the manual cleanup only handled the special case of
  // "orphaned concept nodes". Connected nodes from prior ops survived
  // failures, so a half-finished commit could land in the graph.
  //
  // Implementation notes:
  //   * better-sqlite3's `db.transaction(fn)` requires fn to be sync.
  //     Our batch loop awaits nested tool handlers and the embedding service,
  //     so we use manual BEGIN/COMMIT/ROLLBACK instead. The server-level
  //     CallTool queue serializes every external request—including reads and
  //     project switches—while this process-global transaction is open.
  //   * Early-return cases (mid-loop error with stopOnError, orphan-sweep
  //     failure) are signalled via the BatchEarlyExit sentinel so the
  //     catch block can ROLLBACK before returning the payload.
  //   * Doc auto-regeneration writes files (not the DB), so it happens
  //     AFTER commit. Score-hint computation is read-only, also after.
  const txnDb = sqlite.getDb();
  txnDb.exec('BEGIN');
  let txnCommitted = false;

  try {
    for (let i = 0; i < operations.length; i++) {
      const op = operations[i];

      try {
        // Resolve any variable references in params
        const resolvedParams = resolveReferences(op.params, results);

        // The batch owns agent attribution. Pass it into the nested concept
        // call as well so the synthesizer-only `thinking` path can satisfy
        // the same authorization check during execution.
        if (
          op.tool === 'graph_add_concept' &&
          agentName &&
          resolvedParams.agent_name === undefined
        ) {
          resolvedParams.agent_name = agentName;
        }

        // Pre-execution check: doc_create with parentId but no afterId
        if (
          op.tool === 'doc_create' &&
          resolvedParams.parentId &&
          !resolvedParams.afterId
        ) {
          const store = getGraphStore();
          const parentId = resolvedParams.parentId as string;
          const existingSiblings = store.getChildren(parentId);

          if (existingSiblings.length > 0) {
            const siblingNames = existingSiblings
              .map((s) => s.title)
              .join(', ');
            throw new Error(
              `doc_create requires afterId when parent already has children. ` +
                `Parent "${parentId}" has siblings: [${siblingNames}]. ` +
                'Use afterId to append after the current tail; use doc_move inside graph_batch to insert or reorder.',
            );
          }
        }

        // Execute the tool
        const result = await handleToolCall(
          op.tool,
          resolvedParams,
          contextManager,
          mode,
          true,
        );

        // Tool handlers may report validation/runtime failures as structured
        // payloads instead of throwing. Promote only an explicit
        // `success: false` to the same failure path as an exception so the
        // transaction cannot commit a partial batch. Informational payloads
        // and warnings without that explicit flag remain successful results.
        const explicitFailure = getExplicitToolFailure(result);
        if (explicitFailure) {
          throw new Error(explicitFailure);
        }

        if (
          typeof result !== 'object' ||
          result === null ||
          Array.isArray(result)
        ) {
          throw new Error(
            `BATCH_EFFECTS_MISSING: ${op.tool} returned no structured mutation footprint`,
          );
        }

        const resultObj = result as Record<string, unknown>;
        const effects = collectOperationEffects(resultObj);
        if (effects.nodeIds.length === 0 && effects.edgeIds.length === 0) {
          throw new Error(
            `BATCH_EFFECTS_MISSING: ${op.tool} reported success without affected node or edge IDs`,
          );
        }

        // Normalize every successful operation result. Besides making the
        // provenance contract inspectable to callers, this keeps future result
        // naming changes from silently dropping a mutation from the outer
        // commit or from the next understanding pass.
        resultObj.affectedNodeIds = effects.nodeIds;
        resultObj.affectedEdgeIds = effects.edgeIds;
        results.push(resultObj);
        affectedNodeIds.push(...effects.nodeIds);
        affectedEdgeIds.push(...effects.edgeIds);

        if (
          NODE_CREATING_TOOLS.includes(op.tool) &&
          !DOCUMENT_CREATING_TOOLS.has(op.tool)
        ) {
          const createdId = [
            resultObj.id,
            resultObj.nodeId,
            resultObj.newId,
            resultObj.answerId,
          ].find(
            (id): id is string => typeof id === 'string' && id.startsWith('n_'),
          );
          if (createdId) createdConceptNodeIds.add(createdId);
        }
        if (Array.isArray(resultObj.affectedRootIds)) {
          for (const rootId of resultObj.affectedRootIds) {
            if (typeof rootId === 'string') affectedDocRoots.add(rootId);
          }
        }

        // Generate embedding immediately for node-creating tools
        // This ensures duplicate detection works within the same batch
        if (
          NODE_CREATING_TOOLS.includes(op.tool) &&
          EmbeddingService.isModelLoaded()
        ) {
          const nodeId =
            (result as Record<string, unknown>).id ||
            (result as Record<string, unknown>).newId;
          if (nodeId && typeof nodeId === 'string') {
            try {
              const store = getGraphStore();
              await store.generateAndStoreEmbedding(nodeId);
            } catch {
              // Non-fatal: embedding generation can fail without breaking the batch
            }
          }
        }

        // Post-creation verification: doc_create nodes must trace to root
        // This catches forward references that bypassed pre-validation
        if (DOCUMENT_CREATING_TOOLS.has(op.tool)) {
          const resultObj = result as Record<string, unknown>;
          const nodeId = resultObj.id as string;
          const isRoot = resultObj.isDocRoot as boolean;
          if (nodeId && !isRoot) {
            const store = getGraphStore();
            const docPath = store.getDocumentPath(nodeId);
            if (!docPath) {
              throw new Error(
                `Created document node "${nodeId}" does not trace to a document root. ` +
                  'This may indicate a broken forward reference or missing parentId.',
              );
            }
          }
        }

        // Track affected document roots for auto-regeneration
        if (DOC_MUTATION_TOOLS.includes(op.tool)) {
          const resultObj = result as Record<string, unknown>;
          const nodeId = (resultObj.id || resultObj.nodeId) as string;
          if (nodeId) {
            const store = getGraphStore();
            const docPath = store.getDocumentPath(nodeId);
            if (docPath && docPath.length > 0 && docPath[0].isDocRoot) {
              affectedDocRoots.add(docPath[0].id);
            }
          }
        }
      } catch (error) {
        // Don't double-wrap our own sentinel
        if (error instanceof BatchEarlyExit) throw error;

        const errorMsg = error instanceof Error ? error.message : String(error);
        errors.push({ index: i, tool: op.tool, error: errorMsg });

        if (stopOnError) {
          // The whole batch is in a SQLite transaction, so the outer catch
          // will ROLLBACK and undo every prior op. No need for the manual
          // orphan cleanup that the pre-transaction version had to do.
          throw new BatchEarlyExit({
            success: false,
            completed: i,
            total: operations.length,
            results,
            errors,
            message: `Batch stopped at operation ${i} (${op.tool}): ${errorMsg}. Entire batch rolled back.`,
          });
        }

        // Push null result for failed operation
        results.push({ success: false, error: errorMsg });
      }
    }

    hasErrors = errors.length > 0;

    // `stopOnError: false` controls error collection, never atomicity. The
    // successful operations above are still provisional and must not land as
    // a partial commit when any sibling operation failed.
    if (hasErrors) {
      throw new BatchEarlyExit({
        success: false,
        completed: operations.length,
        total: operations.length,
        results,
        errors,
        message: `Batch attempted all ${operations.length} operation(s) and found ${errors.length} error(s). Entire batch rolled back.`,
      });
    }

    // ORPHAN PREVENTION: detect cognitive concepts created in this batch that
    // have no edges. Document artifacts are intentionally excluded.
    //
    // Inside the transaction. If we find orphans, throw BatchEarlyExit so
    // the catch block ROLLBACKs the entire batch (no half-state).
    const sweepStore = getGraphStore();
    const sweepEdges = sweepStore.getAll().edges;
    const sweepConnectedIds = new Set<string>();
    for (const edge of sweepEdges) {
      sweepConnectedIds.add(edge.fromId);
      sweepConnectedIds.add(edge.toId);
    }

    const orphanedNodes: string[] = [];
    for (const nodeId of createdConceptNodeIds) {
      const node = sweepStore.getNode(nodeId);
      if (!node) continue;
      if (!sweepConnectedIds.has(nodeId)) {
        orphanedNodes.push(nodeId);
      }
    }

    if (orphanedNodes.length > 0) {
      const orphanNames = orphanedNodes
        .map((id) => {
          const r = results.find(
            (r: unknown) => (r as { id?: string })?.id === id,
          );
          return (
            (r as { title?: string; name?: string })?.title ||
            (r as { name?: string })?.name ||
            id
          );
        })
        .join(', ');
      throw new BatchEarlyExit({
        success: false,
        completed: operations.length,
        total: operations.length,
        results,
        errors: [
          {
            index: -1,
            tool: 'orphan_check',
            error: `${orphanedNodes.length} cognitive concept node(s) would be ungrounded (no relationships): ${orphanNames}. The entire batch has been rolled back. Link every new concept to existing knowledge, another grounded concept, or a canonical document artifact.`,
          },
        ],
        message: `Batch rolled back: ${orphanedNodes.length} ungrounded cognitive concept node(s) detected. No changes were persisted.`,
        hint: 'Every new cognitive concept needs at least one grounding relationship. Document nodes do not need semantic edges.',
      });
    }

    // Create commit record if message provided and batch had changes.
    // Inside the transaction so a rollback also rolls back the commit row.
    if (
      commitMessage &&
      (affectedNodeIds.length > 0 || affectedEdgeIds.length > 0)
    ) {
      const uniqueNodeIds = [...new Set(affectedNodeIds)];
      const uniqueEdgeIds = [...new Set(affectedEdgeIds)];

      const createdCommit = createCommit(
        commitMessage,
        uniqueNodeIds,
        uniqueEdgeIds,
        agentName,
        undefined,
        author,
      );
      commit = { id: createdCommit.id, message: createdCommit.message };
    }

    // Everything inside the transaction succeeded. COMMIT.
    txnDb.exec('COMMIT');
    txnCommitted = true;
  } catch (err) {
    // Roll back any uncommitted work. Either a real error from a sub-tool,
    // or a BatchEarlyExit sentinel carrying a structured payload.
    if (!txnCommitted) {
      try {
        txnDb.exec('ROLLBACK');
      } catch {
        // Swallow — if rollback itself fails the connection is wedged
        // and there's nothing useful we can do here.
      }
    }
    if (err instanceof BatchEarlyExit) {
      // Intentional early exit — return its payload as the tool result.
      return err.payload;
    }
    throw err;
  }

  // POST-COMMIT: doc auto-regeneration writes files (not the DB), and
  // score-hint computation is read-only. Both are safe to do after commit.
  const regeneratedDocs: Array<{ rootId: string; outputPath: string }> = [];
  if (affectedDocRoots.size > 0) {
    const projectId = contextManager.getCurrentProjectId();
    const projectDir = contextManager.getProjectDir();
    const outputDir = path.join(projectDir, projectId, 'generated');
    const writer = createDocumentWriter(outputDir);

    for (const rootId of affectedDocRoots) {
      try {
        const result = writer.writeDocument(rootId);
        if (result) {
          regeneratedDocs.push({ rootId, outputPath: result.outputPath });
        }
      } catch {
        // Non-fatal: regeneration failure doesn't break the batch
      }
    }
  }

  // Synthetic Reader/CMP mode may report health for its reserved training
  // artifacts. Ordinary workflows must not be nudged to create or curate
  // `thinking` nodes merely because a project already contains them.
  const store = getGraphStore();
  const { nodes: allNodes, edges: allEdges } = store.getAll();
  const thinkingNodes = allNodes.filter((n) => n.trigger === 'thinking');
  const artifactCognitionBalance = assessArtifactCognitionBalance(
    allNodes,
    allEdges,
  );
  const affectedNodeOrder = [...new Set(affectedNodeIds)];
  const visibleNodeById = new Map(allNodes.map((node) => [node.id, node]));
  const visibleAffectedNodeIds = affectedNodeOrder.filter((id) =>
    visibleNodeById.has(id),
  );

  // Archiving or superseding can make the directly affected node unavailable
  // to an ordinary re-entry packet. In that case, re-open any still-visible
  // endpoints of its incident relations so the absence itself can alter the
  // next pass rather than making the mutation disappear from attention.
  const incidentEdges = sqlite.getDb().prepare(
    `SELECT from_id AS fromId, to_id AS toId
       FROM edges
      WHERE active = 1 AND (from_id = ? OR to_id = ?)`,
  );
  const visibleNeighborIds: string[] = [];
  for (const nodeId of affectedNodeOrder) {
    if (visibleNodeById.has(nodeId)) continue;
    const rows = incidentEdges.all(nodeId, nodeId) as Array<{
      fromId: string;
      toId: string;
    }>;
    for (const row of rows) {
      const otherId = row.fromId === nodeId ? row.toId : row.fromId;
      if (visibleNodeById.has(otherId)) visibleNeighborIds.push(otherId);
    }
  }

  const reentryNodeOrder = [
    ...visibleAffectedNodeIds,
    ...visibleNeighborIds,
  ].filter((id, index, ids) => ids.indexOf(id) === index);
  const reentryNodes = reentryNodeOrder
    .map((id) => visibleNodeById.get(id))
    .filter((node): node is (typeof allNodes)[number] => Boolean(node));
  const reentryFocusNodeIds = [
    ...reentryNodes.filter((node) => !node.isDocRoot && !node.level),
    ...reentryNodes.filter((node) => node.isDocRoot || Boolean(node.level)),
  ]
    .map((node) => node.id)
    .slice(0, 12);
  const reentryWorkflow: BatchReentryWorkflow = requestedWorkflow
    ? (requestedWorkflow as BatchReentryWorkflow)
    : mode === 'full'
      ? 'general'
      : mode === 'synthetic_reader'
        ? 'reading'
        : mode;

  let scoreHint = '';

  // This global shape notice is descriptive and deliberately conservative. It
  // never requires a concept per document or asks an agent to manufacture
  // retrospective testimony merely to make a warning disappear.

  // Only the dedicated producer mode owns global thinking-block health.
  if (mode === 'synthetic_reader' && thinkingNodes.length > 0) {
    const nonThinkingIds = new Set(
      allNodes.filter((n) => n.trigger !== 'thinking').map((n) => n.id),
    );
    let orphanCount = 0;
    for (const t of thinkingNodes) {
      const conceptEdges = allEdges.filter(
        (e) =>
          e.fromId === t.id && e.type !== 'next' && nonThinkingIds.has(e.toId),
      );
      if (conceptEdges.length === 0) orphanCount++;
    }

    if (orphanCount > 0) {
      scoreHint += `\n\n⚠️ ${orphanCount} synthetic thinking block(s) have no source/provenance edges. Reconstruct only from underlying graph evidence and attach the exact nodes that support each block before using it in a corpus.`;
    }
  }

  return {
    success: !hasErrors,
    completed: operations.length,
    total: operations.length,
    results,
    errors: hasErrors ? errors : undefined,
    commit,
    regeneratedDocuments:
      regeneratedDocs.length > 0 ? regeneratedDocs : undefined,
    artifactCognitionBalance:
      artifactCognitionBalance && artifactCognitionBalance.advisories.length > 0
        ? artifactCognitionBalance
        : undefined,
    reentry:
      affectedNodeOrder.length > 0 || affectedEdgeIds.length > 0
        ? {
            focusNodeIds: reentryFocusNodeIds,
            omittedAffectedNodes: Math.max(
              0,
              reentryNodes.length - reentryFocusNodeIds.length,
            ),
            suggestedCall: {
              tool: 'graph_understand',
              arguments: {
                query:
                  'Continue the current task after this encounter. What changed, conflicts, connects, or becomes newly possible?',
                workflow: reentryWorkflow,
                focusNodeIds: reentryFocusNodeIds,
              },
            },
            guidance:
              'Use after a meaningful encounter so the changed nodes and their incident relations become input to the next understanding pass. Routine mutations do not require a note or forced novelty.',
          }
        : undefined,
    message: hasErrors
      ? `Batch completed with ${errors.length} error(s)`
      : commit
        ? `Batch completed: ${operations.length} operation(s). Commit: "${commit.message}"`
        : regeneratedDocs.length > 0
          ? `Batch completed: ${operations.length} operation(s) executed. Regenerated ${regeneratedDocs.length} document(s).`
          : `Batch completed: ${operations.length} operation(s) executed`,
    hint: `Results array matches operations order. Use result indices to find created IDs.${scoreHint}`,
  };
}
