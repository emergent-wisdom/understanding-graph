import type { TriggerType } from '../types/index.js';
import { type GraphNodeData, getGraphStore } from './GraphStore.js';

interface AnalysisNode {
  id: string;
  title: string;
  trigger: TriggerType | null;
  validated: boolean | null;
}

interface AnalysisResult {
  stats: {
    nodeCount: number;
    edgeCount: number;
    density: number;
    isolatedCount: number;
    openQuestionCount: number;
    serendipityCount: number;
    unvalidatedSerendipityCount: number;
    supersededCount: number;
    triggerDistribution: Record<string, number>;
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

  allEdges.forEach((e) => {
    if (!showEvolution && e.type === 'supersedes') return;
    if (!nodeMap.has(e.fromId) || !nodeMap.has(e.toId)) return;

    adj[e.fromId].push(e.toId);
    reverseAdj[e.toId].push(e.fromId);
  });

  // Convert to analysis nodes
  const nodes: Record<string, AnalysisNode> = {};
  activeNodes.forEach((n) => {
    nodes[n.id] = {
      id: n.id,
      title: n.title,
      trigger: n.trigger,
      validated: n.validated,
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

  // 5. Separate tight cycles from structural cycles
  const tightCycles = cycles.filter((c) => c.length <= 2);
  const structuralCycles = cycles.filter((c) => c.length > 2);

  // 6. Open questions
  const openQuestions = Object.values(nodes)
    .filter((n) => n.trigger === 'question')
    .map((n) => ({ id: n.id, title: n.title }));

  // 7. Trigger distribution (include all types so curator can see what's missing)
  const ALL_TRIGGER_TYPES: TriggerType[] = [
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
    'reference',
    'library',
    'thinking',
    'prediction',
    'evaluation',
    'hypothesis',
    'model',
  ];
  const triggerCounts: Record<string, number> = {};
  // Initialize all types to 0
  ALL_TRIGGER_TYPES.forEach((t) => {
    triggerCounts[t] = 0;
  });
  // Count existing nodes
  Object.values(nodes).forEach((n) => {
    const t = n.trigger || 'unspecified';
    triggerCounts[t] = (triggerCounts[t] || 0) + 1;
  });

  // 7b. Edge type distribution (include all types so curator can see what's missing)
  const ALL_EDGE_TYPES = [
    'supersedes',
    'contradicts',
    'refines',
    'learned_from',
    'answers',
    'questions',
    'contains',
    'next',
    'expresses',
    'relates',
  ];
  const edgeTypeCounts: Record<string, number> = {};
  // Initialize all types to 0
  ALL_EDGE_TYPES.forEach((t) => {
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
    openQuestionCount: openQuestions.length,
    serendipityCount: serendipityNodes.length,
    unvalidatedSerendipityCount: unvalidatedSerendipity.length,
    supersededCount: supersededNodeIds.size,
    triggerDistribution: triggerCounts,
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
