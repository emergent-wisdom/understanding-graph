import path from 'node:path';
import {
  createCommit,
  createDocumentWriter,
  getGraphStore,
  sqlite,
} from '@emergent-wisdom/understanding-graph-core';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ContextManager } from '../context-manager.js';
import { handleToolCall } from './index.js';

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

// Tools that create nodes and need immediate embedding generation
const NODE_CREATING_TOOLS = [
  'graph_add_concept',
  'graph_question',
  'graph_serendipity',
  'graph_supersede',
  'graph_answer',
  'doc_create',
];

// Tools that mutate documents and should trigger regeneration
const DOC_MUTATION_TOOLS = [
  'doc_create',
  'doc_revise',
  'doc_merge',
  'doc_split',
  'doc_to_concept',
];

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
the metacognitive log of how the graph evolved.

Use for:
- Document splitting (create children + clear parent)
- Creating hierarchies (root + multiple children)
- Bulk concept/connection creation
- Any multi-step modification that should land all-or-nothing

PARAMETER NAMES (these are strict — wrong names fail silently):
  graph_add_concept: { title, trigger, understanding, why }  — NOT name/body/text
  graph_connect:     { from, to, type, why }                 — NOT source/target/edgeType
  graph_revise:      { node, understanding, before, after, pivot, why }
  doc_create:        { title, content, fileType, isDocRoot, parentId, afterId, level }

Supports variable references: use "$N.id" to reference result N's id (0-indexed, counts ALL operations).
Example: { from: "$0.id", to: "$1.id" } connects first operation's result to second's.`,
    inputSchema: {
      type: 'object',
      properties: {
        operations: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              tool: {
                type: 'string',
                description:
                  'Tool name (e.g., doc_create, doc_revise, graph_connect, graph_add_concept)',
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
            'If true (default), stop on first error. If false, continue and collect errors.',
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
        allowUnorderedDocs: {
          type: 'boolean',
          description:
            'If true, allow doc_create without afterId when siblings exist. Default false (throws error to enforce explicit ordering).',
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
 * PRE-VALIDATION: every new concept created in this batch must be reachable
 * (transitively) to a node that already exists in the graph.
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
 * Algorithm: compute the set of all nodes reachable to/from the existing
 * graph via the union of new connect operations, then any new concept not
 * in that reachable set is orphaned.
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
  //   graph_question        -> params.question
  //   graph_supersede       -> params.new_name (the replacement concept's name)
  //   graph_serendipity     -> params.title
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
    return (op.params.title as string) || (op.params.name as string) || '';
  };

  // Collect all node-creating ops and a per-op identifier set.
  // Each new node has at least two valid handles: its title (if present) and
  // its `$N.id` back-ref. We canonicalize on the title, but accept either.
  const nodeCreatingOps: Array<{
    index: number;
    title: string;
    idRef: string;
  }> = [];
  for (let i = 0; i < operations.length; i++) {
    const op = operations[i];
    if (NODE_CREATING_TOOLS.includes(op.tool)) {
      nodeCreatingOps.push({
        index: i,
        title: conceptToolName(op),
        idRef: `$${i}.id`,
      });
    }
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
    // All node-creating ops (including doc_create) are now in aliasOf,
    // so $N.id refs to them are resolved above. Unknown handles are
    // treated conservatively as unrecognized.
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
  // doc_create with parentId creates an implicit `contains` edge from parent
  // to the new doc node. Child doc nodes are anchored through their parent.
  // Root doc nodes (no parentId) need an explicit graph_connect.
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

  // BFS from ANCHOR through the adjacency list.
  // For empty graphs, there is no ANCHOR to reach — instead we check that
  // all new nodes form a single connected component (every node must have
  // at least one edge, and all must be mutually reachable).
  const graphIsEmpty = existingNodes.length === 0;

  if (graphIsEmpty) {
    // Every new node must appear in at least one edge.
    // BFS from the first connected new node to verify full connectivity.
    const firstConnected = nodeCreatingOps.find((op) => {
      const key = op.title || op.idRef;
      return adjacency.has(key);
    });

    if (!firstConnected) {
      // No new node has any edge at all.
      const label =
        nodeCreatingOps[0]?.title || `operation ${nodeCreatingOps[0]?.index}`;
      return {
        valid: false,
        error:
          `Concept "${label}" (operation ${nodeCreatingOps[0]?.index}) would be orphaned. ` +
          `Every node must have at least one edge — even in an empty graph. ` +
          `Add at least two nodes with a graph_connect between them.`,
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

    for (const op of nodeCreatingOps) {
      const canonical = op.title || op.idRef;
      if (!visited.has(canonical)) {
        const label = op.title || `operation ${op.index}`;
        return {
          valid: false,
          error:
            `Concept "${label}" (operation ${op.index}) would be orphaned. ` +
            `Every node must have at least one edge. In an empty graph, all new nodes must ` +
            `connect to each other through graph_connect operations in this batch.`,
        };
      }
    }
  } else {
    const queue: string[] = [ANCHOR];
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

    // Any new node whose canonical key isn't in `reachable` is orphaned.
    for (const op of nodeCreatingOps) {
      const canonical = op.title || op.idRef;
      if (!reachable.has(canonical)) {
        const label = op.title || `operation ${op.index}`;
        return {
          valid: false,
          error:
            `Concept "${label}" (operation ${op.index}) would be orphaned. ` +
            `Every new concept must reach an EXISTING node in the graph through at least one chain of graph_connect operations in this batch. ` +
            `Add a graph_connect that links this concept (directly or via another new concept) to an existing node — ` +
            `you can use the existing node's title (e.g. to: "Existing Concept Title"), its ID (e.g. to: "n_abc123"), or a back-ref to an earlier op in this batch (e.g. to: "$0.id").`,
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
  if (stats.withEmbedding === 0) {
    return warnings; // Can't check without embeddings
  }

  for (let i = 0; i < operations.length; i++) {
    const op = operations[i];

    // Only check graph_add_concept operations
    if (op.tool !== 'graph_add_concept') continue;

    const name = op.params.name as string;
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
  const allowUnorderedDocs = args.allowUnorderedDocs === true; // default false
  const warningThreshold =
    typeof args.warningThreshold === 'number'
      ? args.warningThreshold
      : DEFAULT_DUPLICATE_THRESHOLD;
  const commitMessage = args.commit_message as string | undefined;
  const agentName = args.agent_name as string | undefined;

  // Enforce commit_message requirement
  if (!commitMessage || commitMessage.trim() === '') {
    throw new Error(
      'commit_message is REQUIRED. Explain what changes you are making and why. ' +
        'Example: "Add concept X to capture insight Y" or "Connect A to B based on relationship Z"',
    );
  }

  // THINKING NODE RESTRICTION: Only synthesizer can create thinking nodes
  // These are reserved for synthetic training data with proper mantra
  for (const op of operations) {
    if (
      op.tool === 'graph_add_concept' &&
      op.params.trigger === 'thinking' &&
      agentName !== 'synthesizer'
    ) {
      throw new Error(
        `FORBIDDEN: trigger "thinking" is reserved for the synthesizer agent only. ` +
          `Agent "${agentName || 'unknown'}" cannot create thinking nodes. ` +
          `Use a different trigger (e.g., analysis, question, tension, insight).`,
      );
    }
  }

  // Track affected node and edge IDs for commit
  const affectedNodeIds: string[] = [];
  const affectedEdgeIds: string[] = [];

  // PRE-VALIDATION: Prevent orphan nodes
  const orphanCheck = validateNoOrphans(operations);
  if (!orphanCheck.valid) {
    return {
      success: false,
      error: 'ORPHAN_PREVENTION',
      message: orphanCheck.error,
      hint: 'Every concept node must connect to something that already exists. Use graph_connect with an existing node ID.',
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
  //     Our batch loop awaits the embedding service, so we use manual
  //     BEGIN/COMMIT/ROLLBACK instead. This is safe because the MCP server
  //     handles requests serially against a single per-project connection.
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

        // Pre-execution check: doc_create with parentId but no afterId
        if (
          op.tool === 'doc_create' &&
          resolvedParams.parentId &&
          !resolvedParams.afterId &&
          !allowUnorderedDocs
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
                `Use afterId to specify position, or set allowUnorderedDocs: true to allow arbitrary ordering.`,
            );
          }
        }

        // Execute the tool
        const result = await handleToolCall(
          op.tool,
          resolvedParams,
          contextManager,
        );
        results.push(result);

        // Track affected node/edge IDs for commit
        const resultObj = result as Record<string, unknown>;
        if (resultObj.id && typeof resultObj.id === 'string') {
          if (resultObj.id.startsWith('e_')) {
            affectedEdgeIds.push(resultObj.id);
          } else if (resultObj.id.startsWith('n_')) {
            affectedNodeIds.push(resultObj.id);
          }
        }
        // Some tools return nodeId instead of id
        if (resultObj.nodeId && typeof resultObj.nodeId === 'string') {
          affectedNodeIds.push(resultObj.nodeId);
        }
        // graph_revise returns the updated node id
        if (resultObj.newId && typeof resultObj.newId === 'string') {
          affectedNodeIds.push(resultObj.newId);
        }

        // Generate embedding immediately for node-creating tools
        // This ensures duplicate detection works within the same batch
        if (NODE_CREATING_TOOLS.includes(op.tool)) {
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
        if (op.tool === 'doc_create') {
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

    // ORPHAN PREVENTION: detect any concept nodes created in this batch that
    // have no edges. Every node must have at least one edge — no exceptions.
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
    for (const nodeId of affectedNodeIds) {
      if (!nodeId.startsWith('n_')) continue;
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
          return (r as { name?: string })?.name || id;
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
            error: `${orphanedNodes.length} concept node(s) would be orphaned (no edges): ${orphanNames}. The entire batch has been rolled back. Add graph_connect operations that link every new concept to an existing or just-created node.`,
          },
        ],
        message: `Batch rolled back: ${orphanedNodes.length} orphaned concept node(s) detected. No changes were persisted.`,
        hint: 'Every concept node MUST have at least one edge. Check that graph_connect operations exist for every new concept.',
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

  // Calculate quick score metrics for thinking nodes - remind model of true goal
  const store = getGraphStore();
  const allNodes = store.getAll().nodes;
  const allEdges = store.getAll().edges;
  const thinkingNodes = allNodes.filter((n) => n.trigger === 'thinking');

  // Check if batch created document nodes without any concept nodes.
  // The understanding process requires that artifacts (doc nodes) are entangled
  // with reasoning (concept nodes). A batch of pure doc_create ops with no
  // accompanying concept node means the agent's reasoning is lost.
  const hasDocCreates = operations.some(
    (op) => op.tool === 'doc_create' && op.params.content,
  );
  const CONCEPT_TOOLS = [
    'graph_add_concept',
    'graph_question',
    'graph_supersede',
    'graph_answer',
  ];
  const batchCreatedConceptNode = operations.some((op) =>
    CONCEPT_TOOLS.includes(op.tool),
  );

  let scoreHint = '';

  // Warn if doc_create (with content) was used but no concept nodes exist in the batch
  if (hasDocCreates && !batchCreatedConceptNode) {
    scoreHint = `\n\n⚠️ MISSING CONCEPT NODES: You created document nodes but NO concept nodes in this batch.
Your reasoning process is LOST. Every doc_create with content should be accompanied by a concept node
explaining WHY — a decision, tension, surprise, or experiment result. Add one:
  graph_add_concept({ title: "...", trigger: "decision", understanding: "What I decided and why...", why: "..." })
Then connect the doc to it with an 'expresses' edge.`;
  }

  // Also check global thinking node health
  if (thinkingNodes.length > 0) {
    const nonThinkingIds = new Set(
      allNodes.filter((n) => n.trigger !== 'thinking').map((n) => n.id),
    );
    let orphanCount = 0;
    let totalConceptEdges = 0;
    for (const t of thinkingNodes) {
      const conceptEdges = allEdges.filter(
        (e) =>
          e.fromId === t.id && e.type !== 'next' && nonThinkingIds.has(e.toId),
      );
      if (conceptEdges.length === 0) orphanCount++;
      totalConceptEdges += conceptEdges.length;
    }
    const avgEdges = totalConceptEdges / thinkingNodes.length;

    if (orphanCount > 0) {
      scoreHint += `\n\n⚠️ ${orphanCount} thinking node(s) have NO concept edges. Capture the invisible understanding — what beliefs shifted?`;
    } else if (avgEdges < 2) {
      scoreHint += `\n\n📊 ${avgEdges.toFixed(1)} avg edges per thinking (target: 2-3). Externalize more of the cognitive journey.`;
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
