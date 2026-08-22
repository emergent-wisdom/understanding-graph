import { EDGE_TYPES, TRIGGER_TYPES, type TriggerType } from '../types/index.js';
import { reservedThinkingVisible } from '../visibility.js';
import {
  type GraphEdgeData,
  type GraphNodeData,
  getGraphStore,
} from './GraphStore.js';

/**
 * Artifact units (prose passages, code units, document roots) as opposed to
 * cognitive testimony. They are stored with why='Document node' and their
 * `trigger` defaults to 'foundation' because the column is required — not
 * because a passage is a foundational concept.
 *
 * Reserved `thinking` blocks are deliberately NOT artifacts even though they
 * are document-shaped: they are the synthetic Reader/CMP corpus, and how many
 * exist is exactly what the distribution should report. They are already
 * mode-gated by visibility projection.
 */
function isDocumentNode(n: GraphNodeData): boolean {
  return n.why === 'Document node' && n.trigger !== 'thinking';
}

interface AnalysisNode {
  id: string;
  title: string;
  trigger: TriggerType | null;
  validated: boolean | null;
  /** Prose/code unit rather than cognitive testimony. See isDocumentNode. */
  isArtifact: boolean;
}

interface AnalysisResult {
  stats: {
    nodeCount: number;
    edgeCount: number;
    density: number;
    isolatedCount: number;
    /** Document nodes touching no cognitive node — prose with no thinking attached. */
    ungroundedProseCount: number;
    openQuestionCount: number;
    serendipityCount: number;
    unvalidatedSerendipityCount: number;
    supersededCount: number;
    triggerDistribution: Record<string, number>;
    /** Prose/code units, counted separately: they are not kinds of thinking. */
    artifactNodeCount: number;
    showingEvolution: boolean;
  };
  centrality: Array<{
    id: string;
    title: string;
    inDegree: number;
    outDegree: number;
    totalDegree: number;
  }>;
  openQuestions: Array<{ id: string; title: string }>;
  serendipityNodes: Array<{ id: string; title: string; validated: boolean }>;
  tightCycles: string[][];
  structuralCycles: string[][];
  cycles: string[][];
  bridges: Array<{ id: string; title: string; degree: number }>;
  isolatedNodes: Array<{ id: string; title: string }>;
  ungroundedProse: Array<{ id: string; title: string }>;
  evolution?: {
    supersededNodes: string[];
    supersessionEdges: Array<{
      superseder: { id: string; title: string };
      superseded: { id: string; title: string };
      explanation: string;
    }>;
  };
}

/**
 * Project historical graph data onto the nodes that are active now.
 *
 * A dedicated supersession archives the displaced node but deliberately keeps
 * its edges for history. In a current-state diagnostic, ordinary edges that
 * touched that node therefore follow the supersession chain to the surviving
 * replacement. The supersession edge itself collapses to a self-loop and is
 * omitted from the active shape; callers that measure revision history should
 * count it from the historical edges instead.
 */
export function projectActiveGraph(
  nodes: GraphNodeData[],
  edges: GraphEdgeData[],
): { nodes: GraphNodeData[]; edges: GraphEdgeData[] } {
  const activeNodes = nodes.filter((node) => node.active);
  const activeNodeIds = new Set(activeNodes.map((node) => node.id));
  const supersededBy = new Map(
    edges
      .filter((edge) => edge.type === 'supersedes')
      .map((edge) => [edge.toId, edge.fromId]),
  );

  const resolveActive = (id: string): string | null => {
    let current = id;
    const seen = new Set<string>();
    while (!activeNodeIds.has(current)) {
      if (seen.has(current)) return null;
      seen.add(current);
      const replacement = supersededBy.get(current);
      if (!replacement) return null;
      current = replacement;
    }
    return current;
  };

  const activeEdges: GraphEdgeData[] = [];
  for (const edge of edges) {
    const fromId = resolveActive(edge.fromId);
    const toId = resolveActive(edge.toId);
    if (!fromId || !toId || fromId === toId) continue;
    activeEdges.push(
      fromId === edge.fromId && toId === edge.toId
        ? edge
        : { ...edge, fromId, toId, from: fromId, to: toId },
    );
  }

  return { nodes: activeNodes, edges: activeEdges };
}

// Analyze graph structure
export function analyzeGraph(
  _projectId: string,
  options: { showEvolution?: boolean } = {},
): AnalysisResult {
  const { showEvolution = false } = options;
  const store = getGraphStore();

  // Both views need the lifecycle edges that active-only getAll() omits.
  const {
    nodes: allNodes,
    edges: allEdges,
    supersededNodeIds,
  } = store.getAllWithSuperseded();
  const supersessionEdges = allEdges.filter(
    (edge) => edge.type === 'supersedes',
  );
  const activeProjection = projectActiveGraph(allNodes, allEdges);
  const activeNodes = showEvolution ? allNodes : activeProjection.nodes;
  const analysisEdges = showEvolution ? allEdges : activeProjection.edges;

  // Build node map
  const nodeMap = new Map<string, GraphNodeData>();
  for (const n of activeNodes) {
    nodeMap.set(n.id, n);
  }

  // Build adjacency
  const adj: Record<string, string[]> = {};
  const reverseAdj: Record<string, string[]> = {};

  activeNodes.forEach((n) => {
    adj[n.id] = [];
    reverseAdj[n.id] = [];
  });

  analysisEdges.forEach((edge) => {
    if (!nodeMap.has(edge.fromId) || !nodeMap.has(edge.toId)) return;
    adj[edge.fromId].push(edge.toId);
    reverseAdj[edge.toId].push(edge.fromId);
  });

  // Convert to analysis nodes
  const nodes: Record<string, AnalysisNode> = {};
  activeNodes.forEach((n) => {
    nodes[n.id] = {
      id: n.id,
      title: n.title,
      trigger: n.trigger,
      validated: n.validated,
      isArtifact: isDocumentNode(n),
    };
  });

  // --- Analysis Algorithms ---

  // 1. Centrality (Degree)
  const centrality = Object.keys(nodes)
    .map((id) => {
      const inDegree = reverseAdj[id]?.length || 0;
      const outDegree = adj[id]?.length || 0;
      return {
        id,
        title: nodes[id].title,
        inDegree,
        outDegree,
        totalDegree: inDegree + outDegree,
      };
    })
    .sort((a, b) => b.totalDegree - a.totalDegree);

  // 2. Cycle Detection (DFS)
  const cycles: string[][] = [];
  const visited = new Set<string>();
  const recursionStack = new Set<string>();

  function dfs(u: string, path: string[]): void {
    visited.add(u);
    recursionStack.add(u);
    path.push(u);

    const neighbors = adj[u] || [];
    for (const v of neighbors) {
      if (!visited.has(v)) {
        dfs(v, path);
      } else if (recursionStack.has(v)) {
        // Cycle detected
        const cycleStartIndex = path.indexOf(v);
        cycles.push(path.slice(cycleStartIndex).map((id) => nodes[id].title));
      }
    }

    recursionStack.delete(u);
    path.pop();
  }

  Object.keys(nodes).forEach((id) => {
    if (!visited.has(id)) {
      dfs(id, []);
    }
  });

  // 3. Bridges / Novel Connections
  const maxDegree = centrality.length > 0 ? centrality[0].totalDegree : 0;
  const bridges = centrality
    .filter((n) => n.totalDegree > 3 && n.totalDegree < maxDegree)
    .slice(0, 5)
    .map((n) => ({ id: n.id, title: n.title, degree: n.totalDegree }));

  // 4. Isolated nodes
  const allConnected = new Set<string>();
  for (const id of Object.keys(adj)) {
    if (adj[id].length > 0) allConnected.add(id);
    for (const targetId of adj[id]) {
      allConnected.add(targetId);
    }
  }
  const isolatedNodes = Object.keys(nodes)
    .filter((id) => !allConnected.has(id))
    .map((id) => ({ id, title: nodes[id].title }));

  // 4b. Prose that no thinking is attached to.
  //
  // Orphan prevention cannot catch this. Creating passages auto-creates
  // `contains` and `next` edges, so a passage has edges from the moment it
  // exists and can never be reported as isolated — while being connected to
  // nothing but its own siblings and its parent document. The existing check
  // asks whether a node is attached to anything; this asks whether anything
  // was thought about it.
  //
  // Measured on two real projects when this was added: 5 of 6 document nodes
  // in one and 7 of 18 in the other touched no cognitive node at all. Neither
  // graph reported a single defect, and the gap was first spotted by a human
  // looking at a picture of it — which is the argument for counting it here
  // rather than leaving it to be noticed.
  const ungroundedProse = Object.keys(nodes)
    .filter((id) => nodes[id].isArtifact)
    .filter(
      (id) =>
        ![...(adj[id] || []), ...(reverseAdj[id] || [])].some(
          (other) => nodes[other] && !nodes[other].isArtifact,
        ),
    )
    .map((id) => ({ id, title: nodes[id].title }));

  // 5. Separate tight cycles from structural cycles
  const tightCycles = cycles.filter((c) => c.length <= 2);
  const structuralCycles = cycles.filter((c) => c.length > 2);

  // 6. Open questions. A question with an inbound answers edge remains in
  //    history but is no longer an unresolved prompt for the next move.
  const answeredQuestionIds = new Set(
    allEdges.filter((edge) => edge.type === 'answers').map((edge) => edge.toId),
  );
  const openQuestions = Object.values(nodes)
    .filter((n) => n.trigger === 'question' && !answeredQuestionIds.has(n.id))
    .map((n) => ({ id: n.id, title: n.title }));

  // 7. Trigger distribution (include all types so curator can see what's missing)
  const triggerCounts: Record<string, number> = {};
  // Initialize all types to 0
  TRIGGER_TYPES.filter(
    (trigger) => reservedThinkingVisible() || trigger !== 'thinking',
  ).forEach((t) => {
    triggerCounts[t] = 0;
  });
  // Count existing nodes — cognitive testimony only.
  //
  // Document nodes are persisted with trigger 'foundation' (see
  // GraphStore.createDocumentNode) because the column is required, not
  // because a prose passage is a foundational concept. Counting them here
  // makes a manuscript look like a pile of unstructured priors: a 36-prose
  // /16-cognition graph reports 36 'foundation', drowning the eight real
  // kinds of understanding it contains. The distribution answers "what
  // kinds of thinking are here", and prose is not one of the answers.
  const artifactCount = { n: 0 };
  Object.values(nodes).forEach((n) => {
    if (n.isArtifact) {
      artifactCount.n += 1;
      return;
    }
    const t = n.trigger || 'unspecified';
    triggerCounts[t] = (triggerCounts[t] || 0) + 1;
  });

  // 7b. Edge type distribution (include all types so curator can see what's missing)
  const edgeTypeCounts: Record<string, number> = {};
  // Initialize all types to 0
  EDGE_TYPES.forEach((t) => {
    edgeTypeCounts[t] = 0;
  });
  // Count existing edges
  allEdges.forEach((e) => {
    const t = e.type || 'unspecified';
    edgeTypeCounts[t] = (edgeTypeCounts[t] || 0) + 1;
  });

  // 8. Serendipity nodes
  const serendipityNodes = Object.values(nodes)
    .filter((n) => n.trigger === 'serendipity')
    .map((n) => ({
      id: n.id,
      title: n.title,
      validated: n.validated === true,
    }));
  const unvalidatedSerendipity = serendipityNodes.filter((n) => !n.validated);

  // 9. Statistics
  const nodeCount = Object.keys(nodes).length;
  const edgeCount = Object.values(adj).reduce(
    (acc, curr) => acc + curr.length,
    0,
  );
  const maxPossibleEdges = nodeCount * (nodeCount - 1);
  const density = maxPossibleEdges > 0 ? edgeCount / maxPossibleEdges : 0;

  const stats = {
    nodeCount,
    edgeCount,
    density: parseFloat(density.toFixed(4)),
    isolatedCount: isolatedNodes.length,
    ungroundedProseCount: ungroundedProse.length,
    openQuestionCount: openQuestions.length,
    serendipityCount: serendipityNodes.length,
    unvalidatedSerendipityCount: unvalidatedSerendipity.length,
    supersededCount: supersededNodeIds.size,
    triggerDistribution: triggerCounts,
    artifactNodeCount: artifactCount.n,
    edgeTypeDistribution: edgeTypeCounts,
    showingEvolution: showEvolution,
  };

  const response: AnalysisResult = {
    stats,
    centrality: centrality.slice(0, 10),
    openQuestions,
    serendipityNodes,
    tightCycles,
    structuralCycles,
    cycles,
    bridges,
    isolatedNodes: isolatedNodes.slice(0, 20),
    ungroundedProse: ungroundedProse.slice(0, 20),
  };

  if (showEvolution) {
    response.evolution = {
      supersededNodes: Array.from(supersededNodeIds),
      supersessionEdges: supersessionEdges.map((e) => ({
        superseder: {
          id: e.fromId,
          title: allNodes.find((n) => n.id === e.fromId)?.title || '',
        },
        superseded: {
          id: e.toId,
          title: allNodes.find((n) => n.id === e.toId)?.title || '',
        },
        explanation: e.explanation || '',
      })),
    };
  }

  return response;
}
