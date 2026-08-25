import {
  getCommitForNode,
  getDb,
  getRecentEvents,
} from '../database/sqlite.js';
import {
  stripThinkingIdentityPreamble,
  TRIGGER_TYPES,
  type TriggerType,
} from '../types/index.js';
import { reservedThinkingVisible } from '../visibility.js';
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

/**
 * Thinking documents keep their substantive thought in `content`; their
 * `understanding` field may contain only signature metadata. Model context
 * should carry the thought, not the bookkeeping wrapper.
 */
function contextUnderstanding(node: GraphNodeData): string | null {
  if (node.trigger === 'thinking') {
    const content = node.content?.trim();
    if (content) return stripThinkingIdentityPreamble(content);

    const legacy = node.understanding?.trim();
    if (legacy && !/^[{[]\s*["']?signatures["']?\s*:/i.test(legacy)) {
      return stripThinkingIdentityPreamble(legacy);
    }
    return null;
  }

  return node.understanding;
}

type EpistemicNode = Pick<GraphNodeData, 'trigger' | 'validated'>;

/**
 * Serendipity is a provenance class, not established graph truth. Keep that
 * distinction attached to the node anywhere model-facing context renders it,
 * even when the caller hides the general `trigger` field.
 */
function epistemicAttributes(node: EpistemicNode, prefix = ''): string {
  if (node.trigger !== 'serendipity') return '';
  return node.validated === true
    ? ` ${prefix}validated="true"`
    : ` ${prefix}epistemic_status="speculative"`;
}

function epistemicTextMarker(node: EpistemicNode): string {
  if (node.trigger !== 'serendipity') return '';
  return node.validated === true
    ? ' [validated=true]'
    : ' [epistemic_status=speculative]';
}

function edgeRelation(edge: {
  type: string;
  explanation?: string | null;
}): string {
  return edge.explanation?.trim() || edge.type;
}

function orderedTriggerKeys<T>(byTrigger: Record<string, T[]>): string[] {
  const canonical = new Set<string>(TRIGGER_TYPES);
  const extra = Object.keys(byTrigger)
    .filter((trigger) => !canonical.has(trigger))
    .sort();
  return [...TRIGGER_TYPES, ...extra];
}

interface RegionSummary {
  id: number;
  nodeCount: number;
  topConcepts: Array<{ id: string; name: string; degree: number }>;
  triggerDistribution: Record<string, number>;
  sampleRelationships: Array<{
    from: string;
    fromTrigger: TriggerType | null;
    fromValidated: boolean | null;
    relation: string;
    to: string;
    toTrigger: TriggerType | null;
    toValidated: boolean | null;
    type: string;
    why: string | null;
  }>;
}

interface NodeWithConnections {
  id: string;
  title: string;
  trigger: TriggerType | null;
  why: string | null;
  understanding: string | null;
  validated: boolean | null;
  outgoing: Array<{
    targetId: string;
    targetTitle: string;
    targetTrigger: TriggerType | null;
    targetValidated: boolean | null;
    explanation: string | null;
    why: string | null;
    type: string;
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
  const allActionRows = reservedThinkingVisible()
    ? (db
        .prepare(
          `SELECT id, tool_name, error, created_at, result, arguments
           FROM tool_calls
           WHERE created_at >= ?
           ORDER BY created_at DESC`,
        )
        .all(since) as Array<{
        id: number;
        tool_name: string;
        error: string | null;
        created_at: string;
        result: string | null;
        arguments: string;
      }>)
    : [];
  const linkedNodeIds = db.prepare(
    'SELECT id FROM nodes WHERE tool_call_id = ?',
  );
  const linkedEdgeIds = db.prepare(
    'SELECT id FROM edges WHERE tool_call_id = ?',
  );
  const actionsRows = allActionRows.filter((action) => {
    const nodeIds = linkedNodeIds.all(action.id) as Array<{ id: string }>;
    const edgeIds = linkedEdgeIds.all(action.id) as Array<{ id: string }>;
    return (
      nodeIds.every((row) => store.getNode(row.id) !== null) &&
      edgeIds.every((row) => store.getEdge(row.id) !== null)
    );
  });

  // 4. Get recent commits (the "metacognitive stream" - why agents made changes)
  const allCommitRows = db
    .prepare(
      `SELECT id, message, agent_name, node_ids, edge_ids, created_at
       FROM commits
       WHERE created_at >= ?
       ORDER BY created_at DESC`,
    )
    .all(since) as Array<{
    id: string;
    message: string;
    agent_name: string | null;
    node_ids: string;
    edge_ids: string;
    created_at: string;
  }>;
  const parseEntityIds = (encoded: string): string[] => {
    try {
      const ids = JSON.parse(encoded || '[]');
      return Array.isArray(ids)
        ? ids.filter((id): id is string => typeof id === 'string')
        : [];
    } catch {
      return [];
    }
  };
  const commitRows = allCommitRows.filter((commit) => {
    const nodeIds = parseEntityIds(commit.node_ids);
    const edgeIds = parseEntityIds(commit.edge_ids);
    return (
      nodeIds.every((id) => store.getNode(id) !== null) &&
      edgeIds.every((id) => store.getEdge(id) !== null)
    );
  });

  // Build XML response
  let out = `<graph_updates since="${since}" timestamp="${new Date().toISOString()}">\n`;

  // Nodes
  if (nodes.length > 0) {
    out += `  <changed_nodes count="${nodes.length}">\n`;
    for (const n of nodes) {
      out += `    <node id="${n.id}" trigger="${n.trigger || 'general'}"${epistemicAttributes(n)}>\n`;
      out += `      <name>${escapeXml(n.title)}</name>\n`;
      const understanding = contextUnderstanding(n);
      if (understanding) {
        out += `      <understanding>${escapeXml(truncateForBrief(understanding, 150))}</understanding>\n`;
      }
      out += `    </node>\n`;
    }
    out += `  </changed_nodes>\n`;
  }

  // Edges
  if (edges.length > 0) {
    out += `  <changed_edges count="${edges.length}">\n`;
    for (const e of edges) {
      const fromNode = store.getNode(e.fromId);
      const toNode = store.getNode(e.toId);
      const from = fromNode?.title || e.fromId;
      const to = toNode?.title || e.toId;
      out += `    <edge id="${e.id}" type="${e.type}">\n`;
      out += `      <from${fromNode ? epistemicAttributes(fromNode) : ''}>${escapeXml(from)}</from>\n`;
      out += `      <relation>${escapeXml(edgeRelation(e))}</relation>\n`;
      if (e.why) {
        out += `      <why>${escapeXml(e.why)}</why>\n`;
      }
      out += `      <to${toNode ? epistemicAttributes(toNode) : ''}>${escapeXml(to)}</to>\n`;
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
      const affectedNodes = parseEntityIds(c.node_ids);
      if (affectedNodes.length > 0) {
        out += `      <affected_nodes>${affectedNodes.join(', ')}</affected_nodes>\n`;
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
      targetTrigger: nodeMap.get(e.toId)?.trigger ?? null,
      targetValidated: nodeMap.get(e.toId)?.validated ?? null,
      explanation: e.explanation,
      why: e.why,
      type: e.type,
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
      understanding: contextUnderstanding(n),
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
  const byTrigger: Record<string, NodeWithConnections[]> = {};
  nodes.forEach((n) => {
    const trigger = n.trigger || 'general';
    if (!byTrigger[trigger]) byTrigger[trigger] = [];
    byTrigger[trigger].push(n);
  });

  // Output in priority order (include any other trigger types not in the standard order)
  for (const trigger of orderedTriggerKeys(byTrigger)) {
    if (byTrigger[trigger]?.length) {
      byTrigger[trigger].forEach((n) => {
        const typeAttr = shouldInclude('trigger', visibleFields)
          ? ` type="${n.trigger || 'general'}"`
          : '';
        context += `  <concept id="${n.id}"${typeAttr}${epistemicAttributes(n)}>
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
          context += `  <link edge_type="${escapeXml(o.type)}">
    <from${epistemicAttributes(n)}>${escapeXml(n.title)}</from>
    <relation>${escapeXml(edgeRelation(o))}</relation>
${shouldInclude('why', visibleFields) && o.why ? `    <why>${escapeXml(o.why)}</why>\n` : ''}    <to${epistemicAttributes({ trigger: o.targetTrigger, validated: o.targetValidated })}>${escapeXml(o.targetTitle)}</to>
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
        context += `    <concept${epistemicAttributes(n)}>${escapeXml(n.title)}</concept>\n`;
      });
      context += `  </open_threads>\n`;
    }
    if (isolated.length > 0) {
      context += `  <isolated hint="These concepts aren't connected to anything yet">\n`;
      isolated.slice(0, 5).forEach((n) => {
        context += `    <concept${epistemicAttributes(n)}>${escapeXml(n.title)}</concept>\n`;
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
      context += `  <node id="${n.id}" epistemic_status="speculative">
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
    return '<error>Requested node not found in current visible graph.</error>';
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

  context += `  <concept id="${n.id}"${typeAttr}${epistemicAttributes(n)}>
    <name>${escapeXml(n.title)}</name>
`;
  // Add origin story for focused node
  const focusedCommit = getCommitForNode(n.id);
  if (focusedCommit?.message) {
    context += `    <origin_story agent="${escapeXml(focusedCommit.agentName || 'unknown')}" time="${focusedCommit.createdAt}">${escapeXml(focusedCommit.message)}</origin_story>\n`;
  }
  const focusedUnderstanding = contextUnderstanding(n);
  if (shouldInclude('understanding', visibleFields) && focusedUnderstanding) {
    // Always full text for the focused node, ignoring brief mode unless very strict
    context += `    <understanding>${escapeXml(focusedUnderstanding)}</understanding>\n`;
  }
  if (shouldInclude('why', visibleFields) && n.why) {
    context += `    <why_added>${escapeXml(n.why)}</why_added>\n`;
  }
  // Thinking content is already emitted as understanding above. Documents keep
  // their prose in a separate content field.
  if (
    n.trigger !== 'thinking' &&
    n.content &&
    shouldInclude('content', visibleFields)
  ) {
    context += `    <content>${escapeXml(n.content)}</content>\n`;
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
    context += `  <concept id="${nb.id}"${nbTypeAttr}${epistemicAttributes(nb)}>
    <name>${escapeXml(nb.title)}</name>
`;
    // Add origin story for neighbor
    const nbCommit = getCommitForNode(nb.id);
    if (nbCommit?.message) {
      context += `    <origin_story agent="${escapeXml(nbCommit.agentName || 'unknown')}" time="${nbCommit.createdAt}">${escapeXml(nbCommit.message)}</origin_story>\n`;
    }
    const neighborUnderstanding = contextUnderstanding(nb);
    if (
      shouldInclude('understanding', visibleFields) &&
      neighborUnderstanding
    ) {
      const text = isBrief
        ? truncateForBrief(neighborUnderstanding, 150)
        : neighborUnderstanding;
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

    const fromNode =
      e.fromId === nodeId
        ? node
        : neighbors.find((neighbor) => neighbor.id === e.fromId);
    const toNode =
      e.toId === nodeId
        ? node
        : neighbors.find((neighbor) => neighbor.id === e.toId);

    context += `  <link dir="${direction}" edge_type="${escapeXml(e.type)}">
    <from${fromNode ? epistemicAttributes(fromNode) : ''}>${escapeXml(fromName)}</from>
    <relation>${escapeXml(edgeRelation(e))}</relation>
${shouldInclude('why', visibleFields) && e.why ? `    <why>${escapeXml(e.why)}</why>\n` : ''}    <to${toNode ? epistemicAttributes(toNode) : ''}>${escapeXml(toName)}</to>
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

    const sampleRels: RegionSummary['sampleRelationships'] = [];
    for (let i = 0; i < Math.min(3, regionEdges.length); i++) {
      const e = regionEdges[i];
      const fromNode = nodes.find((n) => n.id === e.fromId);
      const toNode = nodes.find((n) => n.id === e.toId);
      if (fromNode && toNode) {
        sampleRels.push({
          from: fromNode.title,
          fromTrigger: fromNode.trigger,
          fromValidated: fromNode.validated,
          relation: edgeRelation(e),
          to: toNode.title,
          toTrigger: toNode.trigger,
          toValidated: toNode.validated,
          type: e.type,
          why: e.why,
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
    context += `  <concept id="${item.node.id}" degree="${item.degree}"${typeAttr}${epistemicAttributes(item.node)}>
    <name>${escapeXml(item.node.title)}</name>
`;
    if (
      shouldInclude('understanding', visibleFields) &&
      contextUnderstanding(item.node)
    ) {
      const maxLen = isBrief ? 100 : 150;
      const understanding = contextUnderstanding(item.node) as string;
      const text =
        understanding.slice(0, maxLen) +
        (understanding.length > maxLen ? '...' : '');
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

    const regionLabelNode = allNodes.find(
      (node) => node.id === region.topConcepts[0]?.id,
    );
    let regionXml = `  <region id="${region.id}" nodes="${region.nodeCount}" label="${escapeXml(regionLabel)}"${regionLabelNode ? epistemicAttributes(regionLabelNode, 'label_') : ''}>
    <top_concepts>
`;
    // Show only configured number of concepts per region
    region.topConcepts.slice(0, conceptsPerRegion).forEach((c) => {
      const conceptNode = allNodes.find((node) => node.id === c.id);
      regionXml += `      <concept id="${c.id}" degree="${c.degree}"${conceptNode ? epistemicAttributes(conceptNode) : ''}>${escapeXml(c.name)}</concept>\n`;
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
        regionXml += `      <link edge_type="${escapeXml(r.type)}">\n`;
        regionXml += `        <from${epistemicAttributes({ trigger: r.fromTrigger, validated: r.fromValidated })}>${escapeXml(r.from)}</from>\n`;
        regionXml += `        <relation>${escapeXml(r.relation)}</relation>\n`;
        if (shouldInclude('why', visibleFields) && r.why) {
          regionXml += `        <why>${escapeXml(r.why)}</why>\n`;
        }
        regionXml += `        <to${epistemicAttributes({ trigger: r.toTrigger, validated: r.toValidated })}>${escapeXml(r.to)}</to>\n`;
        regionXml += `      </link>\n`;
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
      context += `  <node id="${n.id}"${epistemicAttributes(n)}>${escapeXml(n.title)}</node>\n`;
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
  const byTrigger: Record<string, GraphNodeData[]> = {};
  regionNodes.forEach((n) => {
    const trigger = n.trigger || 'general';
    if (!byTrigger[trigger]) byTrigger[trigger] = [];
    byTrigger[trigger].push(n);
  });

  // Output in priority order (include any other trigger types not in the standard order)
  for (const trigger of orderedTriggerKeys(byTrigger)) {
    if (byTrigger[trigger]?.length) {
      byTrigger[trigger].forEach((n) => {
        const typeAttr = shouldInclude('trigger', visibleFields)
          ? ` type="${n.trigger || 'general'}"`
          : '';
        context += `  <concept id="${n.id}"${typeAttr}${epistemicAttributes(n)}>
    <name>${escapeXml(n.title)}</name>
`;
        const understanding = contextUnderstanding(n);
        if (shouldInclude('understanding', visibleFields) && understanding) {
          const text = isBrief
            ? truncateForBrief(understanding)
            : understanding;
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
        context += `  <link type="internal" edge_type="${escapeXml(e.type)}">
    <from${epistemicAttributes(fromNode)}>${escapeXml(fromNode.title)}</from>
    <relation>${escapeXml(edgeRelation(e))}</relation>
${shouldInclude('why', visibleFields) && e.why ? `    <why>${escapeXml(e.why)}</why>\n` : ''}    <to${epistemicAttributes(toNode)}>${escapeXml(toNode.title)}</to>
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
        context += `  <link type="${isOutgoing ? 'outgoing' : 'incoming'}" edge_type="${escapeXml(e.type)}">
    <from${epistemicAttributes(fromNode)}>${escapeXml(fromNode.title)}</from>
    <relation>${escapeXml(edgeRelation(e))}</relation>
${shouldInclude('why', visibleFields) && e.why ? `    <why>${escapeXml(e.why)}</why>\n` : ''}    <to${epistemicAttributes(toNode)}>${escapeXml(toNode.title)}</to>
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
  const regionSummaries: Array<{
    label: string;
    labelNode: GraphNodeData;
    count: number;
    id: number;
  }> = [];
  for (const [commId, nodes] of communities) {
    // Get top node by degree as label
    const sorted = nodes
      .map((n) => ({ node: n, degree: degree.get(n.id) || 0 }))
      .sort((a, b) => b.degree - a.degree);
    const labelNode = sorted[0]?.node ?? nodes[0];
    const label =
      labelNode?.title.split(' ').slice(0, 3).join(' ') || 'Unnamed';
    if (labelNode) {
      regionSummaries.push({
        label,
        labelNode,
        count: nodes.length,
        id: commId,
      });
    }
  }
  regionSummaries.sort((a, b) => b.count - a.count);

  // Get hub nodes (top 5 by degree)
  const hubs = activeNodes
    .map((n) => ({ name: n.title, degree: degree.get(n.id) || 0, id: n.id }))
    .sort((a, b) => b.degree - a.degree)
    .slice(0, 5);

  // Get recent activity hint
  const recentEvents = getRecentEvents(5, false);
  const recentTopics = new Set<string>();
  recentEvents.forEach((e) => {
    if (e.summary) {
      // Extract concept name from summary like "Created concept: X"
      const match = e.summary.match(/concept[:\s]+(.+?)(?:\s+with|\s*$)/i);
      if (match) {
        const topic = match[1].split(' ').slice(0, 3).join(' ');
        const eventNode =
          e.entity_type === 'node' ? store.getNode(e.entity_id) : null;
        recentTopics.add(
          `${topic}${eventNode ? epistemicTextMarker(eventNode) : ''}`,
        );
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
    out += `  ${r.label}${epistemicTextMarker(r.labelNode)} (${r.count}) [R${r.id}]\n`;
  });
  if (smallCount > 0) {
    out += `  +${smallCount} smaller\n`;
  }

  // Hubs
  out += '\nHubs: ';
  out += hubs
    .map((hub) => {
      const node = activeNodes.find((candidate) => candidate.id === hub.id);
      return `${hub.name}${node ? epistemicTextMarker(node) : ''}`;
    })
    .join(' · ');

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
    else return 'Start node not found in current visible graph.';
  }

  if (!toId.startsWith('n_')) {
    const match = allNodes.find((n) =>
      n.title.toLowerCase().includes(toId.toLowerCase()),
    );
    if (match) toId = match.id;
    else return 'Target node not found in current visible graph.';
  }

  if (!nodeMap.has(fromId))
    return 'Start node not found in current visible graph.';
  if (!nodeMap.has(toId))
    return 'Target node not found in current visible graph.';

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
    store.recordAccessBatch([fromId, toId]);
    return `No path between "${nodeMap.get(fromId)?.title}" and "${nodeMap.get(toId)?.title}"`;
  }

  // Reconstruct path
  const path: Array<{
    nodeId: string;
    nodeName: string;
    node: GraphNodeData;
    via: string;
  }> = [];
  let current = toId;
  while (current !== fromId) {
    const p = parent.get(current);
    if (!p) break;
    path.unshift({
      nodeId: current,
      nodeName: nodeMap.get(current)?.title || current,
      node: nodeMap.get(current) as GraphNodeData,
      via: p.via,
    });
    current = p.nodeId;
  }
  path.unshift({
    nodeId: fromId,
    nodeName: nodeMap.get(fromId)?.title || fromId,
    node: nodeMap.get(fromId) as GraphNodeData,
    via: '',
  });
  store.recordAccessBatch(path.map((step) => step.nodeId));

  // Format output
  let out = `Path (${path.length} nodes):\n\n`;
  path.forEach((step, i) => {
    if (i === 0) {
      out += `${step.nodeName}${epistemicTextMarker(step.node)}\n`;
    } else {
      out += `  ${step.via}\n${step.nodeName}${epistemicTextMarker(step.node)}\n`;
    }
  });

  return out;
}

// Generate history context for AI
export function generateHistoryContext(limit = 50): string {
  const events = getRecentEvents(limit, reservedThinkingVisible());

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
