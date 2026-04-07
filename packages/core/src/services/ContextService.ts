import {
  getCommitForNode,
  getDb,
  getRecentEvents,
} from '../database/sqlite.js';
import type { TriggerType } from '../types/index.js';
import {
  type GraphEdgeData,
  type GraphNodeData,
  getGraphStore,
} from './GraphStore.js';

// Helper to escape XML special characters
function escapeXml(str: string | null | undefined): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Rough token estimation (4 chars per token on average)
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// Field visibility options
export type DetailLevel = 'titles' | 'brief' | 'full';
export type IncludableField =
  | 'title'
  | 'understanding'
  | 'why'
  | 'content'
  | 'summary'
  | 'edges'
  | 'trigger';

export interface FieldVisibilityOptions {
  detailLevel?: DetailLevel;
  includeFields?: string[];
  hideDocumentProse?: boolean;
}

// Resolve detail_level and include_fields into a set of visible fields
function resolveVisibleFields(
  options: FieldVisibilityOptions,
): Set<IncludableField> {
  const { detailLevel = 'full', includeFields, hideDocumentProse } = options;

  // If explicit fields provided, use those (but always include title)
  if (includeFields && includeFields.length > 0) {
    const fields = new Set<IncludableField>(includeFields as IncludableField[]);
    fields.add('title'); // Title is always included
    if (hideDocumentProse) {
      fields.delete('content');
    }
    return fields;
  }

  // Otherwise use detail_level presets
  switch (detailLevel) {
    case 'titles':
      return new Set(['title', 'trigger'] as IncludableField[]);
    case 'brief':
      return new Set([
        'title',
        'trigger',
        'understanding',
        'edges',
      ] as IncludableField[]);
    default: {
      const fields = new Set([
        'title',
        'trigger',
        'understanding',
        'why',
        'content',
        'summary',
        'edges',
      ] as IncludableField[]);
      if (hideDocumentProse) {
        fields.delete('content');
      }
      return fields;
    }
  }
}

// Check if field should be included
function shouldInclude(
  field: IncludableField,
  visibleFields: Set<IncludableField>,
): boolean {
  return visibleFields.has(field);
}

// Truncate understanding for 'brief' mode
function truncateForBrief(
  text: string | null | undefined,
  maxLen = 100,
): string {
  if (!text) return '';
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen)}...`;
}

interface RegionSummary {
  id: number;
  nodeCount: number;
  topConcepts: Array<{ id: string; name: string; degree: number }>;
  triggerDistribution: Record<string, number>;
  sampleRelationships: Array<{ from: string; relation: string; to: string }>;
}

interface NodeWithConnections {
  id: string;
  title: string;
  trigger: TriggerType | null;
  why: string | null;
  understanding: string | null;
  validated?: boolean | null;
  outgoing: Array<{
    targetId: string;
    targetTitle: string;
    explanation: string | null;
    why: string | null;
  }>;
  incoming: Array<{
    sourceId: string;
    sourceTitle: string;
    explanation: string | null;
  }>;
}

// Get delta updates since a timestamp
// NOTE: projectId is currently unused - getDb() returns current project's DB.
// TODO: Support cross-project queries if needed in the future.
export function getUpdatesSince(_projectId: string, since: string): string {
  const db = getDb();
  const store = getGraphStore();

  // 1. Get new/modified nodes
  const nodeRows = db
    .prepare(
      `SELECT id FROM nodes
       WHERE (updated_at >= ? OR created_at >= ?) AND active = 1
       ORDER BY COALESCE(updated_at, created_at) DESC`,
    )
    .all(since, since) as Array<{ id: string }>;

  const nodes = nodeRows
    .map((row) => store.getNode(row.id))
    .filter((n): n is GraphNodeData => n !== null);

  // 2. Get new/modified edges
  const edgeRows = db
    .prepare(
      `SELECT id FROM edges
       WHERE (updated_at >= ? OR created_at >= ?) AND active = 1
       ORDER BY COALESCE(updated_at, created_at) DESC`,
    )
    .all(since, since) as Array<{ id: string }>;

  const edges = edgeRows
    .map((row) => store.getEdge(row.id))
    .filter((e): e is GraphEdgeData => e !== null);

  // 3. Get recent tool actions (includes both successes and failures)
  // Errors are indicated by status="failed" with failure_reason
  const actionsRows = db
    .prepare(
      `SELECT tool_name, error, created_at, result, arguments
       FROM tool_calls
       WHERE created_at >= ?
       ORDER BY created_at DESC`,
    )
    .all(since) as Array<{
    tool_name: string;
    error: string | null;
    created_at: string;
    result: string | null;
    arguments: string;
  }>;

  // 4. Get recent commits (the "metacognitive stream" - why agents made changes)
  const commitRows = db
    .prepare(
      `SELECT id, message, agent_name, node_ids, created_at
       FROM commits
       WHERE created_at >= ?
       ORDER BY created_at DESC`,
    )
    .all(since) as Array<{
    id: string;
    message: string;
    agent_name: string | null;
    node_ids: string;
    created_at: string;
  }>;

  // Build XML response
  let out = `<graph_updates since="${since}" timestamp="${new Date().toISOString()}">\n`;

  // Nodes
  if (nodes.length > 0) {
    out += `  <changed_nodes count="${nodes.length}">\n`;
    for (const n of nodes) {
      out += `    <node id="${n.id}" trigger="${n.trigger || 'general'}">\n`;
      out += `      <name>${escapeXml(n.title)}</name>\n`;
      if (n.understanding) {
        out += `      <understanding>${escapeXml(truncateForBrief(n.understanding, 150))}</understanding>\n`;
      }
      out += `    </node>\n`;
    }
    out += `  </changed_nodes>\n`;
  }

  // Edges
  if (edges.length > 0) {
    out += `  <changed_edges count="${edges.length}">\n`;
    for (const e of edges) {
      const from = store.getNode(e.fromId)?.title || e.fromId;
      const to = store.getNode(e.toId)?.title || e.toId;
      out += `    <edge id="${e.id}" type="${e.type}">\n`;
      out += `      <from>${escapeXml(from)}</from>\n`;
      out += `      <relation>${escapeXml(e.explanation)}</relation>\n`;
      out += `      <to>${escapeXml(to)}</to>\n`;
      out += `    </edge>\n`;
    }
    out += `  </changed_edges>\n`;
  }

  // Actions (unified - no separate errors section)
  if (actionsRows.length > 0) {
    const failedCount = actionsRows.filter((a) => a.error).length;
    out += `  <recent_actions count="${actionsRows.length}" failed="${failedCount}">\n`;
    for (const act of actionsRows) {
      const status = act.error ? 'failed' : 'success';
      let argsSummary = '';
      try {
        const args = JSON.parse(act.arguments || '{}');
        // Summarize args (truncate long values)
        if (args.title)
          argsSummary += `title="${truncateForBrief(args.title, 30)}" `;
        if (args.from) argsSummary += `from="${args.from}" `;
        if (args.to) argsSummary += `to="${args.to}" `;
        if (args.nodeId) argsSummary += `id="${args.nodeId}" `;
      } catch {
        argsSummary = '';
      }

      out += `    <action tool="${act.tool_name}" status="${status}" timestamp="${act.created_at}">\n`;
      if (argsSummary.trim()) {
        out += `      <summary>${escapeXml(argsSummary.trim())}</summary>\n`;
      }
      if (act.error) {
        out += `      <failure_reason>${escapeXml(truncateForBrief(act.error, 200))}</failure_reason>\n`;
      }
      out += `    </action>\n`;
    }
    out += `  </recent_actions>\n`;
  }

  // Commits (the metacognitive stream - shows WHY agents made changes)
  if (commitRows.length > 0) {
    out += `  <recent_commits count="${commitRows.length}">\n`;
    out += `    <!-- These are agent reflections on their changes - the "why" behind the "what" -->\n`;
    for (const c of commitRows) {
      out += `    <commit id="${c.id}" agent="${c.agent_name || 'unknown'}" timestamp="${c.created_at}">\n`;
      out += `      <message>${escapeXml(c.message)}</message>\n`;
      // Show which nodes were affected so agents can link intent to content
      try {
        const affectedNodes = JSON.parse(c.node_ids || '[]') as string[];
        if (affectedNodes.length > 0) {
          out += `      <affected_nodes>${affectedNodes.join(', ')}</affected_nodes>\n`;
        }
      } catch {
        // Skip if node_ids parsing fails
      }
      out += `    </commit>\n`;
    }
    out += `  </recent_commits>\n`;
  }

  if (
    nodes.length === 0 &&
    edges.length === 0 &&
    actionsRows.length === 0 &&
    commitRows.length === 0
  ) {
    out += `  <status>No updates since ${since}</status>\n`;
  }

  out += `</graph_updates>`;
  return out;
}

// Generate XML context for AI consumption
export function generateXmlContext(
  _projectId: string,
  options: {
    showEvolution?: boolean;
    maxTokens?: number;
    compact?: boolean;
    detailLevel?: DetailLevel;
    includeFields?: string[];
    hideDocumentProse?: boolean;
    nodeId?: string;
  } = {},
): string {
  const {
    showEvolution = false,
    maxTokens,
    compact,
    detailLevel,
    includeFields,
    hideDocumentProse,
    nodeId,
  } = options;
  const visibleFields = resolveVisibleFields({
    detailLevel,
    includeFields,
    hideDocumentProse,
  });
  const isBrief = detailLevel === 'brief';
  const store = getGraphStore();

  // If nodeId is provided, return focused context around that node
  if (nodeId) {
    return generateFocusedContext(_projectId, nodeId, {
      showEvolution,
      detailLevel,
      includeFields,
      hideDocumentProse,
    });
  }

  // Determine if we should use compact mode
  // Auto-enable if graph is large (>50 nodes) unless explicitly requested otherwise
  const { nodes: allNodes } = store.getAll();
  const useCompact =
    compact === true || (compact === undefined && allNodes.length > 50);

  if (useCompact) {
    return generateCompactContext(_projectId, {
      showEvolution,
      maxTokens,
      detailLevel,
      includeFields,
      hideDocumentProse,
    });
  }

  // Get all nodes and edges (full context mode)
  const { edges: allEdges } = store.getAll();

  // Filter out superseded nodes unless showEvolution is true
  let activeNodes = allNodes;
  if (!showEvolution) {
    const supersededIds = new Set(
      allEdges.filter((e) => e.type === 'supersedes').map((e) => e.toId),
    );
    activeNodes = allNodes.filter((n) => !supersededIds.has(n.id));
  }

  // Build node map
  const nodeMap = new Map<string, GraphNodeData>();
  for (const n of activeNodes) {
    nodeMap.set(n.id, n);
  }

  // Build adjacency
  const outgoingEdges = new Map<string, GraphEdgeData[]>();
  const incomingEdges = new Map<string, GraphEdgeData[]>();

  allEdges.forEach((e) => {
    if (!showEvolution && e.type === 'supersedes') return;
    if (!nodeMap.has(e.fromId) || !nodeMap.has(e.toId)) return;

    if (!outgoingEdges.has(e.fromId)) outgoingEdges.set(e.fromId, []);
    outgoingEdges.get(e.fromId)?.push(e);

    if (!incomingEdges.has(e.toId)) incomingEdges.set(e.toId, []);
    incomingEdges.get(e.toId)?.push(e);
  });

  // Build nodes with connections
  const nodes: NodeWithConnections[] = activeNodes.map((n) => {
    const outgoing = (outgoingEdges.get(n.id) || []).map((e) => ({
      targetId: e.toId,
      targetTitle: nodeMap.get(e.toId)?.title || '',
      explanation: e.explanation,
      why: e.why,
    }));
    const incoming = (incomingEdges.get(n.id) || []).map((e) => ({
      sourceId: e.fromId,
      sourceTitle: nodeMap.get(e.fromId)?.title || '',
      explanation: e.explanation,
    }));
    return {
      id: n.id,
      title: n.title,
      trigger: n.trigger,
      why: n.why,
      understanding: n.understanding,
      validated: n.validated,
      outgoing,
      incoming,
    };
  });

  if (nodes.length === 0) {
    return `<understanding_graph>
<meta>
  <topic>Understanding Graph</topic>
  <concepts>0</concepts>
  <relationships>0</relationships>
  <as_of>${new Date().toISOString()}</as_of>
</meta>
<status>No concepts mapped yet. Start by discussing the topic to build understanding.</status>
</understanding_graph>`;
  }

  // Count relationships
  const relationshipCount = nodes.reduce(
    (sum, n) => sum + (n.outgoing?.length || 0),
    0,
  );

  // Build XML-structured context
  const asOf = new Date().toISOString();
  let context = `<understanding_graph>
<meta>
  <topic>Understanding Graph</topic>
  <concepts>${nodes.length}</concepts>
  <relationships>${relationshipCount}</relationships>
  <as_of>${asOf}</as_of>
  <hint>Use graph_updates(since="${asOf}") to get only changes since this snapshot.</hint>
</meta>

<concepts>
`;

  // Group by trigger type for organized output
  const triggerOrder: TriggerType[] = [
    'foundation',
    'surprise',
    'consequence',
    'tension',
    'repetition',
    'question',
    'serendipity',
    'decision',
    'prediction',
    'evaluation',
  ];
  const byTrigger: Record<string, NodeWithConnections[]> = {};
  nodes.forEach((n) => {
    const trigger = n.trigger || 'general';
    if (!byTrigger[trigger]) byTrigger[trigger] = [];
    byTrigger[trigger].push(n);
  });

  // Output in priority order (include any other trigger types not in the standard order)
  const allTriggerTypes = [
    ...triggerOrder,
    'library',
    'analysis',
    'experiment',
    'general',
  ];
  for (const trigger of allTriggerTypes) {
    if (byTrigger[trigger]?.length) {
      byTrigger[trigger].forEach((n) => {
        const typeAttr = shouldInclude('trigger', visibleFields)
          ? ` type="${n.trigger || 'general'}"`
          : '';
        context += `  <concept id="${n.id}"${typeAttr}>
    <name>${escapeXml(n.title)}</name>
`;
        // Add origin story (the commit that created this node)
        const commit = getCommitForNode(n.id);
        if (commit?.message) {
          context += `    <origin_story agent="${escapeXml(commit.agentName || 'unknown')}" time="${commit.createdAt}">${escapeXml(commit.message)}</origin_story>\n`;
        }
        if (shouldInclude('understanding', visibleFields) && n.understanding) {
          const text = isBrief
            ? truncateForBrief(n.understanding)
            : n.understanding;
          context += `    <understanding>${escapeXml(text)}</understanding>\n`;
        }
        if (shouldInclude('why', visibleFields) && n.why) {
          context += `    <why_added>${escapeXml(n.why)}</why_added>\n`;
        }
        context += `  </concept>\n`;
      });
    }
  }

  context += `</concepts>
`;

  // Output relationships if edges are visible
  if (shouldInclude('edges', visibleFields)) {
    context += `
<relationships>
`;
    // Output relationships as triplets
    nodes.forEach((n) => {
      if (n.outgoing?.length) {
        n.outgoing.forEach((o) => {
          context += `  <link>
    <from>${escapeXml(n.title)}</from>
    <relation>${escapeXml(o.explanation) || 'connects to'}</relation>
    <to>${escapeXml(o.targetTitle)}</to>
  </link>\n`;
        });
      }
    });

    context += `</relationships>
`;
  }

  context += `
`;

  // Identify open threads and isolated nodes
  const openEnds = nodes.filter(
    (n) => !n.outgoing?.length && n.incoming?.length > 0,
  );
  const isolated = nodes.filter(
    (n) => !n.outgoing?.length && !n.incoming?.length,
  );

  if (openEnds.length > 0 || isolated.length > 0) {
    context += `<exploration_hints>
`;
    if (openEnds.length > 0) {
      context += `  <open_threads hint="These concepts have incoming connections but lead nowhere yet">\n`;
      openEnds.slice(0, 5).forEach((n) => {
        context += `    <concept>${escapeXml(n.title)}</concept>\n`;
      });
      context += `  </open_threads>\n`;
    }
    if (isolated.length > 0) {
      context += `  <isolated hint="These concepts aren't connected to anything yet">\n`;
      isolated.slice(0, 5).forEach((n) => {
        context += `    <concept>${escapeXml(n.title)}</concept>\n`;
      });
      context += `  </isolated>\n`;
    }
    context += `</exploration_hints>
`;
  }

  // Identify serendipity nodes that need validation
  const serendipityNodes = nodes.filter((n) => n.trigger === 'serendipity');
  const unvalidatedSerendipity = serendipityNodes.filter(
    (n) => n.validated !== true,
  );

  if (unvalidatedSerendipity.length > 0) {
    context += `<serendipity_nodes hint="These were randomly generated and need validation - treat with skepticism">
`;
    unvalidatedSerendipity.forEach((n) => {
      context += `  <node id="${n.id}" validated="false">
    <title>${escapeXml(n.title)}</title>
    <understanding>${escapeXml(n.understanding) || ''}</understanding>
  </node>
`;
    });
    context += `</serendipity_nodes>
`;
  }

  context += `</understanding_graph>`;

  return context;
}

// Generate focused context around a single node (1-hop neighbors)
function generateFocusedContext(
  _projectId: string,
  nodeId: string,
  options: {
    showEvolution?: boolean;
    detailLevel?: DetailLevel;
    includeFields?: string[];
    hideDocumentProse?: boolean;
  } = {},
): string {
  const {
    showEvolution = false,
    detailLevel,
    includeFields,
    hideDocumentProse,
  } = options;
  const visibleFields = resolveVisibleFields({
    detailLevel,
    includeFields,
    hideDocumentProse,
  });
  const isBrief = detailLevel === 'brief';
  const store = getGraphStore();

  const node = store.getNode(nodeId);
  if (!node) {
    return `<error>Node "${nodeId}" not found in current graph.</error>`;
  }

  const { edges: allEdges } = store.getAll();

  // Find 1-hop neighbors
  const neighborIds = new Set<string>();
  const relevantEdges: GraphEdgeData[] = [];

  allEdges.forEach((e) => {
    if (!showEvolution && e.type === 'supersedes') return;

    if (e.fromId === nodeId) {
      neighborIds.add(e.toId);
      relevantEdges.push(e);
    } else if (e.toId === nodeId) {
      neighborIds.add(e.fromId);
      relevantEdges.push(e);
    }
  });

  // Get neighbor nodes
  const neighbors: GraphNodeData[] = [];
  neighborIds.forEach((id) => {
    const n = store.getNode(id);
    if (n) neighbors.push(n);
  });

  // Construct XML
  let context = `<focused_node id="${nodeId}">
<meta>
  <neighbors>${neighbors.length}</neighbors>
  <relationships>${relevantEdges.length}</relationships>
</meta>

<center_concept>
`;

  // Render central node
  const n = node;
  const typeAttr = shouldInclude('trigger', visibleFields)
    ? ` type="${n.trigger || 'general'}"`
    : '';

  context += `  <concept id="${n.id}"${typeAttr}>
    <name>${escapeXml(n.title)}</name>
`;
  // Add origin story for focused node
  const focusedCommit = getCommitForNode(n.id);
  if (focusedCommit?.message) {
    context += `    <origin_story agent="${escapeXml(focusedCommit.agentName || 'unknown')}" time="${focusedCommit.createdAt}">${escapeXml(focusedCommit.message)}</origin_story>\n`;
  }
  if (shouldInclude('understanding', visibleFields) && n.understanding) {
    // Always full text for the focused node, ignoring brief mode unless very strict
    context += `    <understanding>${escapeXml(n.understanding)}</understanding>\n`;
  }
  if (shouldInclude('why', visibleFields) && n.why) {
    context += `    <why_added>${escapeXml(n.why)}</why_added>\n`;
  }
  // Include full metadata/prose if it's a thinking node
  if (n.content && !shouldInclude('content', visibleFields) === false) {
    // Logic: include unless explicitly hidden?
    // Actually respect hideDocumentProse but maybe not for thinking nodes?
    // Let's stick to standard logic: if 'content' is in visibleFields (it is by default), show it.
    if (shouldInclude('content', visibleFields)) {
      context += `    <content>${escapeXml(n.content)}</content>\n`;
    }
  }
  context += `  </concept>
</center_concept>

<neighbors hint="Directly connected concepts">
`;

  // Render neighbors
  neighbors.forEach((nb) => {
    const nbTypeAttr = shouldInclude('trigger', visibleFields)
      ? ` type="${nb.trigger || 'general'}"`
      : '';
    context += `  <concept id="${nb.id}"${nbTypeAttr}>
    <name>${escapeXml(nb.title)}</name>
`;
    // Add origin story for neighbor
    const nbCommit = getCommitForNode(nb.id);
    if (nbCommit?.message) {
      context += `    <origin_story agent="${escapeXml(nbCommit.agentName || 'unknown')}" time="${nbCommit.createdAt}">${escapeXml(nbCommit.message)}</origin_story>\n`;
    }
    if (shouldInclude('understanding', visibleFields) && nb.understanding) {
      const text = isBrief
        ? truncateForBrief(nb.understanding, 150)
        : nb.understanding;
      context += `    <understanding>${escapeXml(text)}</understanding>\n`;
    }
    context += `  </concept>\n`;
  });

  context += `</neighbors>

<relationships>
`;

  // Render edges
  relevantEdges.forEach((e) => {
    const fromName =
      e.fromId === nodeId
        ? node.title
        : neighbors.find((nb) => nb.id === e.fromId)?.title || e.fromId;
    const toName =
      e.toId === nodeId
        ? node.title
        : neighbors.find((nb) => nb.id === e.toId)?.title || e.toId;
    const direction = e.fromId === nodeId ? 'outgoing' : 'incoming';

    context += `  <link dir="${direction}">
    <from>${escapeXml(fromName)}</from>
    <relation>${escapeXml(e.explanation) || 'connects to'}</relation>
    <to>${escapeXml(toName)}</to>
  </link>\n`;
  });

  context += `</relationships>
</focused_node>`;

  return context;
}

// Generate compact context with region summaries
function generateCompactContext(
  _projectId: string,
  options: {
    showEvolution?: boolean;
    maxTokens?: number;
    conceptsPerRegion?: number;
    detailLevel?: DetailLevel;
    includeFields?: string[];
    hideDocumentProse?: boolean;
  } = {},
): string {
  const {
    showEvolution = false,
    maxTokens = 8000,
    conceptsPerRegion = 3,
    detailLevel,
    includeFields,
    hideDocumentProse,
  } = options;
  const visibleFields = resolveVisibleFields({
    detailLevel,
    includeFields,
    hideDocumentProse,
  });
  const isBrief = detailLevel === 'brief';
  const store = getGraphStore();

  // Get all nodes and edges
  const { nodes: allNodes, edges: allEdges } = store.getAll();

  // Filter out superseded nodes unless showEvolution is true
  let activeNodes = allNodes;
  if (!showEvolution) {
    const supersededIds = new Set(
      allEdges.filter((e) => e.type === 'supersedes').map((e) => e.toId),
    );
    activeNodes = allNodes.filter((n) => !supersededIds.has(n.id));
  }

  if (activeNodes.length === 0) {
    return `<understanding_graph mode="compact">
<meta>
  <concepts>0</concepts>
  <relationships>0</relationships>
  <as_of>${new Date().toISOString()}</as_of>
</meta>
<status>No concepts mapped yet. Start by discussing the topic to build understanding.</status>
</understanding_graph>`;
  }

  // Detect communities/regions
  const communityResult = store.detectCommunities();
  const communities = communityResult.communities;

  // Build node-to-community map
  const nodeToCommunity = new Map<string, number>();
  for (const [commId, nodes] of communities) {
    for (const node of nodes) {
      nodeToCommunity.set(node.id, commId);
    }
  }

  // Build adjacency for degree calculation
  const degree = new Map<string, number>();
  allEdges.forEach((e) => {
    if (e.type !== 'supersedes') {
      degree.set(e.fromId, (degree.get(e.fromId) || 0) + 1);
      degree.set(e.toId, (degree.get(e.toId) || 0) + 1);
    }
  });

  // Build region summaries
  const regions: RegionSummary[] = [];

  for (const [commId, nodes] of communities) {
    // Get top concepts by degree
    const nodesWithDegree = nodes.map((n) => ({
      id: n.id,
      name: n.title,
      degree: degree.get(n.id) || 0,
      trigger: n.trigger,
    }));
    nodesWithDegree.sort((a, b) => b.degree - a.degree);

    // Trigger distribution
    const triggerDist: Record<string, number> = {};
    nodes.forEach((n) => {
      const t = n.trigger || 'general';
      triggerDist[t] = (triggerDist[t] || 0) + 1;
    });

    // Sample relationships within this region
    const regionNodeIds = new Set(nodes.map((n) => n.id));
    const regionEdges = allEdges.filter(
      (e) =>
        regionNodeIds.has(e.fromId) &&
        regionNodeIds.has(e.toId) &&
        e.type !== 'supersedes',
    );

    const sampleRels: Array<{ from: string; relation: string; to: string }> =
      [];
    for (let i = 0; i < Math.min(3, regionEdges.length); i++) {
      const e = regionEdges[i];
      const fromNode = nodes.find((n) => n.id === e.fromId);
      const toNode = nodes.find((n) => n.id === e.toId);
      if (fromNode && toNode) {
        sampleRels.push({
          from: fromNode.title,
          relation: e.explanation || 'relates to',
          to: toNode.title,
        });
      }
    }

    regions.push({
      id: commId,
      nodeCount: nodes.length,
      topConcepts: nodesWithDegree.slice(0, conceptsPerRegion + 2), // Keep a few extra for flexibility
      triggerDistribution: triggerDist,
      sampleRelationships: sampleRels,
    });
  }

  // Sort regions by size (largest first)
  regions.sort((a, b) => b.nodeCount - a.nodeCount);

  // Build compact XML
  const relationshipCount = allEdges.filter(
    (e) => e.type !== 'supersedes',
  ).length;

  // Get globally important nodes (top by degree across all regions)
  const allNodesWithDegree = activeNodes.map((n) => ({
    node: n,
    degree: degree.get(n.id) || 0,
  }));
  allNodesWithDegree.sort((a, b) => b.degree - a.degree);
  const topGlobalNodes = allNodesWithDegree.slice(0, 10);

  const asOf = new Date().toISOString();
  let context = `<understanding_graph mode="compact">
<meta>
  <concepts>${activeNodes.length}</concepts>
  <relationships>${relationshipCount}</relationships>
  <regions>${regions.length}</regions>
  <as_of>${asOf}</as_of>
  <hint>Use graph_context_region(region_id) to expand any region for full details. Use graph_updates(since="${asOf}") to get only changes since this snapshot.</hint>
</meta>

<overview hint="Most important concepts across the entire graph">
`;

  // Add globally important nodes
  topGlobalNodes.forEach((item) => {
    const typeAttr = shouldInclude('trigger', visibleFields)
      ? ` type="${item.node.trigger || 'general'}"`
      : '';
    context += `  <concept id="${item.node.id}" degree="${item.degree}"${typeAttr}>
    <name>${escapeXml(item.node.title)}</name>
`;
    if (
      shouldInclude('understanding', visibleFields) &&
      item.node.understanding
    ) {
      const maxLen = isBrief ? 100 : 150;
      const text =
        item.node.understanding.slice(0, maxLen) +
        (item.node.understanding.length > maxLen ? '...' : '');
      context += `    <understanding>${escapeXml(text)}</understanding>\n`;
    }
    context += `  </concept>
`;
  });

  context += `</overview>

<regions hint="Each region is a cluster of related concepts">
`;

  let currentTokens = estimateTokens(context);

  for (const region of regions) {
    // Estimate region label based on top concepts
    const topNames = region.topConcepts.slice(0, 3).map((c) => c.name);
    const regionLabel =
      topNames.length > 0
        ? topNames[0].split(' ').slice(0, 4).join(' ')
        : 'Unnamed';

    let regionXml = `  <region id="${region.id}" nodes="${region.nodeCount}" label="${escapeXml(regionLabel)}">
    <top_concepts>
`;
    // Show only configured number of concepts per region
    region.topConcepts.slice(0, conceptsPerRegion).forEach((c) => {
      regionXml += `      <concept id="${c.id}" degree="${c.degree}">${escapeXml(c.name)}</concept>\n`;
    });
    if (region.nodeCount > conceptsPerRegion) {
      regionXml += `      <more count="${region.nodeCount - conceptsPerRegion}" hint="Use graph_context_region(${region.id}) for full list" />\n`;
    }
    regionXml += `    </top_concepts>\n`;

    // Show triggers distribution if trigger field is visible
    if (shouldInclude('trigger', visibleFields)) {
      regionXml += `    <triggers>`;
      Object.entries(region.triggerDistribution).forEach(([t, count]) => {
        regionXml += ` ${t}:${count}`;
      });
      regionXml += `</triggers>\n`;
    }

    // Show sample relationships if edges are visible
    if (
      shouldInclude('edges', visibleFields) &&
      region.sampleRelationships.length > 0
    ) {
      regionXml += `    <sample_relationships>\n`;
      region.sampleRelationships.forEach((r) => {
        regionXml += `      <link>${escapeXml(r.from)} → ${escapeXml(r.relation)} → ${escapeXml(r.to)}</link>\n`;
      });
      regionXml += `    </sample_relationships>\n`;
    }
    regionXml += `  </region>\n`;

    // Check token budget
    const regionTokens = estimateTokens(regionXml);
    if (currentTokens + regionTokens > maxTokens - 200) {
      context += `  <region id="truncated" hint="More regions exist - use graph_context_region to explore" />\n`;
      break;
    }

    context += regionXml;
    currentTokens += regionTokens;
  }

  context += `</regions>

`;

  // Add open questions summary
  const openQuestions = activeNodes.filter((n) => n.trigger === 'question');
  if (openQuestions.length > 0 && currentTokens < maxTokens - 300) {
    context += `<open_questions count="${openQuestions.length}">\n`;
    openQuestions.slice(0, 5).forEach((q) => {
      context += `  <question id="${q.id}">${escapeXml(q.title)}</question>\n`;
    });
    if (openQuestions.length > 5) {
      context += `  <more count="${openQuestions.length - 5}" />\n`;
    }
    context += `</open_questions>\n`;
  }

  // Add isolated nodes warning
  const isolatedNodes = activeNodes.filter((n) => {
    const d = degree.get(n.id) || 0;
    return d === 0;
  });
  if (isolatedNodes.length > 0 && currentTokens < maxTokens - 200) {
    context += `<isolated_nodes count="${isolatedNodes.length}" hint="These concepts have no connections yet">\n`;
    isolatedNodes.slice(0, 3).forEach((n) => {
      context += `  <node id="${n.id}">${escapeXml(n.title)}</node>\n`;
    });
    context += `</isolated_nodes>\n`;
  }

  context += `</understanding_graph>`;

  return context;
}

// Generate full context for a specific region
export function generateRegionContext(
  _projectId: string,
  regionId: number,
  options: {
    showEvolution?: boolean;
    detailLevel?: DetailLevel;
    includeFields?: string[];
    hideDocumentProse?: boolean;
  } = {},
): string {
  const {
    showEvolution = false,
    detailLevel,
    includeFields,
    hideDocumentProse,
  } = options;
  const visibleFields = resolveVisibleFields({
    detailLevel,
    includeFields,
    hideDocumentProse,
  });
  const isBrief = detailLevel === 'brief';
  const store = getGraphStore();

  // Detect communities
  const communityResult = store.detectCommunities();
  const communities = communityResult.communities;

  let regionNodes = communities.get(regionId);
  if (!regionNodes || regionNodes.length === 0) {
    return `<error>Region ${regionId} not found. Available regions: ${Array.from(communities.keys()).join(', ')}</error>`;
  }

  // Filter out superseded nodes unless showEvolution is true
  const { edges: allEdges } = store.getAll();
  if (!showEvolution) {
    const supersededIds = new Set(
      allEdges.filter((e) => e.type === 'supersedes').map((e) => e.toId),
    );
    regionNodes = regionNodes.filter((n) => !supersededIds.has(n.id));
  }

  const regionNodeIds = new Set(regionNodes.map((n) => n.id));

  // Get edges within and crossing this region
  const regionEdges = allEdges.filter((e) => {
    if (!showEvolution && e.type === 'supersedes') return false;
    return regionNodeIds.has(e.fromId) || regionNodeIds.has(e.toId);
  });

  // Build node map for names
  const nodeMap = new Map<string, GraphNodeData>();
  for (const n of regionNodes) {
    nodeMap.set(n.id, n);
  }

  // Get nodes from other regions that connect to this one
  const crossRegionNodeIds = new Set<string>();
  regionEdges.forEach((e) => {
    if (!regionNodeIds.has(e.fromId)) crossRegionNodeIds.add(e.fromId);
    if (!regionNodeIds.has(e.toId)) crossRegionNodeIds.add(e.toId);
  });

  // Build XML
  let context = `<region id="${regionId}" mode="full">
<meta>
  <concepts>${regionNodes.length}</concepts>
  <internal_relationships>${regionEdges.filter((e) => regionNodeIds.has(e.fromId) && regionNodeIds.has(e.toId)).length}</internal_relationships>
  <cross_region_connections>${crossRegionNodeIds.size}</cross_region_connections>
</meta>

<concepts>
`;

  // Group by trigger type
  const triggerOrder: TriggerType[] = [
    'foundation',
    'surprise',
    'consequence',
    'tension',
    'repetition',
    'question',
    'serendipity',
    'decision',
    'prediction',
    'evaluation',
  ];
  const byTrigger: Record<string, GraphNodeData[]> = {};
  regionNodes.forEach((n) => {
    const trigger = n.trigger || 'general';
    if (!byTrigger[trigger]) byTrigger[trigger] = [];
    byTrigger[trigger].push(n);
  });

  // Output in priority order (include any other trigger types not in the standard order)
  const allTriggerTypes = [
    ...triggerOrder,
    'library',
    'analysis',
    'experiment',
    'general',
  ];
  for (const trigger of allTriggerTypes) {
    if (byTrigger[trigger]?.length) {
      byTrigger[trigger].forEach((n) => {
        const typeAttr = shouldInclude('trigger', visibleFields)
          ? ` type="${n.trigger || 'general'}"`
          : '';
        context += `  <concept id="${n.id}"${typeAttr}>
    <name>${escapeXml(n.title)}</name>
`;
        if (shouldInclude('understanding', visibleFields) && n.understanding) {
          const text = isBrief
            ? truncateForBrief(n.understanding)
            : n.understanding;
          context += `    <understanding>${escapeXml(text)}</understanding>\n`;
        }
        if (shouldInclude('why', visibleFields) && n.why) {
          context += `    <why_added>${escapeXml(n.why)}</why_added>\n`;
        }
        context += `  </concept>\n`;
      });
    }
  }

  context += `</concepts>
`;

  // Only include relationships section if edges are visible
  if (!shouldInclude('edges', visibleFields)) {
    context += `</region>`;
    return context;
  }

  context += `
<relationships>
`;

  // Internal relationships
  regionEdges
    .filter((e) => regionNodeIds.has(e.fromId) && regionNodeIds.has(e.toId))
    .forEach((e) => {
      const fromNode = nodeMap.get(e.fromId);
      const toNode = nodeMap.get(e.toId);
      if (fromNode && toNode) {
        context += `  <link type="internal">
    <from>${escapeXml(fromNode.title)}</from>
    <relation>${escapeXml(e.explanation) || 'connects to'}</relation>
    <to>${escapeXml(toNode.title)}</to>
  </link>\n`;
      }
    });

  // Cross-region connections
  const crossEdges = regionEdges.filter(
    (e) => !(regionNodeIds.has(e.fromId) && regionNodeIds.has(e.toId)),
  );
  if (crossEdges.length > 0) {
    crossEdges.forEach((e) => {
      const fromNode = nodeMap.get(e.fromId) || store.getNode(e.fromId);
      const toNode = nodeMap.get(e.toId) || store.getNode(e.toId);
      if (fromNode && toNode) {
        const isOutgoing = regionNodeIds.has(e.fromId);
        context += `  <link type="${isOutgoing ? 'outgoing' : 'incoming'}">
    <from>${escapeXml(fromNode.title)}</from>
    <relation>${escapeXml(e.explanation) || 'connects to'}</relation>
    <to>${escapeXml(toNode.title)}</to>
  </link>\n`;
      }
    });
  }

  context += `</relationships>
</region>`;

  return context;
}

// Generate skeleton context - minimal orientation view (~150 tokens)
export function generateSkeletonContext(_projectId: string): string {
  const store = getGraphStore();
  const { nodes: allNodes, edges: allEdges } = store.getAll();

  // Filter superseded
  const supersededIds = new Set(
    allEdges.filter((e) => e.type === 'supersedes').map((e) => e.toId),
  );
  const activeNodes = allNodes.filter((n) => !supersededIds.has(n.id));
  const activeEdges = allEdges.filter((e) => e.type !== 'supersedes');

  if (activeNodes.length === 0) {
    return 'Empty graph. Start by adding concepts.';
  }

  // Calculate degrees
  const degree = new Map<string, number>();
  activeEdges.forEach((e) => {
    degree.set(e.fromId, (degree.get(e.fromId) || 0) + 1);
    degree.set(e.toId, (degree.get(e.toId) || 0) + 1);
  });

  // Detect communities for regions
  const communityResult = store.detectCommunities();
  const communities = communityResult.communities;

  // Build region summaries (just name + count)
  const regionSummaries: Array<{ label: string; count: number; id: number }> =
    [];
  for (const [commId, nodes] of communities) {
    // Get top node by degree as label
    const sorted = nodes
      .map((n) => ({ name: n.title, degree: degree.get(n.id) || 0 }))
      .sort((a, b) => b.degree - a.degree);
    const label = sorted[0]?.name.split(' ').slice(0, 3).join(' ') || 'Unnamed';
    regionSummaries.push({ label, count: nodes.length, id: commId });
  }
  regionSummaries.sort((a, b) => b.count - a.count);

  // Get hub nodes (top 5 by degree)
  const hubs = activeNodes
    .map((n) => ({ name: n.title, degree: degree.get(n.id) || 0, id: n.id }))
    .sort((a, b) => b.degree - a.degree)
    .slice(0, 5);

  // Get recent activity hint
  const recentEvents = getRecentEvents(5, true);
  const recentTopics = new Set<string>();
  recentEvents.forEach((e) => {
    if (e.summary) {
      // Extract concept name from summary like "Created concept: X"
      const match = e.summary.match(/concept[:\s]+(.+?)(?:\s+with|\s*$)/i);
      if (match) {
        recentTopics.add(match[1].split(' ').slice(0, 3).join(' '));
      }
    }
  });

  // Build compact output
  let out = `${activeNodes.length}n ${activeEdges.length}e\n\n`;

  // Regions
  out += 'Regions:\n';
  const mainRegions = regionSummaries.slice(0, 7);
  const smallCount = regionSummaries.length - 7;
  mainRegions.forEach((r) => {
    out += `  ${r.label} (${r.count}) [R${r.id}]\n`;
  });
  if (smallCount > 0) {
    out += `  +${smallCount} smaller\n`;
  }

  // Hubs
  out += '\nHubs: ';
  out += hubs.map((h) => h.name).join(' · ');

  // Recent
  if (recentTopics.size > 0) {
    out += `\n\nRecent: ${Array.from(recentTopics).slice(0, 3).join(', ')}`;
  }

  out += '\n\n→ graph_context_region(id) for details';

  return out;
}

// Find shortest path between two nodes
export function findPath(
  _projectId: string,
  fromNodeId: string,
  toNodeId: string,
): string {
  const store = getGraphStore();
  const { nodes: allNodes, edges: allEdges } = store.getAll();

  // Build node map
  const nodeMap = new Map<string, GraphNodeData>();
  for (const n of allNodes) {
    nodeMap.set(n.id, n);
  }

  // Try to resolve by name if not ID
  let fromId = fromNodeId;
  let toId = toNodeId;

  if (!fromId.startsWith('n_')) {
    const match = allNodes.find((n) =>
      n.title.toLowerCase().includes(fromId.toLowerCase()),
    );
    if (match) fromId = match.id;
    else return `Node not found: "${fromNodeId}"`;
  }

  if (!toId.startsWith('n_')) {
    const match = allNodes.find((n) =>
      n.title.toLowerCase().includes(toId.toLowerCase()),
    );
    if (match) toId = match.id;
    else return `Node not found: "${toNodeId}"`;
  }

  if (!nodeMap.has(fromId)) return `Node not found: "${fromNodeId}"`;
  if (!nodeMap.has(toId)) return `Node not found: "${toNodeId}"`;

  // Build adjacency (undirected for path finding)
  const adj = new Map<
    string,
    Array<{ nodeId: string; edgeExplanation: string }>
  >();
  for (const e of allEdges) {
    if (e.type === 'supersedes') continue;
    if (!adj.has(e.fromId)) adj.set(e.fromId, []);
    if (!adj.has(e.toId)) adj.set(e.toId, []);
    adj
      .get(e.fromId)
      ?.push({ nodeId: e.toId, edgeExplanation: e.explanation || '→' });
    adj
      .get(e.toId)
      ?.push({ nodeId: e.fromId, edgeExplanation: `←${e.explanation || ''}` });
  }

  // BFS for shortest path
  const visited = new Set<string>();
  const parent = new Map<string, { nodeId: string; via: string }>();
  const queue: string[] = [fromId];
  visited.add(fromId);

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    if (current === toId) break;

    const neighbors = adj.get(current) || [];
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor.nodeId)) {
        visited.add(neighbor.nodeId);
        parent.set(neighbor.nodeId, {
          nodeId: current,
          via: neighbor.edgeExplanation,
        });
        queue.push(neighbor.nodeId);
      }
    }
  }

  if (!parent.has(toId) && fromId !== toId) {
    return `No path between "${nodeMap.get(fromId)?.title}" and "${nodeMap.get(toId)?.title}"`;
  }

  // Reconstruct path
  const path: Array<{ nodeId: string; nodeName: string; via: string }> = [];
  let current = toId;
  while (current !== fromId) {
    const p = parent.get(current);
    if (!p) break;
    path.unshift({
      nodeId: current,
      nodeName: nodeMap.get(current)?.title || current,
      via: p.via,
    });
    current = p.nodeId;
  }
  path.unshift({
    nodeId: fromId,
    nodeName: nodeMap.get(fromId)?.title || fromId,
    via: '',
  });

  // Format output
  let out = `Path (${path.length} nodes):\n\n`;
  path.forEach((step, i) => {
    if (i === 0) {
      out += `${step.nodeName}\n`;
    } else {
      out += `  ${step.via}\n${step.nodeName}\n`;
    }
  });

  return out;
}

// Generate history context for AI
export function generateHistoryContext(limit = 50): string {
  const events = getRecentEvents(limit, true);

  // Build XML context
  let context = `<recent_activity count="${events.length}">\n`;

  // Reverse to show chronological order (oldest first)
  events.reverse().forEach((e) => {
    context += `  <event seq="${e.seq}" action="${e.action}" entity="${e.entity_type}">\n`;
    context += `    <summary>${escapeXml(e.summary)}</summary>\n`;
    context += `    <entity_id>${e.entity_id}</entity_id>\n`;
    context += `    <timestamp>${e.timestamp}</timestamp>\n`;
    if (e.user_query || e.ai_response) {
      context += `    <conversation>\n`;
      if (e.user_query)
        context += `      <user>${escapeXml(e.user_query)}</user>\n`;
      if (e.ai_response)
        context += `      <ai>${escapeXml(e.ai_response)}</ai>\n`;
      context += `    </conversation>\n`;
    }
    context += `  </event>\n`;
  });

  context += `</recent_activity>`;

  return context;
}
