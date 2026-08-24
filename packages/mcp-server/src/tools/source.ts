import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  createTextSource,
  deleteTextSource,
  getGraphStore,
  getTextSource,
  getTextSourceProgress,
  isReservedThinkingNode,
  listTextSources,
  readTextSource,
  reservedThinkingVisible,
  updateTextSource,
  withReservedThinkingVisibility,
} from '@emergent-wisdom/understanding-graph-core';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { assessArtifactCognitionBalance } from '../artifact-cognition-balance.js';
import type { ContextManager } from '../context-manager.js';
import { ambientGuidanceEnabled, type GuidanceMode } from '../guidance.js';
import { MODE_PROTOCOLS } from '../instructions.js';
import { understandingMode } from '../protocol.js';
import { handleBatchTools } from './batch.js';
import type { ToolMode } from './index.js';

// Generate a unique source ID
function generateSourceId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = 'src_';
  for (let i = 0; i < 8; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

function resolveSourceFilePath(filePath: string): string {
  const configuredRoot = process.env.UG_SOURCE_ROOT?.trim() || process.cwd();
  let sourceRoot: string;

  try {
    sourceRoot = fs.realpathSync(configuredRoot);
  } catch {
    throw new Error(
      'UG_SOURCE_ROOT must point to an existing directory before source_load can read files.',
    );
  }

  if (!fs.statSync(sourceRoot).isDirectory()) {
    throw new Error('UG_SOURCE_ROOT must point to a directory.');
  }

  const requestedPath = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(sourceRoot, filePath);
  let resolvedPath: string;

  try {
    resolvedPath = fs.realpathSync(requestedPath);
  } catch {
    throw new Error(`Source file not found: ${filePath}`);
  }

  const relativePath = path.relative(sourceRoot, resolvedPath);
  const isOutsideRoot =
    relativePath === '..' ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath);
  if (isOutsideRoot) {
    throw new Error(
      'source_load filePath must stay within UG_SOURCE_ROOT (the server working directory by default). Supply content directly or configure UG_SOURCE_ROOT explicitly for another directory.',
    );
  }

  if (!fs.statSync(resolvedPath).isFile()) {
    throw new Error(`Source path is not a file: ${filePath}`);
  }

  return resolvedPath;
}

const ORDINARY_SYNTHETIC_VISIBILITY =
  'In every ordinary mode, reserved synthetic Reader/CMP blocks are excluded and unavailable. TOOL_MODE="synthetic_reader" may read and export them.';

function sourceVisibilityHint(): string {
  return reservedThinkingVisible()
    ? 'Reserved synthetic Reader/CMP blocks are available in TOOL_MODE="synthetic_reader" and source_export may preserve them.'
    : ORDINARY_SYNTHETIC_VISIBILITY;
}

/**
 * Project the persisted source cursor through the active read visibility.
 * A synthetic block may be the physical tail, but ordinary read surfaces must
 * never receive that hidden ID. source_read separately rejects continuation at
 * such a boundary; this fallback is for projection only, not mutation.
 */
function getVisibleSourceTail(
  rootNodeId: string | null | undefined,
  persistedTailId: string | null | undefined,
): string | null {
  const store = getGraphStore();
  if (persistedTailId && store.getNode(persistedTailId)) {
    return persistedTailId;
  }
  if (!rootNodeId) return null;

  const visiblePassages = store
    .flattenDocument(rootNodeId)
    .filter(({ node }) => node.id !== rootNodeId);
  return visiblePassages.at(-1)?.node.id || null;
}

export const sourceTools: Tool[] = [
  {
    name: 'source_load',
    description:
      'Stage a text source for chronological reading when sequence matters: books, papers, articles, transcripts, or similar texts. The source body is stored in SQLite but NOT returned by this call; encounter it portion by portion with source_read. For a filePath, do not inspect or sample the file first. This is not the graph-native coding workflow: code belongs in ordered document nodes, with generated files used only as executable projections. Accepts content directly or a filePath within UG_SOURCE_ROOT (the server working directory by default).',
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
            'Relative or absolute path to a text file within UG_SOURCE_ROOT (defaults to the server working directory)',
        },
        sourceType: {
          type: 'string',
          description:
            'Type of sequential source: "book", "paper", "article", "transcript", "docs", etc.',
        },
        project: {
          type: 'string',
          description: 'Project ID (optional)',
        },
        workflow: {
          type: 'string',
          enum: ['reading', 'research'],
          description:
            'Purpose for re-entry guidance. Use research when passages serve a live inquiry; otherwise reading.',
        },
      },
      required: ['title'],
    },
  },
  {
    name: 'source_read',
    description: `Read the next portion of a text source and AUTO-CREATE a content node.

The content is automatically committed to the graph as a document node - perfect replication from source, no manual copying needed.

ORDINARY READING WORKFLOW:
1. source_read → exact encountered content is appended to the source chain
2. Stop at a natural, self-selected boundary when something will help later continuation
3. If warranted, use graph_batch to preserve rich non-"thinking" typed testimony and connect it to the exact content node with learned_from
4. Continue with source_read; never use unread material or generic recall as evidence

The reserved "thinking" trigger is synthetic Reader/CMP pretraining output and is created only in TOOL_MODE="synthetic_reader". ${ORDINARY_SYNTHETIC_VISIBILITY}`,
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
            'Why this is the next useful source-defined or self-selected reading boundary. Do not manufacture an insight; a read with no durable update is valid.',
        },
        anchorNode: {
          type: 'string',
          description:
            'Existing concept ID or exact title that this source reading should contextualize. Required only when starting a new source in a non-empty graph; the tool never guesses an anchor.',
        },
        workflow: {
          type: 'string',
          enum: ['reading', 'research'],
          description:
            'Purpose for re-entry guidance. Use research when passages serve a live inquiry; otherwise reading.',
        },
      },
      required: ['sourceId', 'commit_message'],
    },
  },
  {
    name: 'source_position',
    description: `Get the current reading progress for a text source. Hidden cursor IDs are never returned. ${ORDINARY_SYNTHETIC_VISIBILITY}`,
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
    description: `Export a completed source reading. In an ordinary mode, the export is the exact source with reserved synthetic Reader/CMP blocks excluded and unavailable. TOOL_MODE="synthetic_reader" may include those blocks in chronological position. Preserves original source content and does not request private chain-of-thought.`,
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
            'Preexisting synthetic Reader/CMP block mode: "graph" uses original structured text, "fluid" uses its translated pretraining prose (if available). Default: graph',
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
  mode: ToolMode = 'full',
  guidanceMode: GuidanceMode = 'guided',
): Promise<unknown> {
  const projectId =
    (args.project as string) || contextManager.getCurrentProjectId();
  // These context values are reserved for future use
  const _conversationId =
    await contextManager.getCurrentConversationId(projectId);
  const _toolCallId = contextManager.getCurrentToolCall();
  const store = getGraphStore();
  // source_read owns an internal atomic graph_batch. Preserve the active
  // visibility across that nested dispatch without widening this handler's
  // public signature.
  const sourceMutationMode = reservedThinkingVisible()
    ? 'synthetic_reader'
    : mode;
  const requestedWorkflow = args.workflow;
  const understandingWorkflow =
    requestedWorkflow === 'research' || requestedWorkflow === 'reading'
      ? requestedWorkflow
      : mode === 'research'
        ? 'research'
        : 'reading';

  switch (name) {
    case 'source_load': {
      const id = generateSourceId();
      const sourceFilePath = args.filePath
        ? resolveSourceFilePath(args.filePath as string)
        : undefined;
      const source = createTextSource({
        id,
        title: args.title as string,
        content: args.content as string | undefined,
        filePath: sourceFilePath,
        sourceType: args.sourceType as string | undefined,
        projectId,
      });
      const readingQuery = JSON.stringify(
        `Read and understand ${source.title}`,
      );
      const firstCommit = JSON.stringify(
        `Begin chronological reading of ${source.title}`,
      );
      const needsAnchor = store.getAll().nodes.length > 0;
      const readCall = needsAnchor
        ? `source_read({ sourceId: "${source.id}", chars: 2000, anchorNode: "<relevant existing node ID>", commit_message: ${firstCommit} })`
        : `source_read({ sourceId: "${source.id}", chars: 2000, commit_message: ${firstCommit} })`;

      return {
        success: true,
        sourceId: source.id,
        title: source.title,
        sourceType: source.sourceType,
        totalLength: source.totalLength,
        loadedFrom: args.filePath ? 'file' : 'content',
        message: `Loaded source "${source.title}" (${source.totalLength} chars)${sourceFilePath ? ` from ${path.basename(sourceFilePath)}` : ''}`,
        nextSteps: `1. Orient for this reading: graph_understand({ query: ${readingQuery}, workflow: "${understandingWorkflow}" })
2. ${needsAnchor ? 'Choose a relevant existing node from that orientation; the tool will not guess one. Then begin reading' : 'Begin reading directly'}: ${readCall}`,
        protocol: MODE_PROTOCOLS.reading,
      };
    }

    case 'source_read': {
      // NOTE: Signing gate removed - the Gatekeeper agent provides organic review
      // through the messaging system instead of hard-blocking source reads.
      const sourceId = args.sourceId as string;
      const sourceBeforeRead = getTextSource(sourceId);
      if (!sourceBeforeRead) {
        return {
          success: false,
          error: `Source not found: ${sourceId}`,
        };
      }

      // The persisted tail is the authoritative physical chronology. If it is
      // a reserved synthetic block, an ordinary append after the last visible
      // passage would fork or reorder the protected chain. Detect that boundary
      // before readTextSource advances the staged cursor and fail closed. The
      // unrestricted lookup is read-only and the hidden node is never returned.
      const hasHiddenSyntheticTail =
        !reservedThinkingVisible() && sourceBeforeRead.lastCommittedNodeId
          ? await withReservedThinkingVisibility(true, () =>
              isReservedThinkingNode(
                getGraphStore().getNode(
                  sourceBeforeRead.lastCommittedNodeId || '',
                ),
              ),
            )
          : false;
      if (hasHiddenSyntheticTail) {
        return {
          success: false,
          error: 'SOURCE_REQUIRES_SYNTHETIC_READER',
          message:
            'This source currently ends at a reserved synthetic Reader/CMP block. Ordinary source_read cannot continue without branching or reordering that protected chronology.',
          hint: `Continue this source with source_read in TOOL_MODE="synthetic_reader", or load a separate ordinary source. No source text was consumed and no graph state changed. ${ORDINARY_SYNTHETIC_VISIBILITY}`,
        };
      }

      // Reading advances the staged cursor before graph persistence. Restore it
      // if the atomic graph batch fails so the passage can be retried instead of
      // being silently skipped.
      const restoreReadPosition = () =>
        updateTextSource(sourceId, {
          position: sourceBeforeRead.position,
          status: sourceBeforeRead.status,
        });

      // Only a root already persisted on this source is eligible for reuse.
      // A same-title graph root may describe unrelated material; adopting it
      // would silently hijack that document and bypass explicit anchoring.
      let rootId = sourceBeforeRead.rootNodeId || undefined;

      const anchorRef = String(args.anchorNode || '').trim();
      const resolvedAnchor = anchorRef
        ? contextManager.resolveNode(anchorRef, projectId)
        : null;
      if (anchorRef && !resolvedAnchor) {
        return {
          success: false,
          error: 'SOURCE_ANCHOR_NOT_FOUND',
          message: `Anchor node not found: "${anchorRef}".`,
          hint: 'Use graph_understand({ query, workflow: "reading" }) or graph_skeleton(), then retry with an existing node ID or exact title.',
        };
      }

      if (!rootId && store.getAll().nodes.length > 0 && !resolvedAnchor) {
        return {
          success: false,
          error: 'SOURCE_ANCHOR_REQUIRED',
          message:
            'Starting this source would create a document component disconnected from the existing graph.',
          hint: `Run graph_understand({ query: ${JSON.stringify(`Read and understand ${sourceBeforeRead.title}`)}, workflow: "reading" }), choose a genuinely relevant existing node, then retry source_read with anchorNode. No source text was consumed.`,
        };
      }

      // Only default `chars` if NONE of chars/lines/until were specified.
      // Earlier code unconditionally defaulted chars to 2000, which made the
      // `if (chars) ... else if (lines) ... else if (until) ...` chain in
      // readTextSource always take the chars branch — silently ignoring
      // every `until` and `lines` request the agent ever sent.
      const charsArg = args.chars as number | undefined;
      const linesArg = args.lines as number | undefined;
      const untilArg = args.until as string | undefined;
      try {
        const result = readTextSource(sourceId, {
          chars:
            charsArg !== undefined
              ? charsArg
              : linesArg === undefined && untilArg === undefined
                ? 2000
                : undefined,
          lines: linesArg,
          until: untilArg,
        });

        if (!result) {
          return {
            success: false,
            error: `Source not found: ${sourceId}`,
          };
        }

        const progress = getTextSourceProgress(sourceId);

        // A read that starts at EOF has no new content to commit. A read that
        // *reaches* EOF still has a final passage and must create its content
        // node before reporting completion.
        if (result.done && result.content.length === 0) {
          return {
            success: true,
            done: true,
            progress: progress ? { percent: 100, remaining: 0 } : null,
            message: 'Source reading complete.',
            hint: `Use source_export to reconstruct the exact visible source. ${sourceVisibilityHint()}`,
          };
        }

        const prevNodeId = getVisibleSourceTail(
          rootId,
          sourceBeforeRead.lastCommittedNodeId,
        );

        const percent = progress?.percent || 0;
        const commitMessage =
          (args.commit_message as string) ||
          `Auto-committed source content at ${percent}%`;
        let contentNodeId: string | undefined;

        // In a fresh graph, a document root by itself violates orphan
        // prevention. Create the root and first content node in one atomic
        // batch so the implicit `contains` edge anchors both nodes.
        if (!rootId) {
          const sourceTitle = sourceBeforeRead.title || 'Reading';
          const anchorOperation = resolvedAnchor
            ? [
                {
                  tool: 'graph_connect',
                  params: {
                    from: '$0.id',
                    to: resolvedAnchor.id,
                    type: 'contextualizes',
                    why: `This source reading was explicitly anchored to "${resolvedAnchor.title}" so future readers can see which existing understanding it is meant to test or extend.`,
                  },
                },
              ]
            : [];
          const initialBatch = (await handleBatchTools(
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
                {
                  tool: 'doc_create',
                  params: {
                    title: `Content ${percent}%`,
                    content: result.content,
                    level: 'paragraph',
                    isDocRoot: false,
                    parentId: '$0.id',
                  },
                },
                ...anchorOperation,
              ],
              commit_message: commitMessage,
              agent_name: 'source_reader',
              workflow: understandingWorkflow,
              author: typeof args.author === 'string' ? args.author : undefined,
            },
            contextManager,
            sourceMutationMode,
            guidanceMode,
          )) as {
            success?: boolean;
            results?: Array<{ id?: string }>;
            errors?: unknown[];
            error?: unknown;
            message?: string;
          };

          rootId = initialBatch.results?.[0]?.id;
          contentNodeId = initialBatch.results?.[1]?.id;
          if (!initialBatch.success || !rootId || !contentNodeId) {
            restoreReadPosition();
            return {
              success: false,
              error: `Failed to commit initial source content: ${JSON.stringify(initialBatch.errors || initialBatch.error || initialBatch.message || initialBatch)}`,
            };
          }

          updateTextSource(sourceId, {
            rootNodeId: rootId,
            lastCommittedNodeId: contentNodeId,
          });
        } else {
          // Create subsequent content under the existing source document root.
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
              commit_message: commitMessage,
              agent_name: 'source_reader',
              workflow: understandingWorkflow,
              author: typeof args.author === 'string' ? args.author : undefined,
            },
            contextManager,
            sourceMutationMode,
            guidanceMode,
          )) as {
            success?: boolean;
            results?: Array<{ id?: string }>;
            errors?: unknown[];
            error?: unknown;
            message?: string;
          };

          contentNodeId = batchResult.results?.[0]?.id;
          if (!batchResult.success || !contentNodeId) {
            restoreReadPosition();
            return {
              success: false,
              error: `Failed to commit source content: ${JSON.stringify(batchResult.errors || batchResult.error || batchResult.message || batchResult)}`,
            };
          }

          updateTextSource(sourceId, {
            lastCommittedNodeId: contentNodeId,
          });
        }

        // Build a directly usable hint. Ordinary reading captures rich typed
        // testimony in graph_batch; reserved synthetic thinking is a separate
        // pretraining-production mode.
        const optionalGuidance = ambientGuidanceEnabled(guidanceMode)
          ? `
OPTIONAL GUIDANCE AT A REAL CHOICE POINT:
  graph_suggest_next({ task: ${JSON.stringify(`Continue understanding ${sourceBeforeRead.title} after this passage`)}, workflow: "${understandingWorkflow}", focusNodeIds: ["${contentNodeId}"] })
  Judge, modify, reject, or skip the returned routes. Suggestions are not a reading phase.
`
          : '';
        const hint = `Content node created: ${contentNodeId}

PRESERVE THE COMMUNICABLE UNDERSTANDING THIS PASSAGE PRODUCED:
  In one graph_batch, use graph_note({ about: "${contentNodeId}", testimony, trigger, relations? }).
  It creates learned_from automatically. Preserve questions, interpretations,
  alternatives, evidence, uncertainty, and what later reading could test. Do not
  manufacture content merely to demonstrate activity.

${optionalGuidance}
${
  result.done
    ? `READING COMPLETE: Use source_export to reconstruct the exact visible source. ${sourceVisibilityHint()}`
    : `TO CONTINUE: source_read({ sourceId: "${sourceId}" })`
}

Progress: ${percent}% complete

${sourceVisibilityHint()}`;
        const graph = store.getAll();
        const artifactCognitionBalance = assessArtifactCognitionBalance(
          graph.nodes,
          graph.edges,
        );

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
          ...(artifactCognitionBalance.advisories.length > 0
            ? { artifactCognitionBalance }
            : {}),
          navigation: {
            focusNodeIds: [contentNodeId],
            ...(ambientGuidanceEnabled(guidanceMode)
              ? {
                  suggestedCall: {
                    tool: 'graph_suggest_next',
                    arguments: {
                      task: `Continue understanding ${sourceBeforeRead.title} after this passage`,
                      workflow: understandingWorkflow,
                      focusNodeIds: [contentNodeId],
                    },
                  },
                }
              : {}),
          },
          understandingMode: understandingMode('encountered', {
            sourceId,
            contentNodeId,
            position: result.position,
            done: result.done,
            workflow: understandingWorkflow,
          }),
          hint,
        };
      } catch (error) {
        restoreReadPosition();
        throw error;
      }
    }

    case 'source_position': {
      const sourceId = args.sourceId as string;
      const progress = getTextSourceProgress(sourceId);

      if (!progress) {
        return {
          success: false,
          error: `Source not found: ${args.sourceId}`,
        };
      }

      const source = getTextSource(sourceId);
      const visibleLastCommittedNodeId = getVisibleSourceTail(
        source?.rootNodeId,
        progress.lastCommittedNodeId,
      );
      const { lastCommittedNodeId: _persistedTailId, ...publicProgress } =
        progress;

      return {
        success: true,
        sourceId,
        ...publicProgress,
        lastCommittedNodeId: visibleLastCommittedNodeId,
        hint:
          progress.status === 'completed'
            ? `Source complete. Use source_export to reconstruct the exact visible source. ${sourceVisibilityHint()}`
            : `${progress.percent}% complete. ${progress.totalLength - progress.position} chars remaining. ${sourceVisibilityHint()}`,
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
          error: 'No content committed yet. Use source_read first.',
        };
      }

      // Flatten the document from root
      const flattened = store.flattenDocument(source.rootNodeId);
      // The source root is structural scaffolding created by source_read. It
      // contains a generated title/description, not source text, so exporting
      // it would violate the tool's exact-replication contract.
      const exportedNodes = flattened.filter(
        ({ node }) => node.id !== source.rootNodeId,
      );

      // The core document projection removes reserved blocks in ordinary
      // modes. synthetic_reader retains them here in chronological position.
      let output = '';
      const thinkingOpen = format === 'xml' ? '<thinking>' : '```thinking';
      const thinkingClose = format === 'xml' ? '</thinking>' : '```';

      for (const { node } of exportedNodes) {
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
          // Synthetic block markers are annotations, so separate them from
          // adjacent source prose without normalizing the source chunks.
          if (output.length > 0 && !output.endsWith('\n')) output += '\n';
          output += `${thinkingOpen}\n${thinkingContent}\n${thinkingClose}\n`;
        } else {
          // Content nodes are exact chronological slices of the staged source.
          // Concatenation (without trim/join separators) reconstructs it byte
          // for byte when no synthetic blocks are present.
          output += node.content || '';
        }
      }

      const isThinkingNode = (n: {
        trigger?: string | null;
        fileType?: string | null;
      }) => n.trigger === 'thinking' || n.fileType === 'thinking';
      const thinkingCount = exportedNodes.filter((f) =>
        isThinkingNode(f.node),
      ).length;
      const includeSynthetic = reservedThinkingVisible();

      return {
        success: true,
        sourceId,
        title: source.title,
        format,
        ...(includeSynthetic ? { thinkingMode } : {}),
        output,
        nodeCount: exportedNodes.length,
        thinkingCount,
        contentCount: exportedNodes.filter((f) => !isThinkingNode(f.node))
          .length,
        message: includeSynthetic
          ? `Exported "${source.title}" with ${exportedNodes.length} source/synthetic nodes (${thinkingMode} mode).`
          : `Exported the exact visible source "${source.title}" with reserved synthetic Reader/CMP blocks excluded and unavailable.`,
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
