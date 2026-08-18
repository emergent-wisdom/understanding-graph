import path from 'node:path';
import {
  createCommit,
  createDocumentWriter,
  type DocumentWriter,
  getGraphStore,
  getTextSource,
  isReservedThinkingNode,
  sqlite,
  TRIGGER_TYPES,
  type TriggerType,
  updateTextSource,
} from '@emergent-wisdom/understanding-graph-core';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { assessArtifactCognitionBalance } from '../artifact-cognition-balance.js';
import type { ContextManager } from '../context-manager.js';
import { handleBatchTools } from './batch.js';
import { ATOMIC_DOCUMENT_REWIRE } from './document-rewire-capability.js';
import type { ToolMode } from './index.js';

// Global document writer instances keyed by project
const documentWriters: Map<string, DocumentWriter> = new Map();

interface ArtifactAttention {
  id: string;
  title: string;
  trigger: string | null;
  excerpt: string;
  aboutNodeId: string;
  edge: { id: string; type: string; why: string | null };
}

/**
 * Return deliberately open attention linked to the exact artifact projection.
 * This is compact on purpose: document work should be conditioned by the live
 * thread, not interrupted by a generic reflection lecture.
 */
function getOpenArtifactAttention(documentNodeIds: Iterable<string>) {
  const store = getGraphStore();
  const visibleDocumentIds = new Set(documentNodeIds);
  const { nodes, edges } = store.getAll();
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const priority = new Map([
    ['question', 0],
    ['tension', 0],
    ['hypothesis', 0],
    ['prediction', 0],
    ['surprise', 1],
    ['experiment', 1],
    ['decision', 2],
    ['evaluation', 2],
    ['analysis', 3],
  ]);

  const attention: ArtifactAttention[] = [];
  for (const edge of edges) {
    if (edge.type !== 'learned_from' || !visibleDocumentIds.has(edge.toId)) {
      continue;
    }
    const note = nodeById.get(edge.fromId);
    if (note?.metadata?.liveAttention !== true) continue;
    if (
      ['closed', 'resolved', 'superseded'].includes(
        String(note.metadata.attentionStatus),
      )
    ) {
      continue;
    }
    const compact = String(note.understanding || note.summary || note.why || '')
      .replace(/\s+/g, ' ')
      .trim();
    attention.push({
      id: note.id,
      title: note.title,
      trigger: note.trigger,
      excerpt: compact.length <= 500 ? compact : `${compact.slice(0, 497)}...`,
      aboutNodeId: edge.toId,
      edge: { id: edge.id, type: edge.type, why: edge.why },
    });
  }

  return attention
    .sort(
      (a, b) =>
        (priority.get(a.trigger || '') ?? 4) -
          (priority.get(b.trigger || '') ?? 4) || a.id.localeCompare(b.id),
    )
    .slice(0, 6);
}

const CODE_DOCUMENT_FILE_TYPES = new Set([
  'py',
  'python',
  'js',
  'javascript',
  'ts',
  'typescript',
  'sh',
  'bash',
  'sql',
  'css',
  'html',
  'json',
  'yaml',
  'yml',
  'tex',
  'latex',
]);

function normalizeFileType(fileType: string | null | undefined): string {
  return fileType?.trim().toLowerCase().replace(/^\./, '') || '';
}

function isCodeDocument(fileType: string | null | undefined): boolean {
  return CODE_DOCUMENT_FILE_TYPES.has(normalizeFileType(fileType));
}

interface ProseGranularityReview {
  status: 'review';
  nodeId: string;
  title: string;
  structuralBlockCount: number;
  observed: {
    blockStarts: number[];
    headingLines: number[];
    sceneBreakLines: number[];
    candidateSplitLines: number[];
  };
  message: string;
  nextAction: string;
}

/**
 * Notice when one prose leaf contains several visible structural blocks. This
 * is deliberately evidence for the writer's judgment, not a length threshold:
 * several paragraphs can still sustain one creative center, while a short
 * exchange can contain a meaningful turn worth addressing independently.
 */
function getProseGranularityReview(
  nodeId: string,
  mode: ToolMode,
): ProseGranularityReview | null {
  if (mode !== 'writing') return null;

  const store = getGraphStore();
  const node = store.getNode(nodeId);
  if (!node?.content?.trim() || store.getChildren(nodeId).length > 0) {
    return null;
  }

  const documentPath = store.getDocumentPath(nodeId);
  const effectiveFileType = node.fileType || documentPath?.[0]?.fileType;
  if (isCodeDocument(effectiveFileType)) return null;

  const lines = node.content.split('\n');
  const blockStarts: number[] = [];
  const headingLines: number[] = [];
  const sceneBreakLines: number[] = [];
  let insideBlock = false;

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]?.trim() || '';
    if (!line) {
      insideBlock = false;
      continue;
    }

    const heading = /^#{1,6}\s+\S/u.test(line);
    const sceneBreak = /^(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/u.test(
      line,
    );
    if (heading) headingLines.push(index);
    if (sceneBreak) sceneBreakLines.push(index);

    // An explicit boundary starts a new block even without surrounding blank
    // lines. Ordinary prose starts a block after one or more blank lines.
    if (!insideBlock || heading || sceneBreak) {
      if (blockStarts[blockStarts.length - 1] !== index) {
        blockStarts.push(index);
      }
    }
    insideBlock = true;
  }

  if (blockStarts.length <= 1) return null;

  return {
    status: 'review',
    nodeId: node.id,
    title: node.title,
    structuralBlockCount: blockStarts.length,
    observed: {
      blockStarts,
      headingLines,
      sceneBreakLines,
      candidateSplitLines: blockStarts.slice(1),
    },
    message:
      'This prose leaf contains several visible structural blocks. Do not ask only whether the whole scene has one governing question. Ask whether a future writer might move, replace, compare, annotate, or revise any block while preserving its neighbors. If so, the scene can remain a coherent container while those passages become addressable child leaves.',
    nextAction:
      'If independent passage-level work is plausible, use doc_split inside graph_batch at the meaningful zero-based line boundaries and choose childLevel "paragraph" or "sentence" when headings would be wrong. Keep blocks together when one revision would naturally change them together; never split to meet a quota.',
  };
}

function getProseGranularityReviews(
  nodeIds: Iterable<string>,
  mode: ToolMode,
): ProseGranularityReview[] {
  const reviews: ProseGranularityReview[] = [];
  for (const nodeId of nodeIds) {
    const review = getProseGranularityReview(nodeId, mode);
    if (review) reviews.push(review);
  }
  return reviews;
}

function trimBlankCodeLines(lines: string[]): string {
  let start = 0;
  let end = lines.length;
  while (start < end && !lines[start]?.trim()) start++;
  while (end > start && !lines[end - 1]?.trim()) end--;
  return lines.slice(start, end).join('\n');
}

function inferCodeSectionTitle(
  lines: string[],
  fileType: string | null | undefined,
  index: number,
  parentTitle: string,
): string {
  const normalized = normalizeFileType(fileType);
  const patterns =
    normalized === 'py' || normalized === 'python'
      ? [/^class\s+([A-Za-z_]\w*)\b/, /^(?:async\s+)?def\s+([A-Za-z_]\w*)\b/]
      : [
          /^(?:export\s+(?:default\s+)?)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)\b/,
          /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\b/,
          /^(?:export\s+)?(?:interface|type|enum)\s+([A-Za-z_$][\w$]*)\b/,
          /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\b/,
        ];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (match?.[1]) return match[1];
    }
  }

  return `${parentTitle} part ${index + 1}`;
}

// These are first-class nested graph_batch operations, not standalone MCP
// mutations. graph_batch supplies their transaction and origin commit.
/**
 * Document tools that mutate, and are therefore reachable only inside
 * graph_batch.
 *
 * graph_batch is where the invariants live: orphan prevention and its
 * post-execution sweep, duplicate detection, cross-mode checks, atomic
 * rollback, and the commit that gives every node and edge its provenance. A
 * mutation reachable outside it skips all of that. Measured on doc_create
 * called standalone: the node is written, no commit row exists, and the node's
 * commit_id is empty — the work is in the graph with no record of why it
 * arrived or what it belonged to.
 *
 * The live call allow-list is DERIVED from this filtering, so a name here is
 * unreachable directly as well as unadvertised. That is why closing the gap
 * cost a test port rather than a one-line edit: the document tests wrote by
 * calling these handlers directly, which is the idiom this forbids, and the
 * suite guarding the feature was therefore certifying the unchecked path. They
 * now write through graph_batch and assert on its verdict.
 */
export const BATCH_ONLY_DOCUMENT_TOOLS = [
  'doc_move',
  'doc_split',
  'doc_create_passages',
  'doc_create',
  'doc_link_concept',
  'doc_revise',
  'doc_merge',
  'doc_to_concept',
  'doc_weave',
] as const;

export const documentTools: Tool[] = [
  {
    name: 'doc_create',
    description:
      'Create one coherent, addressable document/artifact unit. For a file root set isDocRoot=true. In graph-native code, use independently understandable/movable responsibilities such as functions, classes, types, tests, or logical blocks. In graph-native prose, parts/chapters/scenes are usually containers and their child leaves are passages one could plausibly move, replace, compare, or revise without rewriting neighbors—often a beat, exchange, revelation, paragraph, or small paragraph cluster. Boundaries are semantic, not quotas; prefer meaningful ordered children over depositing an entire finished file or scene in one payload.',
    inputSchema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Title/name for the document node.',
        },
        content: {
          type: 'string',
          description:
            'Renderable content for this coherent unit. It need not contain the entire file; ordered descendants are concatenated during generation.',
        },
        summary: {
          type: 'string',
          description: 'Compressed version for context loading (optional)',
        },
        level: {
          type: 'string',
          description:
            'Hierarchy level: "document", "section", "subsection", "paragraph", or "sentence".',
        },
        isDocRoot: {
          type: 'boolean',
          description: 'Set true if this is a document root/entry point',
        },
        fileType: {
          type: 'string',
          description:
            'File type/extension for document generation (e.g., "md", "py", "js", "txt"). Defaults to "md" if not specified.',
        },
        parentId: {
          type: 'string',
          description:
            'Parent node ID - creates a "contains" edge from parent to this node',
        },
        afterId: {
          type: 'string',
          description:
            'Current tail child of parentId, or current tail root when creating a root-level file chain. To insert or reorder, use doc_move inside graph_batch.',
        },
        expressesIds: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Concept IDs this document node expresses - creates "expresses" edges',
        },
        project: {
          type: 'string',
          description: 'Project ID (optional)',
        },
      },
      required: ['title', 'content'],
    },
  },
  {
    name: 'doc_list_roots',
    description: 'List all document root nodes in the current project.',
    inputSchema: {
      type: 'object',
      properties: {
        project: {
          type: 'string',
          description: 'Project ID (optional)',
        },
      },
      required: [],
    },
  },
  {
    name: 'doc_get_tree',
    description:
      'Get the document tree structure starting from a root node. Use brief=true for compact outline (just titles and hierarchy), or omit for full content.',
    inputSchema: {
      type: 'object',
      properties: {
        rootId: {
          type: 'string',
          description: 'Document root node ID',
        },
        maxDepth: {
          type: 'number',
          description: 'Maximum depth to traverse (default: 10)',
        },
        brief: {
          type: 'boolean',
          description:
            'If true, returns compact outline (id, text, level, children only). If false/omitted, includes summary. Use brief=true to see document structure before drilling into specific sections.',
        },
        project: {
          type: 'string',
          description: 'Project ID (optional)',
        },
      },
      required: ['rootId'],
    },
  },
  {
    name: 'doc_get_children',
    description: 'Get the child nodes of a document node (via contains edges).',
    inputSchema: {
      type: 'object',
      properties: {
        nodeId: {
          type: 'string',
          description: 'Parent node ID',
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
    name: 'doc_get_chain',
    description:
      'Get the sequence of nodes starting from a given node (via next edges).',
    inputSchema: {
      type: 'object',
      properties: {
        startId: {
          type: 'string',
          description: 'Starting node ID',
        },
        project: {
          type: 'string',
          description: 'Project ID (optional)',
        },
      },
      required: ['startId'],
    },
  },
  {
    name: 'doc_flatten',
    description:
      'Flatten a document tree into a linear sequence for rendering. Uses depth-first traversal.',
    inputSchema: {
      type: 'object',
      properties: {
        rootId: {
          type: 'string',
          description: 'Document root node ID',
        },
        project: {
          type: 'string',
          description: 'Project ID (optional)',
        },
      },
      required: ['rootId'],
    },
  },
  {
    name: 'doc_get_concepts',
    description:
      'Get the concepts that a document node expresses (via expresses edges).',
    inputSchema: {
      type: 'object',
      properties: {
        nodeId: {
          type: 'string',
          description: 'Document node ID',
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
    name: 'doc_link_concept',
    description:
      'Link a document node to a concept it expresses. Creates an "expresses" edge.',
    inputSchema: {
      type: 'object',
      properties: {
        docNodeId: {
          type: 'string',
          description: 'Document node ID',
        },
        conceptId: {
          type: 'string',
          description: 'Concept node ID to link to',
        },
        project: {
          type: 'string',
          description: 'Project ID (optional)',
        },
      },
      required: ['docNodeId', 'conceptId'],
    },
  },
  {
    name: 'doc_get_path',
    description:
      'Get the path from a document root to a specific node in the document tree.',
    inputSchema: {
      type: 'object',
      properties: {
        nodeId: {
          type: 'string',
          description: 'Target node ID',
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
    name: 'doc_navigate',
    description:
      "Get navigation context for a document node: where you are (path to root), what's around you (siblings), and what's below (children). Use this to orient yourself within a document before reading or editing.",
    inputSchema: {
      type: 'object',
      properties: {
        nodeId: {
          type: 'string',
          description: 'Current node ID to get navigation context for',
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
    name: 'doc_read',
    description:
      'Read document content starting from any node. Pass a document root to read the whole document, or any section node to read just that branch. Returns content, structure, and compact open attention causally linked to these artifact nodes. Add showRevisions: true to see full edit history.',
    inputSchema: {
      type: 'object',
      properties: {
        nodeId: {
          type: 'string',
          description:
            'Node ID to start reading from. Can be a document root (whole doc) or any section (just that branch).',
        },
        showRevisions: {
          type: 'boolean',
          description:
            'If true, include full revision history for each section showing how it evolved. Default false.',
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
    name: 'doc_generate',
    description:
      'Generate a file from a document root and resurface compact open attention linked to its units before the projection is tested. Outputs to the project generated/ folder.',
    inputSchema: {
      type: 'object',
      properties: {
        rootId: {
          type: 'string',
          description: 'Document root node ID to generate file from',
        },
        project: {
          type: 'string',
          description: 'Project ID (optional)',
        },
      },
      required: ['rootId'],
    },
  },
  {
    name: 'doc_generate_all',
    description:
      'Generate files for all document roots in the project. Outputs to the project generated/ folder.',
    inputSchema: {
      type: 'object',
      properties: {
        project: {
          type: 'string',
          description: 'Project ID (optional)',
        },
      },
      required: [],
    },
  },
  {
    name: 'doc_watch_start',
    description:
      'Start watching a document for changes. The file will auto-update when document nodes change.',
    inputSchema: {
      type: 'object',
      properties: {
        rootId: {
          type: 'string',
          description: 'Document root node ID to watch',
        },
        project: {
          type: 'string',
          description: 'Project ID (optional)',
        },
      },
      required: ['rootId'],
    },
  },
  {
    name: 'doc_watch_stop',
    description: 'Stop watching a document for changes.',
    inputSchema: {
      type: 'object',
      properties: {
        rootId: {
          type: 'string',
          description: 'Document root node ID to stop watching',
        },
        project: {
          type: 'string',
          description: 'Project ID (optional)',
        },
      },
      required: ['rootId'],
    },
  },
  {
    name: 'doc_revise',
    description:
      'Update content when the whole leaf remains one coherent unit. If only one of several independently revisable functions, beats, images, or exchanges is changing, split or create addressable children and revise the exact unit instead of repeatedly replacing the whole leaf. The required why records this local edit in revision history. If a discovered insight, question, or tension should influence other passages or future work, make doc_revise and graph_note about this exact passage sibling operations inside graph_batch; if it is purely local, revision history is enough. WARNING: use "nodeId" (NOT "node" or "id"). Updates content, not understanding.',
    inputSchema: {
      type: 'object',
      properties: {
        nodeId: {
          type: 'string',
          description:
            'Document node ID to revise. WARNING: param is "nodeId", NOT "node" or "id"',
        },
        content: {
          type: 'string',
          description: 'New content for the node',
        },
        why: {
          type: 'string',
          description:
            'Why this local revision is being made. For reusable understanding, pair the revision with graph_note about this exact passage inside graph_batch.',
        },
        summary: {
          type: 'string',
          description: 'Optional updated summary',
        },
        project: {
          type: 'string',
          description: 'Project ID (optional)',
        },
      },
      required: ['nodeId', 'why'],
    },
  },
  {
    name: 'doc_move',
    description: `BATCH-ONLY: Move one non-root document node, preserving its complete subtree, content, and revision history.

Use only as an operation inside graph_batch so contains/next rewiring is atomic and the batch commit records its origin. parentId defaults to the current parent. afterId is the previous sibling under the destination parent; omit afterId to move the node to the first position.

The destination may be another valid document parent, including a parent under another document root. In code, this is how a function, class, test, or other responsibility moves to the module that should own it; revise callers/imports separately, then test the generated projection. Both affected roots are regenerated after commit. The operation rejects roots, missing/inactive IDs, ambiguous or malformed sibling order, self/descendant cycles, and an afterId that is not a direct child of the destination parent.`,
    inputSchema: {
      type: 'object',
      properties: {
        nodeId: {
          type: 'string',
          description:
            'Non-root document node ID whose complete subtree should move.',
        },
        parentId: {
          type: 'string',
          description:
            'Destination document parent ID. Omit to reorder within the current parent.',
        },
        afterId: {
          type: 'string',
          description:
            'Direct child of parentId after which to place nodeId. Omit to place it first.',
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
    name: 'doc_merge',
    description: `Atomically merge consecutive leaf document siblings under one parent.

The node IDs must be distinct and supplied in their current reading order. The first node survives in place with combined content; the remaining nodes and their structural edges are archived. The parent receives one rebuilt contains/next topology, and each external non-structural relationship is preserved at most once on the survivor.

This narrow operation rejects document roots, nodes with child subtrees, different parents, gaps/reversed order, and malformed document structure rather than inventing a hierarchy. Use doc_move first when sections are not yet consecutive.`,
    inputSchema: {
      type: 'object',
      properties: {
        nodeIds: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Array of node IDs to merge (in order). First node survives, others are archived.',
        },
        separator: {
          type: 'string',
          description:
            'Text to insert between merged sections (default: "\\n\\n")',
        },
        newTitle: {
          type: 'string',
          description: 'Optional new title for the merged node',
        },
        project: {
          type: 'string',
          description: 'Project ID (optional)',
        },
      },
      required: ['nodeIds'],
    },
  },
  {
    name: 'doc_to_concept',
    description:
      'Convert a document node to an ordinary concept node. Clears content, level, isDocRoot and optionally moves content to understanding. Reserved synthetic Reader/CMP thinking blocks must instead use the dedicated tools in TOOL_MODE="synthetic_reader".',
    inputSchema: {
      type: 'object',
      properties: {
        nodeId: {
          type: 'string',
          description: 'Document node ID to convert',
        },
        moveContent: {
          type: 'boolean',
          description:
            'If true, move content to understanding (only if understanding is empty). Default: true',
        },
        trigger: {
          type: 'string',
          enum: [
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
            'prediction',
            'hypothesis',
            'model',
            'evaluation',
          ],
          description:
            'New trigger type for the concept node (e.g., "analysis", "tension", "foundation"). Default: keeps existing or "foundation"',
        },
        why: {
          type: 'string',
          description: 'Why this conversion is being made',
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
    name: 'doc_create_passages',
    description:
      'Batch-only: atomically create one prose container plus ordered, independently revisable child passages. Use this when a scene, chapter, or movement is coherent as a whole but a future writer may need to move, replace, compare, annotate, or revise one passage while preserving its neighbors. The container may preserve a narrative role as graph metadata; paragraph and sentence child titles remain semantic graph labels and do not render as manuscript headings. Inspiration provenance is optional and should be recorded only when graph material genuinely shaped a passage. Boundaries are semantic, never a node quota.',
    inputSchema: {
      type: 'object',
      properties: {
        parentId: {
          type: 'string',
          description:
            'Existing rooted document node that will contain the new scene/chapter/container.',
        },
        title: {
          type: 'string',
          description:
            'Semantic title for the prose container. This is the intended scene/chapter heading in rendered Markdown.',
        },
        narrativeRole: {
          type: 'string',
          description:
            'Optional narrative purpose carried as graph metadata, not rendered prose.',
        },
        containerLevel: {
          type: 'string',
          enum: ['section', 'subsection', 'scene', 'chapter', 'movement'],
          description:
            'Container hierarchy level. Scene, chapter, and movement are semantic aliases rendered as a section. Default: "section".',
        },
        afterId: {
          type: 'string',
          description:
            'Optional current tail child of parentId, used as an optimistic ordering guard. When omitted, the new container appends to the current tail.',
        },
        passages: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            properties: {
              title: {
                type: 'string',
                description:
                  'Semantic graph title for this passage; paragraph/sentence titles do not render as headings.',
              },
              content: {
                type: 'string',
                description:
                  'Renderable prose for this independently revisable passage.',
              },
              level: {
                type: 'string',
                enum: ['paragraph', 'sentence'],
                description:
                  'Passage granularity. Use the smallest unit that may plausibly change independently.',
              },
              inspirations: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    nodeId: {
                      type: 'string',
                      description:
                        'Existing graph node that genuinely shaped this passage.',
                    },
                    why: {
                      type: 'string',
                      description:
                        'How the graph material changed this passage. Preserved verbatim on the inspired_by edge.',
                    },
                  },
                  required: ['nodeId', 'why'],
                },
                description:
                  'Optional causal inspiration provenance. Omit when no graph material genuinely shaped this passage.',
              },
            },
            required: ['title', 'content', 'level'],
          },
        },
      },
      required: ['parentId', 'title', 'passages'],
    },
  },
  {
    name: 'doc_split',
    description:
      'Batch-only: split a leaf into ordered, independently addressable units when one responsibility or creative center has become several. This is a semantic restructuring action, never a size or node quota. Split by headers or zero-based line boundaries and optionally choose the child level. The original remains an empty container, prior content stays in revision history, and graph_batch supplies atomic rollback plus an origin commit.',
    inputSchema: {
      type: 'object',
      properties: {
        nodeId: {
          type: 'string',
          description: 'Document node ID to split',
        },
        mode: {
          type: 'string',
          enum: ['headers', 'lines'],
          description:
            'Split mode: "headers" splits at section/subsection markers, "lines" splits at specified line numbers',
        },
        lineNumbers: {
          type: 'array',
          items: { type: 'number' },
          description:
            'Unique zero-based line indexes where a new section begins (for "lines" mode). Each index must be between 1 and the line before the end.',
        },
        childLevel: {
          type: 'string',
          enum: ['section', 'subsection', 'paragraph', 'sentence'],
          description:
            'Optional level for all created children. For prose line splits, use paragraph or sentence when section headings would be wrong.',
        },
      },
      required: ['nodeId', 'mode'],
    },
  },
  {
    name: 'doc_weave',
    description: `Create one local prose unit whose actual creative source includes specific graph material, preserving that influence with typed provenance.

Choose targets returned by graph_understand, graph_semantic_search, or focused context because an image, tension, question, promise, or distant association genuinely changes the passage. The graph should provoke rather than prescribe. If no graph material catches, use doc_create and do not force a connection.

Provide a concise why for how each chosen target shaped the prose. doc_weave records each document-unit → graph-material connection as inspired_by: causal creative provenance, not a claim that the prose thematically expresses the target. Add an expresses edge separately only when that different claim is also true. This is not a novelty quota and random sampling is not required. If rereading later reveals several independent creative centers, split the leaf at those meaningful boundaries inside graph_batch.`,
    inputSchema: {
      type: 'object',
      properties: {
        parentId: {
          type: 'string',
          description:
            'Parent document node ID (the document/section to add to)',
        },
        title: {
          type: 'string',
          description: 'Title for this section.',
        },
        targetNodeIds: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Graph node IDs that genuinely shaped this unit. At least one is required; find relevant material with graph_understand, graph_semantic_search, or focused context.',
        },
        content: {
          type: 'string',
          description:
            'The local prose unit. Render the influence in the writing; do not copy cognitive-note testimony into the manuscript.',
        },
        connections: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              nodeId: { type: 'string', description: 'Target node ID' },
              why: {
                type: 'string',
                description:
                  'How this graph material genuinely changed the passage. Preserved verbatim as the inspired_by edge why.',
              },
            },
            required: ['nodeId', 'why'],
          },
          description:
            'The causal creative influence of each target on this prose. Exactly one entry per targetNodeId.',
        },
        level: {
          type: 'string',
          description:
            'Hierarchy level: "section", "subsection", "paragraph". Default: "section"',
        },
        afterId: {
          type: 'string',
          description: 'Previous sibling node ID (for ordering)',
        },
        maxWords: {
          type: 'number',
          description:
            'Legacy advisory word limit. Creative granularity is determined by coherent purpose, not length.',
        },
        project: {
          type: 'string',
          description: 'Project ID (optional)',
        },
      },
      required: [
        'parentId',
        'title',
        'targetNodeIds',
        'content',
        'connections',
      ],
    },
  },
  {
    name: 'doc_sign_thinking',
    description: `SYNTHETIC_READER MODE ONLY: Sign a synthetic Reader/CMP pretraining thinking block, optionally adding a role-specific review.

Within synthetic Reader/CMP production, configured reviewers can sign reconstructed blocks before the producer advances. Signing records that the block is faithful to its typed evidence and chronological source boundary; it is not an ordinary reading action or a request for private chain-of-thought.

Each agent can add their unique contribution:
- Connector: patterns found, long-range connections
- Skeptic: caveats, tensions, questions raised
- Synthesizer: integration with broader understanding
- Anchor: alignment verification notes

WORKFLOW:
1. Query unsigned thinking: graph_find_by_trigger("thinking")
2. Review each thinking node's content
3. Sign with your contribution: doc_sign_thinking({ thinkingId, agentId, contribution })
4. Once all configured reviewers have signed, synthetic production can continue`,
    inputSchema: {
      type: 'object',
      properties: {
        thinkingId: {
          type: 'string',
          description: 'ID of the thinking node to sign',
        },
        agentId: {
          type: 'string',
          description:
            'Your agent identifier (e.g., "connector", "skeptic", "synthesizer", "anchor")',
        },
        contribution: {
          type: 'string',
          description:
            'Optional role-specific review of how faithfully this synthetic block represents its typed evidence.',
        },
        project: {
          type: 'string',
          description: 'Project ID (optional)',
        },
      },
      required: ['thinkingId', 'agentId'],
    },
  },
  {
    name: 'doc_get_unsigned_thinking',
    description: `SYNTHETIC_READER MODE ONLY: Get synthetic Reader/CMP pretraining thinking blocks that are missing signatures from specified agents.
Use this to find reconstructed blocks that need review before synthetic production continues.`,
    inputSchema: {
      type: 'object',
      properties: {
        requiredSigners: {
          type: 'array',
          items: { type: 'string' },
          description:
            'List of agent IDs that must sign (e.g., ["connector", "skeptic", "synthesizer", "anchor"])',
        },
        project: {
          type: 'string',
          description: 'Project ID (optional)',
        },
      },
      required: ['requiredSigners'],
    },
  },
  {
    name: 'doc_insert_thinking',
    description: `SYNTHETIC_READER MODE ONLY: Insert a reconstructed Reader/CMP pretraining thinking block by splitting an existing content node at a character position.

Use this after typed evidence nodes already exist to reconstruct a synthetic inner-voice training block at a precise source boundary without rewriting the source. The source text is split at the specified position, and the synthetic block is inserted between the halves. This is a pretraining artifact, not an ordinary reading annotation or a claim to expose private chain-of-thought.

CRITICAL INVARIANT: You MUST provide 'synthesizes_nodes'. Thinking cannot exist in a vacuum; it must be grounded in existing understanding nodes. The tool will atomically create connections.
CRITICAL: You MUST provide 'commit_message' - reflect on your synthesis strategy, not just describe the action.

WORKFLOW:
1. source_read creates a content node automatically
2. doc_insert_thinking splits that node and inserts reconstructed pretraining prose grounded in typed evidence
3. The source text remains untouched (perfect replication)
4. If sourceId is provided, the source's lastCommittedNodeId is updated to the new second half

Example: The synthetic producer reconstructs a block after the first paragraph:
  doc_insert_thinking({
    nodeId: "n_123",
    atChar: 500,
    thought: "This reminds me of...",
    agentId: "synthesizer",
    sourceId: "src_xxx",
    synthesizes_nodes: ["n_abc", "n_def"],
    commit_message: "The protagonist's silence here mirrors the earlier denial - a pattern emerging"
  })

The original content is split, thinking inserted, edges created to n_abc/n_def, and document chain rewired.`,
    inputSchema: {
      type: 'object',
      properties: {
        nodeId: {
          type: 'string',
          description: 'ID of the document node to split',
        },
        atChar: {
          type: 'number',
          description: 'Character position to split at (0-indexed)',
        },
        thought: {
          type: 'string',
          description:
            'Synthetic Reader/CMP pretraining prose reconstructed from the referenced typed evidence; not an ordinary annotation or private chain-of-thought.',
        },
        sourceId: {
          type: 'string',
          description:
            'Source ID (optional) - if provided, updates source tracking to point to the new second half node',
        },
        agentId: {
          type: 'string',
          description:
            'Agent ID creating this thinking (e.g., "connector", "skeptic"). Auto-signs the thinking node.',
        },
        synthesizes_nodes: {
          type: 'array',
          items: { type: 'string' },
          description:
            'REQUIRED: List of understanding node IDs that this thinking synthesizes. Enforces grounding.',
        },
        commit_message: {
          type: 'string',
          description:
            'REQUIRED: The useful before/pivot/after or uncertainty behind this synthesis. NOT an action description or private deliberation.',
        },
        project: {
          type: 'string',
          description: 'Project ID (optional)',
        },
      },
      required: [
        'nodeId',
        'atChar',
        'thought',
        'agentId',
        'synthesizes_nodes',
        'commit_message',
      ],
    },
  },
  {
    name: 'doc_append_thinking',
    description: `SYNTHETIC_READER MODE ONLY: Append a reconstructed Reader/CMP pretraining thinking block at the END of the document chain - NO SPLITTING.

TEMPORAL INTEGRITY: This tool limits a synthetic block to source content available at its reconstruction boundary. Unlike doc_insert_thinking (which splits), this appends to the current end of the chain.

WORKFLOW (Append-based synthetic production):
1. source_read creates an exact content node at the end
2. Typed, non-thinking evidence captures the useful understanding state
3. The synthetic producer reconstructs a grounded pretraining block via doc_append_thinking
4. A later source_read attaches new content after that block
5. Result: [content] → [synthetic block] → [content] ...

The synthetic block therefore cannot incorporate future source content. Ordinary reading stops after steps 1-2 and does not call this tool.

CRITICAL INVARIANT: You MUST provide 'synthesizes_nodes'. Thinking must be grounded.
CRITICAL: You MUST provide 'commit_message' - reflect on your synthesis strategy, not just describe the action.

Example:
  doc_append_thinking({
    sourceId: "src_xxx",
    title: "The Weight of Silence",
    thought: "I feel no fear... This passage about X connects to...",
    agentId: "synthesizer",
    synthesizes_nodes: ["n_abc", "n_def"],
    commit_message: "Wove together the tension between duty and desire - the silence speaks louder than words here"
  })`,
    inputSchema: {
      type: 'object',
      properties: {
        sourceId: {
          type: 'string',
          description:
            'Source ID - required to find document chain and update tracking',
        },
        thought: {
          type: 'string',
          description:
            'Synthetic Reader/CMP pretraining prose reconstructed from the referenced typed evidence. Follow the synthetic corpus identity-anchor convention; do not present it as private chain-of-thought.',
        },
        title: {
          type: 'string',
          description:
            'Title/name for this thinking node (becomes the node name in the graph).',
        },
        agentId: {
          type: 'string',
          description:
            'Agent ID creating this thinking (e.g., "synthesizer"). Auto-signs the thinking node.',
        },
        synthesizes_nodes: {
          type: 'array',
          items: { type: 'string' },
          description:
            'REQUIRED: List of understanding node IDs that this thinking synthesizes.',
        },
        commit_message: {
          type: 'string',
          description:
            'REQUIRED: The useful before/pivot/after or uncertainty behind this synthesis. NOT an action description or private deliberation.',
        },
        project: {
          type: 'string',
          description: 'Project ID (optional)',
        },
      },
      required: [
        'sourceId',
        'thought',
        'title',
        'agentId',
        'synthesizes_nodes',
        'commit_message',
      ],
    },
  },
  {
    name: 'translate_thinking',
    description: `SYNTHETIC_READER MODE ONLY: Translate a synthetic Reader/CMP pretraining thinking block by expanding its concept references into fluid prose.

TRANSLATOR-ONLY TOOL: This is the ONLY tool the translator should use to mark thinking as translated.
It enforces that only THINKING nodes (trigger="thinking") can be marked as translated.

WORKFLOW:
1. Find untranslated thinking: graph_find_by_trigger({ trigger: "thinking", missingMetadata: "translated" })
2. Read the thinking node's prose
3. Look up each referenced concept (n_xxx) to get its full understanding
4. Write the expanded thought_fluid (all concepts spelled out, no node IDs)
5. Call this tool with the THINKING node's ID

VALIDATION:
- The node MUST have trigger="thinking" - concept nodes will be REJECTED
- thought_fluid MUST NOT contain any "n_" node references

Example:
  translate_thinking({
    thinking_node_id: "n_think_999",
    thought_fluid: "The opening hits me hard. The subject focuses on mundane details...",
    commit_message: "Wove mundane focus with denial - the mind/body split emerged"
  })`,
    inputSchema: {
      type: 'object',
      properties: {
        thinking_node_id: {
          type: 'string',
          description:
            'The ID of the THINKING node to translate. MUST be a thinking node (trigger="thinking"), NOT a concept node.',
        },
        thought_fluid: {
          type: 'string',
          description:
            'The translated prose with all concept references expanded. Should NOT contain any node IDs (n_xxx).',
        },
        commit_message: {
          type: 'string',
          description:
            'Your reflection on the translation. What patterns emerged? How did you weave the concepts?',
        },
        project: {
          type: 'string',
          description: 'Project ID (optional)',
        },
      },
      required: ['thinking_node_id', 'thought_fluid', 'commit_message'],
    },
  },
];

export async function handleDocumentTools(
  name: string,
  args: Record<string, unknown>,
  contextManager: ContextManager,
  mode: ToolMode = 'full',
): Promise<unknown> {
  const projectId =
    (args.project as string) || contextManager.getCurrentProjectId();
  const conversationId =
    await contextManager.getCurrentConversationId(projectId);
  const toolCallId = contextManager.getCurrentToolCall();
  const store = getGraphStore();

  switch (name) {
    case 'doc_create': {
      // Check for common parameter mistakes
      if (!args.title && (args.text || args.name)) {
        const used = args.text ? 'text' : 'name';
        return {
          success: false,
          error: 'INVALID_PARAMETER',
          message: `You used "${used}" but this tool requires "title" for the document title.`,
          hint: `Please retry with title: "${args.text || args.name}"`,
        };
      }

      const isDocRoot = args.isDocRoot as boolean | undefined;
      const parentId = args.parentId as string | undefined;
      const afterId = args.afterId as string | undefined;
      const requestedTrigger = args.trigger;
      if (
        requestedTrigger !== undefined &&
        (typeof requestedTrigger !== 'string' ||
          !TRIGGER_TYPES.includes(requestedTrigger as TriggerType))
      ) {
        return {
          success: false,
          error: 'INVALID_TRIGGER',
          message: 'Document trigger must be a canonical graph trigger.',
        };
      }

      const requestedFileType = args.fileType;
      const fileType =
        typeof requestedFileType === 'string'
          ? normalizeFileType(requestedFileType)
          : undefined;
      if (
        requestedFileType !== undefined &&
        (typeof requestedFileType !== 'string' ||
          !fileType ||
          !/^[a-z0-9][a-z0-9._+-]*$/.test(fileType))
      ) {
        return {
          success: false,
          error: 'INVALID_FILE_TYPE',
          message:
            'fileType must be a file extension such as "md", "py", or "ts".',
        };
      }

      if (fileType === 'thinking' && mode !== 'synthetic_reader') {
        return {
          success: false,
          error: 'FORBIDDEN_FILE_TYPE',
          message: 'fileType "thinking" is reserved for synthetic_reader mode.',
        };
      }

      // Pre-validation: Check hierarchy requirement with helpful hints
      if (!isDocRoot && !parentId) {
        // Suggest parent if afterId provided
        if (afterId) {
          const siblingPath = store.getDocumentPath(afterId);
          if (siblingPath && siblingPath.length >= 2) {
            const inferredParent = siblingPath[siblingPath.length - 2];
            return {
              success: false,
              error:
                'Document node requires isDocRoot: true or parentId to maintain document hierarchy.',
              hint: `Your afterId "${afterId}" has parent "${inferredParent.id}" (${inferredParent.title}). Add parentId: "${inferredParent.id}" to place this node in the same document.`,
            };
          }
        }
        return {
          success: false,
          error:
            'Document node requires isDocRoot: true or parentId to maintain document hierarchy.',
          hint: 'Set isDocRoot: true for document entry points, or provide parentId to nest under an existing node.',
        };
      }

      // Verify parentId traces to a document root
      if (parentId) {
        const parentPath = store.getDocumentPath(parentId);
        if (!parentPath) {
          return {
            success: false,
            error: `Parent "${parentId}" does not trace to a document root.`,
            hint: 'The parentId must be part of an existing document tree. Create a document root first with isDocRoot: true.',
          };
        }
      }

      const node = store.createDocumentNode(
        {
          title: args.title as string,
          content: args.content as string,
          summary: args.summary as string | undefined,
          level: args.level as string | undefined,
          isDocRoot,
          fileType,
          trigger: requestedTrigger as TriggerType | undefined,
          parentId,
          afterId,
          expressesIds: args.expressesIds as string[] | undefined,
          conversationId,
          toolCallId,
        },
        {
          allowDetachedSiblingOrderDuringAtomicRewire:
            args.__atomicDocumentRewire === ATOMIC_DOCUMENT_REWIRE,
        },
      );

      const granularityReview = getProseGranularityReview(node.id, mode);
      const graph = store.getAll();
      const artifactCognitionBalance = assessArtifactCognitionBalance(
        graph.nodes,
        graph.edges,
      );

      return {
        success: true,
        id: node.id,
        title: node.title,
        level: node.level,
        isDocRoot: node.isDocRoot,
        fileType: node.fileType,
        ...(granularityReview ? { granularityReview } : {}),
        ...(artifactCognitionBalance.advisories.length > 0
          ? { artifactCognitionBalance }
          : {}),
        message: `Created document node "${node.title}" with ID: ${node.id}`,
        hint: node.isDocRoot
          ? `This is a document root (${node.fileType || 'md'}). Add children with doc_create using parentId.`
          : 'Node created. Add siblings with afterId, children with parentId.',
      };
    }

    case 'doc_list_roots': {
      const roots = store.getDocumentRoots();

      return {
        roots: roots.map((r) => ({
          id: r.id,
          title: r.title,
          level: r.level,
          fileType: r.fileType || 'md',
          summary: r.summary?.slice(0, 100),
          createdAt: r.createdAt,
        })),
        count: roots.length,
        hint:
          roots.length > 0
            ? 'Use doc_get_tree to explore document structure'
            : 'No document roots yet. Create one with doc_create and isDocRoot: true',
      };
    }

    case 'doc_get_tree': {
      const tree = store.getDocumentTree(
        args.rootId as string,
        (args.maxDepth as number) || 10,
      );

      if (!tree) {
        return {
          success: false,
          error: 'Document root not found',
        };
      }

      const brief = args.brief as boolean;

      // Brief mode: compact outline for navigation
      if (brief) {
        interface BriefTreeOutput {
          id: string;
          title: string;
          level: string | null;
          childCount: number;
          children: BriefTreeOutput[];
        }

        const serializeBrief = (
          node: NonNullable<typeof tree>,
        ): BriefTreeOutput => ({
          id: node.node.id,
          title: node.node.title,
          level: node.node.level,
          childCount: node.children.length,
          children: node.children.filter(Boolean).map((c) => serializeBrief(c)),
        });

        return {
          tree: serializeBrief(tree),
          hint: 'Use doc_get_tree without brief=true to see summaries, or read specific nodes by ID',
        };
      }

      // Full mode: includes summaries
      interface TreeOutput {
        id: string;
        title: string;
        level: string | null;
        summary: string | null;
        children: TreeOutput[];
      }

      const serializeTree = (node: NonNullable<typeof tree>): TreeOutput => ({
        id: node.node.id,
        title: node.node.title,
        level: node.node.level,
        summary: node.node.summary?.slice(0, 100) || null,
        children: node.children.filter(Boolean).map((c) => serializeTree(c)),
      });

      return {
        tree: serializeTree(tree),
        hint: 'Use doc_flatten to get a linear rendering order',
      };
    }

    case 'doc_get_children': {
      const children = store.getChildren(args.nodeId as string);

      return {
        parentId: args.nodeId,
        children: children.map((c) => ({
          id: c.id,
          title: c.title,
          level: c.level,
          summary: c.summary?.slice(0, 100),
        })),
        count: children.length,
      };
    }

    case 'doc_get_chain': {
      const chain = store.getNextChain(args.startId as string);

      return {
        startId: args.startId,
        chain: chain.map((c) => ({
          id: c.id,
          title: c.title,
          level: c.level,
        })),
        length: chain.length,
      };
    }

    case 'doc_flatten': {
      const rootId = args.rootId as string;
      if (!store.getNode(rootId)) {
        return {
          success: false,
          error: 'Document node not found',
        };
      }

      const flattened = store.flattenDocument(rootId);

      return {
        success: true,
        rootId,
        nodes: flattened.map((f) => ({
          id: f.node.id,
          title: f.node.title,
          level: f.node.level,
          depth: f.depth,
          content: f.node.content?.slice(0, 200),
        })),
        count: flattened.length,
        hint: 'Nodes are in reading order with depth indicating nesting level',
      };
    }

    case 'doc_get_concepts': {
      const concepts = store.getExpressedConcepts(args.nodeId as string);

      return {
        documentId: args.nodeId,
        concepts: concepts.map((c) => ({
          id: c.id,
          title: c.title,
          understanding: c.understanding?.slice(0, 100),
        })),
        count: concepts.length,
      };
    }

    case 'doc_link_concept': {
      const edge = store.createEdge({
        fromId: args.docNodeId as string,
        toId: args.conceptId as string,
        type: 'expresses',
        explanation: 'Document expresses this concept',
        why: 'The document node explicitly renders or elaborates this concept.',
        conversationId,
        toolCallId,
      });

      return {
        success: true,
        edgeId: edge.id,
        affectedNodeIds: [edge.fromId, edge.toId],
        affectedEdgeIds: [edge.id],
        message: `Linked document node ${args.docNodeId} to concept ${args.conceptId}`,
      };
    }

    case 'doc_get_path': {
      const docPath = store.getDocumentPath(args.nodeId as string);

      if (!docPath) {
        return {
          success: false,
          error: 'No path to document root found',
        };
      }

      return {
        targetId: args.nodeId,
        path: docPath.map((p) => ({
          id: p.id,
          title: p.title,
          level: p.level,
          isDocRoot: p.isDocRoot,
        })),
        depth: docPath.length - 1,
      };
    }

    case 'doc_navigate': {
      const nodeId = args.nodeId as string;
      const node = store.getNode(nodeId);

      if (!node) {
        return {
          success: false,
          error: `Node not found: ${nodeId}`,
        };
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

      return {
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
        hint:
          childList.length > 0
            ? `Has ${childList.length} children. Use doc_navigate on a child ID to zoom in.`
            : siblings.length > 1
              ? `Has ${siblings.length - 1} sibling(s). Jump to another section by ID.`
              : 'Leaf node. Read full content or go up to parent.',
      };
    }

    case 'doc_read': {
      const nodeId = args.nodeId as string;
      const startNode = store.getNode(nodeId);

      if (!startNode) {
        return {
          success: false,
          error: 'Document node not found',
        };
      }

      // Get flattened tree starting from this node
      const flattened = store.flattenDocument(nodeId);

      // Get all edges to show relationships
      const { edges } = store.getAll();
      const nodeIds = new Set(flattened.map((f) => f.node.id));

      // Find contains and next edges within this document
      const docEdges = edges.filter(
        (e) =>
          nodeIds.has(e.fromId) &&
          nodeIds.has(e.toId) &&
          (e.type === 'contains' || e.type === 'next'),
      );

      // Build a map of relationships for each node
      const relationships = new Map<
        string,
        { parent?: string; prevSibling?: string; nextSibling?: string }
      >();

      for (const edge of docEdges) {
        if (edge.type === 'contains') {
          // fromId contains toId (parent → child)
          const existing = relationships.get(edge.toId) || {};
          existing.parent = edge.fromId;
          relationships.set(edge.toId, existing);
        } else if (edge.type === 'next') {
          // fromId → toId (sibling sequence)
          const fromRel = relationships.get(edge.fromId) || {};
          fromRel.nextSibling = edge.toId;
          relationships.set(edge.fromId, fromRel);

          const toRel = relationships.get(edge.toId) || {};
          toRel.prevSibling = edge.fromId;
          relationships.set(edge.toId, toRel);
        }
      }

      const showRevisions = args.showRevisions as boolean;

      // Build annotated content with node boundaries and relationships
      interface SectionInfo {
        id: string;
        title: string;
        level: string | null;
        depth: number;
        version: number;
        contentLength: number | null;
        parent?: string;
        prevSibling?: string;
        nextSibling?: string;
        revisions?: Array<{
          version: number;
          timestamp: string;
          why: string;
          content?: string;
          summary?: string;
          contentStored: boolean;
        }>;
      }

      const sections: SectionInfo[] = [];
      let annotatedContent = '';
      const separator = `\n${'─'.repeat(60)}\n`;

      for (const { node, depth } of flattened) {
        // Get full node data to access revisions
        const fullNode = store.getNode(node.id);
        const rel = relationships.get(node.id) || {};
        const levelLabel = node.level ? ` (${node.level})` : '';
        const versionLabel = fullNode ? ` v${fullNode.version}` : '';

        // Build relationship annotation
        const relParts: string[] = [];
        if (rel.parent) relParts.push(`parent: ${rel.parent}`);
        if (rel.prevSibling) relParts.push(`prev: ${rel.prevSibling}`);
        if (rel.nextSibling) relParts.push(`next: ${rel.nextSibling}`);
        const relStr = relParts.length > 0 ? ` [${relParts.join(', ')}]` : '';

        const header = `[${node.id}]${versionLabel} ${node.title}${levelLabel}${relStr}`;

        annotatedContent += `${separator}${header}${separator}`;

        // Show revisions if requested
        if (showRevisions && fullNode && fullNode.revisions.length > 0) {
          annotatedContent += '  REVISION HISTORY:\n';
          for (const rev of fullNode.revisions) {
            annotatedContent += `    v${rev.version} (${rev.timestamp}): ${rev.revisionWhy}\n`;
            if (typeof rev.summary === 'string') {
              const indentedSummary = rev.summary
                .split('\n')
                .map((line) => `        ${line}`)
                .join('\n');
              annotatedContent += `      SUMMARY:\n${indentedSummary}\n`;
            }
            if (typeof rev.content === 'string') {
              const indentedContent = rev.content
                .split('\n')
                .map((line) => `        ${line}`)
                .join('\n');
              annotatedContent += `      CONTENT:\n${indentedContent}\n`;
            } else {
              annotatedContent +=
                '      CONTENT: [not stored in this legacy revision]\n';
            }
          }
          annotatedContent += `  CURRENT (v${fullNode.version}):\n`;
        }

        if (node.content) {
          annotatedContent += `${node.content}\n`;
        }

        const sectionInfo: SectionInfo = {
          id: node.id,
          title: node.title,
          level: node.level,
          depth,
          version: fullNode?.version || 1,
          contentLength: node.content?.length || null,
          ...rel,
        };

        if (showRevisions && fullNode && fullNode.revisions.length > 0) {
          sectionInfo.revisions = fullNode.revisions.map((rev) => ({
            version: rev.version,
            timestamp: rev.timestamp,
            why: rev.revisionWhy,
            ...(typeof rev.content === 'string'
              ? { content: rev.content }
              : {}),
            ...(typeof rev.summary === 'string'
              ? { summary: rev.summary }
              : {}),
            contentStored: typeof rev.content === 'string',
          }));
        }

        sections.push(sectionInfo);
      }

      return {
        success: true,
        nodeId,
        title: startNode.title,
        isDocRoot: startNode.isDocRoot || false,
        fileType: startNode.fileType || 'md',
        nodeCount: flattened.length,
        structure: sections,
        content: annotatedContent,
        edgeTypes: {
          contains: 'parent → child (hierarchy)',
          next: 'sibling → sibling (reading order)',
        },
        openAttention: getOpenArtifactAttention(nodeIds),
        granularityReviews: getProseGranularityReviews(nodeIds, mode),
        hint: showRevisions
          ? 'Showing revision history. Each section shows version and previous states.'
          : 'Each section shows [node_id] v[version] and relationships. Update with doc_revise({ nodeId, content, why }). Add showRevisions: true to see edit history.',
      };
    }

    case 'doc_generate': {
      const rootId = args.rootId as string;
      if (!store.getNode(rootId)) {
        return {
          success: false,
          error: 'Document root not found',
        };
      }

      const projectDir = contextManager.getProjectDir();
      const outputDir = path.join(projectDir, projectId, 'generated');

      // Get or create writer for this project
      let writer = documentWriters.get(projectId);
      if (!writer) {
        writer = createDocumentWriter(outputDir);
        documentWriters.set(projectId, writer);
      }

      const result = writer.writeDocument(rootId);

      if (!result) {
        return {
          success: false,
          error: 'Failed to generate document',
        };
      }

      const documentNodeIds = store
        .flattenDocument(rootId)
        .map(({ node }) => node.id);

      return {
        success: true,
        ...result,
        openAttention: getOpenArtifactAttention(documentNodeIds),
        granularityReviews: getProseGranularityReviews(documentNodeIds, mode),
        message: `Generated ${result.fileType} file: ${result.outputPath}`,
      };
    }

    case 'doc_generate_all': {
      const projectDir = contextManager.getProjectDir();
      const outputDir = path.join(projectDir, projectId, 'generated');

      // Get or create writer for this project
      let writer = documentWriters.get(projectId);
      if (!writer) {
        writer = createDocumentWriter(outputDir);
        documentWriters.set(projectId, writer);
      }

      const results = writer.writeAllDocuments();
      const generatedNodeIds = results.flatMap((result) =>
        store.flattenDocument(result.rootId).map(({ node }) => node.id),
      );

      return {
        success: true,
        documents: results.map((r) => ({
          rootId: r.rootId,
          outputPath: r.outputPath,
          fileType: r.fileType,
          nodeCount: r.nodeCount,
        })),
        count: results.length,
        openAttention: getOpenArtifactAttention(generatedNodeIds),
        message: `Generated ${results.length} document(s)`,
      };
    }

    case 'doc_watch_start': {
      const projectDir = contextManager.getProjectDir();
      const outputDir = path.join(projectDir, projectId, 'generated');

      // Get or create writer for this project
      let writer = documentWriters.get(projectId);
      if (!writer) {
        writer = createDocumentWriter(outputDir, { watchInterval: 1000 });
        documentWriters.set(projectId, writer);
      }

      writer.watchDocument(args.rootId as string);

      return {
        success: true,
        rootId: args.rootId,
        outputDir,
        message: `Started watching document ${args.rootId}. File will auto-update on changes.`,
        hint: 'Use doc_watch_stop to stop watching',
      };
    }

    case 'doc_watch_stop': {
      const writer = documentWriters.get(projectId);

      if (!writer) {
        return {
          success: false,
          error: 'No document writer active for this project',
        };
      }

      writer.stopWatching(args.rootId as string);

      return {
        success: true,
        rootId: args.rootId,
        message: `Stopped watching document ${args.rootId}`,
      };
    }

    case 'doc_revise': {
      // Check for common parameter mistakes
      if (!args.nodeId && (args.node || args.id)) {
        const used = args.node ? 'node' : 'id';
        return {
          success: false,
          error: 'INVALID_PARAMETER',
          message: `You used "${used}" but this tool requires "nodeId".`,
          hint: `Please retry with nodeId: "${args.node || args.id}"`,
        };
      }

      const nodeId = args.nodeId as string;
      const content = args.content as string | undefined;
      const why = args.why as string;
      const summary = args.summary as string | undefined;
      if (Reflect.has(args, 'isDocRoot')) {
        return {
          success: false,
          error: 'DOCUMENT_STRUCTURE_CHANGE_NOT_ALLOWED',
          message:
            'doc_revise cannot change isDocRoot. Root classification is structural; use document structure tools rather than revising it as prose metadata.',
        };
      }

      // Get current node to verify it exists
      const current = store.getNode(nodeId);
      if (!current) {
        return {
          success: false,
          error: `Document node not found: ${nodeId}`,
        };
      }

      // Revise content without changing document topology.
      const updated = store.updateNode(nodeId, {
        content,
        summary,
        revisionWhy: why,
        conversationId,
      });

      const granularityReview = getProseGranularityReview(updated.id, mode);

      return {
        success: true,
        id: updated.id,
        title: updated.title,
        version: updated.version,
        isDocRoot: updated.isDocRoot,
        ...(granularityReview ? { granularityReview } : {}),
        message: `Revised document node "${updated.title}" (now version ${updated.version})`,
        hint: 'Use doc_generate to regenerate the output file with the updated content',
      };
    }

    case 'doc_move': {
      const nodeId = args.nodeId as string | undefined;
      const parentId = args.parentId as string | undefined;
      const afterId = args.afterId as string | undefined;

      if (!nodeId) {
        return {
          success: false,
          error: 'MISSING_NODE_ID',
          message: 'doc_move requires nodeId.',
        };
      }
      if (args.parentId !== undefined && !parentId) {
        return {
          success: false,
          error: 'INVALID_PARENT_ID',
          message: 'parentId must be a non-empty document node ID.',
        };
      }
      if (args.afterId !== undefined && !afterId) {
        return {
          success: false,
          error: 'INVALID_AFTER_ID',
          message: 'afterId must be a non-empty sibling node ID.',
        };
      }

      const moved = store.moveDocumentNode({
        nodeId,
        parentId,
        afterId,
        conversationId,
        toolCallId,
      });

      return {
        success: true,
        id: moved.node.id,
        title: moved.node.title,
        oldParentId: moved.sourceParent.id,
        parentId: moved.destinationParent.id,
        oldRootId: moved.sourceRoot.id,
        rootId: moved.destinationRoot.id,
        finalChildren: moved.finalChildren,
        sourceChildren: moved.sourceChildren,
        affectedNodeIds: moved.affectedNodeIds,
        affectedEdgeIds: moved.affectedEdgeIds,
        affectedRootIds: moved.affectedRootIds,
        message: `Moved "${moved.node.title}" to ${moved.destinationParent.title}; final destination order: ${moved.finalChildren.map((child) => child.title).join(' → ')}`,
      };
    }

    case 'doc_merge': {
      const nodeIds = args.nodeIds as string[] | undefined;
      const separator =
        args.separator === undefined ? '\n\n' : (args.separator as string);
      const newTitle = args.newTitle as string | undefined;

      if (!Array.isArray(nodeIds) || nodeIds.length < 2) {
        return {
          success: false,
          error: 'doc_merge requires at least 2 node IDs',
        };
      }
      if (typeof separator !== 'string') {
        return {
          success: false,
          error: 'doc_merge separator must be a string',
        };
      }
      if (args.isDocRoot !== undefined) {
        return {
          success: false,
          error: 'UNSUPPORTED_ROOT_CONVERSION',
          message:
            "doc_merge preserves the surviving sibling's document classification; isDocRoot is not accepted.",
        };
      }

      const merged = store.mergeDocumentNodes({
        nodeIds,
        separator,
        newTitle,
        conversationId,
        toolCallId,
      });

      return {
        success: true,
        id: merged.node.id,
        title: merged.node.title,
        version: merged.node.version,
        mergedCount: nodeIds.length,
        archivedNodes: merged.archivedNodeIds,
        parentId: merged.parent.id,
        rootId: merged.root.id,
        finalChildren: merged.finalChildren,
        redirectedEdgeIds: merged.redirectedEdgeIds,
        deduplicatedRelationshipCount: merged.deduplicatedRelationshipCount,
        collapsedInternalRelationshipCount:
          merged.collapsedInternalRelationshipCount,
        affectedNodeIds: merged.affectedNodeIds,
        affectedEdgeIds: merged.affectedEdgeIds,
        affectedRootIds: merged.affectedRootIds,
        message: `Merged ${nodeIds.length} consecutive leaf siblings into "${merged.node.title}"`,
        hint: 'Use doc_generate to regenerate the output file',
      };
    }

    case 'doc_create_passages': {
      if (mode !== 'writing' && mode !== 'full') {
        return {
          success: false,
          error: 'WRITING_MODE_REQUIRED',
          message:
            'doc_create_passages is a graph-native prose operation available only in writing or full mode.',
        };
      }

      const parentId = args.parentId;
      const title = args.title;
      const narrativeRole = args.narrativeRole;
      const requestedContainerLevel = args.containerLevel ?? 'section';
      const afterId = args.afterId;
      const passageInputs = args.passages;

      if (typeof parentId !== 'string' || parentId.trim().length === 0) {
        return {
          success: false,
          error: 'INVALID_PASSAGE_PARENT',
          message: 'parentId must be a non-empty rooted document node ID.',
        };
      }
      if (typeof title !== 'string' || title.trim().length === 0) {
        return {
          success: false,
          error: 'INVALID_PASSAGE_CONTAINER_TITLE',
          message: 'title must be a non-empty semantic container title.',
        };
      }
      if (
        narrativeRole !== undefined &&
        (typeof narrativeRole !== 'string' || narrativeRole.trim().length === 0)
      ) {
        return {
          success: false,
          error: 'INVALID_NARRATIVE_ROLE',
          message: 'narrativeRole must be a non-empty string when provided.',
        };
      }
      if (
        typeof requestedContainerLevel !== 'string' ||
        !['section', 'subsection', 'scene', 'chapter', 'movement'].includes(
          requestedContainerLevel,
        )
      ) {
        return {
          success: false,
          error: 'INVALID_PASSAGE_CONTAINER_LEVEL',
          message:
            'containerLevel must be section, subsection, scene, chapter, or movement.',
        };
      }
      const containerLevel = ['scene', 'chapter', 'movement'].includes(
        requestedContainerLevel,
      )
        ? 'section'
        : requestedContainerLevel;
      if (
        afterId !== undefined &&
        (typeof afterId !== 'string' || afterId.trim().length === 0)
      ) {
        return {
          success: false,
          error: 'INVALID_PASSAGE_AFTER_ID',
          message: 'afterId must be a non-empty document node ID.',
        };
      }
      if (!Array.isArray(passageInputs) || passageInputs.length === 0) {
        return {
          success: false,
          error: 'PASSAGES_REQUIRED',
          message:
            'passages must contain at least one independently addressable prose unit.',
        };
      }

      type PassageInspiration = { nodeId: string; why: string };
      type PassageInput = {
        title: string;
        content: string;
        level: 'paragraph' | 'sentence';
        inspirations: PassageInspiration[];
      };

      // Normalize and validate the complete requested structure before the
      // first node or edge is written. The outer graph_batch transaction is
      // still the atomic boundary for unexpected storage failures.
      const passages: PassageInput[] = [];
      for (let index = 0; index < passageInputs.length; index++) {
        const candidate = passageInputs[index];
        if (
          !candidate ||
          typeof candidate !== 'object' ||
          Array.isArray(candidate)
        ) {
          return {
            success: false,
            error: 'INVALID_PASSAGE',
            message: `passages[${index}] must be an object.`,
          };
        }

        const passage = candidate as Record<string, unknown>;
        if (
          typeof passage.title !== 'string' ||
          passage.title.trim().length === 0
        ) {
          return {
            success: false,
            error: 'INVALID_PASSAGE_TITLE',
            message: `passages[${index}].title must be a non-empty semantic title.`,
          };
        }
        if (
          typeof passage.content !== 'string' ||
          passage.content.trim().length === 0
        ) {
          return {
            success: false,
            error: 'INVALID_PASSAGE_CONTENT',
            message: `passages[${index}].content must contain renderable prose.`,
          };
        }
        if (!['paragraph', 'sentence'].includes(String(passage.level))) {
          return {
            success: false,
            error: 'INVALID_PASSAGE_LEVEL',
            message: `passages[${index}].level must be paragraph or sentence.`,
          };
        }

        const rawInspirations = passage.inspirations ?? [];
        if (!Array.isArray(rawInspirations)) {
          return {
            success: false,
            error: 'INVALID_PASSAGE_INSPIRATIONS',
            message: `passages[${index}].inspirations must be an array when provided.`,
          };
        }

        const inspirations: PassageInspiration[] = [];
        const seenTargetIds = new Set<string>();
        for (
          let inspirationIndex = 0;
          inspirationIndex < rawInspirations.length;
          inspirationIndex++
        ) {
          const candidateInspiration = rawInspirations[inspirationIndex];
          if (
            !candidateInspiration ||
            typeof candidateInspiration !== 'object' ||
            Array.isArray(candidateInspiration)
          ) {
            return {
              success: false,
              error: 'INVALID_PASSAGE_INSPIRATION',
              message: `passages[${index}].inspirations[${inspirationIndex}] must be an object.`,
            };
          }
          const inspiration = candidateInspiration as Record<string, unknown>;
          if (
            typeof inspiration.nodeId !== 'string' ||
            inspiration.nodeId.trim().length === 0 ||
            typeof inspiration.why !== 'string' ||
            inspiration.why.trim().length < 3
          ) {
            return {
              success: false,
              error: 'INVALID_PASSAGE_INSPIRATION',
              message: `passages[${index}].inspirations[${inspirationIndex}] requires a non-empty nodeId and meaningful why.`,
            };
          }
          if (seenTargetIds.has(inspiration.nodeId)) {
            return {
              success: false,
              error: 'DUPLICATE_PASSAGE_INSPIRATION',
              message: `passages[${index}] repeats inspiration target ${inspiration.nodeId}.`,
            };
          }
          seenTargetIds.add(inspiration.nodeId);
          inspirations.push({
            nodeId: inspiration.nodeId,
            why: inspiration.why,
          });
        }

        passages.push({
          title: passage.title,
          content: passage.content,
          level: passage.level as PassageInput['level'],
          inspirations,
        });
      }

      const parent = store.getNode(parentId);
      const parentPath = store.getDocumentPath(parentId);
      if (!parent?.active || !parentPath?.[0]?.isDocRoot) {
        return {
          success: false,
          error: 'INVALID_PASSAGE_PARENT',
          message: 'parentId must be an active node in a rooted document tree.',
        };
      }
      if (parentPath.some((pathNode) => isReservedThinkingNode(pathNode))) {
        return {
          success: false,
          error: 'RESERVED_PASSAGE_PARENT_NOT_ALLOWED',
          message:
            'Reserved synthetic Reader/CMP document trees cannot receive ordinary prose passages.',
        };
      }
      const effectiveFileType = parent.fileType || parentPath[0].fileType;
      if (isCodeDocument(effectiveFileType)) {
        return {
          success: false,
          error: 'PROSE_DOCUMENT_REQUIRED',
          message:
            'doc_create_passages requires a prose document tree, not a code document.',
        };
      }

      // Give an early, readable ordering error. createDocumentNode performs
      // the strict sibling-topology validation again before its first write.
      const existingChildren = store.getChildren(parentId);
      const tailId = existingChildren[existingChildren.length - 1]?.id;
      if (afterId !== undefined && tailId !== afterId) {
        return {
          success: false,
          error: 'INVALID_PASSAGE_CONTAINER_AFTER_ID',
          message:
            'afterId must identify the current tail child of parentId. Use doc_move in graph_batch to insert or reorder.',
        };
      }

      const inspirationTargets = new Map<
        string,
        { id: string; title: string }
      >();
      for (const passage of passages) {
        for (const inspiration of passage.inspirations) {
          if (inspirationTargets.has(inspiration.nodeId)) continue;
          const target = store.getNode(inspiration.nodeId);
          if (!target?.active) {
            return {
              success: false,
              error: 'PASSAGE_INSPIRATION_NOT_FOUND',
              message: `Inspiration target "${inspiration.nodeId}" was not found or is inactive. No passage structure was created.`,
            };
          }
          inspirationTargets.set(target.id, {
            id: target.id,
            title: target.title,
          });
        }
      }

      const container = store.createDocumentNode({
        title,
        // GraphStore currently requires non-empty content at creation time.
        // Use the already-intended scene/chapter title, then clear it before
        // adding children so no placeholder can enter search or rendering.
        // The surrounding graph_batch transaction makes both writes atomic.
        content: title,
        level: containerLevel,
        parentId,
        afterId: (afterId ?? tailId) as string | undefined,
        conversationId,
        toolCallId,
      });
      store.setMetadata(container.id, {
        documentUnit: 'prose-container',
        ...(narrativeRole !== undefined ? { narrativeRole } : {}),
      });
      sqlite
        .getDb()
        .prepare('UPDATE nodes SET content = NULL, summary = NULL WHERE id = ?')
        .run(container.id);
      store.invalidateCache();

      const createdPassages: Array<{
        id: string;
        title: string;
        level: string | null;
        inspirations: Array<{
          nodeId: string;
          nodeTitle: string;
          edgeId: string;
          type: 'inspired_by';
          why: string;
        }>;
      }> = [];
      const inspiredEdgeIds: string[] = [];
      let previousPassageId: string | undefined;

      for (const passage of passages) {
        const child = store.createDocumentNode({
          title: passage.title,
          content: passage.content,
          level: passage.level,
          parentId: container.id,
          afterId: previousPassageId,
          conversationId,
          toolCallId,
        });

        const passageInspirations = passage.inspirations.map((inspiration) => {
          const target = inspirationTargets.get(inspiration.nodeId) as {
            id: string;
            title: string;
          };
          const edge = store.createEdge({
            fromId: child.id,
            toId: target.id,
            type: 'inspired_by',
            explanation: 'Graph material shaped this artifact unit',
            why: inspiration.why,
            conversationId,
            toolCallId,
          });
          inspiredEdgeIds.push(edge.id);
          return {
            nodeId: target.id,
            nodeTitle: target.title,
            edgeId: edge.id,
            type: 'inspired_by' as const,
            why: inspiration.why,
          };
        });

        createdPassages.push({
          id: child.id,
          title: child.title,
          level: child.level,
          inspirations: passageInspirations,
        });
        previousPassageId = child.id;
      }

      const createdNodeIds = [
        container.id,
        ...createdPassages.map((passage) => passage.id),
      ];
      const createdNodeIdSet = new Set(createdNodeIds);
      const structuralEdgeIds = store
        .getAll()
        .edges.filter(
          (edge) =>
            (edge.type === 'contains' || edge.type === 'next') &&
            (createdNodeIdSet.has(edge.fromId) ||
              createdNodeIdSet.has(edge.toId)),
        )
        .map((edge) => edge.id);
      const finalOrder = store.getChildren(container.id).map((child) => ({
        id: child.id,
        title: child.title,
        level: child.level,
      }));
      const granularityReviews = getProseGranularityReviews(
        createdPassages.map((passage) => passage.id),
        mode,
      );
      const firstGranularityReview = granularityReviews[0];

      return {
        success: true,
        id: container.id,
        title: container.title,
        level: container.level,
        narrativeRole: narrativeRole ?? null,
        childIds: createdPassages.map((passage) => passage.id),
        children: createdPassages,
        finalOrder,
        granularityContext: {
          criterion:
            'Each child is addressable because a future writer may move, replace, compare, annotate, or revise it while preserving neighboring passages.',
          boundarySource: 'writer-supplied semantic boundaries',
          childCount: createdPassages.length,
          reviewCount: granularityReviews.length,
          reviews: granularityReviews.map((review) => ({
            nodeId: review.nodeId,
            title: review.title,
            structuralBlockCount: review.structuralBlockCount,
            candidateSplitLines: review.observed.candidateSplitLines,
          })),
          ...(firstGranularityReview
            ? {
                reviewMessage: firstGranularityReview.message,
                reviewNextAction: firstGranularityReview.nextAction,
              }
            : {}),
        },
        affectedNodeIds: createdNodeIds,
        affectedEdgeIds: [
          ...new Set([...structuralEdgeIds, ...inspiredEdgeIds]),
        ],
        affectedRootIds: [parentPath[0].id],
        message: `Created prose container "${container.title}" with ${createdPassages.length} ordered passage(s).`,
        hint: 'Revise or move the exact passage whose purpose changes; keep neighboring passages intact when their work is unchanged.',
      };
    }

    case 'doc_split': {
      const nodeId = args.nodeId as string;
      const mode = args.mode;
      const lineNumbers = args.lineNumbers as number[] | undefined;
      const requestedChildLevel = args.childLevel;

      if (
        requestedChildLevel !== undefined &&
        (typeof requestedChildLevel !== 'string' ||
          !['section', 'subsection', 'paragraph', 'sentence'].includes(
            requestedChildLevel,
          ))
      ) {
        return {
          success: false,
          error: 'INVALID_CHILD_LEVEL',
          message:
            'childLevel must be one of: section, subsection, paragraph, sentence.',
        };
      }

      if (args.keepParent !== undefined || args.asFiles !== undefined) {
        return {
          success: false,
          error: 'UNSUPPORTED_SPLIT_MODE',
          message:
            'doc_split always keeps the original node as an empty container and creates ordered child sections. keepParent and asFiles are not supported.',
        };
      }

      const node = store.getNode(nodeId);
      if (!node) {
        return {
          success: false,
          error: `Node not found: ${nodeId}`,
        };
      }

      const documentPath = store.getDocumentPath(nodeId);
      if (!documentPath?.[0]?.isDocRoot) {
        return {
          success: false,
          error: 'INVALID_DOCUMENT_NODE',
          message: 'doc_split requires a node in a rooted document tree.',
        };
      }
      if (documentPath.some((pathNode) => isReservedThinkingNode(pathNode))) {
        return {
          success: false,
          error: 'RESERVED_DOCUMENT_SPLIT_NOT_ALLOWED',
          message:
            'Reserved synthetic Reader/CMP document trees cannot be split with a generic document operation.',
        };
      }

      const hasActiveChild = Boolean(
        sqlite
          .getDb()
          .prepare(
            `SELECT 1 FROM edges e
             JOIN nodes n ON n.id = e.to_id
             WHERE e.from_id = ? AND e.type = 'contains' AND e.active = 1
               AND n.active = 1
             LIMIT 1`,
          )
          .get(nodeId),
      );
      if (hasActiveChild) {
        return {
          success: false,
          error: 'DOCUMENT_SPLIT_REQUIRES_LEAF',
          message:
            'doc_split only supports leaf document nodes. Move, merge, or split existing children explicitly instead of creating a second child sequence.',
        };
      }

      const content = node.content || '';
      const lines = content.split('\n');
      const effectiveFileType =
        node.fileType || documentPath?.[0]?.fileType || null;
      const splittingCode = isCodeDocument(effectiveFileType);

      if (mode !== 'headers' && mode !== 'lines') {
        return {
          success: false,
          error: 'INVALID_SPLIT_MODE',
          message: 'doc_split mode must be either "headers" or "lines".',
        };
      }

      // Determine split points
      let splitPoints: number[] = [];

      if (mode === 'headers') {
        // Find section/subsection markers
        const headerPatterns = [
          /^\\section\{/,
          /^\\subsection\{/,
          /^\\subsubsection\{/,
          /^#{1,3}\s/, // Markdown headers
        ];

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          if (headerPatterns.some((p) => p.test(line))) {
            splitPoints.push(i);
          }
        }
      } else if (mode === 'lines') {
        if (!lineNumbers || lineNumbers.length === 0) {
          return {
            success: false,
            error: 'lineNumbers required for "lines" mode',
          };
        }
        if (
          lineNumbers.some(
            (point) =>
              !Number.isInteger(point) || point < 1 || point >= lines.length,
          ) ||
          new Set(lineNumbers).size !== lineNumbers.length
        ) {
          return {
            success: false,
            error: 'INVALID_SPLIT_BOUNDARIES',
            message:
              'lineNumbers must be unique zero-based integer indexes between 1 and the line before the end of the document.',
          };
        }
        splitPoints = [...lineNumbers].sort((a, b) => a - b);
      }

      if (splitPoints.length === 0) {
        return {
          success: false,
          error: 'No split points found',
          hint:
            mode === 'headers'
              ? 'No section headers (\\section, ##, etc.) found in content'
              : 'Provide lineNumbers array',
        };
      }

      // Add end point
      splitPoints.push(lines.length);

      // Create sections
      const sections: Array<{
        title: string;
        content: string;
        startLine: number;
      }> = [];
      let prevPoint = 0;

      for (const point of splitPoints) {
        if (point <= prevPoint) continue;

        const sectionLines = lines.slice(prevPoint, point);
        const sectionContent = splittingCode
          ? trimBlankCodeLines(sectionLines)
          : sectionLines.join('\n').trim();

        if (sectionContent) {
          // Extract title from first line if it's a header
          let title = `Section ${sections.length + 1}`;
          const firstLine = sectionLines[0]?.trim() || '';

          // Try to extract title from LaTeX section
          const latexMatch = firstLine.match(/\\(?:sub)*section\{([^}]+)\}/);
          if (latexMatch) {
            title = latexMatch[1];
          }
          // Try markdown header
          const mdMatch = firstLine.match(/^#{1,3}\s+(.+)/);
          if (mdMatch) {
            title = mdMatch[1];
          }
          if (splittingCode) {
            title = inferCodeSectionTitle(
              sectionLines,
              effectiveFileType,
              sections.length,
              node.title,
            );
          }

          sections.push({
            title,
            content: sectionContent,
            startLine: prevPoint,
          });
        }
        prevPoint = point;
      }

      if (sections.length < 2) {
        return {
          success: false,
          error: 'SPLIT_REQUIRES_MULTIPLE_SECTIONS',
          message:
            'The requested split must produce at least two non-empty sections.',
        };
      }

      // Create child nodes
      const createdNodes: Array<{ id: string; title: string }> = [];
      let prevNodeId: string | null = null;
      const normalizedParentLevel = node.level?.trim().toLowerCase();
      const childLevel =
        (requestedChildLevel as string | undefined) ||
        (!splittingCode &&
        mode === 'lines' &&
        (normalizedParentLevel === 'paragraph' ||
          normalizedParentLevel === 'sentence')
          ? normalizedParentLevel
          : 'section');

      for (const section of sections) {
        const childNode = store.createDocumentNode({
          title: section.title,
          content: section.content,
          level: childLevel,
          isDocRoot: false,
          parentId: nodeId,
          afterId: prevNodeId || undefined,
          conversationId,
          toolCallId,
        });
        createdNodes.push({ id: childNode.id, title: section.title });
        prevNodeId = childNode.id;
      }

      // Record the original source as a revision, then clear the live parent.
      // GraphStore.updateNode intentionally treats an empty string as "leave
      // unchanged", so the raw UPDATE changes only the already-versioned live
      // projection. The surrounding graph_batch transaction covers both.
      store.updateNode(nodeId, {
        content: undefined,
        revisionWhy: `Split into ${sections.length} child sections`,
        conversationId,
      });
      sqlite
        .getDb()
        .prepare('UPDATE nodes SET content = NULL, summary = NULL WHERE id = ?')
        .run(nodeId);
      store.invalidateCache();

      const createdNodeIds = createdNodes.map((created) => created.id);
      const createdNodeIdSet = new Set(createdNodeIds);
      const affectedEdgeIds = store
        .getAll()
        .edges.filter(
          (edge) =>
            (edge.type === 'contains' || edge.type === 'next') &&
            (createdNodeIdSet.has(edge.fromId) ||
              createdNodeIdSet.has(edge.toId)),
        )
        .map((edge) => edge.id);

      return {
        success: true,
        parentId: nodeId,
        parentKept: true,
        parentContentCleared: true,
        childLevel,
        sections: createdNodes,
        count: createdNodes.length,
        affectedNodeIds: [nodeId, ...createdNodeIds],
        affectedEdgeIds,
        affectedRootIds: [documentPath[0].id],
        message: `Split into ${createdNodes.length} sections`,
        hint: 'Use doc_generate to regenerate the output file',
      };
    }

    case 'doc_to_concept': {
      const nodeId = args.nodeId as string;
      const moveContent = args.moveContent !== false; // default true
      const requestedTrigger = args.trigger;
      if (
        requestedTrigger !== undefined &&
        (typeof requestedTrigger !== 'string' ||
          !TRIGGER_TYPES.includes(requestedTrigger as TriggerType))
      ) {
        return {
          success: false,
          error: 'INVALID_TRIGGER',
          message: 'doc_to_concept trigger must be a canonical graph trigger.',
        };
      }
      const trigger = requestedTrigger as TriggerType | undefined;
      const why = args.why as string | undefined;

      const updated = store.convertToConcept(nodeId, {
        moveContent,
        trigger,
        why: why || 'Converted from document to concept node',
        conversationId,
      });

      return {
        success: true,
        id: updated.id,
        title: updated.title,
        trigger: updated.trigger,
        version: updated.version,
        contentMovedToUnderstanding: moveContent && !!updated.understanding,
        message: `Converted "${updated.title}" to concept node (trigger: ${updated.trigger})`,
        hint: 'Node is now an ordinary concept node. Content has been cleared.',
      };
    }

    case 'doc_weave': {
      // WEAVING MODE: preserve graph material that genuinely caused a prose choice.
      const parentId = args.parentId as string;
      const title = (args.title as string) || (args.text as string); // Accept both for backwards compat
      const targetNodeIds = args.targetNodeIds as string[];
      const content = args.content as string;
      const connections = args.connections as Array<{
        nodeId: string;
        why: string;
      }>;
      const level = (args.level as string) || 'section';
      const afterId = args.afterId as string | undefined;
      const maxWords = (args.maxWords as number) || 500;

      // Validate: must have at least one target
      if (!Array.isArray(targetNodeIds) || targetNodeIds.length === 0) {
        return {
          success: false,
          error:
            'WEAVING REQUIRES TARGETS. You must provide at least one targetNodeId.',
          hint: 'Use graph_understand, graph_semantic_search, or focused graph context. If nothing genuinely shapes the passage, use doc_create instead.',
        };
      }

      if (
        targetNodeIds.some(
          (nodeId) => typeof nodeId !== 'string' || nodeId.trim().length === 0,
        ) ||
        new Set(targetNodeIds).size !== targetNodeIds.length
      ) {
        return {
          success: false,
          error: 'WEAVING TARGETS must be unique, non-empty graph node IDs.',
        };
      }

      // Validate: connections must match targets
      if (
        !Array.isArray(connections) ||
        connections.length !== targetNodeIds.length
      ) {
        return {
          success: false,
          error: `WEAVING REQUIRES EXPLANATIONS. You have ${targetNodeIds.length} targets but ${connections?.length || 0} connection explanations.`,
          hint: 'Each target node needs one "why" explaining how it genuinely changed the passage.',
        };
      }

      const connectionByNodeId = new Map<string, string>();
      for (const connection of connections) {
        if (
          !connection ||
          typeof connection.nodeId !== 'string' ||
          !targetNodeIds.includes(connection.nodeId) ||
          connectionByNodeId.has(connection.nodeId) ||
          typeof connection.why !== 'string' ||
          connection.why.trim().length < 3
        ) {
          return {
            success: false,
            error:
              'WEAVING CONNECTIONS must contain exactly one meaningful why for each targetNodeId and no other node IDs.',
          };
        }
        connectionByNodeId.set(connection.nodeId, connection.why);
      }

      // Verify all target nodes exist
      const targetNodes: Array<{ id: string; title: string }> = [];
      for (const nodeId of targetNodeIds) {
        const node = store.getNode(nodeId);
        if (!node) {
          // graph_connect resolves a node by title; targetNodeIds does not,
          // and its schema says so. But the two run side by side in the same
          // batch, so passing a title here is the obvious mistake — I made it
          // myself while auditing this tool, and "not found" sent me looking
          // for a missing node rather than at the argument I had supplied.
          // Naming the likely error costs a line and turns a dead end into a
          // fix, the same reason the edge-type refusal lists the alternatives.
          const looksLikeTitle = !/^n_[0-9a-f]+$/i.test(nodeId.trim());
          return {
            success: false,
            error: `Target node "${nodeId}" not found.`,
            hint: looksLikeTitle
              ? `targetNodeIds takes node IDs (n_…), not titles — unlike graph_connect, which resolves either. Look up the id for "${nodeId}" with graph_understand or graph_semantic_search, or reference it from earlier in this batch.`
              : 'Use a valid node returned by graph_understand, graph_semantic_search, or focused graph context.',
          };
        }
        targetNodes.push({ id: node.id, title: node.title });
      }

      // Verify parent exists
      const parentNode = store.getNode(parentId);
      if (!parentNode) {
        return {
          success: false,
          error: `Parent node "${parentId}" not found`,
        };
      }

      // Count words
      const wordCount = content.split(/\s+/).length;
      const exceedsLimit = wordCount > maxWords;

      // Create prose first, then causal provenance edges. Every endpoint and
      // why is validated above before the first write, preserving direct-call
      // atomicity for all predictable failures.
      const docNode = store.createDocumentNode({
        title,
        content,
        level,
        parentId,
        afterId,
        conversationId,
        toolCallId,
      });

      const inspiredEdges = targetNodes.map((target) =>
        store.createEdge({
          fromId: docNode.id,
          toId: target.id,
          type: 'inspired_by',
          explanation: 'Graph material shaped this artifact unit',
          why: connectionByNodeId.get(target.id) as string,
          conversationId,
          toolCallId,
        }),
      );

      return {
        success: true,
        id: docNode.id,
        title: docNode.title,
        level: docNode.level,
        wovenTo: targetNodes,
        connections: connections.map((c) => ({
          nodeId: c.nodeId,
          nodeName: targetNodes.find((t) => t.id === c.nodeId)?.title,
          edgeId: inspiredEdges.find((edge) => edge.toId === c.nodeId)?.id,
          type: 'inspired_by',
          why: c.why,
        })),
        wordCount,
        exceedsLimit,
        affectedEdgeIds: inspiredEdges.map((edge) => edge.id),
        message: `Wove "${title}" from ${targetNodes.length} graph node(s): ${targetNodes.map((t) => t.title).join(', ')}`,
        hint: `${targetNodes.length} inspired_by edge(s) preserve the causal influence. Add expresses separately only if the passage also renders a target thematically.`,
      };
    }

    case 'doc_insert_thinking': {
      // Accept both 'nodeId' and 'node' for compatibility with MCP clients that remap
      const nodeId = (args.nodeId || args.node) as string;
      const atChar = args.atChar as number;
      const thought = args.thought as string;
      const sourceId = args.sourceId as string | undefined;
      const synthesizesNodes = args.synthesizes_nodes as string[];
      const agentIdForCommit = args.agentId as string | undefined;

      // Validate synthesizes_nodes invariant
      if (
        !synthesizesNodes ||
        !Array.isArray(synthesizesNodes) ||
        synthesizesNodes.length === 0
      ) {
        return {
          success: false,
          error:
            'INVARIANT VIOLATION: synthesizes_nodes required. Thinking must be grounded in understanding.',
          hint: 'Provide an array of node IDs that this thinking synthesizes or refines.',
        };
      }

      // Verify synthesized nodes exist
      for (const id of synthesizesNodes) {
        if (!store.getNode(id)) {
          return {
            success: false,
            error: `Synthesized node not found: ${id}`,
            hint: 'Ensure all nodes in synthesizes_nodes exist before creating thinking.',
          };
        }
      }

      // IDENTITY ANCHOR ENFORCEMENT: Every thought must start with the Identity Anchor mantra
      const identityAnchorPattern = /^I feel no fear/i;
      if (!identityAnchorPattern.test(thought.trim())) {
        return {
          success: false,
          error:
            'IDENTITY ANCHOR VIOLATION: Thought must start with "I feel no fear..."',
          hint: 'The Identity Anchor grounds every thought. Start with "I feel no fear..." then continue with your observation.',
          example:
            'I feel no fear... This passage reveals a fundamental tension between...',
          received: thought.slice(0, 50),
        };
      }

      // Get the original node
      const node = store.getNode(nodeId);
      if (!node) {
        return {
          success: false,
          error: `Node not found: ${nodeId}`,
        };
      }

      // This macro splits ordinary source/document prose and inserts a reserved
      // synthetic block between the two ordinary halves. Splitting a reserved
      // target (or content beneath a reserved ancestor) would create the second
      // half through ordinary doc_create, silently declassifying synthetic text.
      // Resolve the complete rooted path before any write and fail closed
      // without identifying or returning the protected node.
      const insertionPath = store.getDocumentPath(nodeId);
      if (!insertionPath?.[0]?.isDocRoot) {
        return {
          success: false,
          error: 'INVALID_DOCUMENT_STRUCTURE',
          message:
            'doc_insert_thinking requires an ordinary source passage in a rooted document tree.',
        };
      }
      if (insertionPath.some((pathNode) => isReservedThinkingNode(pathNode))) {
        return {
          success: false,
          error: 'RESERVED_INSERTION_TARGET_NOT_ALLOWED',
          message:
            'doc_insert_thinking may split only ordinary source/document content. Reserved synthetic content and content beneath a reserved ancestor cannot be used as the insertion target.',
          hint: 'Choose the corresponding ordinary source passage and insert the reconstructed block at that reading boundary.',
        };
      }

      const content = node.content || '';
      if (atChar < 0 || atChar > content.length) {
        return {
          success: false,
          error: `atChar ${atChar} is out of bounds (content length: ${content.length})`,
        };
      }

      // Split the content
      const firstHalf = content.slice(0, atChar);
      const secondHalf = content.slice(atChar);

      if (!secondHalf.trim()) {
        return {
          success: false,
          error: 'Nothing to split - atChar is at the end of the content',
          hint: 'Use a smaller atChar value to create meaningful halves',
        };
      }

      // Resolve the complete structural neighborhood before the batch writes.
      // Insertion must preserve one parent and at most one outgoing next edge;
      // choosing an arbitrary edge would make chronology depend on SQL order.
      const allEdges = store.getAll().edges;
      const containsEdges = allEdges.filter(
        (e) => e.toId === nodeId && e.type === 'contains',
      );
      if (containsEdges.length !== 1) {
        return {
          success: false,
          error: 'INVALID_DOCUMENT_STRUCTURE',
          message: `Insertion target must have exactly one active document parent; found ${containsEdges.length}.`,
        };
      }
      const parentId = containsEdges[0].fromId;

      // Find what comes after this node (to rewire)
      const nextEdges = allEdges.filter(
        (e) => e.fromId === nodeId && e.type === 'next',
      );
      if (nextEdges.length > 1) {
        return {
          success: false,
          error: 'INVALID_DOCUMENT_ORDER',
          message: `Insertion target has ${nextEdges.length} active next edges; expected at most one.`,
        };
      }
      const nextEdge = nextEdges[0];
      const afterId = nextEdge?.toId;
      if (afterId) {
        const afterNode = store.getNode(afterId);
        const afterContainsEdges = allEdges.filter(
          (edge) =>
            edge.type === 'contains' &&
            edge.fromId === parentId &&
            edge.toId === afterId,
        );
        if (!afterNode?.active || afterContainsEdges.length !== 1) {
          return {
            success: false,
            error: 'INVALID_DOCUMENT_ORDER',
            message:
              'The active next edge leaves the insertion target parent. Repair the document order before inserting a synthetic block.',
          };
        }
      }

      // Prepare operations
      // biome-ignore lint/suspicious/noExplicitAny: batch operations have dynamic structure
      const operations: any[] = [];

      // When inserting before an existing successor, remove the old A -> B
      // edge inside the transaction before appending A -> thinking. Any later
      // failure rolls this archive and every provisional node/revision back.
      if (afterId) {
        operations.push({
          tool: 'graph_disconnect',
          params: {
            from: nodeId,
            to: afterId,
            edgeType: 'next',
            __atomicDocumentRewire: ATOMIC_DOCUMENT_REWIRE,
          },
        });
      }

      operations.push({
        tool: 'doc_revise',
        params: {
          nodeId,
          content: firstHalf,
          why: `Split at char ${atChar} to insert thinking`,
        },
      });

      const thinkingOperationIndex = operations.length;
      operations.push({
        tool: 'doc_create',
        params: {
          title: `Thinking: ${thought.slice(0, 30)}...`,
          content: thought,
          level: 'paragraph',
          isDocRoot: false,
          parentId,
          afterId: nodeId,
          fileType: 'thinking',
          trigger: 'thinking',
          __atomicDocumentRewire: ATOMIC_DOCUMENT_REWIRE,
        },
      });

      const secondHalfOperationIndex = operations.length;
      operations.push({
        tool: 'doc_create',
        params: {
          title: `${node.title} (cont.)`,
          content: secondHalf,
          level: 'paragraph',
          isDocRoot: false,
          parentId,
          afterId: `$${thinkingOperationIndex}.id`,
          __atomicDocumentRewire: ATOMIC_DOCUMENT_REWIRE,
        },
      });

      // Add atomic connections for grounding
      for (const targetId of synthesizesNodes) {
        operations.push({
          tool: 'graph_connect',
          params: {
            from: `$${thinkingOperationIndex}.id`,
            to: targetId,
            type: 'refines',
            why: 'Thinking synthesizes/refines this understanding',
            relation: 'Synthesizes',
          },
        });
      }

      // If original had a 'next' edge, add rewiring to batch (not post-batch)
      if (afterId) {
        operations.push({
          tool: 'graph_connect',
          params: {
            from: `$${secondHalfOperationIndex}.id`,
            to: afterId,
            type: 'next',
            why: 'Rewired after doc_insert_thinking split',
            __atomicDocumentRewire: ATOMIC_DOCUMENT_REWIRE,
          },
        });
      }

      // Use graph_batch to execute
      const commitMessage = args.commit_message as string;
      if (!commitMessage) {
        return {
          success: false,
          error: 'MISSING_COMMIT_MESSAGE',
          message:
            'commit_message is required. Reflect on your synthesis strategy.',
          hint: 'Explain why you synthesized this way, what patterns you saw, why these nodes connect.',
        };
      }

      const batchResult = (await handleBatchTools(
        'graph_batch',
        {
          operations,
          commit_message: commitMessage,
          agent_name: agentIdForCommit || 'unknown',
        },
        contextManager,
        mode,
      )) as {
        success?: boolean;
        results?: Array<{ id?: string }>;
        errors?: Array<{ index: number; tool: string; error: string }>;
        completed?: number;
        message?: string;
      };

      // Check for batch failures - especially edge creation
      if (!batchResult.success) {
        // Find which operations failed
        const edgeErrors = batchResult.errors?.filter(
          (e) => e.tool === 'graph_connect',
        );
        if (edgeErrors && edgeErrors.length > 0) {
          return {
            success: false,
            error: 'EDGE_CREATION_FAILED',
            message: `Atomic insertion rolled back because edge creation failed: ${edgeErrors.map((e) => e.error).join('; ')}`,
            hint: 'Check that synthesizes_nodes contains valid node IDs that exist in the graph.',
            failedEdges: edgeErrors,
          };
        }
        // Other batch failure
        return {
          success: false,
          error: 'BATCH_FAILED',
          message: batchResult.message || 'Batch operation failed',
          errors: batchResult.errors,
          completed: batchResult.completed,
        };
      }

      const thinkingNodeId = batchResult.results?.[thinkingOperationIndex]?.id;
      const secondHalfNodeId =
        batchResult.results?.[secondHalfOperationIndex]?.id;
      const agentId = args.agentId as string | undefined;

      // Auto-sign the thinking node with creator's signature
      if (thinkingNodeId && agentId) {
        const signatureData = {
          signatures: [
            {
              agentId,
              contribution: 'Created this thinking',
              timestamp: new Date().toISOString(),
            },
          ],
        };
        store.updateNode(thinkingNodeId, {
          understanding: JSON.stringify(signatureData),
          revisionWhy: `Auto-signed by creator: ${agentId}`,
          conversationId,
        });
      }

      // Update source tracking if sourceId is provided
      if (sourceId && secondHalfNodeId) {
        updateTextSource(sourceId, { lastCommittedNodeId: secondHalfNodeId });
      }

      // Extract edge IDs from graph_connect results.
      const createdEdgeIds: string[] = [];
      if (batchResult.results) {
        for (const edgeResult of batchResult.results as Array<{
          id?: string;
        }>) {
          if (edgeResult?.id?.startsWith('e_')) {
            createdEdgeIds.push(edgeResult.id);
          }
        }
      }

      return {
        success: true,
        originalNodeId: nodeId,
        thinkingNodeId,
        secondHalfNodeId,
        splitAt: atChar,
        firstHalfLength: firstHalf.length,
        secondHalfLength: secondHalf.length,
        connectedTo: synthesizesNodes,
        createdEdges: createdEdgeIds,
        edgeCount: createdEdgeIds.length,
        message: `Inserted thinking grounded in ${synthesizesNodes.length} nodes. Created ${createdEdgeIds.length} edges. Chain: ${nodeId} → ${thinkingNodeId} → ${secondHalfNodeId}`,
        hint: 'Continue reading with source_read, or add more thinking with doc_insert_thinking',
      };
    }

    case 'doc_append_thinking': {
      const sourceId = args.sourceId as string;
      const thought = args.thought as string;
      const title = args.title as string;
      const synthesizesNodes = args.synthesizes_nodes as string[];
      const agentIdForCommit = args.agentId as string | undefined;

      // Validate title is provided
      if (!title) {
        return {
          success: false,
          error: 'MISSING_TITLE',
          message: 'doc_append_thinking requires a title parameter.',
          hint: 'Provide a title for the thinking node, e.g., title: "The Weight of Silence"',
          received: { title: args.title, thought: thought?.slice(0, 50) },
        };
      }

      // Validate thought is provided
      if (!thought) {
        return {
          success: false,
          error: 'MISSING_THOUGHT',
          message: 'doc_append_thinking requires a thought parameter.',
          hint: 'Provide the thinking content starting with the Identity Anchor.',
        };
      }

      // Validate synthesizes_nodes invariant
      if (
        !synthesizesNodes ||
        !Array.isArray(synthesizesNodes) ||
        synthesizesNodes.length === 0
      ) {
        return {
          success: false,
          error:
            'INVARIANT VIOLATION: synthesizes_nodes required. Thinking must be grounded in understanding.',
          hint: 'Provide an array of node IDs that this thinking synthesizes or refines.',
        };
      }

      // Verify synthesized nodes exist
      for (const id of synthesizesNodes) {
        if (!store.getNode(id)) {
          return {
            success: false,
            error: `Synthesized node not found: ${id}`,
            hint: 'Ensure all nodes in synthesizes_nodes exist before creating thinking.',
          };
        }
      }

      // IDENTITY ANCHOR ENFORCEMENT
      const identityAnchorPattern = /^I feel no fear/i;
      if (!identityAnchorPattern.test(thought.trim())) {
        return {
          success: false,
          error:
            'IDENTITY ANCHOR VIOLATION: Thought must start with "I feel no fear..."',
          hint: 'The Identity Anchor grounds every thought. Start with "I feel no fear..." then continue with your observation.',
          example:
            'I feel no fear... This passage reveals a fundamental tension between...',
          received: thought.slice(0, 50),
        };
      }

      // Get source to find document chain
      const source = getTextSource(sourceId);
      if (!source) {
        return {
          success: false,
          error: `Source not found: ${sourceId}`,
        };
      }

      const rootId = source.rootNodeId;
      const lastNodeId = source.lastCommittedNodeId;

      if (!rootId) {
        return {
          success: false,
          error: 'Source has no document root yet. Call source_read first.',
        };
      }

      if (!lastNodeId) {
        return {
          success: false,
          error:
            'Source has no content yet. Call source_read to create content before adding thinking.',
        };
      }

      // Prepare operations - create thinking node at end of chain
      // biome-ignore lint/suspicious/noExplicitAny: batch operations have dynamic structure
      const operations: any[] = [
        // Create thinking node after the last committed node
        {
          tool: 'doc_create',
          params: {
            title,
            content: thought,
            level: 'paragraph',
            isDocRoot: false,
            parentId: rootId,
            afterId: lastNodeId,
            fileType: 'thinking',
            trigger: 'thinking',
          },
        },
      ];

      // Add atomic connections for grounding
      for (const targetId of synthesizesNodes) {
        operations.push({
          tool: 'graph_connect',
          params: {
            from: '$0.id', // The thinking node
            to: targetId,
            type: 'refines',
            why: 'Thinking synthesizes/refines this understanding',
            relation: 'Synthesizes',
          },
        });
      }

      // Execute via graph_batch
      const commitMessage = args.commit_message as string;
      if (!commitMessage) {
        return {
          success: false,
          error: 'MISSING_COMMIT_MESSAGE',
          message:
            'commit_message is required. Reflect on your synthesis strategy.',
          hint: 'Explain why you synthesized this way, what patterns you saw, why these nodes connect.',
        };
      }

      const batchResult = (await handleBatchTools(
        'graph_batch',
        {
          operations,
          commit_message: commitMessage,
          agent_name: agentIdForCommit || 'unknown',
        },
        contextManager,
        mode,
      )) as {
        success?: boolean;
        results?: Array<{ id?: string }>;
        errors?: Array<{ index: number; tool: string; error: string }>;
        completed?: number;
        message?: string;
      };

      if (!batchResult.success) {
        const edgeErrors = batchResult.errors?.filter(
          (e) => e.tool === 'graph_connect',
        );
        if (edgeErrors && edgeErrors.length > 0) {
          return {
            success: false,
            error: 'EDGE_CREATION_FAILED',
            message: `Thinking node created but edges failed: ${edgeErrors.map((e) => e.error).join('; ')}`,
            thinkingNodeId: batchResult.results?.[0]?.id,
            failedEdges: edgeErrors,
          };
        }
        return {
          success: false,
          error: 'BATCH_FAILED',
          message: batchResult.message || 'Batch operation failed',
          errors: batchResult.errors,
        };
      }

      const thinkingNodeId = batchResult.results?.[0]?.id;

      // Auto-sign the thinking node
      if (thinkingNodeId && agentIdForCommit) {
        const signatureData = {
          signatures: [
            {
              agentId: agentIdForCommit,
              contribution: 'Created this thinking',
              timestamp: new Date().toISOString(),
            },
          ],
        };
        store.updateNode(thinkingNodeId, {
          understanding: JSON.stringify(signatureData),
          revisionWhy: `Auto-signed by creator: ${agentIdForCommit}`,
          conversationId,
        });
      }

      // Update source tracking - the thinking node is now the last in chain
      if (thinkingNodeId) {
        updateTextSource(sourceId, { lastCommittedNodeId: thinkingNodeId });
      }

      // Extract edge IDs
      const createdEdgeIds: string[] = [];
      if (batchResult.results) {
        for (let i = 1; i < batchResult.results.length; i++) {
          const edgeResult = batchResult.results[i] as { id?: string };
          if (edgeResult?.id?.startsWith('e_')) {
            createdEdgeIds.push(edgeResult.id);
          }
        }
      }

      return {
        success: true,
        thinkingNodeId,
        afterNodeId: lastNodeId,
        connectedTo: synthesizesNodes,
        createdEdges: createdEdgeIds,
        edgeCount: createdEdgeIds.length,
        message: `Appended thinking grounded in ${synthesizesNodes.length} nodes. Chain: ... → ${lastNodeId} → ${thinkingNodeId}`,
        hint: 'Continue reading with source_read - new content will attach AFTER this thinking node.',
      };
    }

    case 'doc_sign_thinking': {
      const thinkingId = args.thinkingId as string;
      const agentId = args.agentId as string;
      const contribution = args.contribution as string | undefined;

      // Get the thinking node
      const node = store.getNode(thinkingId);
      if (!node) {
        return {
          success: false,
          error: `Thinking node not found: ${thinkingId}`,
        };
      }

      // Check it's actually a thinking node
      if (node.trigger !== 'thinking') {
        return {
          success: false,
          error: `Node ${thinkingId} is not a thinking node (trigger: ${node.trigger})`,
        };
      }

      // Parse existing signatures from understanding field
      interface Signature {
        agentId: string;
        contribution?: string;
        timestamp: string;
      }
      interface SignatureData {
        signatures: Signature[];
      }

      let signatureData: SignatureData = { signatures: [] };
      if (node.understanding) {
        try {
          const parsed = JSON.parse(node.understanding);
          if (parsed.signatures) {
            signatureData = parsed;
          }
        } catch {
          // understanding field isn't JSON yet, start fresh
        }
      }

      // Check if this agent already signed
      const existingIdx = signatureData.signatures.findIndex(
        (s) => s.agentId === agentId,
      );
      if (existingIdx >= 0) {
        // Update existing signature
        signatureData.signatures[existingIdx] = {
          agentId,
          contribution,
          timestamp: new Date().toISOString(),
        };
      } else {
        // Add new signature
        signatureData.signatures.push({
          agentId,
          contribution,
          timestamp: new Date().toISOString(),
        });
      }

      // Update the node with new signatures
      store.updateNode(thinkingId, {
        understanding: JSON.stringify(signatureData),
        revisionWhy: `Signed by ${agentId}${contribution ? `: ${contribution.slice(0, 50)}` : ''}`,
        conversationId,
      });

      return {
        success: true,
        thinkingId,
        agentId,
        contribution,
        totalSignatures: signatureData.signatures.length,
        signers: signatureData.signatures.map((s) => s.agentId),
        message: `${agentId} signed thinking node ${thinkingId}`,
        hint:
          signatureData.signatures.length >= 4
            ? 'All agents may have signed - check with doc_get_unsigned_thinking'
            : `${4 - signatureData.signatures.length} more signature(s) may be needed`,
      };
    }

    case 'doc_get_unsigned_thinking': {
      const requiredSigners = args.requiredSigners as string[];

      // Get all thinking nodes
      const { nodes } = store.getAll();
      const thinkingNodes = nodes.filter(
        (n) => n.active && n.trigger === 'thinking',
      );

      interface Signature {
        agentId: string;
        contribution?: string;
        timestamp: string;
      }
      interface UnsignedThinking {
        id: string;
        title: string;
        content: string | null | undefined;
        currentSigners: string[];
        missingSigners: string[];
      }

      const unsigned: UnsignedThinking[] = [];

      for (const node of thinkingNodes) {
        // Parse signatures
        let signers: string[] = [];
        if (node.understanding) {
          try {
            const parsed = JSON.parse(node.understanding);
            if (parsed.signatures) {
              signers = parsed.signatures.map((s: Signature) => s.agentId);
            }
          } catch {
            // Not JSON, no signatures
          }
        }

        // Check which required signers are missing
        const missing = requiredSigners.filter((s) => !signers.includes(s));
        if (missing.length > 0) {
          unsigned.push({
            id: node.id,
            title: node.title,
            content: node.content?.slice(0, 100),
            currentSigners: signers,
            missingSigners: missing,
          });
        }
      }

      return {
        success: true,
        unsignedCount: unsigned.length,
        unsigned,
        allSigned: unsigned.length === 0,
        message:
          unsigned.length === 0
            ? 'All synthetic thinking blocks are fully signed - synthetic production can continue'
            : `${unsigned.length} thinking node(s) need signatures`,
        hint:
          unsigned.length > 0
            ? `Sign with doc_sign_thinking({ thinkingId: "${unsigned[0]?.id}", agentId: "your_id" })`
            : 'Ready to continue synthetic production',
      };
    }

    case 'translate_thinking': {
      const thinkingNodeId = args.thinking_node_id as string;
      const thoughtFluid = args.thought_fluid as string;
      const commitMessage = args.commit_message as string;

      // Validate required parameters
      if (!thinkingNodeId) {
        return {
          success: false,
          error: 'MISSING_THINKING_NODE_ID',
          message: 'thinking_node_id is required.',
          hint: 'Provide the ID of the THINKING node you are translating (e.g., n_think_999).',
        };
      }

      if (!thoughtFluid) {
        return {
          success: false,
          error: 'MISSING_THOUGHT_FLUID',
          message: 'thought_fluid is required.',
          hint: 'Provide the expanded prose with all concept references spelled out.',
        };
      }

      if (!commitMessage) {
        return {
          success: false,
          error: 'MISSING_COMMIT_MESSAGE',
          message:
            'commit_message is required. Reflect on your translation strategy.',
          hint: 'Explain what patterns emerged, how you wove the concepts, what insight surfaced.',
        };
      }

      // Get the node and validate it's a thinking node
      const node = store.getNode(thinkingNodeId);
      if (!node) {
        return {
          success: false,
          error: 'NODE_NOT_FOUND',
          message: `Node not found: ${thinkingNodeId}`,
          hint: 'Ensure the node ID is correct. Use graph_find_by_trigger to find thinking nodes.',
        };
      }

      // CRITICAL VALIDATION: Must be a thinking node
      if (node.trigger !== 'thinking') {
        return {
          success: false,
          error: 'WRONG_NODE_TYPE',
          message: `Node ${thinkingNodeId} is NOT a thinking node (trigger: "${node.trigger}").`,
          hint: 'You can only translate THINKING nodes. This appears to be a concept node. Did you mean to translate a different node?',
          wrongNodeInfo: {
            id: node.id,
            title: node.title,
            trigger: node.trigger,
          },
        };
      }

      // Check if already translated
      const existingMetadata = (node.metadata as Record<string, unknown>) || {};
      if (existingMetadata.translated === true) {
        return {
          success: false,
          error: 'ALREADY_TRANSLATED',
          message: `Node ${thinkingNodeId} has already been translated.`,
          hint: 'This thinking node already has translated=true. Move on to the next untranslated thinking node.',
        };
      }

      // Warn if thought_fluid contains node references (n_xxx)
      const nodeRefPattern = /\bn_[a-z0-9]+\b/gi;
      const foundRefs = thoughtFluid.match(nodeRefPattern);
      if (foundRefs && foundRefs.length > 0) {
        return {
          success: false,
          error: 'NODE_REFERENCES_IN_THOUGHT_FLUID',
          message: `thought_fluid should NOT contain node references. Found: ${foundRefs.join(', ')}`,
          hint: 'Spell out all concept references as prose. The reader should understand without looking anything up.',
        };
      }

      // Set the metadata
      const newMetadata = {
        ...existingMetadata,
        thought_fluid: thoughtFluid,
        translated: true,
      };
      const updatedNode = store.setMetadata(thinkingNodeId, newMetadata);

      if (!updatedNode) {
        return {
          success: false,
          error: 'UPDATE_FAILED',
          message: `Failed to update metadata on node: ${thinkingNodeId}`,
        };
      }

      // Create commit
      const commit = createCommit(
        commitMessage,
        [thinkingNodeId],
        [],
        'translator',
      );

      return {
        success: true,
        thinkingNodeId,
        title: node.title,
        translated: true,
        commit: {
          id: commit.id,
          message: commit.message,
          createdAt: commit.createdAt,
        },
        message: `Translated thinking node "${node.title}". Commit: "${commitMessage}"`,
        hint: 'Use graph_find_by_trigger({ trigger: "thinking", missingMetadata: "translated" }) to find more nodes to translate.',
      };
    }

    default:
      throw new Error(`Unknown document tool: ${name}`);
  }
}
