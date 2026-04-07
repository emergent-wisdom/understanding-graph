import path from 'node:path';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import {
  createCommit,
  createDocumentWriter,
  getGraphStore,
} from '@understanding-graph/core';
import type { ContextManager } from '../context-manager.js';
import { handleToolCall } from './index.js';

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
    description: `Execute multiple graph operations in a single call.

Use for:
- Document splitting (create children + clear parent)
- Creating hierarchies (root + multiple children)
- Bulk concept/connection creation
- Any multi-step modifications

EDGE QUALITY REMINDER: When using graph_connect, edges should aid cognition — help future agents think better. Don't create edges for bureaucracy or "completeness". Each edge should answer: "When reasoning about X, why should I consider Y?"

Supports variable references: use "$N.field" to reference result N's field.
Example: { parentId: "$0.id" } uses the id from the first operation's result.`,
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
 * PRE-VALIDATION: Every new concept must connect to an EXISTING node.
 * Exception: First node in an empty graph is allowed.
 *
 * This prevents orphan nodes from being created in the first place.
 */
function validateNoOrphans(
  operations: Array<{ tool: string; params: Record<string, unknown> }>,
): { valid: boolean; error?: string } {
  const store = getGraphStore();
  const { nodes: existingNodes } = store.getAll();
  const existingNodeIds = new Set(existingNodes.map((n) => n.id));

  // Find all node-creating operations and their indices
  const nodeCreatingOps: Array<{ index: number; name: string }> = [];
  for (let i = 0; i < operations.length; i++) {
    const op = operations[i];
    if (NODE_CREATING_TOOLS.includes(op.tool) && op.tool !== 'doc_create') {
      nodeCreatingOps.push({
        index: i,
        name: (op.params.name as string) || `operation ${i}`,
      });
    }
  }

  // If graph is empty and we're creating the first node, allow it
  if (existingNodes.length === 0 && nodeCreatingOps.length > 0) {
    // Allow first node, but subsequent nodes in this batch must still connect
    // to something (either existing or the first node via $0.id reference)
    return { valid: true };
  }

  // For each node-creating operation, check if there's a graph_connect
  // that connects it to an EXISTING node (not just another new node)
  for (const nodeOp of nodeCreatingOps) {
    const ref = `$${nodeOp.index}.id`;
    let connectsToExisting = false;

    for (const op of operations) {
      if (op.tool !== 'graph_connect') continue;

      const from = (op.params.from || op.params.fromId) as string;
      const to = (op.params.to || op.params.toId) as string;

      // Check if this connect references our new node
      const referencesNewNode = from === ref || to === ref;
      if (!referencesNewNode) continue;

      // Check if the OTHER end connects to an existing node
      const otherEnd = from === ref ? to : from;

      // If otherEnd is an existing node ID, we're good
      if (existingNodeIds.has(otherEnd)) {
        connectsToExisting = true;
        break;
      }

      // If otherEnd is a reference to an earlier operation that creates a doc node, that's ok
      // (doc nodes are structural and allowed)
      if (otherEnd.startsWith('$')) {
        const match = otherEnd.match(/^\$(\d+)\.(\w+)$/);
        if (match) {
          const refIndex = Number.parseInt(match[1], 10);
          if (refIndex < operations.length) {
            const refOp = operations[refIndex];
            // Document nodes are structural anchors, connecting to them is valid
            if (refOp.tool === 'doc_create') {
              connectsToExisting = true;
              break;
            }
          }
        }
      }
    }

    if (!connectsToExisting) {
      return {
        valid: false,
        error:
          `Concept "${nodeOp.name}" (operation ${nodeOp.index}) would be orphaned. ` +
          `Every new concept MUST connect to an EXISTING node in the graph. ` +
          `Add a graph_connect operation that links this concept to an existing node ID.`,
      };
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
          const siblingNames = existingSiblings.map((s) => s.title).join(', ');
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
      const errorMsg = error instanceof Error ? error.message : String(error);
      errors.push({ index: i, tool: op.tool, error: errorMsg });

      if (stopOnError) {
        // CRITICAL: Clean up orphaned nodes before returning
        // Otherwise nodes created before the error become orphans
        const graphStore = getGraphStore();
        const { edges: currentEdges } = graphStore.getAll();
        const connectedNodeIds = new Set<string>();
        for (const edge of currentEdges) {
          connectedNodeIds.add(edge.fromId);
          connectedNodeIds.add(edge.toId);
        }

        const orphanedNodes: string[] = [];
        for (const nodeId of affectedNodeIds) {
          if (!nodeId.startsWith('n_')) continue;
          const node = graphStore.getNode(nodeId);
          if (!node) continue;
          if (node.fileType || node.isDocRoot) continue;
          if (!connectedNodeIds.has(nodeId)) {
            orphanedNodes.push(nodeId);
            graphStore.archiveNode(nodeId);
          }
        }

        const orphanMsg =
          orphanedNodes.length > 0
            ? ` Rolled back ${orphanedNodes.length} orphaned node(s).`
            : '';

        return {
          success: false,
          completed: i,
          total: operations.length,
          results,
          errors,
          message: `Batch stopped at operation ${i} (${op.tool}): ${errorMsg}${orphanMsg}`,
        };
      }

      // Push null result for failed operation
      results.push({ success: false, error: errorMsg });
    }
  }

  const hasErrors = errors.length > 0;

  // Auto-regenerate affected document roots
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

  // Check if batch created document nodes without any thinking nodes
  const hasDocCreates = operations.some((op) => op.tool === 'doc_create');
  const batchCreatedThinkingNode = results.some((r) => {
    const result = r as Record<string, unknown>;
    return result?.trigger === 'thinking';
  });

  let scoreHint = '';

  // Warn if doc_create was used but no thinking nodes were created in this batch
  if (hasDocCreates && !batchCreatedThinkingNode) {
    scoreHint = `\n\n⚠️ MISSING THINKING NODES: You created document nodes but NO thinking nodes.
Your reasoning process is LOST. Interleave thinking nodes to capture understanding:
  graph_add_concept({ name: "...", trigger: "thinking", understanding: "What I noticed/learned..." })
Or use source_commit with type: "thinking" nodes.`;
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

  // ORPHAN PREVENTION: Delete any concept nodes created in this batch that have no edges
  const orphanedNodes: string[] = [];
  const { edges: currentEdges } = store.getAll();
  const connectedNodeIds = new Set<string>();
  for (const edge of currentEdges) {
    connectedNodeIds.add(edge.fromId);
    connectedNodeIds.add(edge.toId);
  }

  for (const nodeId of affectedNodeIds) {
    if (!nodeId.startsWith('n_')) continue;
    const node = store.getNode(nodeId);
    if (!node) continue;
    // Skip document nodes (they have structural edges managed elsewhere)
    if (node.fileType || node.isDocRoot) continue;
    // Check if node has any edges
    if (!connectedNodeIds.has(nodeId)) {
      orphanedNodes.push(nodeId);
      // Delete the orphan
      store.archiveNode(nodeId);
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
    return {
      success: false,
      completed: operations.length,
      total: operations.length,
      results,
      errors: [
        {
          index: -1,
          tool: 'orphan_check',
          error: `${orphanedNodes.length} concept node(s) were orphaned (no edges): ${orphanNames}. They have been deleted. Ensure graph_connect operations succeed for all new concepts.`,
        },
      ],
      message: `Batch failed: ${orphanedNodes.length} orphaned concept node(s) deleted. Add graph_connect calls with valid 'why' field.`,
      hint: 'Every concept node MUST have at least one edge. Check that graph_connect calls include required fields (from, to, why).',
    };
  }

  // Create commit record if message provided and batch had changes
  let commit: { id: string; message: string } | undefined;
  if (
    commitMessage &&
    (affectedNodeIds.length > 0 || affectedEdgeIds.length > 0)
  ) {
    // Deduplicate IDs
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
