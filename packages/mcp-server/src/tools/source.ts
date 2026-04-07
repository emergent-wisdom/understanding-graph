import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import {
  createTextSource,
  deleteTextSource,
  getGraphStore,
  getTextSource,
  getTextSourceProgress,
  listTextSources,
  readTextSource,
  sqlite,
  updateTextSource,
} from '@understanding-graph/core';
import type { ContextManager } from '../context-manager.js';
import { MODE_PROTOCOLS } from '../instructions.js';
import { handleBatchTools } from './batch.js';

// Generate a unique source ID
function generateSourceId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = 'src_';
  for (let i = 0; i < 8; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

export const sourceTools: Tool[] = [
  {
    name: 'source_load',
    description:
      'Load a text source for chronological reading. The content is staged in SQLite and read portion by portion. Use this for books, papers, articles, code - any text you want to create understanding traces for. Accepts either content directly OR a filePath to read from (filePath is preferred to avoid context limits).',
    inputSchema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description:
            'Title of the source (e.g., "Attention Is All You Need")',
        },
        content: {
          type: 'string',
          description:
            'Full text content to read through (use filePath instead for large files)',
        },
        filePath: {
          type: 'string',
          description:
            'Absolute path to a text file to load (preferred over content for large files)',
        },
        sourceType: {
          type: 'string',
          description:
            'Type of source: "book", "paper", "article", "code", "docs", etc.',
        },
        project: {
          type: 'string',
          description: 'Project ID (optional)',
        },
      },
      required: ['title'],
    },
  },
  {
    name: 'source_read',
    description: `Read the next portion of a text source and AUTO-CREATE a content node.

The content is automatically committed to the graph as a document node - perfect replication from source, no manual copying needed.

TEMPORAL INTEGRITY WORKFLOW (append-based):
1. source_read → content node created at END of chain
2. STOP at natural "thought moment" (paragraph break, tension, shift)
3. doc_append_thinking → thinking node appended at END
4. source_read → new content attaches AFTER thinking
5. Result: [content] → [thinking] → [content] → ...

This ensures thinking can ONLY reference content that has been read (no future knowledge leakage).`,
    inputSchema: {
      type: 'object',
      properties: {
        sourceId: {
          type: 'string',
          description: 'Source ID from source_load',
        },
        chars: {
          type: 'number',
          description: 'Read next N characters (default: 2000)',
        },
        lines: {
          type: 'number',
          description: 'Read next N lines',
        },
        until: {
          type: 'string',
          description:
            'Read until this delimiter (e.g., "##" for markdown headers, "\\n\\n" for paragraphs)',
        },
        project: {
          type: 'string',
          description: 'Project ID (optional)',
        },
        commit_message: {
          type: 'string',
          description:
            'Reflect on your reading decision. Why did you read this much? What are you sensing?',
        },
      },
      required: ['sourceId', 'commit_message'],
    },
  },
  {
    name: 'source_position',
    description: 'Get the current reading progress for a text source.',
    inputSchema: {
      type: 'object',
      properties: {
        sourceId: {
          type: 'string',
          description: 'Source ID',
        },
        project: {
          type: 'string',
          description: 'Project ID (optional)',
        },
      },
      required: ['sourceId'],
    },
  },
  {
    name: 'source_list',
    description: 'List all text sources in the current project.',
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
    name: 'source_export',
    description:
      'Export a completed source reading as a document with <thinking> blocks interleaved. Creates training-ready output showing the original content with reasoning traces.',
    inputSchema: {
      type: 'object',
      properties: {
        sourceId: {
          type: 'string',
          description: 'Source ID',
        },
        format: {
          type: 'string',
          enum: ['markdown', 'xml'],
          description:
            'Output format: "markdown" uses code blocks, "xml" uses <thinking> tags. Default: markdown',
        },
        thinkingMode: {
          type: 'string',
          enum: ['graph', 'fluid'],
          description:
            'Thinking content mode: "graph" uses original structured text, "fluid" uses natural language translation (if available). Default: graph',
        },
        project: {
          type: 'string',
          description: 'Project ID (optional)',
        },
      },
      required: ['sourceId'],
    },
  },
  {
    name: 'source_delete',
    description:
      'Delete a text source (does not delete committed graph nodes).',
    inputSchema: {
      type: 'object',
      properties: {
        sourceId: {
          type: 'string',
          description: 'Source ID to delete',
        },
        project: {
          type: 'string',
          description: 'Project ID (optional)',
        },
      },
      required: ['sourceId'],
    },
  },
];

export async function handleSourceTools(
  name: string,
  args: Record<string, unknown>,
  contextManager: ContextManager,
): Promise<unknown> {
  const projectId =
    (args.project as string) || contextManager.getCurrentProjectId();
  // These context values are reserved for future use
  const _conversationId =
    await contextManager.getCurrentConversationId(projectId);
  const _toolCallId = contextManager.getCurrentToolCall();
  const store = getGraphStore();

  switch (name) {
    case 'source_load': {
      const id = generateSourceId();
      const source = createTextSource({
        id,
        title: args.title as string,
        content: args.content as string | undefined,
        filePath: args.filePath as string | undefined,
        sourceType: args.sourceType as string | undefined,
        projectId,
      });

      return {
        success: true,
        sourceId: source.id,
        title: source.title,
        sourceType: source.sourceType,
        totalLength: source.totalLength,
        loadedFrom: args.filePath ? 'file' : 'content',
        message: `Loaded source "${source.title}" (${source.totalLength} chars)${args.filePath ? ` from ${args.filePath}` : ''}`,
        nextSteps: `1. Create document root: doc_create({ text: "${source.title}", isDocRoot: true })
2. Find existing beliefs: graph_semantic_search({ query: "[topic keywords]" })
3. Begin reading: source_read({ sourceId: "${source.id}", chars: 2000 })`,
        protocol: MODE_PROTOCOLS.reading,
      };
    }

    case 'source_read': {
      // NOTE: Signing gate removed - the Gatekeeper agent provides organic review
      // through the messaging system instead of hard-blocking source reads.
      const sourceId = args.sourceId as string;
      const result = readTextSource(sourceId, {
        chars: (args.chars as number | undefined) || 2000,
        lines: args.lines as number | undefined,
        until: args.until as string | undefined,
      });

      if (!result) {
        return {
          success: false,
          error: `Source not found: ${sourceId}`,
        };
      }

      const source = getTextSource(sourceId);
      const progress = getTextSourceProgress(sourceId);

      // If source is done, don't create a node
      if (result.done) {
        return {
          success: true,
          done: true,
          progress: progress ? { percent: 100, remaining: 0 } : null,
          message: 'Source reading complete.',
          hint: `Use source_export to generate the final document with thinking traces.`,
        };
      }

      // Get or create document root
      let rootId = source?.rootNodeId;
      const prevNodeId = source?.lastCommittedNodeId;

      // Fix: Re-fetch source and check graph to avoid duplicate roots
      // 1. Re-fetch source to see if root was just added
      const freshSource = getTextSource(sourceId);
      if (freshSource?.rootNodeId) {
        rootId = freshSource.rootNodeId;
      }

      // 2. If still no root, check if a doc root with this title already exists in the graph
      if (!rootId) {
        const sourceTitle = source?.title || 'Reading';
        const existingRoot = sqlite
          .getDb()
          .prepare('SELECT id FROM nodes WHERE title = ? AND is_doc_root = 1')
          .get(sourceTitle) as { id: string } | undefined;

        if (existingRoot) {
          rootId = existingRoot.id;
          updateTextSource(sourceId, { rootNodeId: rootId });
        }
      }

      // If no root yet, create document root first
      if (!rootId) {
        const sourceTitle = source?.title || 'Reading';
        const rootResult = (await handleBatchTools(
          'graph_batch',
          {
            operations: [
              {
                tool: 'doc_create',
                params: {
                  title: sourceTitle,
                  content: `# ${sourceTitle}\n\nChronological reading of source material.`,
                  level: 'document',
                  isDocRoot: true,
                },
              },
            ],
            commit_message: `Created document root for source: ${sourceTitle}`,
            agent_name: 'source_reader',
          },
          contextManager,
        )) as {
          success?: boolean;
          results?: Array<{ id?: string }>;
          errors?: unknown[];
        };

        if (!rootResult.success) {
          return {
            success: false,
            error: `Failed to create document root: ${JSON.stringify(rootResult.errors || rootResult)}`,
          };
        }

        rootId = rootResult.results?.[0]?.id;
        if (rootId) {
          updateTextSource(sourceId, { rootNodeId: rootId });
        }
      }

      // Create content node with exact source text via graph_batch
      const percent = progress?.percent || 0;
      const batchResult = (await handleBatchTools(
        'graph_batch',
        {
          operations: [
            {
              tool: 'doc_create',
              params: {
                title: `Content ${percent}%`,
                content: result.content,
                level: 'paragraph',
                isDocRoot: false,
                parentId: rootId,
                afterId: prevNodeId || rootId,
              },
            },
          ],
          commit_message:
            (args.commit_message as string) ||
            `Auto-committed source content at ${percent}%`,
          agent_name: 'source_reader',
        },
        contextManager,
      )) as {
        success?: boolean;
        results?: Array<{ id?: string }>;
        errors?: unknown[];
      };

      const contentNodeId = batchResult.results?.[0]?.id;

      // Update source tracking
      if (contentNodeId) {
        updateTextSource(sourceId, {
          lastCommittedNodeId: contentNodeId,
        });
      }

      // Build hint - use doc_append_thinking for temporal integrity
      let hint = `Content node created: ${contentNodeId}

TO ADD THINKING (preserves temporal integrity):
  doc_append_thinking({
    sourceId: "${sourceId}",
    thinking: "I feel no fear... [Your observation about this passage]",
    agentId: "synthesizer",
    synthesizes_nodes: ["n_existing_concept_id"]
  })

This appends thinking at the END - workers can ONLY reference what they've seen.
REQUIRED: synthesizes_nodes must reference existing concept nodes.

TO CONTINUE: source_read({ sourceId: "${sourceId}" })

Progress: ${percent}% complete`;

      if (percent >= 25 && percent < 30) {
        hint +=
          '\n\n⏸️ MILESTONE 25%: Consider running graph_skeleton() to see emerging structure.';
      } else if (percent >= 50 && percent < 55) {
        hint +=
          '\n\n⏸️ MILESTONE 50%: Good time to review and add thinking traces.';
      } else if (percent >= 75 && percent < 80) {
        hint += '\n\n⏸️ MILESTONE 75%: Almost done. Capture remaining insights.';
      }

      return {
        success: true,
        content: result.content,
        contentNodeId,
        position: result.position,
        done: result.done,
        progress: progress
          ? {
              percent: progress.percent,
              remaining: progress.totalLength - progress.position,
            }
          : null,
        hint,
      };
    }

    case 'source_position': {
      const progress = getTextSourceProgress(args.sourceId as string);

      if (!progress) {
        return {
          success: false,
          error: `Source not found: ${args.sourceId}`,
        };
      }

      return {
        success: true,
        sourceId: args.sourceId,
        ...progress,
        hint:
          progress.status === 'completed'
            ? 'Source complete. Use source_export to generate output.'
            : `${progress.percent}% complete. ${progress.totalLength - progress.position} chars remaining.`,
      };
    }

    case 'source_list': {
      const sources = listTextSources(projectId);

      return {
        success: true,
        sources: sources.map((s) => ({
          id: s.id,
          title: s.title,
          sourceType: s.sourceType,
          status: s.status,
          progress: Math.round((s.position / s.totalLength) * 100),
          totalLength: s.totalLength,
          hasRoot: !!s.rootNodeId,
        })),
        count: sources.length,
        hint:
          sources.length === 0
            ? 'No sources yet. Use source_load to add text for reading.'
            : 'Use source_read to continue reading, or source_export for completed sources.',
      };
    }

    case 'source_export': {
      const sourceId = args.sourceId as string;
      const format = (args.format as string) || 'markdown';
      const thinkingMode = (args.thinkingMode as string) || 'graph';

      const source = getTextSource(sourceId);
      if (!source) {
        return {
          success: false,
          error: `Source not found: ${sourceId}`,
        };
      }

      if (!source.rootNodeId) {
        return {
          success: false,
          error:
            'No content committed yet. Use source_read and source_commit first.',
        };
      }

      // Flatten the document from root
      const flattened = store.flattenDocument(source.rootNodeId);

      // Build output with thinking blocks
      let output = '';
      const thinkingOpen = format === 'xml' ? '<thinking>' : '```thinking';
      const thinkingClose = format === 'xml' ? '</thinking>' : '```';

      for (const { node } of flattened) {
        // Check both trigger and fileType for thinking nodes
        const isThinking =
          node.trigger === 'thinking' || node.fileType === 'thinking';

        if (isThinking) {
          // Use fluid thought if available and mode is 'fluid', otherwise use original
          const thoughtFluid = node.metadata?.thought_fluid as
            | string
            | undefined;
          const thinkingContent =
            thinkingMode === 'fluid' && thoughtFluid
              ? thoughtFluid
              : node.content || '';
          output += `\n${thinkingOpen}\n${thinkingContent}\n${thinkingClose}\n`;
        } else {
          output += `\n${node.content || ''}\n`;
        }
      }

      const isThinkingNode = (n: {
        trigger?: string | null;
        fileType?: string | null;
      }) => n.trigger === 'thinking' || n.fileType === 'thinking';

      return {
        success: true,
        sourceId,
        title: source.title,
        format,
        thinkingMode,
        output: output.trim(),
        nodeCount: flattened.length,
        thinkingCount: flattened.filter((f) => isThinkingNode(f.node)).length,
        contentCount: flattened.filter((f) => !isThinkingNode(f.node)).length,
        message: `Exported "${source.title}" with ${flattened.length} nodes (${thinkingMode} mode)`,
      };
    }

    case 'source_delete': {
      const deleted = deleteTextSource(args.sourceId as string);

      return {
        success: deleted,
        sourceId: args.sourceId,
        message: deleted
          ? `Deleted source ${args.sourceId}`
          : `Source not found: ${args.sourceId}`,
        hint: deleted
          ? 'Source staging data deleted. Committed graph nodes remain.'
          : null,
      };
    }

    default:
      throw new Error(`Unknown source tool: ${name}`);
  }
}
