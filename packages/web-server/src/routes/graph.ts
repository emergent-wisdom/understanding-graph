import fs from 'node:fs';
import path from 'node:path';
import {
  AnalysisService,
  ContextService,
  createCommit,
  createDocumentWriter,
  getGraphStore,
  sqlite,
  type TriggerType,
} from '@emergent-wisdom/understanding-graph-core';
import { type Request, Router } from 'express';

export const graphRouter = Router();

// Get the full graph
graphRouter.get('/graph', (req, res, next) => {
  try {
    const showSuperseded = req.query.showSuperseded === 'true';
    const store = getGraphStore();

    if (showSuperseded) {
      // Get all nodes and edges including inactive superseded ones
      const { nodes, edges, supersededNodeIds } = store.getAllWithSuperseded();
      res.json({
        graphId: req.projectId,
        nodes,
        edges,
        nodeCount: nodes.length,
        edgeCount: edges.length,
        supersededNodeIds: Array.from(supersededNodeIds),
      });
    } else {
      // Default: only active nodes, no supersedes edges
      const { nodes, edges } = store.getAll();
      const filteredEdges = edges.filter((e) => e.type !== 'supersedes');
      res.json({
        graphId: req.projectId,
        nodes,
        edges: filteredEdges,
        nodeCount: nodes.length,
        edgeCount: filteredEdges.length,
      });
    }
  } catch (error) {
    next(error);
  }
});

// Get graph context (XML)
graphRouter.get('/graph/context', (req, res, next) => {
  try {
    const showEvolution = req.query.showEvolution === 'true';
    // compact: 'true' forces compact, 'false' forces full, undefined = auto (>50 nodes)
    const compact =
      req.query.compact === 'true'
        ? true
        : req.query.compact === 'false'
          ? false
          : undefined;
    const xml = ContextService.generateXmlContext(req.projectId, {
      showEvolution,
      compact,
    });
    res.type('text/plain').send(xml);
  } catch (error) {
    next(error);
  }
});

// Get skeleton context (minimal orientation)
graphRouter.get('/graph/skeleton', (req, res, next) => {
  try {
    const skeleton = ContextService.generateSkeletonContext(req.projectId);
    res.type('text/plain').send(skeleton);
  } catch (error) {
    next(error);
  }
});

// Find path between two nodes
graphRouter.get('/graph/path', (req, res, next) => {
  try {
    const from = req.query.from as string;
    const to = req.query.to as string;

    if (!from || !to) {
      return res
        .status(400)
        .json({ error: 'Both "from" and "to" query parameters are required' });
    }

    const path = ContextService.findPath(req.projectId, from, to);
    res.type('text/plain').send(path);
  } catch (error) {
    next(error);
  }
});

// Get graph analysis
graphRouter.get('/graph/analysis', (req, res, next) => {
  try {
    const showEvolution = req.query.showEvolution === 'true';
    const analysis = AnalysisService.analyzeGraph(req.projectId, {
      showEvolution,
    });
    res.json(analysis);
  } catch (error) {
    next(error);
  }
});

// Get random elements
graphRouter.get('/graph/random', (req, res, next) => {
  try {
    const nodeCount = parseInt(req.query.nodes as string, 10) || 3;
    const edgeCount = parseInt(req.query.edges as string, 10) || 0;

    const store = getGraphStore();
    const nodes = store.getRandomNodes(nodeCount);
    const edges = store.getRandomEdges(edgeCount);

    res.json({
      nodes: nodes.map((n) => ({
        id: n.id,
        title: n.title,
        understanding: n.understanding,
      })),
      edges: edges.map((e) => ({
        id: e.id,
        from: e.fromId,
        to: e.toId,
        explanation: e.explanation,
      })),
      hint: 'Create a synthesis from these elements',
    });
  } catch (error) {
    next(error);
  }
});

// Initialize graph (no-op now, just ensures project is ready)
graphRouter.post('/graph/init', (req, res, next) => {
  try {
    res.json({ graphId: req.projectId, initialized: true });
  } catch (error) {
    next(error);
  }
});

// Export graph
graphRouter.get('/graph/export', (req, res, next) => {
  try {
    const store = getGraphStore();
    const { nodes, edges } = store.getAll();
    res.json({
      graphId: req.projectId,
      nodes,
      edges,
      exportedAt: new Date().toISOString(),
    });
  } catch (error) {
    next(error);
  }
});

// --- Batch operations (Git for Cognition) ---

// BATCH ENDPOINT - The ONLY way to mutate the graph with commits
graphRouter.post('/graph/batch', (req, res, next) => {
  try {
    const { operations, commit_message, agent_name, author } = req.body;

    // Enforce commit_message requirement
    if (!commit_message || commit_message.trim() === '') {
      res.status(400).json({
        error: 'commit_message is REQUIRED',
        hint: 'Explain what changes you are making and why.',
      });
      return;
    }

    if (!Array.isArray(operations) || operations.length === 0) {
      res.status(400).json({
        error: 'operations array is REQUIRED and must not be empty',
      });
      return;
    }

    const store = getGraphStore();
    const results: unknown[] = [];
    const errors: Array<{ index: number; tool: string; error: string }> = [];
    const affectedNodeIds: string[] = [];
    const affectedEdgeIds: string[] = [];

    // Resolve variable references like "$0.id" in params
    function resolveRefs(
      params: Record<string, unknown>,
      results: unknown[],
    ): Record<string, unknown> {
      const resolved: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(params)) {
        if (typeof value === 'string' && value.startsWith('$')) {
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
            resolved[key] = value;
          }
        } else if (Array.isArray(value)) {
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

    // Execute each operation
    for (let i = 0; i < operations.length; i++) {
      const op = operations[i];
      try {
        const params = resolveRefs(op.params || {}, results);
        let result: Record<string, unknown> = {};

        switch (op.tool) {
          case 'graph_add_concept': {
            // Validate required fields for concept nodes
            if (!params.trigger || !params.why || !params.understanding) {
              throw new Error(
                'ILLEGAL_CONCEPT_NODE: trigger, why, and understanding are REQUIRED',
              );
            }
            const node = store.createNode({
              title: (params.text as string) || (params.name as string),
              trigger: params.trigger as TriggerType,
              why: params.why as string,
              understanding: params.understanding as string,
              conversationId: params.conversationId as string | undefined,
              sourceElements: params.sourceElements as string[] | undefined,
            });
            result = { id: node.id, title: node.title, trigger: node.trigger };
            affectedNodeIds.push(node.id);
            break;
          }
          case 'graph_connect': {
            // Find nodes by name or use ID directly
            let sourceId = params.source as string;
            let targetId = params.target as string;

            if (!sourceId.startsWith('n_') && !sourceId.startsWith('d_')) {
              const found = store.findNodeByName(sourceId);
              if (!found) throw new Error(`Source node not found: ${sourceId}`);
              sourceId = found.id;
            }
            if (!targetId.startsWith('n_') && !targetId.startsWith('d_')) {
              const found = store.findNodeByName(targetId);
              if (!found) throw new Error(`Target node not found: ${targetId}`);
              targetId = found.id;
            }

            const edge = store.createEdge({
              fromId: sourceId,
              toId: targetId,
              type: (params.type as string) || 'related',
              explanation:
                (params.relation as string) || (params.why as string),
              why: params.why as string,
            });
            result = {
              id: edge.id,
              type: edge.type,
              fromId: edge.fromId,
              toId: edge.toId,
            };
            affectedEdgeIds.push(edge.id);
            break;
          }
          case 'graph_revise': {
            // Revise/supersede an existing node with updated understanding
            const nodeId = params.nodeId as string;
            if (!nodeId) throw new Error('nodeId is required for graph_revise');

            const oldNode = store.getNode(nodeId);
            if (!oldNode) throw new Error(`Node not found: ${nodeId}`);

            // Create a new node with updated content
            const newNode = store.createNode({
              title: (params.text as string) || oldNode.title,
              trigger: (params.trigger as TriggerType) || oldNode.trigger,
              why: (params.why as string) || oldNode.why || undefined,
              understanding:
                (params.understanding as string) ||
                oldNode.understanding ||
                undefined,
              conversationId: params.conversationId as string | undefined,
            });

            // Create supersedes edge from new to old
            const supersedesEdge = store.createEdge({
              fromId: newNode.id,
              toId: oldNode.id,
              type: 'supersedes',
              explanation: (params.why as string) || 'Updated understanding',
            });

            result = {
              newNodeId: newNode.id,
              oldNodeId: oldNode.id,
              supersedesEdgeId: supersedesEdge.id,
              title: newNode.title,
              trigger: newNode.trigger,
            };
            affectedNodeIds.push(newNode.id, oldNode.id);
            affectedEdgeIds.push(supersedesEdge.id);
            break;
          }
          default:
            throw new Error(
              `Unknown tool: ${op.tool}. Use graph_add_concept, graph_connect, or graph_revise.`,
            );
        }

        results.push(result);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        errors.push({ index: i, tool: op.tool, error: errorMsg });
        results.push({ success: false, error: errorMsg });
      }
    }

    // Create commit if we have changes
    let commit: { id: string; message: string } | undefined;
    if (affectedNodeIds.length > 0 || affectedEdgeIds.length > 0) {
      const createdCommit = createCommit(
        commit_message,
        [...new Set(affectedNodeIds)],
        [...new Set(affectedEdgeIds)],
        agent_name,
        undefined, // timestamp — default to now
        author,
      );
      commit = { id: createdCommit.id, message: createdCommit.message };
    }

    res.json({
      success: errors.length === 0,
      completed: operations.length,
      total: operations.length,
      results,
      errors: errors.length > 0 ? errors : undefined,
      commit,
      message: commit
        ? `Batch completed: ${operations.length} operation(s). Commit: "${commit.message}"`
        : `Batch completed: ${operations.length} operation(s)`,
    });
  } catch (error) {
    next(error);
  }
});

// --- Node operations (READ ONLY - mutations go through /graph/batch) ---

// Get node
graphRouter.get('/graph/nodes/:nodeId', (req, res, next) => {
  try {
    const store = getGraphStore();
    const node = store.getNode(req.params.nodeId);
    if (!node) {
      return res.status(404).json({ error: 'Node not found' });
    }
    res.json(node);
  } catch (error) {
    next(error);
  }
});

// --- Edge operations (READ ONLY - mutations go through /graph/batch) ---

// Get edge
graphRouter.get('/graph/edges/:edgeId', (req, res, next) => {
  try {
    const store = getGraphStore();
    const edge = store.getEdge(req.params.edgeId);
    if (!edge) {
      return res.status(404).json({ error: 'Edge not found' });
    }
    res.json(edge);
  } catch (error) {
    next(error);
  }
});

// --- Commits ---

graphRouter.get('/commits', (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit as string, 10) || 50;
    const commits = sqlite.getRecentCommits(limit);
    // Frontend expects array directly, not wrapped object
    res.json(commits);
  } catch (error) {
    next(error);
  }
});

// --- History ---

graphRouter.get('/graph/history', (req, res, next) => {
  try {
    const { from, to, entity, limit, includeConversations } = req.query;

    const options = {
      from: from ? parseInt(from as string, 10) : undefined,
      to: to ? parseInt(to as string, 10) : undefined,
      entityId: entity as string | undefined,
      limit: limit ? parseInt(limit as string, 10) : 50,
      includeConversations: includeConversations === 'true',
    };

    const events = sqlite.getEventLog(options);
    res.json({ events, count: events.length });
  } catch (error) {
    next(error);
  }
});

graphRouter.get('/graph/history/context', (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit as string, 10) || 50;
    const xml = ContextService.generateHistoryContext(limit);
    res.type('text/plain').send(xml);
  } catch (error) {
    next(error);
  }
});

// --- Conversations ---

graphRouter.post('/conversations', (req, res, next) => {
  try {
    const { query, metadata } = req.body;
    const id = `c_${Math.random().toString(36).slice(2, 10)}`;
    sqlite.saveConversation(id, query, null, metadata || {});
    res.status(201).json({ id, query, created_at: new Date().toISOString() });
  } catch (error) {
    next(error);
  }
});

graphRouter.patch('/conversations/:id', (req, res, next) => {
  try {
    const { response } = req.body;
    sqlite.updateConversationResponse(req.params.id, response);
    res.json({ id: req.params.id, response });
  } catch (error) {
    next(error);
  }
});

graphRouter.get('/conversations/:id', (req, res, next) => {
  try {
    const conv = sqlite.getConversation(req.params.id);
    if (!conv) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
    res.json(conv);
  } catch (error) {
    next(error);
  }
});

graphRouter.get('/conversations', (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit as string, 10) || 50;
    const conversations = sqlite.getRecentConversations(limit);
    res.json(conversations);
  } catch (error) {
    next(error);
  }
});

// --- Documents ---

graphRouter.get('/documents', (_req, res, next) => {
  try {
    const documents = sqlite.getAllDocuments();
    res.json(documents);
  } catch (error) {
    next(error);
  }
});

graphRouter.get('/documents/:hash', (req, res, next) => {
  try {
    const doc = sqlite.getDocument(req.params.hash);
    if (!doc) {
      return res.status(404).json({ error: 'Document not found' });
    }
    res.json(doc);
  } catch (error) {
    next(error);
  }
});

// --- Embeddings ---

// Get embedding stats
graphRouter.get('/graph/embeddings/stats', (_req, res, next) => {
  try {
    const store = getGraphStore();
    const stats = store.getEmbeddingStats();
    res.json({
      total: stats.total,
      withEmbedding: stats.withEmbedding,
      withoutEmbedding: stats.total - stats.withEmbedding,
      coverage: `${Math.round(stats.coverage * 100)}%`,
      hint:
        stats.coverage < 1
          ? 'Run POST /graph/embeddings/backfill to generate missing embeddings'
          : 'All nodes have embeddings - semantic search is fully available',
    });
  } catch (error) {
    next(error);
  }
});

// Backfill embeddings for all nodes
graphRouter.post('/graph/embeddings/backfill', async (_req, res, next) => {
  try {
    const store = getGraphStore();
    const beforeStats = store.getEmbeddingStats();

    if (beforeStats.total === beforeStats.withEmbedding) {
      return res.json({
        message: 'All nodes already have embeddings',
        stats: beforeStats,
      });
    }

    const processed = await store.backfillEmbeddings();
    const afterStats = store.getEmbeddingStats();

    res.json({
      message: `Generated embeddings for ${processed} nodes`,
      before: beforeStats,
      after: afterStats,
      hint: 'Semantic search is now available for these nodes',
    });
  } catch (error) {
    next(error);
  }
});

// Semantic search
graphRouter.get('/graph/embeddings/search', async (req, res, next) => {
  try {
    const query = req.query.q as string;
    const limit = parseInt(req.query.limit as string, 10) || 10;

    if (!query) {
      return res.status(400).json({ error: 'Query parameter "q" is required' });
    }

    const store = getGraphStore();
    const stats = store.getEmbeddingStats();

    if (stats.withEmbedding === 0) {
      return res.status(400).json({
        error:
          'No embeddings found. Run POST /graph/embeddings/backfill first.',
        stats,
      });
    }

    const results = await store.semanticSearch(query, limit);

    res.json({
      query,
      results: results.map((r) => ({
        id: r.node.id,
        name: r.node.title,
        similarity: Math.round(r.similarity * 1000) / 1000,
        understanding:
          r.node.understanding?.slice(0, 200) +
          (r.node.understanding && r.node.understanding.length > 200
            ? '...'
            : ''),
      })),
      count: results.length,
      embeddingCoverage: `${stats.withEmbedding}/${stats.total} nodes (${Math.round(stats.coverage * 100)}%)`,
    });
  } catch (error) {
    next(error);
  }
});

// Find semantic gaps (similar nodes without connections)
graphRouter.get('/graph/embeddings/gaps', (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit as string, 10) || 20;
    const store = getGraphStore();
    const stats = store.getEmbeddingStats();

    const hasEmbeddings = stats.withEmbedding > stats.total * 0.5;

    if (hasEmbeddings) {
      const gaps = store.findSemanticGapsWithEmbeddings(limit);
      return res.json({
        method: 'embeddings',
        gaps: gaps.map((g) => ({
          node1: { id: g.node1.id, name: g.node1.title },
          node2: { id: g.node2.id, name: g.node2.title },
          similarity: Math.round((g.embeddingSimilarity || 0) * 1000) / 1000,
        })),
        count: gaps.length,
        embeddingCoverage: `${Math.round(stats.coverage * 100)}%`,
        hint: 'These node pairs are semantically similar but have no edge - consider connecting them',
      });
    }

    // Fall back to keyword-based
    const gaps = store.findSemanticGaps(limit);
    res.json({
      method: 'keywords',
      gaps: gaps.map((g) => ({
        node1: { id: g.node1.id, name: g.node1.title },
        node2: { id: g.node2.id, name: g.node2.title },
        sharedTerms: g.sharedTerms,
      })),
      count: gaps.length,
      hint: 'Run POST /graph/embeddings/backfill for semantic matching',
    });
  } catch (error) {
    next(error);
  }
});

// --- Temporal Tracking (Memory Decay) ---

// Get temporal stats
graphRouter.get('/graph/temporal/stats', (_req, res, next) => {
  try {
    const store = getGraphStore();
    const stats = store.getTemporalStats();
    res.json(stats);
  } catch (error) {
    next(error);
  }
});

// Get hot nodes (most active)
graphRouter.get('/graph/temporal/hot', (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit as string, 10) || 20;
    const store = getGraphStore();
    const hot = store.getHotNodes(limit);
    res.json({
      nodes: hot.map((h) => ({
        id: h.node.id,
        name: h.node.title,
        temperature: h.temperature,
        accessCount: h.accessCount,
      })),
      count: hot.length,
      hint: 'Hot nodes are recently/frequently accessed - core working memory',
    });
  } catch (error) {
    next(error);
  }
});

// Get cold nodes (least active, candidates for review)
graphRouter.get('/graph/temporal/cold', (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit as string, 10) || 20;
    const store = getGraphStore();
    const cold = store.getColdNodes(limit);
    res.json({
      nodes: cold.map((c) => ({
        id: c.node.id,
        name: c.node.title,
        temperature: c.temperature,
        daysSinceAccess: c.daysSinceAccess,
      })),
      count: cold.length,
      hint: 'Cold nodes are rarely accessed - consider for serendipity or review',
    });
  } catch (error) {
    next(error);
  }
});

// Record access to a node
graphRouter.post('/graph/temporal/access/:nodeId', (req, res, next) => {
  try {
    const store = getGraphStore();
    store.recordAccess(req.params.nodeId);
    const temperature = store.getNodeTemperature(req.params.nodeId);
    res.json({
      nodeId: req.params.nodeId,
      temperature,
      message: 'Access recorded',
    });
  } catch (error) {
    next(error);
  }
});

// Get temperature ranking
graphRouter.get('/graph/temporal/ranking', (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit as string, 10) || 50;
    const store = getGraphStore();
    const ranking = store.getTemperatureRanking(limit);
    res.json({
      ranking: ranking.map((r, i) => ({
        rank: i + 1,
        id: r.node.id,
        name: r.node.title,
        temperature: r.temperature,
      })),
      count: ranking.length,
    });
  } catch (error) {
    next(error);
  }
});

// --- Link Prediction ---

// Get link prediction scores between two specific nodes
graphRouter.get('/graph/links/score', (req, res, next) => {
  try {
    const node1 = req.query.node1 as string;
    const node2 = req.query.node2 as string;

    if (!node1 || !node2) {
      return res.status(400).json({
        error: 'Both node1 and node2 query parameters are required',
      });
    }

    const store = getGraphStore();

    // Check if nodes exist
    const n1 = store.getNode(node1);
    const n2 = store.getNode(node2);
    if (!n1 || !n2) {
      return res.status(404).json({
        error: `Node not found: ${!n1 ? node1 : node2}`,
      });
    }

    const scores = store.linkPredictionScore(node1, node2);

    res.json({
      node1: { id: n1.id, name: n1.title },
      node2: { id: n2.id, name: n2.title },
      scores,
      hint: 'Higher normalizedScore suggests a stronger predicted connection',
    });
  } catch (error) {
    next(error);
  }
});

// Get global edge suggestions (most valuable missing edges)
graphRouter.get('/graph/links/suggest', async (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit as string, 10) || 20;
    const store = getGraphStore();

    const suggestions = await store.suggestEdges(limit);

    res.json({
      suggestions: suggestions.map((s) => ({
        node1: { id: s.node1.id, name: s.node1.title },
        node2: { id: s.node2.id, name: s.node2.title },
        structuralScore: Math.round(s.structuralScore * 1000) / 1000,
        embeddingScore: s.embeddingScore
          ? Math.round(s.embeddingScore * 1000) / 1000
          : null,
        noveltyScore: Math.round(s.noveltyScore * 1000) / 1000,
        reason: s.reason,
      })),
      count: suggestions.length,
      hint: 'These node pairs have high structural similarity but no edge - consider connecting them',
    });
  } catch (error) {
    next(error);
  }
});

// Get edge suggestions for a specific node
graphRouter.get('/graph/links/suggest/:nodeId', async (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit as string, 10) || 10;
    const store = getGraphStore();

    const node = store.getNode(req.params.nodeId);
    if (!node) {
      return res.status(404).json({ error: 'Node not found' });
    }

    const suggestions = await store.suggestEdgesForNode(
      req.params.nodeId,
      limit,
    );

    res.json({
      forNode: { id: node.id, name: node.title },
      suggestions: suggestions.map((s) => ({
        node: { id: s.target.id, name: s.target.title },
        structuralScore: Math.round(s.structuralScore * 1000) / 1000,
        embeddingScore: s.embeddingScore
          ? Math.round(s.embeddingScore * 1000) / 1000
          : null,
        noveltyScore: Math.round(s.noveltyScore * 1000) / 1000,
        reason: s.reason,
      })),
      count: suggestions.length,
      hint: 'These nodes are likely to have meaningful connections to the target node',
    });
  } catch (error) {
    next(error);
  }
});

// --- Serendipity Engine ---

// Spreading activation from seed nodes
graphRouter.get('/graph/serendipity/activate', (req, res, next) => {
  try {
    const seeds = (req.query.seeds as string)?.split(',').filter(Boolean) || [];
    const decayFactor = parseFloat(req.query.decay as string) || 0.5;
    const maxSteps = parseInt(req.query.steps as string, 10) || 3;
    const limit = parseInt(req.query.limit as string, 10) || 20;

    if (seeds.length === 0) {
      return res.status(400).json({
        error: 'At least one seed node ID required (seeds=n_xxx,n_yyy)',
      });
    }

    const store = getGraphStore();
    const results = store.spreadingActivation(seeds, {
      decayFactor,
      maxSteps,
      temperatureWeighted: true,
    });

    res.json({
      seeds,
      activated: results.slice(0, limit).map((r) => ({
        id: r.node.id,
        name: r.node.title,
        activation: r.activation,
        pathLength: r.pathLength,
        source: r.source,
      })),
      count: Math.min(results.length, limit),
      hint: 'Nodes activated by spreading energy from seeds',
    });
  } catch (error) {
    next(error);
  }
});

// Information gain between two nodes
graphRouter.get('/graph/serendipity/info-gain', (req, res, next) => {
  try {
    const node1 = req.query.node1 as string;
    const node2 = req.query.node2 as string;

    if (!node1 || !node2) {
      return res.status(400).json({
        error: 'Both node1 and node2 query parameters required',
      });
    }

    const store = getGraphStore();
    const n1 = store.getNode(node1);
    const n2 = store.getNode(node2);

    if (!n1 || !n2) {
      return res.status(404).json({
        error: `Node not found: ${!n1 ? node1 : node2}`,
      });
    }

    const gain = store.informationGain(node1, node2);

    res.json({
      node1: { id: n1.id, name: n1.title },
      node2: { id: n2.id, name: n2.title },
      informationGain: gain,
      hint: 'Higher combined score = more surprising/novel connection',
    });
  } catch (error) {
    next(error);
  }
});

// Unified serendipity discovery
graphRouter.get('/graph/serendipity/discover', async (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit as string, 10) || 10;
    const seedStrategy = (req.query.strategy as string) || 'mixed';
    const numSeeds = parseInt(req.query.seeds as string, 10) || 3;

    const validStrategies = ['hot', 'cold', 'random', 'bridge', 'mixed'];
    if (!validStrategies.includes(seedStrategy)) {
      return res.status(400).json({
        error: `Invalid strategy. Use one of: ${validStrategies.join(', ')}`,
      });
    }

    const store = getGraphStore();
    const discoveries = await store.unifiedSerendipity({
      limit,
      seedStrategy: seedStrategy as
        | 'hot'
        | 'cold'
        | 'random'
        | 'bridge'
        | 'mixed',
      numSeeds,
    });

    res.json({
      strategy: seedStrategy,
      discoveries: discoveries.map((d) => ({
        node1: { id: d.node1.id, name: d.node1.title },
        node2: { id: d.node2.id, name: d.node2.title },
        score: d.score,
        reason: d.reason,
        sources: d.sources,
      })),
      count: discoveries.length,
      hint: 'Serendipitous connection candidates ranked by multi-algorithm scoring',
    });
  } catch (error) {
    next(error);
  }
});

// Question-focused serendipity: pair open questions with random nodes
graphRouter.get('/graph/serendipity/questions', (req, res, next) => {
  try {
    const questionsLimit = parseInt(req.query.questions as string, 10) || 5;
    const randomPerQuestion = parseInt(req.query.random as string, 10) || 3;

    const store = getGraphStore();
    const results = store.questionSerendipity({
      questionsLimit,
      randomPerQuestion,
    });

    res.json({
      pairs: results.map((r) => ({
        question: {
          id: r.question.id,
          title: r.question.title,
          understanding: r.question.understanding,
        },
        randomNodes: r.randomNodes.map((n) => ({
          id: n.id,
          title: n.title,
          trigger: n.trigger,
          understanding: n.understanding,
        })),
      })),
      count: results.length,
      hint: 'For each question, consider: does any random node help answer or reframe it?',
    });
  } catch (error) {
    next(error);
  }
});

// --- Document Structure ---

// Get all document roots
graphRouter.get('/graph/documents', (_req, res, next) => {
  try {
    const store = getGraphStore();
    const roots = store.getDocumentRoots();
    res.json({
      roots: roots.map((r) => ({
        id: r.id,
        title: r.title,
        level: r.level,
        summary: r.summary,
        createdAt: r.createdAt,
      })),
      count: roots.length,
    });
  } catch (error) {
    next(error);
  }
});

// Get document tree from a root
graphRouter.get('/graph/documents/:nodeId/tree', (req, res, next) => {
  try {
    const maxDepth = parseInt(req.query.maxDepth as string, 10) || 10;
    const brief = req.query.brief === 'true';
    const store = getGraphStore();
    const tree = store.getDocumentTree(req.params.nodeId, maxDepth);

    if (!tree) {
      return res.status(404).json({ error: 'Document root not found' });
    }

    // Brief mode: compact outline for navigation (no content/summary)
    if (brief) {
      interface BriefTree {
        id: string;
        title: string;
        level: string | null;
        childCount: number;
        children: BriefTree[];
      }

      const serializeBrief = (node: NonNullable<typeof tree>): BriefTree => ({
        id: node.node.id,
        title: node.node.title,
        level: node.node.level,
        childCount: node.children.length,
        children: node.children.map((c) => serializeBrief(c)),
      });

      return res.json(serializeBrief(tree));
    }

    // Full mode: includes content and summary
    interface SerializedTree {
      id: string;
      title: string;
      level: string | null;
      content: string | null;
      summary: string | null;
      children: SerializedTree[];
    }

    const serializeTree = (node: NonNullable<typeof tree>): SerializedTree => ({
      id: node.node.id,
      title: node.node.title,
      level: node.node.level,
      content: node.node.content,
      summary: node.node.summary,
      children: node.children.map((c) => serializeTree(c)),
    });

    res.json(serializeTree(tree));
  } catch (error) {
    next(error);
  }
});

// Read document with structure overlay (for agent reading/editing)
graphRouter.get('/graph/documents/:nodeId/read', (req, res, next) => {
  try {
    const store = getGraphStore();
    const nodeId = req.params.nodeId;
    const startNode = store.getNode(nodeId);
    const showRevisions = req.query.showRevisions === 'true';

    if (!startNode) {
      return res.status(404).json({ error: `Node not found: ${nodeId}` });
    }

    const flattened = store.flattenDocument(nodeId);

    // Get all edges to show relationships
    const { edges } = store.getAll();
    const flatNodeIds = new Set(flattened.map((f) => f.node.id));

    // Find contains and next edges within this document
    const docEdges = edges.filter(
      (e) =>
        flatNodeIds.has(e.fromId) &&
        flatNodeIds.has(e.toId) &&
        (e.type === 'contains' || e.type === 'next'),
    );

    // Build a map of relationships for each node
    const relationships = new Map<
      string,
      { parent?: string; prevSibling?: string; nextSibling?: string }
    >();

    for (const edge of docEdges) {
      if (edge.type === 'contains') {
        const existing = relationships.get(edge.toId) || {};
        existing.parent = edge.fromId;
        relationships.set(edge.toId, existing);
      } else if (edge.type === 'next') {
        const fromRel = relationships.get(edge.fromId) || {};
        fromRel.nextSibling = edge.toId;
        relationships.set(edge.fromId, fromRel);

        const toRel = relationships.get(edge.toId) || {};
        toRel.prevSibling = edge.fromId;
        relationships.set(edge.toId, toRel);
      }
    }

    // Build structure summary with relationships and revisions
    interface SectionInfo {
      id: string;
      title: string;
      level: string | null;
      depth: number;
      version: number;
      contentLength: number;
      parent?: string;
      prevSibling?: string;
      nextSibling?: string;
      revisions?: Array<{ version: number; timestamp: string; why: string }>;
    }

    const structure: SectionInfo[] = [];

    // Build annotated content with node markers and relationships
    let content = '';
    const separator = `\n${'─'.repeat(60)}\n`;

    for (const { node, depth } of flattened) {
      const fullNode = store.getNode(node.id);
      const rel = relationships.get(node.id) || {};
      const levelLabel = node.level ? ` (${node.level})` : '';
      const versionLabel = fullNode ? ` v${fullNode.version}` : '';

      const relParts: string[] = [];
      if (rel.parent) relParts.push(`parent: ${rel.parent}`);
      if (rel.prevSibling) relParts.push(`prev: ${rel.prevSibling}`);
      if (rel.nextSibling) relParts.push(`next: ${rel.nextSibling}`);
      const relStr = relParts.length > 0 ? ` [${relParts.join(', ')}]` : '';

      const header = `[${node.id}]${versionLabel} ${node.title}${levelLabel}${relStr}`;
      content += `${separator}${header}${separator}`;

      // Show revisions if requested
      if (showRevisions && fullNode && fullNode.revisions.length > 0) {
        content += '  REVISION HISTORY:\n';
        for (const rev of fullNode.revisions) {
          content += `    v${rev.version} (${rev.timestamp}): ${rev.revisionWhy}\n`;
        }
        content += `  CURRENT (v${fullNode.version}):\n`;
      }

      if (node.content) {
        content += `${node.content}\n`;
      }

      const sectionInfo: SectionInfo = {
        id: node.id,
        title: node.title,
        level: node.level,
        depth,
        version: fullNode?.version || 1,
        contentLength: node.content?.length || 0,
        ...rel,
      };

      if (showRevisions && fullNode && fullNode.revisions.length > 0) {
        sectionInfo.revisions = fullNode.revisions.map((rev) => ({
          version: rev.version,
          timestamp: rev.timestamp,
          why: rev.revisionWhy,
        }));
      }

      structure.push(sectionInfo);
    }

    res.json({
      nodeId,
      title: startNode.title,
      isDocRoot: startNode.isDocRoot || false,
      fileType: startNode.fileType || 'md',
      nodeCount: flattened.length,
      structure,
      content,
      edgeTypes: {
        contains: 'parent → child (hierarchy)',
        next: 'sibling → sibling (reading order)',
      },
    });
  } catch (error) {
    next(error);
  }
});

// Get flattened document (for rendering)
graphRouter.get('/graph/documents/:nodeId/flatten', (req, res, next) => {
  try {
    const store = getGraphStore();
    const flattened = store.flattenDocument(req.params.nodeId);

    res.json({
      rootId: req.params.nodeId,
      nodes: flattened.map((f) => ({
        id: f.node.id,
        title: f.node.title,
        level: f.node.level,
        content: f.node.content,
        summary: f.node.summary,
        depth: f.depth,
      })),
      count: flattened.length,
    });
  } catch (error) {
    next(error);
  }
});

// Get children of a document node
graphRouter.get('/graph/documents/:nodeId/children', (req, res, next) => {
  try {
    const store = getGraphStore();
    const children = store.getChildren(req.params.nodeId);

    res.json({
      parentId: req.params.nodeId,
      children: children.map((c) => ({
        id: c.id,
        title: c.title,
        level: c.level,
        content: c.content,
        summary: c.summary,
      })),
      count: children.length,
    });
  } catch (error) {
    next(error);
  }
});

// Get the next-chain from a document node
graphRouter.get('/graph/documents/:nodeId/chain', (req, res, next) => {
  try {
    const store = getGraphStore();
    const chain = store.getNextChain(req.params.nodeId);

    res.json({
      startId: req.params.nodeId,
      chain: chain.map((c) => ({
        id: c.id,
        title: c.title,
        level: c.level,
        content: c.content,
        summary: c.summary,
      })),
      length: chain.length,
    });
  } catch (error) {
    next(error);
  }
});

// Get path from document root to a node
graphRouter.get('/graph/documents/:nodeId/path', (req, res, next) => {
  try {
    const store = getGraphStore();
    const path = store.getDocumentPath(req.params.nodeId);

    if (!path) {
      return res.status(404).json({ error: 'No path to document root found' });
    }

    res.json({
      targetId: req.params.nodeId,
      path: path.map((p) => ({
        id: p.id,
        title: p.title,
        level: p.level,
        isDocRoot: p.isDocRoot,
      })),
      depth: path.length - 1,
    });
  } catch (error) {
    next(error);
  }
});

// Navigate within a document - get context for jumping around
graphRouter.get('/graph/documents/:nodeId/navigate', (req, res, next) => {
  try {
    const store = getGraphStore();
    const nodeId = req.params.nodeId;
    const node = store.getNode(nodeId);

    if (!node) {
      return res.status(404).json({ error: `Node not found: ${nodeId}` });
    }

    // Get path to root (breadcrumbs)
    const docPath = store.getDocumentPath(nodeId);
    const breadcrumbs = docPath
      ? docPath.map((p) => ({ id: p.id, title: p.title, level: p.level }))
      : [];

    // Get parent (if any)
    const parentId =
      breadcrumbs.length > 1 ? breadcrumbs[breadcrumbs.length - 2]?.id : null;

    // Get siblings (other children of same parent)
    let siblings: Array<{
      id: string;
      title: string;
      level: string | null;
      isCurrent: boolean;
    }> = [];
    if (parentId) {
      const parentChildren = store.getChildren(parentId);
      siblings = parentChildren.map((c) => ({
        id: c.id,
        title: c.title,
        level: c.level,
        isCurrent: c.id === nodeId,
      }));
    }

    // Get children of current node
    const children = store.getChildren(nodeId);
    const childList = children.map((c) => ({
      id: c.id,
      title: c.title,
      level: c.level,
    }));

    // Get node summary/content preview
    const preview =
      node.summary?.slice(0, 150) || node.content?.slice(0, 150) || null;

    res.json({
      current: {
        id: node.id,
        title: node.title,
        level: node.level,
        preview: preview
          ? preview + (preview.length >= 150 ? '...' : '')
          : null,
      },
      breadcrumbs,
      parent: parentId
        ? { id: parentId, title: breadcrumbs[breadcrumbs.length - 2]?.title }
        : null,
      siblings,
      children: childList,
      navigation: {
        canGoUp: parentId !== null,
        canGoDown: childList.length > 0,
        siblingCount: siblings.length,
        childCount: childList.length,
      },
    });
  } catch (error) {
    next(error);
  }
});

// Get concepts expressed by a document node
graphRouter.get('/graph/documents/:nodeId/concepts', (req, res, next) => {
  try {
    const store = getGraphStore();
    const concepts = store.getExpressedConcepts(req.params.nodeId);

    res.json({
      documentId: req.params.nodeId,
      concepts: concepts.map((c) => ({
        id: c.id,
        title: c.title,
        understanding: c.understanding,
      })),
      count: concepts.length,
    });
  } catch (error) {
    next(error);
  }
});

// Get document nodes that express a concept
graphRouter.get('/graph/concepts/:nodeId/documents', (req, res, next) => {
  try {
    const store = getGraphStore();
    const docs = store.getExpressingDocuments(req.params.nodeId);

    res.json({
      conceptId: req.params.nodeId,
      documents: docs.map((d) => ({
        id: d.id,
        title: d.title,
        level: d.level,
        content: d.content,
        summary: d.summary,
      })),
      count: docs.length,
    });
  } catch (error) {
    next(error);
  }
});

// --- Document Writer ---

// Store active document writers per project
const documentWriters: Map<
  string,
  ReturnType<typeof createDocumentWriter>
> = new Map();

// Get or create a document writer for the current project
function getDocumentWriter(req: Request) {
  const key = req.projectId;
  if (!documentWriters.has(key)) {
    const projectDir = req.app.locals.projectDir as string;
    const outputDir = path.join(projectDir, req.projectId, 'generated');
    documentWriters.set(
      key,
      createDocumentWriter(outputDir, { watchInterval: 1000 }),
    );
  }
  const writer = documentWriters.get(key);
  if (!writer) {
    throw new Error(`Document writer not found for key: ${key}`);
  }
  return writer;
}

// Serve PDF file for a document (if it exists)
graphRouter.get('/graph/documents/:nodeId/pdf', (req, res, next) => {
  try {
    const store = getGraphStore();
    const node = store.getNode(req.params.nodeId);

    if (!node || !node.isDocRoot) {
      return res.status(404).json({ error: 'Document not found' });
    }

    // Generate the expected PDF path based on the document title
    const projectDir = req.app.locals.projectDir as string;
    const outputDir = path.join(projectDir, req.projectId, 'generated');

    // Replicate the filename generation logic from DocumentWriter
    const title = node.title;
    const baseName = title
      .toLowerCase()
      .replace(/\.(tex|latex)$/i, '') // Remove .tex extension if present
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50);
    const pdfPath = path.join(outputDir, `${baseName}.pdf`);

    if (!fs.existsSync(pdfPath)) {
      return res
        .status(404)
        .json({ error: 'PDF not found', expectedPath: pdfPath });
    }

    // Serve the PDF file
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${baseName}.pdf"`);
    res.sendFile(pdfPath);
  } catch (error) {
    next(error);
  }
});

// Generate a single document to file (POST)
graphRouter.post('/graph/documents/:nodeId/generate', (req, res, next) => {
  try {
    const writer = getDocumentWriter(req);
    const result = writer.writeDocument(req.params.nodeId);

    if (!result) {
      return res
        .status(404)
        .json({ error: 'Document not found or not a document root' });
    }

    res.json({
      success: true,
      ...result,
      message: `Document written to ${result.outputPath}`,
    });
  } catch (error) {
    next(error);
  }
});

// Generate a single document to file (GET - for easy browser/curl access)
graphRouter.get('/graph/documents/:nodeId/generate', (req, res, next) => {
  try {
    const writer = getDocumentWriter(req);
    const result = writer.writeDocument(req.params.nodeId);

    if (!result) {
      return res
        .status(404)
        .json({ error: 'Document not found or not a document root' });
    }

    res.json({
      success: true,
      ...result,
      message: `Document written to ${result.outputPath}`,
    });
  } catch (error) {
    next(error);
  }
});

// Generate all documents to files (POST)
graphRouter.post('/graph/documents/generate-all', (req, res, next) => {
  try {
    const writer = getDocumentWriter(req);
    const results = writer.writeAllDocuments();

    res.json({
      success: true,
      documents: results,
      count: results.length,
      message: `Generated ${results.length} documents`,
    });
  } catch (error) {
    next(error);
  }
});

// Generate all documents to files (GET - for easy browser/curl access)
graphRouter.get('/graph/documents/generate-all', (req, res, next) => {
  try {
    const writer = getDocumentWriter(req);
    const results = writer.writeAllDocuments();

    res.json({
      success: true,
      documents: results,
      count: results.length,
      message: `Generated ${results.length} documents`,
    });
  } catch (error) {
    next(error);
  }
});

// Start watching a document for changes
graphRouter.post('/graph/documents/:nodeId/watch', (req, res, next) => {
  try {
    const writer = getDocumentWriter(req);
    writer.watchDocument(req.params.nodeId);

    res.json({
      success: true,
      nodeId: req.params.nodeId,
      message: `Now watching document for changes`,
    });
  } catch (error) {
    next(error);
  }
});

// Start watching all documents
graphRouter.post('/graph/documents/watch-all', (req, res, next) => {
  try {
    const writer = getDocumentWriter(req);
    writer.watchAllDocuments();

    const store = getGraphStore();
    const roots = store.getDocumentRoots();

    res.json({
      success: true,
      watching: roots.map((r) => ({ id: r.id, title: r.title })),
      count: roots.length,
      message: `Now watching ${roots.length} documents for changes`,
    });
  } catch (error) {
    next(error);
  }
});

// Stop watching documents
graphRouter.post('/graph/documents/stop-watch', (req, res, next) => {
  try {
    const writer = getDocumentWriter(req);
    writer.stopAll();

    res.json({
      success: true,
      message: 'Stopped watching all documents',
    });
  } catch (error) {
    next(error);
  }
});

// Generate all documents across all projects
graphRouter.post('/graph/documents/generate-all-projects', (req, res, next) => {
  try {
    const projectDir = req.app.locals.projectDir as string;
    const allResults: Array<{
      project: string;
      documents: Array<{
        rootId: string;
        outputPath: string;
        nodeCount: number;
        fileType: string;
        pdfPath?: string;
        compileError?: string;
      }>;
    }> = [];

    // Get all project directories
    const projects = fs.readdirSync(projectDir).filter((name: string) => {
      const projectPath = path.join(projectDir, name);
      return (
        fs.statSync(projectPath).isDirectory() &&
        fs.existsSync(path.join(projectPath, 'store.db'))
      );
    });

    // Generate documents for each project
    for (const projectId of projects) {
      const projectPath = path.join(projectDir, projectId);
      sqlite.initDatabase(projectPath);

      const outputDir = path.join(projectDir, projectId, 'generated');
      const writer = createDocumentWriter(outputDir, { watchInterval: 1000 });
      const results = writer.writeAllDocuments();

      if (results.length > 0) {
        allResults.push({
          project: projectId,
          documents: results,
        });
      }
    }

    // Switch back to the original project
    const originalProject = req.projectId;
    const originalPath = path.join(projectDir, originalProject);
    if (fs.existsSync(originalPath)) {
      sqlite.initDatabase(originalPath);
    }

    res.json({
      success: true,
      projects: allResults,
      totalProjects: allResults.length,
      totalDocuments: allResults.reduce(
        (sum, p) => sum + p.documents.length,
        0,
      ),
      message: `Generated documents across ${allResults.length} projects`,
    });
  } catch (error) {
    next(error);
  }
});
