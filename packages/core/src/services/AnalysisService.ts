import { EDGE_TYPES, TRIGGER_TYPES, type TriggerType } from '../types/index.js';
import { reservedThinkingVisible } from '../visibility.js';
import { type GraphNodeData, getGraphStore } from './GraphStore.js';

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

// Analyze graph structure
export function analyzeGraph(
  _projectId: string,
  options: { showEvolution?: boolean } = {},
): AnalysisResult {
  const { showEvolution = false } = options;
  const store = getGraphStore();

  // Get all nodes and edges
  const { nodes: allNodes, edges: allEdges } = store.getAll();

  // Find supersession info
  const supersessionEdges = allEdges.filter((e) => e.type === 'supersedes');
  const supersededNodeIds = new Set(supersessionEdges.map((e) => e.toId));

  // Filter nodes based on showEvolution
  let activeNodes = allNodes;
  if (!showEvolution) {
    activeNodes = allNodes.filter((n) => !supersededNodeIds.has(n.id));
  }

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

  // When a superseded node is hidden, its incident edges must follow it to
  // whatever replaced it rather than being dropped.
  //
  // Dropping them silently orphans nodes that are still connected. Measured on
  // a real graph: one node's only edge pointed at a node that had been
  // superseded, so the edge vanished from the analysis and the node was
  // reported isolated — while graph_score, which does not hide anything,
  // reported 100% connectivity on the same graph. Revising a position is the
  // behaviour this tool exists to encourage, and it was being repaid with a
  // phantom defect in the statistic meant to detect exactly that.
  //
  // Redirection is what supersession already means: if C replaces B, then in a
  // view that hides B an edge onto B is an edge onto C. Chains are followed to
  // the end, and an edge that collapses onto its own endpoint is dropped
  // rather than recorded as a self-loop.
  const supersededBy = new Map<string, string>();
  for (const e of supersessionEdges) supersededBy.set(e.toId, e.fromId);
  const resolve = (id: string): string => {
    let current = id;
    const seen = new Set<string>([current]);
    while (!nodeMap.has(current)) {
      const next = supersededBy.get(current);
      if (!next || seen.has(next)) return current;
      seen.add(next);
      current = next;
    }
    return current;
  };

  allEdges.forEach((e) => {
    if (!showEvolution && e.type === 'supersedes') return;

    const from = showEvolution ? e.fromId : resolve(e.fromId);
    const to = showEvolution ? e.toId : resolve(e.toId);
    if (!nodeMap.has(from) || !nodeMap.has(to)) return;
    if (from === to) return;

    adj[from].push(to);
    reverseAdj[to].push(from);
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

  // 6. Open questions
  const openQuestions = Object.values(nodes)
    .filter((n) => n.trigger === 'question')
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
