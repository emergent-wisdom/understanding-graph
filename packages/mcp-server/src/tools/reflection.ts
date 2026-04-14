import {
  AnalysisService,
  ContextService,
  type GraphStore,
  getGraphStore,
  isProjectLoaded,
  lookupExternalNode,
  queryEdges,
  queryNodes,
  sqlite,
} from '@emergent-wisdom/understanding-graph-core';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ContextManager } from '../context-manager.js';

/**
 * Helper to check if we should read from another project.
 * Returns target project info - use sqlite functions for cross-project reads.
 */
function getTargetProject(
  projectId: string | undefined,
  contextManager: ContextManager,
): { isExternal: boolean; projectId: string; available: boolean } {
  const currentProject = contextManager.getCurrentProjectId();
  const targetProject = projectId || currentProject;

  // If same project or no project specified, use current
  if (targetProject === currentProject) {
    return { isExternal: false, projectId: currentProject, available: true };
  }

  // Check if external project is loaded
  const available = isProjectLoaded(targetProject);
  return { isExternal: true, projectId: targetProject, available };
}

/**
 * Helper to get store for current project operations.
 * For cross-project reads, use sqlite functions directly instead.
 */
function getStoreForRead(
  projectId: string | undefined,
  contextManager: ContextManager,
): { store: GraphStore; isExternal: boolean; projectId: string } {
  const {
    isExternal,
    projectId: targetProject,
    available,
  } = getTargetProject(projectId, contextManager);

  // For external projects, we still return the current store
  // but tools should check isExternal and use sqlite functions directly
  if (isExternal && !available) {
    // Fall back to current if external not available
    return {
      store: getGraphStore(),
      isExternal: false,
      projectId: contextManager.getCurrentProjectId(),
    };
  }

  return { store: getGraphStore(), isExternal, projectId: targetProject };
}

const {
  generateXmlContext,
  generateRegionContext,
  generateSkeletonContext,
  findPath,
} = ContextService;

// Valid trigger types for reference
const _TRIGGER_TYPES = [
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
  'library',
  'prediction',
  'evaluation',
  'anchor', // deprecated but may exist
  'synthesis', // deprecated but may exist
] as const;

export const reflectionTools: Tool[] = [
  {
    name: 'node_get_revisions',
    description:
      'Get the revision history for a node. Shows how understanding evolved over time, who changed what, and why.',
    inputSchema: {
      type: 'object',
      properties: {
        nodeId: {
          type: 'string',
          description: 'Node ID to get revision history for',
        },
        project: {
          type: 'string',
          description: 'Project ID (optional)',
        },
      },
      required: ['nodeId'],
    },
  },
  {
    name: 'edge_get_revisions',
    description:
      'Get the revision history for an edge. Shows how the relationship between concepts evolved.',
    inputSchema: {
      type: 'object',
      properties: {
        edgeId: {
          type: 'string',
          description: 'Edge ID to get revision history for',
        },
        project: {
          type: 'string',
          description: 'Project ID (optional)',
        },
      },
      required: ['edgeId'],
    },
  },
  {
    name: 'graph_find_by_trigger',
    description:
      'Find all nodes with a specific trigger type. Useful for finding all questions, tensions, serendipities, etc. Use unresolvedOnly=true to find open predictions (no validates/invalidates) or unanswered questions (no answers edge).',
    inputSchema: {
      type: 'object',
      properties: {
        trigger: {
          type: 'string',
          description:
            'Trigger type to search for: foundation, surprise, tension, consequence, repetition, question, serendipity, decision, experiment, analysis, library, prediction, evaluation',
          enum: [
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
            'library',
            'prediction',
            'evaluation',
          ],
        },
        unresolvedOnly: {
          type: 'boolean',
          description:
            'For predictions: exclude those with validates/invalidates edges. For questions: exclude those with answers edge. (default: false)',
        },
        missingMetadata: {
          type: 'string',
          description:
            'Only return nodes that do NOT have this metadata field set. Example: "translated" to find untranslated nodes.',
        },
        includeArchived: {
          type: 'boolean',
          description: 'Include archived nodes (default: false)',
        },
        limit: {
          type: 'number',
          description: 'Maximum results (default: 50)',
        },
        project: {
          type: 'string',
          description: 'Project ID (optional)',
        },
      },
      required: ['trigger'],
    },
  },
  {
    name: 'graph_search_metadata',
    description:
      'Search nodes by metadata field values. Metadata is flexible JSON stored on nodes for module-specific data.',
    inputSchema: {
      type: 'object',
      properties: {
        field: {
          type: 'string',
          description:
            'Metadata field path to search (e.g., "type", "physics.home")',
        },
        value: {
          type: 'string',
          description: 'Value to match (exact match or JSON for objects)',
        },
        limit: {
          type: 'number',
          description: 'Maximum results (default: 50)',
        },
        project: {
          type: 'string',
          description: 'Project ID (optional)',
        },
      },
      required: ['field'],
    },
  },
  {
    name: 'graph_find_by_reference',
    description:
      'Find nodes that reference a specific URL or external resource. Useful for finding all nodes that cite a paper or website.',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description:
            'URL or URL pattern to search for (partial match supported)',
        },
        project: {
          type: 'string',
          description: 'Project ID (optional)',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'graph_purge',
    description:
      'ADMIN: Permanently delete nodes/edges (not just archive). Use for test data cleanup only. Two-step: preview first, then confirm.',
    inputSchema: {
      type: 'object',
      properties: {
        nodeIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Node IDs to permanently delete',
        },
        edgeIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Edge IDs to permanently delete',
        },
        confirm: {
          type: 'boolean',
          description:
            'Set to true to actually delete. Without this, only previews what would be deleted.',
        },
        reason: {
          type: 'string',
          description: 'Reason for purge (required for audit trail)',
        },
        project: {
          type: 'string',
          description: 'Project ID (optional)',
        },
      },
      required: ['reason'],
    },
  },
  {
    name: 'graph_updates',
    description:
      'Get graph changes (nodes, edges, errors) since a specific timestamp. Use this to maintain state without reloading the full context. Returns new nodes, edges, and YOUR recent actions (success/failure).',
    inputSchema: {
      type: 'object',
      properties: {
        since: {
          type: 'string',
          description:
            'ISO timestamp (e.g., "2023-10-27T10:00:00.000Z") to fetch updates from.',
        },
        project: {
          type: 'string',
          description: 'Project ID (optional)',
        },
      },
      required: ['since'],
    },
  },
  {
    name: 'graph_context',
    description:
      'Get the current understanding graph as XML context. For large graphs (50+ nodes), returns a compact view with overview of important concepts and region summaries. Use graph_context_region to drill into specific regions.',
    inputSchema: {
      type: 'object',
      properties: {
        show_evolution: {
          type: 'boolean',
          description:
            'Include superseded nodes to see how understanding evolved',
        },
        compact: {
          type: 'boolean',
          description:
            'Force compact mode (region summaries instead of full graph). Auto-enabled for large graphs.',
        },
        max_tokens: {
          type: 'number',
          description:
            'Maximum tokens for output (default: 8000). Lower values show fewer concepts per region.',
        },
        detail_level: {
          type: 'string',
          enum: ['titles', 'brief', 'full'],
          description:
            'Control verbosity: "titles" = just node names, "brief" = titles + truncated understanding (100 chars), "full" = everything (default)',
        },
        include_fields: {
          type: 'array',
          items: {
            type: 'string',
            enum: [
              'title',
              'understanding',
              'why',
              'content',
              'summary',
              'edges',
              'trigger',
            ],
          },
          description:
            'Granular field selection. Overrides detail_level. Example: ["title", "trigger"] for minimal view',
        },
        hide_document_content: {
          type: 'boolean',
          description:
            'Hide content from document nodes but show their structure. Useful for seeing doc outline without full text.',
        },
        nodeId: {
          type: 'string',
          description:
            'Focus context around a specific node and its neighbors. Overrides compact mode.',
        },
        project: {
          type: 'string',
          description: 'Project ID (optional)',
        },
      },
    },
  },
  {
    name: 'graph_context_region',
    description:
      'Get full details for a specific region/cluster of concepts. Use after graph_context to drill into regions of interest.',
    inputSchema: {
      type: 'object',
      properties: {
        region_id: {
          type: 'number',
          description: 'The region ID from graph_context output',
        },
        show_evolution: {
          type: 'boolean',
          description: 'Include superseded nodes',
        },
        detail_level: {
          type: 'string',
          enum: ['titles', 'brief', 'full'],
          description:
            'Control verbosity: "titles" = just node names, "brief" = titles + truncated understanding (100 chars), "full" = everything (default)',
        },
        include_fields: {
          type: 'array',
          items: {
            type: 'string',
            enum: [
              'title',
              'understanding',
              'why',
              'content',
              'summary',
              'edges',
              'trigger',
            ],
          },
          description:
            'Granular field selection. Overrides detail_level. Example: ["title", "trigger"] for minimal view',
        },
        hide_document_content: {
          type: 'boolean',
          description:
            'Hide content from document nodes but show their structure.',
        },
        project: {
          type: 'string',
          description: 'Project ID (optional)',
        },
      },
      required: ['region_id'],
    },
  },
  {
    name: 'graph_skeleton',
    description:
      'Ultra-minimal graph overview (~150 tokens) of the CURRENTLY ACTIVE project. Shows regions with sizes, hub nodes, and recent activity. Use for initial orientation before drilling into regions. To inspect a different project, call project_switch first — graph_skeleton always reports on whatever project is active at call time.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'graph_path',
    description:
      'Find the shortest path between two concepts. Shows how they connect through the graph.',
    inputSchema: {
      type: 'object',
      properties: {
        from: {
          type: 'string',
          description: 'Starting node (ID or name)',
        },
        to: {
          type: 'string',
          description: 'Ending node (ID or name)',
        },
        project: {
          type: 'string',
          description: 'Project ID (optional)',
        },
      },
      required: ['from', 'to'],
    },
  },
  {
    name: 'graph_analyze',
    description:
      'Analyze graph structure to find gaps, cycles, bridges, and open questions.',
    inputSchema: {
      type: 'object',
      properties: {
        include: {
          type: 'array',
          items: {
            type: 'string',
            enum: [
              'gaps',
              'cycles',
              'bridges',
              'questions',
              'serendipity',
              'all',
            ],
          },
          description: 'What to include in analysis',
        },
        show_evolution: {
          type: 'boolean',
          description: 'Include superseded nodes in analysis',
        },
        project: {
          type: 'string',
          description: 'Project ID (optional)',
        },
      },
    },
  },
  {
    name: 'graph_history',
    description:
      'Read the recent activity feed for the current project: who created/revised which nodes and edges, with their commit messages, in chronological order. Returns XML so structure is preserved when other agents quote from it. Use this at the start of every session to see what teammates have done since you last looked.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Number of recent events to show (default: 50)',
        },
        entity: {
          type: 'string',
          description: 'Filter to specific node/edge ID',
        },
        project: {
          type: 'string',
          description: 'Project ID (optional)',
        },
      },
    },
  },
  {
    name: 'project_switch',
    description:
      'Switch to a different project, creating it if it does not exist yet. The project becomes the active target for all subsequent graph mutations and queries. Pass the projectId you want to use; the matching directory + SQLite database are loaded (or created) on demand. Set goal to describe the project purpose (shown in the UI).',
    inputSchema: {
      type: 'object',
      properties: {
        project: {
          type: 'string',
          description: 'Project ID to switch to',
        },
        goal: {
          type: 'string',
          description:
            'Short description of the project goal (e.g. "Deep reading of Erta Ale"). Saved to meta.json and shown in the frontend sidebar.',
        },
      },
      required: ['project'],
    },
  },
  {
    name: 'project_list',
    description: 'List all available projects.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'graph_lookup_external',
    description:
      'Look up a node from a different project without switching. Use this to resolve cross-project references.',
    inputSchema: {
      type: 'object',
      properties: {
        project: {
          type: 'string',
          description: 'Project ID to look up from (e.g., "default")',
        },
        nodeId: {
          type: 'string',
          description: 'Node ID to look up',
        },
      },
      required: ['project', 'nodeId'],
    },
  },
  {
    name: 'graph_list_external',
    description:
      'List nodes from a different project without switching. Use this to browse available references in other projects.',
    inputSchema: {
      type: 'object',
      properties: {
        project: {
          type: 'string',
          description: 'Project ID to list from (e.g., "default")',
        },
        limit: {
          type: 'number',
          description: 'Maximum nodes to return (default: 50)',
        },
      },
      required: ['project'],
    },
  },
  {
    name: 'graph_resolve_references',
    description:
      'Resolve all cross-project references in a node. Given a node ID, fetches the full content of any referenced nodes from other projects.',
    inputSchema: {
      type: 'object',
      properties: {
        nodeId: {
          type: 'string',
          description: 'Node ID to resolve references for',
        },
        project: {
          type: 'string',
          description:
            'Project containing the node (optional, defaults to current)',
        },
        depth: {
          type: 'number',
          description:
            'How many levels deep to resolve (default: 1, max: 3). Use 2+ to follow chains of references.',
        },
      },
      required: ['nodeId'],
    },
  },
  {
    name: 'graph_global_lookup',
    description:
      'Find a node by ID across ALL projects. Searches every project database to locate the node. Use when you have a node ID but do not know which project it belongs to.',
    inputSchema: {
      type: 'object',
      properties: {
        nodeId: {
          type: 'string',
          description: 'Node ID to find (e.g., "n_abc123")',
        },
      },
      required: ['nodeId'],
    },
  },
  {
    name: 'graph_similar',
    description:
      'Find nodes structurally similar to a given node (share neighbors). Use this to discover related concepts you might want to connect.',
    inputSchema: {
      type: 'object',
      properties: {
        node: {
          type: 'string',
          description: 'Node ID or name to find similar nodes for',
        },
        limit: {
          type: 'number',
          description: 'Max results (default: 10)',
        },
        project: {
          type: 'string',
          description: 'Project ID (optional)',
        },
      },
      required: ['node'],
    },
  },
  {
    name: 'graph_semantic_gaps',
    description:
      'Find potential missing connections - node pairs that are semantically similar but not connected. Uses embeddings when available, falls back to keyword matching.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Max results (default: 20)',
        },
        use_embeddings: {
          type: 'boolean',
          description:
            'Use embedding similarity instead of keyword matching (default: true, requires embeddings)',
        },
        project: {
          type: 'string',
          description: 'Project ID (optional)',
        },
      },
    },
  },
  {
    name: 'graph_centrality',
    description:
      'Get advanced centrality measures: PageRank (importance via link structure), Betweenness (bridges between clusters), Degree (connection count). Use to find the most important concepts.',
    inputSchema: {
      type: 'object',
      properties: {
        project: {
          type: 'string',
          description: 'Project ID (optional)',
        },
      },
    },
  },
  {
    name: 'graph_semantic_search',
    description:
      "Search nodes by semantic similarity to a query. Uses embeddings to find conceptually related nodes even if they don't share keywords. Returns region_id for each result to enable efficient context loading via graph_context_region.",
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query - finds nodes with similar meaning',
        },
        limit: {
          type: 'number',
          description: 'Max results (default: 10)',
        },
        project: {
          type: 'string',
          description: 'Project ID (optional)',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'graph_backfill_embeddings',
    description:
      "Generate embeddings for all nodes that don't have them. Run this to enable semantic search on existing nodes.",
    inputSchema: {
      type: 'object',
      properties: {
        project: {
          type: 'string',
          description: 'Project ID (optional)',
        },
      },
    },
  },
  {
    name: 'graph_embedding_stats',
    description: 'Get statistics about embedding coverage in the graph.',
    inputSchema: {
      type: 'object',
      properties: {
        project: {
          type: 'string',
          description: 'Project ID (optional)',
        },
      },
    },
  },
  {
    name: 'graph_thermostat',
    description:
      'Measures the cognitive temperature of the graph to govern the Explore/Exploit trade-off. Returns a strategy (DIVERGE/CONVERGE) based on graph entropy.',
    inputSchema: {
      type: 'object',
      properties: {
        project: {
          type: 'string',
          description: 'Project ID (optional)',
        },
      },
    },
  },
  {
    name: 'graph_bulk_replace',
    description:
      'Find and replace text across all nodes in the graph. Useful for renaming characters, locations, or concepts. Supports single replacement or batch replacements. Use preview mode first to see what will change.',
    inputSchema: {
      type: 'object',
      properties: {
        find: {
          type: 'string',
          description: 'Text to find (for single replacement)',
        },
        replace: {
          type: 'string',
          description: 'Text to replace with (for single replacement)',
        },
        replacements: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              find: { type: 'string', description: 'Text to find' },
              replace: { type: 'string', description: 'Text to replace with' },
            },
            required: ['find', 'replace'],
          },
          description:
            'Array of {find, replace} pairs for batch replacements. Example: [{find: "Oren", replace: "Marcus"}, {find: "Deja", replace: "Nova"}]',
        },
        fields: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['title', 'understanding', 'content', 'summary'],
          },
          description:
            'Fields to search in (default: all). title=node title, understanding=description, content=document content, summary=compressed content',
        },
        caseSensitive: {
          type: 'boolean',
          description: 'Case sensitive matching (default: false)',
        },
        preview: {
          type: 'boolean',
          description:
            'Preview changes without applying them (default: true). Set to false to apply changes.',
        },
        project: {
          type: 'string',
          description: 'Project ID (optional)',
        },
      },
    },
  },
  {
    name: 'graph_score',
    description:
      'Calculate chronological understanding score based on graph structure. Measures how well thinking nodes integrate with concepts, track belief evolution, and build coherent understanding trails. All metrics are structural (cannot be gamed).',
    inputSchema: {
      type: 'object',
      properties: {
        project: {
          type: 'string',
          description: 'Project ID (optional)',
        },
        detailed: {
          type: 'boolean',
          description: 'Show per-node issues and detailed breakdown',
        },
      },
    },
  },
];

// ============================================================================
// Helper functions for graph_score
// ============================================================================

/**
 * Calculate the longest thinking→thinking chain depth using DFS.
 * Only counts non-"next" edges between thinking nodes.
 */
function calculateThinkingChainDepth(
  thinkingNodes: Array<{ id: string }>,
  edges: Array<{ fromId: string; toId: string; type: string }>,
): number {
  const thinkingIds = new Set(thinkingNodes.map((n) => n.id));
  const adj = new Map<string, string[]>();

  for (const e of edges) {
    if (
      thinkingIds.has(e.fromId) &&
      thinkingIds.has(e.toId) &&
      e.type !== 'next'
    ) {
      if (!adj.has(e.fromId)) adj.set(e.fromId, []);
      adj.get(e.fromId)?.push(e.toId);
    }
  }

  let maxDepth = 0;
  const visited = new Set<string>();

  function dfs(nodeId: string, depth: number) {
    maxDepth = Math.max(maxDepth, depth);
    visited.add(nodeId);
    for (const next of adj.get(nodeId) || []) {
      if (!visited.has(next)) dfs(next, depth + 1);
    }
    visited.delete(nodeId);
  }

  for (const id of thinkingIds) {
    dfs(id, 1);
  }

  return maxDepth;
}

/**
 * Calculate semantic coherence: average cosine similarity of edge endpoints.
 * Only samples up to 50 edges for performance.
 */
function calculateSemanticCoherence(
  store: GraphStore,
  edges: Array<{ fromId: string; toId: string }>,
): number {
  if (edges.length === 0) return 1;

  let totalSim = 0;
  let count = 0;

  // Helper: cosine similarity (works with Float32Array or number[])
  function cosineSimilarity(
    a: Float32Array | number[],
    b: Float32Array | number[],
  ): number {
    if (a.length !== b.length) return 0;
    let dot = 0;
    let magA = 0;
    let magB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      magA += a[i] * a[i];
      magB += b[i] * b[i];
    }
    magA = Math.sqrt(magA);
    magB = Math.sqrt(magB);
    if (magA === 0 || magB === 0) return 0;
    return dot / (magA * magB);
  }

  // Sample edges for performance
  const sampleEdges = edges.slice(0, 50);

  for (const edge of sampleEdges) {
    const fromNode = store.getNode(edge.fromId);
    const toNode = store.getNode(edge.toId);
    if (fromNode?.embedding && toNode?.embedding) {
      totalSim += cosineSimilarity(fromNode.embedding, toNode.embedding);
      count++;
    }
  }

  return count > 0 ? totalSim / count : 0.5; // Default to 0.5 if no embeddings
}

/**
 * Calculate Shannon entropy of a distribution.
 * Higher entropy = more diversity.
 */
function calculateEntropy(counts: Map<string, number>, total: number): number {
  if (total === 0) return 0;
  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / total;
    if (p > 0) entropy -= p * Math.log2(p);
  }
  return entropy;
}

export async function handleReflectionTools(
  name: string,
  args: Record<string, unknown>,
  contextManager: ContextManager,
): Promise<unknown> {
  switch (name) {
    // ========================================================================
    // New revision/query tools
    // ========================================================================

    case 'node_get_revisions': {
      const projectId =
        (args.project as string) || contextManager.getCurrentProjectId();
      await contextManager.getContext(projectId);

      const store = getGraphStore();
      const nodeId = args.nodeId as string;
      const node = store.getNode(nodeId);

      if (!node) {
        return {
          error: `Node not found: ${nodeId}`,
        };
      }

      return {
        nodeId: node.id,
        nodeName: node.title,
        currentVersion: node.version,
        currentState: {
          text: node.title,
          trigger: node.trigger,
          why: node.why,
          understanding: node.understanding?.slice(0, 500),
        },
        revisions: node.revisions.map((r) => ({
          version: r.version,
          timestamp: r.timestamp,
          revisionWhy: r.revisionWhy,
          conversationId: r.conversationId,
          changes: {
            text: r.title,
            trigger: r.trigger,
            why: r.why,
            understanding: r.understanding?.slice(0, 200),
          },
        })),
        revisionCount: node.revisions.length,
        hint:
          node.revisions.length === 0
            ? 'No revisions yet - this is the original version'
            : `${node.revisions.length} previous version(s) stored`,
      };
    }

    case 'edge_get_revisions': {
      const projectId =
        (args.project as string) || contextManager.getCurrentProjectId();
      await contextManager.getContext(projectId);

      const store = getGraphStore();
      const edgeId = args.edgeId as string;
      const edge = store.getEdge(edgeId);

      if (!edge) {
        return {
          error: `Edge not found: ${edgeId}`,
        };
      }

      // Get node names for context
      const fromNode = store.getNode(edge.fromId);
      const toNode = store.getNode(edge.toId);

      return {
        edgeId: edge.id,
        from: { id: edge.fromId, name: fromNode?.title || 'Unknown' },
        to: { id: edge.toId, name: toNode?.title || 'Unknown' },
        currentVersion: edge.version,
        currentState: {
          type: edge.type,
          explanation: edge.explanation,
          why: edge.why,
        },
        revisions: edge.revisions.map((r) => ({
          version: r.version,
          timestamp: r.timestamp,
          revisionWhy: r.revisionWhy,
          conversationId: r.conversationId,
          changes: {
            explanation: r.explanation,
            why: r.why,
          },
        })),
        revisionCount: edge.revisions.length,
        hint:
          edge.revisions.length === 0
            ? 'No revisions yet - this is the original version'
            : `${edge.revisions.length} previous version(s) stored`,
      };
    }

    case 'graph_find_by_trigger': {
      const { isExternal, projectId } = getStoreForRead(
        args.project as string | undefined,
        contextManager,
      );

      const trigger = args.trigger as string;
      const includeArchived = args.includeArchived as boolean | undefined;
      const unresolvedOnly = args.unresolvedOnly as boolean | undefined;
      const missingMetadata = args.missingMetadata as string | undefined;
      const limit = (args.limit as number) || 50;

      // Use queryNodes for both local and external projects (all DBs are in memory)
      const nodes = queryNodes(projectId, {
        trigger,
        limit: limit * 4, // Fetch more to account for filtering
        includeArchived,
      });

      // Filter for unresolved if requested (Cold Case Protocol)
      let filteredNodes = nodes;
      if (
        unresolvedOnly &&
        (trigger === 'prediction' || trigger === 'question')
      ) {
        filteredNodes = filteredNodes.filter((n) => {
          const incomingEdges = queryEdges(projectId, { toId: n.id });
          if (trigger === 'prediction') {
            // Unresolved = no validates/invalidates edges pointing to it
            return !incomingEdges.some(
              (e) => e.type === 'validates' || e.type === 'invalidates',
            );
          }
          if (trigger === 'question') {
            // Unanswered = no answers edge pointing to it
            return !incomingEdges.some((e) => e.type === 'answers');
          }
          return true;
        });
      }

      // Filter for nodes missing specific metadata (e.g., "translated")
      if (missingMetadata) {
        const store = getGraphStore();
        filteredNodes = filteredNodes.filter((n) => {
          const meta = store.getMetadata(n.id);
          if (!meta) return true; // No metadata = missing the field
          return !(missingMetadata in meta);
        });
      }

      // Apply final limit
      const results = filteredNodes.slice(0, limit);

      // Get all nodes for edge target names lookup
      const allNodes = queryNodes(projectId, { limit: 1000 });
      const nodeNameMap = new Map(
        allNodes.map((node) => [node.id, node.title]),
      );

      // Determine appropriate hint
      let hint: string | undefined;
      if (unresolvedOnly) {
        hint =
          trigger === 'prediction'
            ? 'These predictions have NO validates/invalidates edges - adjudicate them (settle, abandon, or mark as open mystery)'
            : trigger === 'question'
              ? 'These questions have NO answers edge - consider answering or marking as abandoned'
              : undefined;
      } else {
        hint =
          trigger === 'question'
            ? 'These are open questions - consider answering them with graph_answer'
            : trigger === 'tension'
              ? 'These are unresolved tensions - consider resolving with a decision or synthesis'
              : trigger === 'serendipity'
                ? 'These are chaos-injected discoveries - consider validating with graph_validate'
                : trigger === 'prediction'
                  ? 'Use unresolvedOnly=true to find predictions that need adjudication'
                  : undefined;
      }

      return {
        trigger,
        project: projectId,
        isExternal,
        total: nodes.length,
        filtered: unresolvedOnly ? filteredNodes.length : undefined,
        returned: results.length,
        unresolvedOnly: unresolvedOnly || undefined,
        nodes: results.map((n) => {
          // Get outgoing edges for this node
          const edges = queryEdges(projectId, { fromId: n.id });
          return {
            id: n.id,
            name: n.title,
            understanding:
              n.understanding?.slice(0, 150) +
              (n.understanding && n.understanding.length > 150 ? '...' : ''),
            content: n.content || null, // Full content for thinking nodes
            createdAt: n.createdAt,
            edges: edges.map((e) => ({
              toId: e.toId,
              toName: nodeNameMap.get(e.toId) || 'unknown',
              type: e.type,
            })),
          };
        }),
        hint,
      };
    }

    case 'graph_search_metadata': {
      const projectId =
        (args.project as string) || contextManager.getCurrentProjectId();
      await contextManager.getContext(projectId);

      const field = args.field as string;
      const value = args.value as string | undefined;
      const limit = (args.limit as number) || 50;

      const store = getGraphStore();
      const { nodes } = store.getAll();

      // Parse field path (supports nested like "physics.home")
      const getNestedValue = (
        obj: Record<string, unknown>,
        path: string,
      ): unknown => {
        const parts = path.split('.');
        let current: unknown = obj;
        for (const part of parts) {
          if (current && typeof current === 'object' && part in current) {
            current = (current as Record<string, unknown>)[part];
          } else {
            return undefined;
          }
        }
        return current;
      };

      const results = nodes.filter((n) => {
        if (!n.metadata) return false;
        const fieldValue = getNestedValue(n.metadata, field);
        if (fieldValue === undefined) return false;

        // If no value specified, just check existence
        if (value === undefined) return true;

        // String comparison
        if (typeof fieldValue === 'string') {
          return fieldValue === value || fieldValue.includes(value);
        }

        // Number/boolean comparison
        if (typeof fieldValue === 'number' || typeof fieldValue === 'boolean') {
          return String(fieldValue) === value;
        }

        // Object comparison (try JSON match)
        try {
          return JSON.stringify(fieldValue) === value;
        } catch {
          return false;
        }
      });

      return {
        field,
        value: value ?? '(any)',
        total: results.length,
        nodes: results.slice(0, limit).map((n) => ({
          id: n.id,
          name: n.title,
          trigger: n.trigger,
          metadataValue: getNestedValue(n.metadata, field),
          fullMetadata: n.metadata,
        })),
        hint:
          results.length > limit
            ? `Showing first ${limit} of ${results.length} matches`
            : undefined,
      };
    }

    case 'graph_find_by_reference': {
      const projectId =
        (args.project as string) || contextManager.getCurrentProjectId();
      await contextManager.getContext(projectId);

      const url = args.url as string;
      const store = getGraphStore();
      const { nodes } = store.getAll();

      const results = nodes.filter((n) => {
        if (!n.references || n.references.length === 0) return false;
        return n.references.some(
          (ref) =>
            ref.url?.toLowerCase().includes(url.toLowerCase()) ||
            ref.title?.toLowerCase().includes(url.toLowerCase()),
        );
      });

      return {
        searchTerm: url,
        total: results.length,
        nodes: results.map((n) => ({
          id: n.id,
          name: n.title,
          trigger: n.trigger,
          references: n.references?.filter(
            (ref) =>
              ref.url?.toLowerCase().includes(url.toLowerCase()) ||
              ref.title?.toLowerCase().includes(url.toLowerCase()),
          ),
        })),
        hint:
          results.length === 0
            ? 'No nodes found referencing this URL. Try a broader search term.'
            : undefined,
      };
    }

    case 'graph_purge': {
      const projectId =
        (args.project as string) || contextManager.getCurrentProjectId();
      await contextManager.getContext(projectId);

      const nodeIds = (args.nodeIds as string[]) || [];
      const edgeIds = (args.edgeIds as string[]) || [];
      const confirm = args.confirm as boolean;
      const reason = args.reason as string;

      if (nodeIds.length === 0 && edgeIds.length === 0) {
        return {
          error: 'No nodeIds or edgeIds provided. Specify what to purge.',
          usage: {
            nodeIds: ['n_xxx', 'n_yyy'],
            edgeIds: ['e_xxx'],
            confirm: true,
            reason: 'Test data cleanup',
          },
        };
      }

      const store = getGraphStore();

      // Preview mode - show what would be deleted
      const nodesToDelete = nodeIds
        .map((id) => store.getNode(id))
        .filter((n) => n !== null);
      const edgesToDelete = edgeIds
        .map((id) => store.getEdge(id))
        .filter((e) => e !== null);

      // Find edges connected to nodes being deleted
      const { edges } = store.getAll();
      const connectedEdges = edges.filter(
        (e) => nodeIds.includes(e.fromId) || nodeIds.includes(e.toId),
      );

      const preview = {
        nodes: nodesToDelete.map((n) => ({
          id: n?.id,
          name: n?.title,
          trigger: n?.trigger,
          createdAt: n?.createdAt,
        })),
        edges: edgesToDelete.map((e) => ({
          id: e?.id,
          from: e?.fromId,
          to: e?.toId,
          type: e?.type,
        })),
        cascadeEdges: connectedEdges.map((e) => ({
          id: e.id,
          from: e.fromId,
          to: e.toId,
          type: e.type,
          reason: 'Connected to deleted node',
        })),
      };

      if (!confirm) {
        return {
          preview: true,
          reason,
          willDelete: {
            nodes: preview.nodes.length,
            edges: preview.edges.length,
            cascadeEdges: preview.cascadeEdges.length,
          },
          details: preview,
          warning:
            'This will PERMANENTLY delete these items. Set confirm: true to proceed.',
          hint: 'Review the preview carefully. Purge cannot be undone.',
        };
      }

      // Actually delete - use raw SQL since we're bypassing normal soft-delete
      const result = sqlite.purgeNodes(nodeIds, edgeIds, reason);

      return {
        success: true,
        purged: {
          nodes: result.deletedNodes,
          edges: result.deletedEdges,
          cascadeEdges: result.cascadeEdges,
        },
        reason,
        auditLogId: result.auditLogId,
        message: `Permanently deleted ${result.deletedNodes} nodes, ${result.deletedEdges} specified edges, and ${result.cascadeEdges} connected edges`,
        warning: 'This action cannot be undone',
      };
    }

    // ========================================================================
    // Existing tools
    // ========================================================================

    case 'graph_updates': {
      const projectId =
        (args.project as string) || contextManager.getCurrentProjectId();
      await contextManager.getContext(projectId); // Ensure initialized

      const since = args.since as string;
      const xml = ContextService.getUpdatesSince(projectId, since);

      return xml;
    }

    case 'graph_context': {
      const projectId =
        (args.project as string) || contextManager.getCurrentProjectId();
      await contextManager.getContext(projectId); // Ensure initialized

      const xml = generateXmlContext(projectId, {
        showEvolution: args.show_evolution as boolean | undefined,
        compact: args.compact as boolean | undefined,
        maxTokens: args.max_tokens as number | undefined,
        detailLevel: args.detail_level as
          | 'titles'
          | 'brief'
          | 'full'
          | undefined,
        includeFields: args.include_fields as string[] | undefined,
        hideDocumentProse: args.hide_document_content as boolean | undefined,
        nodeId: args.nodeId as string | undefined,
      });

      return xml;
    }

    case 'graph_context_region': {
      const projectId =
        (args.project as string) || contextManager.getCurrentProjectId();
      await contextManager.getContext(projectId); // Ensure initialized

      const regionId = args.region_id as number;
      const xml = generateRegionContext(projectId, regionId, {
        showEvolution: args.show_evolution as boolean | undefined,
        detailLevel: args.detail_level as
          | 'titles'
          | 'brief'
          | 'full'
          | undefined,
        includeFields: args.include_fields as string[] | undefined,
        hideDocumentProse: args.hide_document_content as boolean | undefined,
      });

      return xml;
    }

    case 'graph_skeleton': {
      // graph_skeleton always reports on whatever project is currently
      // active — the old `project` param was a schema lie: the singleton
      // GraphStore and the underlying sqlite.getDb() both route through
      // currentProjectId, so a per-call project override is unsafe under
      // concurrency (two parallel graph_skeleton calls racing on the
      // mutation of currentProjectId would both see the last writer).
      // Callers who need another project's skeleton must call
      // project_switch first. The param is no longer declared in the
      // input schema; if an older client still sends it, we ignore it.
      const projectId = contextManager.getCurrentProjectId();
      await contextManager.getContext(projectId); // Ensure initialized

      return generateSkeletonContext(projectId);
    }

    case 'graph_path': {
      const projectId =
        (args.project as string) || contextManager.getCurrentProjectId();
      await contextManager.getContext(projectId); // Ensure initialized

      const from = args.from as string;
      const to = args.to as string;

      return findPath(projectId, from, to);
    }

    case 'graph_analyze': {
      const projectId =
        (args.project as string) || contextManager.getCurrentProjectId();
      await contextManager.getContext(projectId);

      const analysis = AnalysisService.analyzeGraph(projectId, {
        showEvolution: args.show_evolution as boolean | undefined,
      });

      const include = (args.include as string[]) || ['all'];
      const includeAll = include.includes('all');

      // Filter results based on what was requested
      const result: Record<string, unknown> = {
        stats: analysis.stats,
      };

      if (includeAll || include.includes('gaps')) {
        result.isolatedNodes = analysis.isolatedNodes;
      }
      if (includeAll || include.includes('cycles')) {
        result.cycles = {
          tight: analysis.tightCycles,
          structural: analysis.structuralCycles,
        };
      }
      if (includeAll || include.includes('bridges')) {
        result.bridges = analysis.bridges;
        result.centrality = analysis.centrality;
      }
      if (includeAll || include.includes('questions')) {
        result.openQuestions = analysis.openQuestions;
      }
      if (includeAll || include.includes('serendipity')) {
        result.serendipityNodes = analysis.serendipityNodes;
      }
      if (analysis.evolution) {
        result.evolution = analysis.evolution;
      }

      return result;
    }

    case 'graph_history': {
      const projectId =
        (args.project as string) || contextManager.getCurrentProjectId();
      await contextManager.getContext(projectId);

      if (args.entity) {
        // Get history for specific entity
        const events = sqlite.getEntityHistory(args.entity as string, true);
        return {
          entity: args.entity,
          events,
          count: events.length,
        };
      }

      // Get recent history as XML context
      const xml = ContextService.generateHistoryContext(
        (args.limit as number) || 50,
      );

      return xml;
    }

    case 'project_switch': {
      const projectId = args.project as string;
      const goal = args.goal as string | undefined;
      const context = await contextManager.switchProject(projectId, goal);

      // Get document roots for this project
      const store = getGraphStore();
      const docRoots = store.getDocumentRoots();

      // Format document info for agent awareness
      const documents =
        docRoots.length > 0
          ? docRoots.map((doc) => ({
              id: doc.id,
              title: doc.title,
              fileType: doc.fileType || 'md',
              summary:
                doc.summary?.slice(0, 100) +
                (doc.summary && doc.summary.length > 100 ? '...' : ''),
            }))
          : [];

      return {
        success: true,
        project: context.projectId,
        conversationId: context.conversationId,
        message: `Switched to project "${projectId}"`,
        documents:
          documents.length > 0
            ? {
                count: documents.length,
                roots: documents,
                hint: 'Use doc_get_tree({ rootId, brief: true }) to see structure, doc_read({ nodeId }) to read content',
              }
            : {
                count: 0,
                hint: 'No documents yet. Create with doc_create({ title, content, isDocRoot: true, fileType: "md" })',
              },
      };
    }

    case 'project_list': {
      const projects = contextManager.listProjects();

      return {
        projects,
        current: contextManager.getCurrentProjectId(),
        count: projects.length,
        debug_project_dir: contextManager.getProjectDir(),
        debug_cwd: process.cwd(),
      };
    }

    case 'graph_lookup_external': {
      const targetProject = args.project as string;
      const nodeId = args.nodeId as string;
      const projectsDir = contextManager.getProjectDir();

      const node = sqlite.lookupExternalNode(
        projectsDir,
        targetProject,
        nodeId,
      );

      if (!node) {
        return {
          success: false,
          error: `Node "${nodeId}" not found in project "${targetProject}"`,
        };
      }

      return {
        success: true,
        node,
        hint: `To reference this in current project: { project: "${targetProject}", nodeId: "${nodeId}" }`,
      };
    }

    case 'graph_list_external': {
      const targetProject = args.project as string;
      const limit = (args.limit as number) || 50;
      const projectsDir = contextManager.getProjectDir();

      const nodes = sqlite.listExternalNodes(projectsDir, targetProject, limit);

      return {
        success: true,
        project: targetProject,
        count: nodes.length,
        nodes: nodes.map((n) => ({
          id: n.id,
          name: n.title,
          trigger: n.trigger,
          understanding:
            n.understanding?.slice(0, 100) +
            (n.understanding && n.understanding.length > 100 ? '...' : ''),
        })),
      };
    }

    case 'graph_global_lookup': {
      const nodeId = args.nodeId as string;
      const currentProject = contextManager.getCurrentProjectId();

      // Use sqlite's globalNodeLookup - searches all in-memory databases
      const result = sqlite.globalNodeLookup(nodeId);

      if (result) {
        const { node, projectId } = result;
        return {
          found: true,
          project: projectId,
          isCurrent: projectId === currentProject,
          node: {
            id: node.id,
            text: node.title,
            trigger: node.trigger,
            understanding: node.understanding,
            references: node.references,
          },
          hint:
            projectId !== currentProject
              ? `Node found in "${projectId}". Use graph_lookup_external({ project: "${projectId}", nodeId: "${nodeId}" }) for full details.`
              : undefined,
        };
      }

      // SECURITY: Filter projects to only show those belonging to the current user
      const allProjects = sqlite.getLoadedProjectIds();
      const userPrefix = currentProject.includes('__')
        ? `${currentProject.split('__')[0]}__`
        : '';

      const visibleProjects = userPrefix
        ? allProjects.filter((p) => p.startsWith(userPrefix))
        : allProjects; // Fallback for legacy/non-namespaced projects

      return {
        found: false,
        nodeId,
        searchedProjects: visibleProjects,
        hint: 'Node not found in your projects',
      };
    }

    case 'graph_resolve_references': {
      const { projectId } = getStoreForRead(
        args.project as string | undefined,
        contextManager,
      );

      const nodeId = args.nodeId as string;
      const maxDepth = Math.min((args.depth as number) || 1, 3);
      const projectsDir = contextManager.getProjectDir();

      // Use lookupExternalNode which works with in-memory databases
      const sourceNode = lookupExternalNode(projectsDir, projectId, nodeId);
      if (!sourceNode) {
        return {
          error: `Node not found: ${nodeId}`,
          project: projectId,
        };
      }

      // Recursive reference resolver
      interface ResolvedRef {
        project: string;
        nodeId: string;
        node: {
          id: string;
          text: string;
          trigger: string | null;
          understanding: string | null;
        } | null;
        references?: ResolvedRef[];
        error?: string;
      }

      const resolveRefs = (
        refs: Array<{ project?: string; nodeId?: string; url?: string }> | null,
        currentDepth: number,
      ): ResolvedRef[] => {
        if (!refs || currentDepth > maxDepth) return [];

        return refs
          .filter(
            (ref): ref is { project: string; nodeId: string; url?: string } =>
              !!ref.project && !!ref.nodeId,
          ) // Only cross-project refs
          .map((ref) => {
            if (!isProjectLoaded(ref.project)) {
              return {
                project: ref.project,
                nodeId: ref.nodeId,
                node: null,
                error: `Project not loaded: ${ref.project}`,
              };
            }

            const refNode = lookupExternalNode(
              projectsDir,
              ref.project,
              ref.nodeId,
            );
            if (!refNode) {
              return {
                project: ref.project,
                nodeId: ref.nodeId,
                node: null,
                error: `Node not found in ${ref.project}`,
              };
            }

            const result: ResolvedRef = {
              project: ref.project,
              nodeId: ref.nodeId,
              node: {
                id: refNode.id,
                text: refNode.title,
                trigger: refNode.trigger,
                understanding: refNode.understanding,
              },
            };

            // Recurse if depth allows
            if (currentDepth < maxDepth && refNode.references?.length) {
              result.references = resolveRefs(
                refNode.references,
                currentDepth + 1,
              );
            }

            return result;
          });
      };

      const resolved = resolveRefs(sourceNode.references, 1);

      return {
        sourceNode: {
          id: sourceNode.id,
          text: sourceNode.title,
          project: projectId,
          referenceCount: sourceNode.references?.length || 0,
        },
        resolved,
        depth: maxDepth,
        hint:
          resolved.length === 0
            ? 'This node has no cross-project references'
            : `Resolved ${resolved.length} cross-project reference(s)`,
      };
    }

    case 'graph_similar': {
      const { isExternal, projectId } = getStoreForRead(
        args.project as string | undefined,
        contextManager,
      );

      // graph_similar requires the graphology graph - only works for current project
      if (isExternal) {
        return {
          error:
            'graph_similar is not available for external projects (requires loaded graph)',
          project: projectId,
          hint: 'Switch to the target project with project_switch() first',
        };
      }

      await contextManager.getContext(projectId);
      const store = getGraphStore();

      const nodeId = args.node as string;
      const limit = (args.limit as number) || 10;

      // Try to resolve node by name if not an ID
      let resolvedId = nodeId;
      if (!nodeId.startsWith('n_')) {
        const allNodes = store.getAll().nodes;
        const match = allNodes.find(
          (n) =>
            n.title.toLowerCase() === nodeId.toLowerCase() ||
            n.title.toLowerCase().includes(nodeId.toLowerCase()),
        );
        if (match) {
          resolvedId = match.id;
        } else {
          return {
            error: `Node not found: "${nodeId}"`,
            project: projectId,
            suggestions: allNodes
              .filter((n) =>
                n.title
                  .toLowerCase()
                  .includes(nodeId.toLowerCase().split(' ')[0]),
              )
              .slice(0, 5)
              .map((n) => ({ id: n.id, name: n.title })),
          };
        }
      }

      const similar = store.findSimilar(resolvedId, limit);

      return {
        node: resolvedId,
        project: projectId,
        isExternal: false,
        similar: similar.map((s) => ({
          id: s.node.id,
          name: s.node.title,
          sharedNeighbors: s.sharedNeighbors,
          similarity: Math.round(s.jaccardSimilarity * 100) / 100,
        })),
        count: similar.length,
        hint: 'Nodes with high similarity share neighbor patterns - consider if they should be connected directly',
      };
    }

    case 'graph_semantic_gaps': {
      const projectId =
        (args.project as string) || contextManager.getCurrentProjectId();
      await contextManager.getContext(projectId);

      const store = getGraphStore();
      const limit = (args.limit as number) || 20;
      const useEmbeddings = args.use_embeddings !== false; // Default true

      // Check if embeddings are available
      const stats = store.getEmbeddingStats();
      const hasEmbeddings = stats.withEmbedding > stats.total * 0.5; // At least 50% coverage

      if (useEmbeddings && hasEmbeddings) {
        // Use embedding-based gaps (more accurate)
        const gaps = store.findSemanticGapsWithEmbeddings(limit);
        return {
          method: 'embeddings',
          gaps: gaps.map((g) => ({
            node1: { id: g.node1.id, name: g.node1.title },
            node2: { id: g.node2.id, name: g.node2.title },
            similarity: Math.round((g.embeddingSimilarity || 0) * 1000) / 1000,
          })),
          count: gaps.length,
          embeddingCoverage: `${Math.round(stats.coverage * 100)}%`,
          hint: 'These node pairs are semantically similar but have no edge - consider connecting them',
        };
      }

      // Fall back to keyword-based gaps
      const gaps = store.findSemanticGaps(limit);

      return {
        method: 'keywords',
        gaps: gaps.map((g) => ({
          node1: { id: g.node1.id, name: g.node1.title },
          node2: { id: g.node2.id, name: g.node2.title },
          sharedTerms: g.sharedTerms,
        })),
        count: gaps.length,
        hint: hasEmbeddings
          ? 'Using keyword matching. Run with use_embeddings=true for semantic matching.'
          : 'These node pairs share keywords but have no edge - consider connecting them',
      };
    }

    case 'graph_centrality': {
      const { isExternal, projectId } = getStoreForRead(
        args.project as string | undefined,
        contextManager,
      );

      // graph_centrality requires the graphology graph - only works for current project
      if (isExternal) {
        return {
          error:
            'graph_centrality is not available for external projects (requires loaded graph)',
          project: projectId,
          hint: 'Switch to the target project with project_switch() first',
        };
      }

      await contextManager.getContext(projectId);
      const store = getGraphStore();
      const importance = store.getImportance();

      return {
        project: projectId,
        isExternal: false,
        pageRank: importance.pageRank.map((r) => ({
          id: r.node.id,
          name: r.node.title,
          score: Math.round(r.score * 1000) / 1000,
        })),
        betweenness: importance.betweenness.map((r) => ({
          id: r.node.id,
          name: r.node.title,
          score: Math.round(r.score * 1000) / 1000,
        })),
        degree: importance.degree.map((r) => ({
          id: r.node.id,
          name: r.node.title,
          inDegree: r.inDegree,
          outDegree: r.outDegree,
          total: r.total,
        })),
        hint: 'PageRank = importance via links, Betweenness = bridges between clusters, Degree = raw connections',
      };
    }

    case 'graph_semantic_search': {
      const { isExternal, projectId } = getStoreForRead(
        args.project as string | undefined,
        contextManager,
      );

      // graph_semantic_search requires the graphology graph - only works for current project
      if (isExternal) {
        return {
          error:
            'graph_semantic_search is not available for external projects (requires loaded graph)',
          project: projectId,
          hint: 'Switch to the target project with project_switch() first',
        };
      }

      await contextManager.getContext(projectId);
      const store = getGraphStore();

      const query = args.query as string;
      const limit = (args.limit as number) || 10;

      // Check embedding coverage first
      const stats = store.getEmbeddingStats();
      if (stats.withEmbedding === 0) {
        return {
          error:
            'No embeddings found. Run graph_backfill_embeddings first to enable semantic search.',
          stats,
          project: projectId,
        };
      }

      const results = await store.semanticSearch(query, limit);

      // Build node-to-region map for context loading optimization
      const communityResult = store.detectCommunities();
      const nodeToCommunity = new Map<string, number>();
      for (const [commId, nodes] of communityResult.communities) {
        for (const node of nodes) {
          nodeToCommunity.set(node.id, commId);
        }
      }

      return {
        query,
        project: projectId,
        isExternal: false,
        results: results.map((r) => ({
          id: r.node.id,
          name: r.node.title,
          similarity: Math.round(r.similarity * 1000) / 1000,
          region_id: nodeToCommunity.get(r.node.id) ?? null,
          understanding:
            r.node.understanding?.slice(0, 200) +
            (r.node.understanding && r.node.understanding.length > 200
              ? '...'
              : ''),
        })),
        count: results.length,
        embeddingCoverage: `${stats.withEmbedding}/${stats.total} nodes (${Math.round(stats.coverage * 100)}%)`,
      };
    }

    case 'graph_backfill_embeddings': {
      const projectId =
        (args.project as string) || contextManager.getCurrentProjectId();
      await contextManager.getContext(projectId);

      const store = getGraphStore();

      // Get initial stats
      const beforeStats = store.getEmbeddingStats();

      if (beforeStats.total === beforeStats.withEmbedding) {
        return {
          message: 'All nodes already have embeddings',
          stats: beforeStats,
        };
      }

      // Backfill embeddings
      const processed = await store.backfillEmbeddings();

      // Get updated stats
      const afterStats = store.getEmbeddingStats();

      return {
        message: `Generated embeddings for ${processed} nodes`,
        before: beforeStats,
        after: afterStats,
        hint: 'Semantic search is now available for these nodes',
      };
    }

    case 'graph_embedding_stats': {
      const projectId =
        (args.project as string) || contextManager.getCurrentProjectId();
      await contextManager.getContext(projectId);

      const store = getGraphStore();
      const stats = store.getEmbeddingStats();

      return {
        total: stats.total,
        withEmbedding: stats.withEmbedding,
        withoutEmbedding: stats.total - stats.withEmbedding,
        coverage: `${Math.round(stats.coverage * 100)}%`,
        hint:
          stats.coverage < 1
            ? 'Run graph_backfill_embeddings to generate missing embeddings'
            : 'All nodes have embeddings - semantic search is fully available',
      };
    }

    case 'graph_thermostat': {
      const projectId =
        (args.project as string) || contextManager.getCurrentProjectId();
      await contextManager.getContext(projectId);

      const store = getGraphStore();
      const { nodes, edges } = store.getAll();

      const total = nodes.length;
      if (total === 0) {
        return {
          metrics: { total: 0 },
          physics: { temperature: '0.00', state: 'VOID', entropy: '0.00' },
          governance: {
            strategy: 'SEED',
            directive: 'Graph is empty. Create foundational concepts.',
            recommended_tool: 'graph_add_concept',
          },
        };
      }

      // 1. Calculate Metrics
      const unresolved = nodes.filter(
        (n) => n.trigger === 'question' || n.trigger === 'tension',
      ).length;

      const connectedNodeIds = new Set<string>();
      for (const edge of edges) {
        connectedNodeIds.add(edge.fromId);
        connectedNodeIds.add(edge.toId);
      }
      const orphans = nodes.filter((n) => !connectedNodeIds.has(n.id)).length;

      // 2. Calculate Entropy (Disorder)
      // High entropy = Messy = Needs Cooling (Converge)
      // Low entropy = Ordered = Needs Heat (Diverge)
      const tensionRatio = unresolved / total;
      const fragRatio = orphans / total;

      const disorder = tensionRatio * 0.6 + fragRatio * 0.4;

      // Temperature is the inverse of disorder
      // High Disorder -> Low Temp (Freeze/Solidify)
      // Low Disorder -> High Temp (Melt/Fluid)
      const temperature = 1.0 - Math.min(disorder * 2.0, 1.0);

      // 3. Determine Phase & Strategy
      let phase: 'GAS' | 'LIQUID' | 'SOLID' = 'LIQUID';
      let strategy: 'DIVERGE' | 'MAINTAIN' | 'CONVERGE' = 'MAINTAIN';
      let directive = 'Graph is balanced. Follow curiosity or refine paths.';
      let recommendedTool = 'graph_context';

      if (temperature > 0.7) {
        phase = 'GAS';
        strategy = 'DIVERGE';
        directive =
          'Graph is too stable (stagnant). Inject chaos. Use graph_discover to find new paths.';
        recommendedTool = 'graph_discover';
      } else if (temperature < 0.3) {
        phase = 'SOLID';
        strategy = 'CONVERGE';
        directive =
          'Graph is unstable (fragmented). Crystallize understanding. Use graph_decide to resolve options or graph_connect to link orphans.';
        recommendedTool = 'graph_decide';
      }

      return {
        metrics: {
          total_nodes: total,
          unresolved_tension: `${(tensionRatio * 100).toFixed(1)}%`,
          fragmentation: `${(fragRatio * 100).toFixed(1)}%`,
        },
        physics: {
          temperature: temperature.toFixed(2),
          state: phase,
          entropy: disorder.toFixed(2),
        },
        governance: {
          strategy,
          directive,
          recommended_tool: recommendedTool,
        },
      };
    }

    case 'graph_bulk_replace': {
      const projectId =
        (args.project as string) || contextManager.getCurrentProjectId();
      await contextManager.getContext(projectId);

      const find = args.find as string | undefined;
      const replace = args.replace as string | undefined;
      const replacements = args.replacements as
        | Array<{ find: string; replace: string }>
        | undefined;
      const fields = args.fields as
        | Array<'title' | 'understanding' | 'content' | 'summary'>
        | undefined;
      const caseSensitive = args.caseSensitive as boolean | undefined;
      const preview = args.preview !== false; // Default true

      // Validate input
      const hasReplacements =
        replacements && Array.isArray(replacements) && replacements.length > 0;
      const hasSingle = find && replace !== undefined;

      if (!hasReplacements && !hasSingle) {
        return {
          error: 'Either find/replace or replacements array is required',
          usage: {
            single: { find: 'OldName', replace: 'NewName' },
            batch: {
              replacements: [
                { find: 'Oren', replace: 'Marcus' },
                { find: 'Deja', replace: 'Nova' },
              ],
            },
            options: {
              fields: ['title', 'understanding', 'content', 'summary'],
              caseSensitive: false,
              preview: true,
            },
          },
        };
      }

      const result = sqlite.bulkReplace({
        find,
        replace,
        replacements,
        fields,
        caseSensitive,
        preview,
      });

      const affectedNodes = new Set(
        result.changes.map(
          (c: {
            nodeId: string;
            field: string;
            find: string;
            replace: string;
            occurrences: number;
          }) => c.nodeId,
        ),
      ).size;

      return {
        success: true,
        preview: result.preview,
        matchCount: result.matchCount,
        replacementCount: result.replacementCount,
        nodesAffected: affectedNodes,
        summary: result.summary,
        changes: result.changes.slice(0, 50), // Limit to first 50 changes
        message: result.preview
          ? `Found ${result.matchCount} occurrences. Set preview: false to apply.`
          : `Applied ${result.matchCount} replacements across ${affectedNodes} nodes.`,
        hint: result.preview
          ? 'Review changes above, then call with preview: false to apply'
          : 'Changes applied and logged to event history',
      };
    }

    case 'graph_score': {
      const projectId =
        (args.project as string) || contextManager.getCurrentProjectId();
      await contextManager.getContext(projectId);

      const store = getGraphStore();
      const { nodes, edges } = store.getAll();
      const detailed = args.detailed as boolean | undefined;

      // Empty graph case
      if (nodes.length === 0) {
        return {
          score: 0,
          metrics: {
            thinkingIntegration: '0%',
            thinkingConceptEdges: 0,
            backwardReferences: 0,
            supersessionCount: 0,
            questionResolution: '100%',
            thinkingChainDepth: 0,
            semanticCoherence: '1.00',
            edgeTypeDiversity: '0.00',
            relatesRatio: '0%',
            connectivity: '100%',
            meaningfulEdgeRate: '100%',
          },
          issues: ['Graph is empty'],
          hint: 'Start by adding foundational concepts with graph_add_concept',
        };
      }

      // Categorize nodes
      const thinkingNodes = nodes.filter((n) => n.trigger === 'thinking');
      const questionNodes = nodes.filter((n) => n.trigger === 'question');
      const nonThinkingNodes = nodes.filter((n) => n.trigger !== 'thinking');
      const nonThinkingIds = new Set(nonThinkingNodes.map((n) => n.id));

      // 1. Thinking Integration: % thinking nodes with non-"next" edges to non-thinking nodes
      // This is the MAJOR metric - how many concept connections does each thinking block have
      let totalThinkingConceptEdges = 0;
      const thinkingEdgeCounts: Record<string, number> = {};

      for (const t of thinkingNodes) {
        const conceptEdges = edges.filter(
          (e) =>
            e.fromId === t.id &&
            e.type !== 'next' &&
            nonThinkingIds.has(e.toId),
        );
        thinkingEdgeCounts[t.id] = conceptEdges.length;
        totalThinkingConceptEdges += conceptEdges.length;
      }

      const thinkingWithConceptEdges = thinkingNodes.filter(
        (t) => thinkingEdgeCounts[t.id] > 0,
      );
      const thinkingIntegration =
        thinkingNodes.length > 0
          ? thinkingWithConceptEdges.length / thinkingNodes.length
          : 1;

      // Average edges per thinking node (quality indicator)
      const avgEdgesPerThinking =
        thinkingNodes.length > 0
          ? totalThinkingConceptEdges / thinkingNodes.length
          : 0;

      // 2. Backward References: edges from newer to older nodes (by timestamp)
      const nodeTimestamps = new Map(
        nodes.map((n) => [n.id, new Date(n.createdAt).getTime()]),
      );
      const backwardRefs = edges.filter((e) => {
        const fromTime = nodeTimestamps.get(e.fromId);
        const toTime = nodeTimestamps.get(e.toId);
        return fromTime && toTime && fromTime > toTime && e.type !== 'next';
      }).length;

      // 3. Supersession Count
      const supersessionCount = edges.filter(
        (e) => e.type === 'supersedes',
      ).length;

      // 4. Question Resolution: questions with "answers" edges pointing to them
      const answeredQuestions = questionNodes.filter((q) =>
        edges.some((e) => e.toId === q.id && e.type === 'answers'),
      );
      const questionResolution =
        questionNodes.length > 0
          ? answeredQuestions.length / questionNodes.length
          : 1;

      // 5. Thinking Chain Depth
      const chainDepth = calculateThinkingChainDepth(thinkingNodes, edges);

      // 6. Semantic Coherence
      const coherence = calculateSemanticCoherence(store, edges);

      // 7. Edge Type Diversity (Shannon entropy, penalize "relates" overuse)
      const edgeTypeCounts = new Map<string, number>();
      for (const e of edges) {
        const t = e.type || 'relates';
        edgeTypeCounts.set(t, (edgeTypeCounts.get(t) || 0) + 1);
      }
      const relatesRatio =
        edges.length > 0
          ? (edgeTypeCounts.get('relates') || 0) / edges.length
          : 0;
      const edgeTypeEntropy = calculateEntropy(edgeTypeCounts, edges.length);

      // 8. Connectivity: % of nodes that have at least one edge
      const connectedNodes = new Set<string>();
      for (const e of edges) {
        connectedNodes.add(e.fromId);
        connectedNodes.add(e.toId);
      }
      const connectivity =
        nodes.length > 0 ? connectedNodes.size / nodes.length : 1;

      // 9. Meaningful Edge Rate: edges with non-empty 'explanation' or 'why'
      const meaningfulEdges = edges.filter(
        (e) => e.explanation?.trim() || (e as { why?: string }).why?.trim(),
      );
      const meaningfulEdgeRate =
        edges.length > 0 ? meaningfulEdges.length / edges.length : 1;

      // Issues detection
      const issues: string[] = [];
      const orphanThinking = thinkingNodes.filter(
        (t) => thinkingEdgeCounts[t.id] === 0,
      );

      if (orphanThinking.length > 0) {
        issues.push(
          `${orphanThinking.length} orphan thinking node(s) with no concept connections`,
        );
      }
      if (relatesRatio > 0.5) {
        issues.push(
          `${(relatesRatio * 100).toFixed(0)}% edges are generic "relates" - use specific edge types`,
        );
      }
      if (coherence < 0.3) {
        issues.push(`Low semantic coherence (${coherence.toFixed(2)})`);
      }
      if (avgEdgesPerThinking < 1 && thinkingNodes.length > 0) {
        issues.push(
          `Low thinking density: avg ${avgEdgesPerThinking.toFixed(1)} concept edges per thinking node`,
        );
      }

      // Composite score (0-100 scale, weighted)
      // Major weight on thinking integration and concept edges per thinking node
      const score = Math.round(
        thinkingIntegration * 25 + // % thinking nodes connected
          Math.min(avgEdgesPerThinking / 3, 1) * 15 + // Quality: avg edges per thinking
          Math.min(backwardRefs / 10, 1) * 10 + // Backward references
          Math.min(supersessionCount / 5, 1) * 10 + // Belief revisions
          questionResolution * 10 + // Questions answered
          Math.min(chainDepth / 5, 1) * 5 + // Reasoning depth
          coherence * 10 + // Semantic coherence
          (1 - relatesRatio) * 5 + // Edge type quality
          connectivity * 5 + // No orphans
          meaningfulEdgeRate * 5, // Edge explanations
      );

      // Build response
      const response: Record<string, unknown> = {
        score,
        project: projectId,
        metrics: {
          thinkingIntegration: `${(thinkingIntegration * 100).toFixed(0)}%`,
          thinkingConceptEdges: totalThinkingConceptEdges,
          avgEdgesPerThinking: avgEdgesPerThinking.toFixed(1),
          backwardReferences: backwardRefs,
          supersessionCount,
          questionResolution: `${(questionResolution * 100).toFixed(0)}%`,
          thinkingChainDepth: chainDepth,
          semanticCoherence: coherence.toFixed(2),
          edgeTypeDiversity: edgeTypeEntropy.toFixed(2),
          relatesRatio: `${(relatesRatio * 100).toFixed(0)}%`,
          connectivity: `${(connectivity * 100).toFixed(0)}%`,
          meaningfulEdgeRate: `${(meaningfulEdgeRate * 100).toFixed(0)}%`,
        },
        counts: {
          totalNodes: nodes.length,
          thinkingNodes: thinkingNodes.length,
          questionNodes: questionNodes.length,
          totalEdges: edges.length,
        },
        issues: issues.length > 0 ? issues : null,
        hint:
          score < 40
            ? 'Connect thinking nodes to concepts with meaningful edges'
            : score < 70
              ? 'Good foundation. Add supersession edges when beliefs change, connect to earlier thinking.'
              : 'Strong chronological understanding structure',
      };

      // Detailed breakdown if requested
      if (detailed && orphanThinking.length > 0) {
        response.orphanThinkingNodes = orphanThinking.slice(0, 10).map((n) => ({
          id: n.id,
          text: n.title.slice(0, 80) + (n.title.length > 80 ? '...' : ''),
        }));
      }

      if (detailed) {
        // Show top thinking nodes by edge count
        const thinkingByEdges = thinkingNodes
          .map((n) => ({
            id: n.id,
            text: n.title,
            edges: thinkingEdgeCounts[n.id],
          }))
          .sort((a, b) => b.edges - a.edges)
          .slice(0, 5);
        response.topThinkingNodes = thinkingByEdges.map((n) => ({
          id: n.id,
          text: n.text.slice(0, 60) + (n.text.length > 60 ? '...' : ''),
          conceptEdges: n.edges,
        }));
      }

      return response;
    }

    default:
      throw new Error(`Unknown reflection tool: ${name}`);
  }
}
