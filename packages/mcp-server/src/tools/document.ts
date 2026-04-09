import path from 'node:path';
import {
  createCommit,
  createDocumentWriter,
  type DocumentWriter,
  getGraphStore,
  getTextSource,
  type TriggerType,
  updateTextSource,
} from '@emergent-wisdom/understanding-graph-core';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ContextManager } from '../context-manager.js';
import { handleBatchTools } from './batch.js';

// Global document writer instances keyed by project
const documentWriters: Map<string, DocumentWriter> = new Map();

export const documentTools: Tool[] = [
  {
    name: 'doc_create',
    description:
      'Create a document node with content. For document roots, set isDocRoot=true.',
    inputSchema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Title/name for the document node.',
        },
        content: {
          type: 'string',
          description: 'Full content for rendering',
        },
        summary: {
          type: 'string',
          description: 'Compressed version for context loading (optional)',
        },
        level: {
          type: 'string',
          description:
            'Hierarchy level: "document", "section", "subsection", "paragraph".',
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
            'Previous node ID - creates a "next" edge from that node to this one',
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
      'Read document content starting from any node. Pass a document root to read the whole document, or any section node to read just that branch. Returns content with node IDs, versions, and relationships. Add showRevisions: true to see full edit history.',
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
      'Generate a file from a document root. Outputs to the project generated/ folder.',
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
      'Update content of a document node. WARNING: use "nodeId" (NOT "node" or "id"), and "why" is REQUIRED. Updates content field, not understanding.',
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
          description: 'Why this revision is being made',
        },
        summary: {
          type: 'string',
          description: 'Optional updated summary',
        },
        isDocRoot: {
          type: 'boolean',
          description:
            'Set to true to mark as document root, false to remove root status',
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
    name: 'doc_merge',
    description:
      'Merge multiple document nodes into one. Combines content in order, keeps the first node, archives the rest. Re-links edges from merged nodes to the surviving node.',
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
        isDocRoot: {
          type: 'boolean',
          description:
            "Set to true to make merged result a file, false to make it a section. If omitted, preserves the first node's status.",
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
      'Convert a document node to a concept/thinking node. Clears content, level, isDocRoot and optionally moves content to understanding. Use this when the node should be AI-oriented thinking rather than human-readable content.',
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
    name: 'doc_split',
    description:
      'Split a document node into multiple child nodes. Can split by headers (auto) or at specific line numbers.',
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
            'Line numbers to split at (for "lines" mode). Each number starts a new section.',
        },
        keepParent: {
          type: 'boolean',
          description:
            'If true, keep parent node as container with children. If false, replace parent with first child. Default: true',
        },
        asFiles: {
          type: 'boolean',
          description:
            'If true, each split section becomes a separate file (isDocRoot: true). If false, sections stay as children within parent. Default: false',
        },
        project: {
          type: 'string',
          description: 'Project ID (optional)',
        },
      },
      required: ['nodeId', 'mode'],
    },
  },
  {
    name: 'doc_weave',
    description: `WEAVING MODE: Write a document section that MUST connect to target concept nodes.

Use weaving when you want the graph to pull your writing in unexpected directions.
Sample random nodes first with graph_discover(), then weave your content toward them.

This is NOT for all writing - only when you want to generate surprising connections.
For normal writing, use doc_create.

WORKFLOW:
1. graph_discover({ nodes: 1, cold: true }) → get a random concept
2. Contemplate: "How could my writing connect to this?"
3. doc_weave({ title: "Section Title", targetNodeIds: ["n_xxx"], ... }) → write toward it
4. If section is long, split and weave each part toward different nodes`,
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
            'REQUIRED: Concept node IDs to weave toward. At least one required. Sample with graph_discover({ nodes: 1, cold: true }) first.',
        },
        content: {
          type: 'string',
          description:
            'The content. Should relate to the target concepts - that is the point of weaving.',
        },
        connections: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              nodeId: { type: 'string', description: 'Target node ID' },
              why: {
                type: 'string',
                description: 'How the content connects to this concept',
              },
            },
            required: ['nodeId', 'why'],
          },
          description:
            'How each target node connects to this content. One entry per targetNodeId.',
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
            'Maximum words before warning. Default: 500. Long sections should be split, each woven to different nodes.',
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
    description: `Sign a thinking node, optionally adding your contribution/flavor.

In collaborative reading, each agent must sign off on thinking nodes before the swarm can advance.
Signing confirms the thinking faithfully represents the current understanding state.

Each agent can add their unique contribution:
- Connector: patterns found, long-range connections
- Skeptic: caveats, tensions, questions raised
- Synthesizer: integration with broader understanding
- Anchor: alignment verification notes

WORKFLOW:
1. Query unsigned thinking: graph_find_by_trigger("thinking")
2. Review each thinking node's content
3. Sign with your contribution: doc_sign_thinking({ thinkingId, agentId, contribution })
4. Once all agents have signed, swarm can continue reading`,
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
            'Your contribution/flavor to add to this thinking (optional but encouraged). What does this thinking mean from your perspective?',
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
    description: `Get all thinking nodes that are missing signatures from specified agents.
Use this to find thinking nodes that need signing before the swarm can continue.`,
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
    description: `Insert a thinking node into a document by splitting an existing content node at a character position.

Use this to add thinking traces to source content without rewriting. The source text is split at the specified position, and a thinking node is inserted between the halves.

CRITICAL INVARIANT: You MUST provide 'synthesizes_nodes'. Thinking cannot exist in a vacuum; it must be grounded in existing understanding nodes. The tool will atomically create connections.
CRITICAL: You MUST provide 'commit_message' - reflect on your synthesis strategy, not just describe the action.

WORKFLOW:
1. source_read creates a content node automatically
2. doc_insert_thinking splits that node and inserts your thinking (connecting it to understanding)
3. The source text remains untouched (perfect replication)
4. If sourceId is provided, the source's lastCommittedNodeId is updated to the new second half

Example: After reading, you want to add thinking after the first paragraph:
  doc_insert_thinking({
    nodeId: "n_123",
    atChar: 500,
    thinking: "This reminds me of...",
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
          description: 'The thought/reasoning content to insert',
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
            'REQUIRED: Your reflection on why you synthesized this way. Explain your strategy, what patterns you saw, why these nodes connect. NOT a description of the action.',
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
    description: `Append a thinking node at the END of the document chain - NO SPLITTING.

TEMPORAL INTEGRITY: This tool ensures thinking nodes can ONLY reference content that has been read.
Unlike doc_insert_thinking (which splits), this appends to the current end of the chain.

WORKFLOW (Append-based architecture):
1. Reader reads chunk via source_read → content node created at end
2. Reader STOPS at "thought moment"
3. Workers add thinking via doc_append_thinking → thinking node at end
4. Reader continues via source_read → new content attaches AFTER thinking
5. Result: [content] → [thinking] → [content] ...

Workers literally CANNOT reference future content because they've never seen it.

CRITICAL INVARIANT: You MUST provide 'synthesizes_nodes'. Thinking must be grounded.
CRITICAL: You MUST provide 'commit_message' - reflect on your synthesis strategy, not just describe the action.

Example:
  doc_append_thinking({
    sourceId: "src_xxx",
    title: "The Weight of Silence",
    thinking: "I feel no fear... This passage about X connects to...",
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
            'The thought/reasoning content. MUST start with Identity Anchor.',
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
            'REQUIRED: Your reflection on why you synthesized this way. Explain your strategy, what patterns you saw, why these nodes connect. NOT a description of the action.',
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
    description: `Translate a thinking node by expanding its concept references into fluid prose.

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

      const node = store.createDocumentNode({
        title: args.title as string,
        content: args.content as string,
        summary: args.summary as string | undefined,
        level: args.level as string | undefined,
        isDocRoot,
        fileType: args.fileType as string | undefined,
        trigger: args.trigger as TriggerType | undefined,
        parentId,
        afterId,
        expressesIds: args.expressesIds as string[] | undefined,
        conversationId,
        toolCallId,
      });

      return {
        success: true,
        id: node.id,
        title: node.title,
        level: node.level,
        isDocRoot: node.isDocRoot,
        fileType: node.fileType,
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
      const flattened = store.flattenDocument(args.rootId as string);

      return {
        rootId: args.rootId,
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
        conversationId,
        toolCallId,
      });

      return {
        success: true,
        edgeId: edge.id,
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
          error: `Node not found: ${nodeId}`,
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
        hint: showRevisions
          ? 'Showing revision history. Each section shows version and previous states.'
          : 'Each section shows [node_id] v[version] and relationships. Update with doc_revise({ nodeId, content, why }). Add showRevisions: true to see edit history.',
      };
    }

    case 'doc_generate': {
      const projectDir = contextManager.getProjectDir();
      const outputDir = path.join(projectDir, projectId, 'generated');

      // Get or create writer for this project
      let writer = documentWriters.get(projectId);
      if (!writer) {
        writer = createDocumentWriter(outputDir);
        documentWriters.set(projectId, writer);
      }

      const result = writer.writeDocument(args.rootId as string);

      if (!result) {
        return {
          success: false,
          error: `Failed to generate document for ${args.rootId}`,
        };
      }

      return {
        success: true,
        ...result,
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

      return {
        success: true,
        documents: results.map((r) => ({
          rootId: r.rootId,
          outputPath: r.outputPath,
          fileType: r.fileType,
          nodeCount: r.nodeCount,
        })),
        count: results.length,
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
      const isDocRoot = args.isDocRoot as boolean | undefined;

      // Get current node to verify it exists
      const current = store.getNode(nodeId);
      if (!current) {
        return {
          success: false,
          error: `Document node not found: ${nodeId}`,
        };
      }

      // Update the node with new content and/or isDocRoot
      const updated = store.updateNode(nodeId, {
        content,
        summary,
        isDocRoot,
        revisionWhy: why,
        conversationId,
      });

      return {
        success: true,
        id: updated.id,
        title: updated.title,
        version: updated.version,
        isDocRoot: updated.isDocRoot,
        message: `Revised document node "${updated.title}" (now version ${updated.version})`,
        hint: 'Use doc_generate to regenerate the output file with the updated content',
      };
    }

    case 'doc_merge': {
      const nodeIds = args.nodeIds as string[];
      const separator = (args.separator as string) || '\n\n';
      const newTitle = args.newTitle as string | undefined;
      const isDocRoot = args.isDocRoot as boolean | undefined;

      if (!nodeIds || nodeIds.length < 2) {
        return {
          success: false,
          error: 'doc_merge requires at least 2 node IDs',
        };
      }

      // Get all nodes
      const nodes = nodeIds.map((id) => store.getNode(id));
      const missingIdx = nodes.findIndex((n) => !n);
      if (missingIdx !== -1) {
        return {
          success: false,
          error: `Node not found: ${nodeIds[missingIdx]}`,
        };
      }

      // Combine content
      const combinedContent = nodes
        .map((n) => n?.content || '')
        .filter((p) => p.trim())
        .join(separator);

      // Update the first node with combined content
      const targetId = nodeIds[0];
      const updated = store.updateNode(targetId, {
        title: newTitle || nodes[0]?.title,
        content: combinedContent,
        isDocRoot, // undefined preserves existing, true/false sets explicitly
        revisionWhy: `Merged ${nodeIds.length} nodes: ${nodeIds.join(', ')}`,
        conversationId,
      });

      // Re-link edges from merged nodes to the target
      const archivedNodes: string[] = [];
      const allEdges = store.getAll().edges;

      for (let i = 1; i < nodeIds.length; i++) {
        const sourceId = nodeIds[i];

        // Get all edges pointing TO this node and redirect to target
        const incomingEdges = allEdges.filter(
          (e) => e.toId === sourceId && e.active,
        );
        for (const edge of incomingEdges) {
          // Skip if this would create a self-loop or already exists
          if (edge.fromId === targetId) continue;
          // Create new edge to target
          store.createEdge({
            fromId: edge.fromId,
            toId: targetId,
            type: edge.type,
            explanation: edge.explanation || undefined,
            why: `Redirected from merged node ${sourceId}`,
            conversationId,
            toolCallId,
          });
        }

        // Get all edges FROM this node and redirect from target
        const outgoingEdges = allEdges.filter(
          (e) => e.fromId === sourceId && e.active,
        );
        for (const edge of outgoingEdges) {
          // Skip if this would create a self-loop or points to another merged node
          if (edge.toId === targetId || nodeIds.includes(edge.toId)) continue;
          // Create new edge from target
          store.createEdge({
            fromId: targetId,
            toId: edge.toId,
            type: edge.type,
            explanation: edge.explanation || undefined,
            why: `Redirected from merged node ${sourceId}`,
            conversationId,
            toolCallId,
          });
        }

        // Archive the merged node
        store.archiveNode(sourceId, `Merged into ${targetId}`, conversationId);
        archivedNodes.push(sourceId);
      }

      return {
        success: true,
        id: updated.id,
        title: updated.title,
        version: updated.version,
        mergedCount: nodeIds.length,
        archivedNodes,
        message: `Merged ${nodeIds.length} nodes into "${updated.title}"`,
        hint: 'Use doc_generate to regenerate the output file',
      };
    }

    case 'doc_split': {
      const nodeId = args.nodeId as string;
      const mode = args.mode as 'headers' | 'lines';
      const lineNumbers = args.lineNumbers as number[] | undefined;
      const keepParent = args.keepParent !== false; // default true
      const asFiles = args.asFiles === true; // default false - sections within parent

      const node = store.getNode(nodeId);
      if (!node) {
        return {
          success: false,
          error: `Node not found: ${nodeId}`,
        };
      }

      const content = node.content || '';
      const lines = content.split('\n');

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
        splitPoints = lineNumbers.sort((a, b) => a - b);
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
        const sectionContent = sectionLines.join('\n').trim();

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

          sections.push({
            title,
            content: sectionContent,
            startLine: prevPoint,
          });
        }
        prevPoint = point;
      }

      if (sections.length === 0) {
        return {
          success: false,
          error: 'No sections could be created from split points',
        };
      }

      // Create child nodes
      const createdNodes: Array<{ id: string; title: string }> = [];
      let prevNodeId: string | null = null;

      for (const section of sections) {
        const childNode = store.createDocumentNode({
          title: section.title,
          content: section.content,
          level: asFiles ? 'document' : 'section',
          isDocRoot: asFiles, // true = separate files, false = sections within parent
          parentId: keepParent && !asFiles ? nodeId : undefined,
          afterId: prevNodeId || undefined,
          conversationId,
          toolCallId,
        });
        createdNodes.push({ id: childNode.id, title: section.title });
        prevNodeId = childNode.id;
      }

      // Update parent if keeping it
      if (keepParent) {
        store.updateNode(nodeId, {
          content: `% Split into ${sections.length} sections`,
          summary: `Container for ${sections.length} child sections`,
          revisionWhy: `Split into ${sections.length} child sections`,
          conversationId,
        });
      }

      return {
        success: true,
        parentId: nodeId,
        parentKept: keepParent,
        sections: createdNodes,
        count: createdNodes.length,
        message: `Split into ${createdNodes.length} sections`,
        hint: 'Use doc_generate to regenerate the output file',
      };
    }

    case 'doc_to_concept': {
      const nodeId = args.nodeId as string;
      const moveContent = args.moveContent !== false; // default true
      const trigger = args.trigger as string | undefined;
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
        hint: 'Node is now a thinking/concept node. Content has been cleared.',
      };
    }

    case 'doc_weave': {
      // WEAVING MODE: Writing that MUST connect to target nodes
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
      if (!targetNodeIds || targetNodeIds.length === 0) {
        return {
          success: false,
          error:
            'WEAVING REQUIRES TARGETS. You must provide at least one targetNodeId.',
          hint: 'Sample a random node first: graph_discover({ nodes: 1, cold: true }), then weave toward it.',
        };
      }

      // Validate: connections must match targets
      if (!connections || connections.length !== targetNodeIds.length) {
        return {
          success: false,
          error: `WEAVING REQUIRES EXPLANATIONS. You have ${targetNodeIds.length} targets but ${connections?.length || 0} connection explanations.`,
          hint: 'Each target node needs a "why" explaining how your content connects to it.',
        };
      }

      // Verify all target nodes exist
      const targetNodes: Array<{ id: string; title: string }> = [];
      for (const nodeId of targetNodeIds) {
        const node = store.getNode(nodeId);
        if (!node) {
          return {
            success: false,
            error: `Target node "${nodeId}" not found.`,
            hint: 'Sample valid nodes with graph_discover() first.',
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

      // Create the document section with all target edges
      const docNode = store.createDocumentNode({
        title,
        content,
        level,
        parentId,
        afterId,
        expressesIds: targetNodeIds, // Create edges to ALL targets
        conversationId,
        toolCallId,
      });

      // Update each edge with its specific connection reason
      for (const conn of connections) {
        const edges = store.getEdgesBetween(docNode.id, conn.nodeId);
        const expressesEdge = edges.find((e) => e.type === 'expresses');
        if (expressesEdge) {
          store.updateEdge(expressesEdge.id, {
            why: conn.why,
            conversationId,
          });
        }
      }

      return {
        success: true,
        id: docNode.id,
        title: docNode.title,
        level: docNode.level,
        wovenTo: targetNodes,
        connections: connections.map((c) => ({
          nodeId: c.nodeId,
          nodeName: targetNodes.find((t) => t.id === c.nodeId)?.title,
          why: c.why,
        })),
        wordCount,
        exceedsLimit,
        message: `Wove "${title}" to ${targetNodes.length} concept(s): ${targetNodes.map((t) => t.title).join(', ')}`,
        hint: exceedsLimit
          ? `WARNING: Section has ${wordCount} words (limit: ${maxWords}). Split it with doc_split, then weave each subsection to different nodes for richer connections.`
          : `Woven successfully. ${targetNodes.length} edge(s) created.`,
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

      // Find the parent (document root) via contains edge
      const allEdges = store.getAll().edges;
      const containsEdge = allEdges.find(
        (e) => e.toId === nodeId && e.type === 'contains',
      );
      const parentId = containsEdge?.fromId;

      // Find what comes after this node (to rewire)
      const nextEdge = allEdges.find(
        (e) => e.fromId === nodeId && e.type === 'next',
      );
      const afterId = nextEdge?.toId;

      // Prepare operations
      // biome-ignore lint/suspicious/noExplicitAny: batch operations have dynamic structure
      const operations: any[] = [
        // Update original node with first half
        {
          tool: 'doc_revise',
          params: {
            nodeId,
            content: firstHalf,
            why: `Split at char ${atChar} to insert thinking`,
          },
        },
        // Create thinking node (as document paragraph with fileType: thinking)
        {
          tool: 'doc_create',
          params: {
            title: `Thinking: ${thought.slice(0, 30)}...`,
            content: thought,
            level: 'paragraph',
            isDocRoot: false,
            parentId: parentId,
            afterId: nodeId,
            fileType: 'thinking',
            trigger: 'thinking',
          },
        },
        // Create second half node
        {
          tool: 'doc_create',
          params: {
            title: `${node.title} (cont.)`,
            content: secondHalf,
            level: 'paragraph',
            isDocRoot: false,
            parentId: parentId,
            afterId: '$1.id', // after thinking node
          },
        },
      ];

      // Add atomic connections for grounding
      for (const targetId of synthesizesNodes) {
        operations.push({
          tool: 'graph_connect',
          params: {
            from: '$1.id', // The thinking node
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
            from: '$2.id', // The second half node
            to: afterId,
            type: 'next',
            why: 'Rewired after doc_insert_thinking split',
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
            message: `Thinking node created but edges failed: ${edgeErrors.map((e) => e.error).join('; ')}`,
            hint: 'Check that synthesizes_nodes contains valid node IDs that exist in the graph.',
            thinkingNodeId: batchResult.results?.[1]?.id,
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

      const thinkingNodeId = batchResult.results?.[1]?.id;
      const secondHalfNodeId = batchResult.results?.[2]?.id;
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

      // Archive old next edge if it existed (the new one was created in batch)
      if (afterId && nextEdge) {
        store.archiveEdge(nextEdge.id, conversationId);
      }

      // Extract edge IDs from batch results (operations 3+ are graph_connect)
      const createdEdgeIds: string[] = [];
      if (batchResult.results) {
        for (let i = 3; i < batchResult.results.length; i++) {
          const edgeResult = batchResult.results[i] as { id?: string };
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
            ? 'All thinking nodes are fully signed - swarm can continue'
            : `${unsigned.length} thinking node(s) need signatures`,
        hint:
          unsigned.length > 0
            ? `Sign with doc_sign_thinking({ thinkingId: "${unsigned[0]?.id}", agentId: "your_id" })`
            : 'Ready to continue reading',
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
