import {
  createCommit,
  type EdgeType,
  EmbeddingService,
  getGraphStore,
  TRIGGER_TYPES,
  type TriggerType,
} from '@emergent-wisdom/understanding-graph-core';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ContextManager } from '../context-manager.js';

// Similarity thresholds for duplicate detection
const SIMILARITY_THRESHOLDS = {
  DUPLICATE: 0.8, // > 0.8 = near duplicate, should extend not create
  CAUTION: 0.6, // 0.6-0.8 = related, warn but allow
  SAFE: 0.4, // < 0.6 = different enough
};

const CONCEPT_TRIGGER_TYPES = TRIGGER_TYPES.filter(
  (trigger) => trigger !== 'thinking',
);

// `graph_note` already creates its grounding `learned_from` edge.
// This smaller vocabulary is only for genuine note-to-understanding links;
// structural document edges and direction-sensitive lifecycle operations such
// as `supersedes` remain owned by their dedicated tools.
const GRAPH_NOTE_RELATION_TYPES = [
  'refines',
  'questions',
  'answers',
  'contradicts',
  'validates',
  'invalidates',
  'contextualizes',
  'diverse_from',
] as const satisfies readonly EdgeType[];
const graphNoteRelationTypes = new Set<string>(GRAPH_NOTE_RELATION_TYPES);

export const conceptTools: Tool[] = [
  {
    name: 'graph_add_concept',
    description: `Add a new concept node to the understanding graph.

AUTOMATIC DUPLICATE DETECTION:
This tool automatically checks for similar existing concepts before creating:
- >80% similarity: BLOCKS creation - extend existing concept instead
- 60-80% similarity: WARNS but creates - consider linking
- <60% similarity: Creates normally

If blocked, you'll receive the existing concept ID and suggestions for how to extend it instead.

WHEN TO USE:
- An encounter changes what is understood or what becomes salient:
  a surprise, hesitation, attraction, alternative, question, hypothesis,
  prediction, consequence, evaluation, decision, or changed direction
- You've checked graph_semantic_search and found nothing similar
- A future instance would work differently by re-entering this state

Write enough intentional, user-visible testimony to preserve the texture of the
moment. The node may be provisional, personal, unresolved, and multi-paragraph;
it does not need to pretend that a conclusion has stabilized. Do not create
nodes by quota or retroactively rationalize finished work. Do not claim this is
hidden chain-of-thought.

The "thinking" trigger is intentionally unavailable here. It belongs only to
the separate synthetic Reader/CMP synthesis mode, which reconstructs training
blocks from these underlying typed nodes.

PARAMETERS:
- title: Title of the concept (REQUIRED)
- trigger: Why adding (foundation/surprise/tension/consequence/question/etc)
- understanding: The user-visible understanding to preserve
- why: Why this matters`,
    inputSchema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Title/name of the concept',
        },
        trigger: {
          type: 'string',
          enum: [...CONCEPT_TRIGGER_TYPES],
          description:
            'Why this concept is being added: foundation (core building block), surprise (unexpected), tension (creates conflict), consequence (has implications), repetition (frequently occurring), question (open question), serendipity (unexpected connection), reference (pointer to another project/URL - REQUIRES references field), library (collection of references), prediction (forward-looking belief), hypothesis (provisional explanation), model (generalized pattern), evaluation (normative reflection), decision (a choice between alternatives with rationale), experiment (a test that will yield information), analysis (stabilized integration or structured examination). Note: trigger "thinking" is reserved for the separate synthetic Reader/CMP synthesizer and is intentionally omitted here.',
        },
        references: {
          type: 'array',
          description:
            'REQUIRED for trigger="reference". Array of cross-project or URL references. Each item must have either {project, nodeId, title?} for cross-project refs OR {url, title?} for web refs.',
          items: {
            type: 'object',
            properties: {
              project: {
                type: 'string',
                description: 'Project ID for cross-project reference',
              },
              nodeId: {
                type: 'string',
                description: 'Node ID in the referenced project',
              },
              url: {
                type: 'string',
                description: 'URL for external web reference',
              },
              title: {
                type: 'string',
                description: 'Display title for the reference',
              },
            },
          },
        },
        why: {
          type: 'string',
          description:
            'REQUIRED. One line naming what this node DOES to the understanding around it — what it corrects, reframes, opens, settles, or contradicts. Not a restatement of the title and not a precis of the understanding: state the role. From practice: "Corrects my own earlier recommendation with a sharper mechanism", "Self-observation that contradicts the flattering reading of my own metrics", "Reframes my own diagnosis from a missing action to a degraded operation". If no honest role can be named, that is a signal the node may not be worth creating on its own.',
        },
        attend: {
          type: 'string',
          description:
            'Optional forward-looking pointer: what a later instance should attend to DIFFERENTLY because of this — an assumption now worth testing, a place the next reader should look, a question this opens. Not a summary of the understanding above; it is addressed to a future instance, not to the record. Supplying it marks this node as open live attention. Note the current limit: automatic resurfacing only happens for a node with a learned_from edge to a visible document, so on a concept with no artifact link this is recorded and readable but will not resurface on its own. Leave empty when nothing downstream should change.',
        },
        understanding: {
          type: 'string',
          description:
            'Intentional user-visible cognitive testimony: preserve enough observation, live alternatives, significance, uncertainty, or changed understanding for a future agent to continue it. May be rich and provisional; do not claim hidden chain-of-thought.',
        },
        project: {
          type: 'string',
          description:
            'Project ID (optional, uses current project if not specified)',
        },
        skipDuplicateCheck: {
          type: 'boolean',
          description:
            'Skip duplicate detection. Only use if you have already verified no similar concept exists via graph_semantic_search.',
        },
        agent_name: {
          type: 'string',
          description:
            'Name of the agent making this call. Auto-injected by the system.',
        },
      },
      required: ['title', 'trigger', 'why', 'understanding'],
    },
  },
  {
    name: 'graph_note',
    description: `Capture each substantive, user-visible change in understanding while working with an artifact, source, or prior graph material.

This is the low-friction, batch-only path for new interpretations, questions,
tensions, alternatives, predictions, surprises, and evaluations that record corrections
that change attention or action before they become polished conclusions. It
creates an ordinary typed concept and a learned_from edge to the exact visible
graph node that occasioned it. Use it inside the same graph_batch as nearby work
so the note is prospective or contemporaneous, not a rationale filed after
completion.

The testimony may be multi-paragraph and unresolved. It can preserve a design
fork, felt brittleness, unexpected behavior, a possible test, or a question a
future instance should re-enter. Prefer the specific honest trigger when one
fits; omission stores a neutral structured examination as analysis. This never creates reserved thinking
blocks and does not claim hidden chain-of-thought. Routine execution with no
change in understanding needs no note; this is completeness of meaningful
cognitive testimony, not transcription or a node quota. The note is useful
only when re-entering it can change later attention, reveal a relationship, or
open another cycle of understanding.`,
    inputSchema: {
      type: 'object',
      properties: {
        about: {
          type: 'string',
          description:
            'Exact visible source, artifact, or cognitive node ID/title—or a $N.id batch reference—that occasioned this change in understanding.',
        },
        testimony: {
          type: 'string',
          description:
            'Intentional user-visible account of the substantive change in understanding: what was noticed before, what encounter moved it, what is now different, and which alternatives or uncertainty remain.',
        },
        title: {
          type: 'string',
          description:
            'Optional retrieval title. Defaults to "Understanding from <node>".',
        },
        trigger: {
          type: 'string',
          enum: [...CONCEPT_TRIGGER_TYPES],
          description:
            'Optional honest ordinary trigger. Omission uses analysis as a neutral structured examination; prefer a more specific trigger whenever it genuinely fits.',
        },
        why: {
          type: 'string',
          description:
            'Optional explanation of why this moment may matter to future work.',
        },
        status: {
          type: 'string',
          enum: ['open', 'resolved'],
          description:
            'Optional lifecycle state. Defaults to open. Use resolved only when this same atomic commit fully responds to the attention; the note remains in history but will not be resurfaced as unfinished work.',
        },
        relations: {
          type: 'array',
          description:
            'Optional genuine cognitive relationships from this note to existing understanding. Omit when no relationship helps future reasoning; never add links for diversity alone. Artifact grounding is created separately as learned_from.',
          items: {
            type: 'object',
            properties: {
              node: {
                type: 'string',
                description:
                  'Existing cognitive node ID or exact title. A concept created earlier in this batch may be referenced by its exact title.',
              },
              type: {
                type: 'string',
                enum: [...GRAPH_NOTE_RELATION_TYPES],
                description:
                  'How this new note relates to the existing cognitive node.',
              },
              why: {
                type: 'string',
                description:
                  'Why following this relationship will help future reasoning.',
              },
            },
            required: ['node', 'type', 'why'],
            additionalProperties: false,
          },
        },
      },
      required: ['about', 'testimony'],
    },
  },
  {
    name: 'graph_question',
    description:
      'Create a question node representing something you want to explore or understand better.',
    inputSchema: {
      type: 'object',
      properties: {
        question: {
          type: 'string',
          description: 'The question you want to explore',
        },
        speculation: {
          type: 'string',
          description:
            'Your initial speculation or hypothesis about the answer. Required: a question node with nothing behind it records that you wondered, not what you thought.',
        },
        why: {
          type: 'string',
          description:
            'One line naming what asking this opens — what it would settle, unblock, or put in doubt. Not "an open question": every question is that, so a line true of all of them carries nothing.',
        },
        project: {
          type: 'string',
          description: 'Project ID (optional)',
        },
      },
      required: ['question', 'speculation', 'why'],
    },
  },
  {
    name: 'graph_revise',
    description: `Update concept understanding with EPISTEMIC JOURNEY tracking.

This tool captures HOW your understanding developed, not just WHAT changed.
The before/after/pivot fields create a learning trail for future agents.

EPISTEMIC JOURNEY (recommended for significant revisions):
- before: What you believed before ("I thought X because...")
- after: What you now believe ("Now I see Y because...")
- pivot: The key insight that caused the shift ("The realization was...")

These fields are stored in revision history, making understanding evolution visible.

WARNING: use "node" (NOT "nodeId"). Updates "understanding" field - for prose use doc_revise instead.`,
    inputSchema: {
      type: 'object',
      properties: {
        node: {
          type: 'string',
          description:
            'Node name or ID. WARNING: param is "node", NOT "nodeId" (doc_revise uses nodeId)',
        },
        understanding: {
          type: 'string',
          description:
            'Updated understanding text (this is NOT prose - use doc_revise for prose). Optional if only updating references.',
        },
        before: {
          type: 'string',
          description:
            'EPISTEMIC JOURNEY: What you believed before this revision. Example: "I thought caching was causing the slowdown"',
        },
        after: {
          type: 'string',
          description:
            'EPISTEMIC JOURNEY: What you now believe. Example: "Now I see the database query was the bottleneck"',
        },
        pivot: {
          type: 'string',
          description:
            'EPISTEMIC JOURNEY: The key insight or evidence that caused the shift. Example: "Profiling showed 80% time in SQL"',
        },
        references: {
          type: 'array',
          description:
            'Update cross-project or URL references. Each item must have either {project, nodeId, title?} for cross-project refs OR {url, title?} for web refs.',
          items: {
            type: 'object',
            properties: {
              project: {
                type: 'string',
                description: 'Project ID for cross-project reference',
              },
              nodeId: {
                type: 'string',
                description: 'Node ID in the referenced project',
              },
              url: {
                type: 'string',
                description: 'URL for external web reference',
              },
              title: {
                type: 'string',
                description: 'Display title for the reference',
              },
            },
          },
        },
        why: {
          type: 'string',
          description: 'Why you are revising this concept',
        },
        project: {
          type: 'string',
          description: 'Project ID (optional)',
        },
      },
      required: ['node', 'why'],
    },
  },
  {
    name: 'graph_supersede',
    description:
      'Replace a wrong or incomplete concept with a fundamentally better understanding. Creates a supersession edge to preserve evolution history.',
    inputSchema: {
      type: 'object',
      properties: {
        old: {
          type: 'string',
          description: 'Node name or ID to supersede',
        },
        new_name: {
          type: 'string',
          description: 'Name for the replacement concept',
        },
        new_understanding: {
          type: 'string',
          description: 'The corrected understanding',
        },
        why: {
          type: 'string',
          description: 'Why the original was wrong or incomplete',
        },
        project: {
          type: 'string',
          description: 'Project ID (optional)',
        },
      },
      required: ['old', 'new_name', 'new_understanding', 'why'],
    },
  },
  {
    name: 'graph_add_reference',
    description:
      'Add a reference to an existing node. Can be an external URL OR a cross-project reference to a node in another project.',
    inputSchema: {
      type: 'object',
      properties: {
        node: {
          type: 'string',
          description: 'Node name or ID to add reference to',
        },
        url: {
          type: 'string',
          description: 'URL of the source (for external web references)',
        },
        title: {
          type: 'string',
          description: 'Title/description of the reference (optional)',
        },
        refProject: {
          type: 'string',
          description:
            'For cross-project refs: Project ID containing the referenced node',
        },
        refNodeId: {
          type: 'string',
          description:
            'For cross-project refs: Node ID in the referenced project',
        },
        project: {
          type: 'string',
          description: 'Current project ID (optional)',
        },
      },
      required: ['node'],
    },
  },
  {
    name: 'node_set_metadata',
    description:
      'Set arbitrary metadata on a node. Merges with existing metadata. Use for module-specific data (e.g., narrative-engine coordinates, thought_fluid translations). Creates a commit if commit_message is provided.',
    inputSchema: {
      type: 'object',
      properties: {
        node: {
          type: 'string',
          description: 'Node name or ID',
        },
        metadata: {
          type: 'object',
          description: 'Metadata object to merge with existing metadata',
          additionalProperties: true,
        },
        project: {
          type: 'string',
          description: 'Project ID (optional)',
        },
        commit_message: {
          type: 'string',
          description:
            'REQUIRED: Your reflection on this metadata change. Explain your strategy, what you noticed, why this matters. NOT a description of the action.',
        },
        agent_name: {
          type: 'string',
          description:
            'Name of the agent making this change. Used for commit tracking.',
        },
        commit_timestamp: {
          type: 'string',
          description:
            'Optional ISO timestamp for retroactive commits. If not provided, uses current time.',
        },
      },
      required: ['node', 'metadata', 'commit_message'],
    },
  },
  {
    name: 'node_get_metadata',
    description: 'Get metadata from a node.',
    inputSchema: {
      type: 'object',
      properties: {
        node: {
          type: 'string',
          description: 'Node name or ID',
        },
        key: {
          type: 'string',
          description:
            'Specific key to retrieve (optional, returns all if not specified)',
        },
        project: {
          type: 'string',
          description: 'Project ID (optional)',
        },
      },
      required: ['node'],
    },
  },
  {
    name: 'graph_rename',
    description:
      'Rename a node (update its text/name). Use this to change character names, place names, concept names, etc. Documents using soft references ({{char:id}}) will automatically resolve to the new name on regeneration.',
    inputSchema: {
      type: 'object',
      properties: {
        node: {
          type: 'string',
          description: 'Node name or ID to rename',
        },
        newName: {
          type: 'string',
          description: 'The new name for the node',
        },
        project: {
          type: 'string',
          description: 'Project ID (optional)',
        },
      },
      required: ['node', 'newName'],
    },
  },
  {
    name: 'graph_archive',
    description:
      'Archive (soft-delete) a node. The node is hidden from default context but preserved in history. Use for orphan nodes, outdated concepts, or cleanup.',
    inputSchema: {
      type: 'object',
      properties: {
        node: {
          type: 'string',
          description: 'Node name or ID to archive',
        },
        reason: {
          type: 'string',
          description: 'Why this node is being archived',
        },
        project: {
          type: 'string',
          description: 'Project ID (optional)',
        },
      },
      required: ['node'],
    },
  },
  {
    name: 'node_set_trigger',
    description:
      "Change a node's trigger type. Use to reclassify nodes (e.g., foundation→analysis, foundation→tension).",
    inputSchema: {
      type: 'object',
      properties: {
        node: {
          type: 'string',
          description: 'Node name or ID',
        },
        trigger: {
          type: 'string',
          enum: [...CONCEPT_TRIGGER_TYPES],
          description: 'New trigger type for the node',
        },
        project: {
          type: 'string',
          description: 'Project ID (optional)',
        },
      },
      required: ['node', 'trigger'],
    },
  },
];

export async function handleConceptTools(
  name: string,
  args: Record<string, unknown>,
  contextManager: ContextManager,
  internal = false,
): Promise<unknown> {
  const projectId =
    (args.project as string) || contextManager.getCurrentProjectId();
  const conversationId =
    await contextManager.getCurrentConversationId(projectId);
  const toolCallId = contextManager.getCurrentToolCall();

  switch (name) {
    case 'graph_add_concept': {
      const store = getGraphStore();

      // Check for common parameter mistakes
      if (!args.title && (args.name || args.text)) {
        const used = args.name ? 'name' : 'text';
        return {
          success: false,
          error: 'INVALID_PARAMETER',
          message: `You used "${used}" but this tool requires "title" for the concept title.`,
          hint: `Please retry with title: "${args.name || args.text}"`,
        };
      }

      const conceptName = args.title as string;
      const understanding = args.understanding as string;
      const skipCheck = args.skipDuplicateCheck === true;
      const trigger = args.trigger as TriggerType;
      const why = args.why as string;
      const attend = String(args.attend || '').trim();
      // Live attention is opt-in via `attend`: it is what makes the pointer
      // re-readable rather than write-only. Open attention is only ever
      // filtered out once resolved, so this adds a resurfacing hook without
      // reweighting ordinary retrieval.
      const conceptMetadata = attend
        ? { attend, liveAttention: true, attentionStatus: 'open' }
        : undefined;
      const references = args.references as
        | Array<{
            project?: string;
            nodeId?: string;
            url?: string;
            title?: string;
          }>
        | undefined;

      // `why` is required, and the measurement that settled it is worth
      // keeping: it was made optional for roughly forty minutes, and every
      // node authored in that window skipped it — by an agent who had just
      // designed the field and was watching for this exact effect. The
      // premise for relaxing it (that it merely restates the title) did not
      // survive the data either: the whys already in the graph name what a
      // node does to the understanding around it, which nothing else records.
      // A required field is a forcing function, and an optional one is a slow
      // leak. `attend` is the optional forward-looking companion, not a
      // replacement.
      const missing: string[] = [];
      if (!conceptName) missing.push('title');
      if (!trigger) missing.push('trigger');
      if (!why) missing.push('why');
      if (!understanding) missing.push('understanding');

      if (missing.length > 0) {
        return {
          success: false,
          error: 'MISSING_REQUIRED_FIELDS',
          message: `graph_add_concept requires: ${missing.join(', ')}`,
          received: {
            title: conceptName || '(missing)',
            trigger: trigger || '(missing)',
            why: why || '(missing)',
            understanding: understanding ? '(provided)' : '(missing)',
          },
          hint: 'Every concept node needs title, trigger, why, and understanding. why is one line naming what this node does to the understanding around it. attend is optional and points forward.',
        };
      }

      // Validate: reference trigger REQUIRES references field
      if (trigger === 'reference' && (!references || references.length === 0)) {
        return {
          success: false,
          error: 'MISSING_REFERENCES',
          message:
            'trigger="reference" requires the references field with at least one cross-project ref {project, nodeId} or URL ref {url}',
          hint: 'Example: references: [{ project: "thinking-protocol", nodeId: "n_abc123", title: "Paper Title" }]',
        };
      }

      // Validate reference structure
      if (references && references.length > 0) {
        for (const ref of references) {
          const hasCrossProject = ref.project && ref.nodeId;
          const hasUrl = ref.url;
          if (!hasCrossProject && !hasUrl) {
            return {
              success: false,
              error: 'INVALID_REFERENCE',
              message:
                'Each reference must have either {project, nodeId} for cross-project refs OR {url} for web refs',
              invalidRef: ref,
            };
          }
        }
      }

      // Validate trigger is a valid value
      const validTriggers: readonly string[] = TRIGGER_TYPES;
      if (!validTriggers.includes(trigger)) {
        return {
          success: false,
          error: 'INVALID_TRIGGER',
          message: `Invalid trigger "${trigger}". Valid triggers: ${validTriggers.filter((t) => t !== 'thinking').join(', ')}`,
          hint: 'Choose a trigger that describes why you are adding this concept.',
        };
      }

      // THINKING NODE RESTRICTION: only the dedicated synthetic Reader/CMP
      // synthesizer can create reconstructed inner-voice training blocks.
      const agentName = args.agent_name as string | undefined;
      if (trigger === 'thinking' && agentName !== 'synthesizer') {
        return {
          success: false,
          error: 'FORBIDDEN_TRIGGER',
          message: `trigger "thinking" is reserved for the synthetic Reader/CMP synthesizer only. Agent "${agentName || 'unknown'}" cannot create thinking nodes.`,
          hint: 'For ordinary cognitive testimony, use the non-thinking trigger that honestly fits (for example surprise, tension, question, hypothesis, prediction, evaluation, decision, or analysis).',
        };
      }

      // Duplicate detection (unless explicitly skipped)
      if (!skipCheck && EmbeddingService.isModelLoaded()) {
        try {
          // Search for similar concepts using the combined name + understanding
          const searchText = `${conceptName}: ${understanding}`;
          const similar = await store.semanticSearch(searchText, 5);

          if (similar.length > 0) {
            const topMatch = similar[0];

            // DUPLICATE (>0.8): Block creation, suggest extending existing
            if (topMatch.similarity > SIMILARITY_THRESHOLDS.DUPLICATE) {
              return {
                success: false,
                blocked: true,
                reason: 'NEAR_DUPLICATE',
                message: `Found near-duplicate concept with ${Math.round(topMatch.similarity * 100)}% similarity. Extend or link to existing concept instead of creating new.`,
                existingConcept: {
                  id: topMatch.node.id,
                  name: topMatch.node.title,
                  similarity: Math.round(topMatch.similarity * 100) / 100,
                  understanding: topMatch.node.understanding?.slice(0, 300),
                },
                suggestions: [
                  `Use graph_revise to update "${topMatch.node.title}" (${topMatch.node.id})`,
                  `Use graph_connect to link your new insight to the existing concept`,
                  `Use graph_supersede if your understanding fundamentally replaces the old one`,
                  `Set skipDuplicateCheck=true if you are certain this is genuinely different`,
                ],
                otherSimilar: similar.slice(1, 3).map((s) => ({
                  id: s.node.id,
                  name: s.node.title,
                  similarity: Math.round(s.similarity * 100) / 100,
                })),
              };
            }

            // CAUTION (0.6-0.8): Warn but allow creation
            if (topMatch.similarity > SIMILARITY_THRESHOLDS.CAUTION) {
              // Create the node but include warning
              const node = store.createNode({
                title: conceptName,
                trigger,
                why: args.why as string,
                understanding,
                conversationId,
                toolCallId,
                references,
                metadata: conceptMetadata,
              });

              return {
                success: true,
                id: node.id,
                name: node.title,
                message: `Created concept "${node.title}" with ID: ${node.id}`,
                warning: {
                  level: 'CAUTION',
                  message: `Similar concept exists (${Math.round(topMatch.similarity * 100)}% similarity). Consider linking to it.`,
                  similarConcept: {
                    id: topMatch.node.id,
                    name: topMatch.node.title,
                    similarity: Math.round(topMatch.similarity * 100) / 100,
                  },
                  suggestion: `Consider: graph_connect from "${node.title}" to "${topMatch.node.title}"`,
                },
                hint: 'You can now connect it to other concepts using graph_connect',
              };
            }
          }
        } catch {
          // Semantic search failed (no embeddings?) - proceed without check
        }
      }

      // Create the node (no duplicates found or check skipped)
      const node = store.createNode({
        title: conceptName,
        trigger,
        why: args.why as string,
        understanding,
        conversationId,
        toolCallId,
        references,
        metadata: conceptMetadata,
      });

      return {
        success: true,
        id: node.id,
        name: node.title,
        message: `Created concept "${node.title}" with ID: ${node.id}`,
        hint: 'You can now connect it to other concepts using graph_connect',
      };
    }

    case 'graph_note': {
      const about = String(args.about || '').trim();
      const testimony = String(args.testimony || '').trim();
      if (!about || !testimony) {
        return {
          success: false,
          error: 'MISSING_REQUIRED_FIELDS',
          message: 'graph_note requires non-empty about and testimony fields.',
        };
      }

      const trigger = String(args.trigger || 'analysis') as TriggerType;
      if (trigger === 'thinking' || !TRIGGER_TYPES.includes(trigger)) {
        return {
          success: false,
          error: 'INVALID_TRIGGER',
          message: `graph_note requires an ordinary trigger. Valid triggers: ${CONCEPT_TRIGGER_TYPES.join(', ')}`,
        };
      }

      const status = String(args.status || 'open');
      if (!['open', 'resolved'].includes(status)) {
        return {
          success: false,
          error: 'INVALID_ATTENTION_STATUS',
          message: 'graph_note status must be open or resolved.',
        };
      }

      const resolvedSubject = contextManager.resolveNodeWithSuggestions(
        about,
        projectId,
      );
      const store = getGraphStore();
      const subject = store.getNode(resolvedSubject.id);
      if (!subject) {
        return {
          success: false,
          error: 'ATTENTION_TARGET_NOT_FOUND',
          message:
            'The referenced node is not available in the current visible graph.',
        };
      }

      const rawRelations = args.relations;
      if (rawRelations !== undefined && !Array.isArray(rawRelations)) {
        return {
          success: false,
          error: 'INVALID_ATTENTION_RELATIONS',
          message: 'graph_note relations must be an array when provided.',
        };
      }

      const resolvedRelations: Array<{
        target: { id: string; title: string };
        type: (typeof GRAPH_NOTE_RELATION_TYPES)[number];
        why: string;
      }> = [];
      for (const [index, rawRelation] of (
        (rawRelations as unknown[]) || []
      ).entries()) {
        if (
          !rawRelation ||
          typeof rawRelation !== 'object' ||
          Array.isArray(rawRelation)
        ) {
          return {
            success: false,
            error: 'INVALID_ATTENTION_RELATION',
            message: `graph_note relations[${index}] must be an object with node, type, and why.`,
          };
        }

        const relation = rawRelation as Record<string, unknown>;
        const targetRef = String(relation.node || '').trim();
        const relationType = String(relation.type || '').trim();
        const relationWhy = String(relation.why || '').trim();
        if (!targetRef || !relationType || !relationWhy) {
          return {
            success: false,
            error: 'INVALID_ATTENTION_RELATION',
            message: `graph_note relations[${index}] requires non-empty node, type, and why fields.`,
          };
        }
        if (!graphNoteRelationTypes.has(relationType)) {
          return {
            success: false,
            error: 'INVALID_ATTENTION_RELATION_TYPE',
            message: `graph_note relations[${index}] type must be one of: ${GRAPH_NOTE_RELATION_TYPES.join(', ')}. Artifact structural and lifecycle edge types require their dedicated tools.`,
          };
        }

        // Resolve every endpoint before the note is written. Because targets
        // must already exist at this point, the resulting edge cannot be a
        // self-edge to the new note.
        const target = contextManager.resolveNodeWithSuggestions(
          targetRef,
          projectId,
        );
        resolvedRelations.push({
          target,
          type: relationType as (typeof GRAPH_NOTE_RELATION_TYPES)[number],
          why: relationWhy,
        });
      }

      const why =
        String(args.why || '').trim() ||
        `Became salient while re-entering "${subject.title}".`;
      const title =
        String(args.title || '').trim() ||
        `Understanding from ${subject.title}`;
      const node = store.createNode({
        title,
        trigger,
        why,
        understanding: testimony,
        conversationId,
        toolCallId,
        metadata: {
          liveAttention: true,
          attentionStatus: status,
          aboutNodeId: subject.id,
        },
      });
      const edge = store.createEdge({
        fromId: node.id,
        toId: subject.id,
        type: 'learned_from',
        explanation: 'Understanding occasioned by re-entered graph material',
        why,
        conversationId,
        toolCallId,
      });
      const relationEdges = resolvedRelations.map((relation) => {
        const relationEdge = store.createEdge({
          fromId: node.id,
          toId: relation.target.id,
          type: relation.type,
          explanation: `Live attention ${relation.type} existing understanding`,
          why: relation.why,
          conversationId,
          toolCallId,
        });
        return {
          id: relationEdge.id,
          node: relation.target,
          type: relation.type,
          why: relation.why,
        };
      });

      return {
        success: true,
        id: node.id,
        edgeId: edge.id,
        title: node.title,
        trigger: node.trigger,
        status,
        about: { id: subject.id, title: subject.title },
        relations: relationEdges,
        testimony: node.understanding,
        affectedNodeIds: [
          ...new Set([
            node.id,
            subject.id,
            ...resolvedRelations.map((relation) => relation.target.id),
          ]),
        ],
        affectedEdgeIds: [
          edge.id,
          ...relationEdges.map((relation) => relation.id),
        ],
        message: `Captured changed understanding from "${subject.title}" for future re-entry.`,
      };
    }

    case 'graph_question': {
      // The schema said speculation was optional and the handler defaulted it
      // to an empty string, which node validation then rejected — so an agent
      // following the documented contract got ILLEGAL_CONCEPT_NODE and no hint
      // that speculation was the missing piece. And `why` was a constant,
      // 'Open question to explore', identical on every question node ever
      // created: a field required everywhere else precisely because it names
      // what a node DOES to the understanding around it, carrying zero
      // information here because it could not vary.
      const missing: string[] = [];
      if (!(args.question as string)?.trim()) missing.push('question');
      if (!(args.speculation as string)?.trim()) missing.push('speculation');
      if (!(args.why as string)?.trim()) missing.push('why');
      if (missing.length > 0) {
        return {
          success: false,
          error: 'QUESTION_INCOMPLETE',
          message:
            `graph_question requires ${missing.join(', ')}. A question node ` +
            'records what you wondered, what you already suspect, and what ' +
            'answering it would settle — the last two are what a later ' +
            'instance can actually use.',
        };
      }

      const store = getGraphStore();
      const node = store.createNode({
        title: args.question as string,
        trigger: 'question',
        why: args.why as string,
        understanding: args.speculation as string,
        conversationId,
        toolCallId,
      });

      return {
        success: true,
        id: node.id,
        question: node.title,
        message: `Created question node "${node.title}" with ID: ${node.id}`,
        hint: 'When you find the answer, use graph_answer to record it',
      };
    }

    case 'graph_revise': {
      // Check for common parameter mistakes
      if (!args.node && (args.nodeId || args.id)) {
        const used = args.nodeId ? 'nodeId' : 'id';
        return {
          success: false,
          error: 'INVALID_PARAMETER',
          message: `You used "${used}" but this tool requires "node" (name or ID).`,
          hint: `Please retry with node: "${args.nodeId || args.id}"`,
        };
      }

      const resolved = contextManager.resolveNodeWithSuggestions(
        args.node as string,
        projectId,
      );

      // Extract epistemic journey fields
      const before = args.before as string | undefined;
      const after = args.after as string | undefined;
      const pivot = args.pivot as string | undefined;

      // Build epistemic journey summary for revision history
      let epistemicJourney: string | undefined;
      if (before || after || pivot) {
        const parts: string[] = [];
        if (before) parts.push(`BEFORE: ${before}`);
        if (after) parts.push(`AFTER: ${after}`);
        if (pivot) parts.push(`PIVOT: ${pivot}`);
        epistemicJourney = parts.join(' | ');
      }

      // Build revision why - include epistemic journey if provided
      const baseWhy = args.why as string;
      const fullRevisionWhy = epistemicJourney
        ? `${baseWhy}\n\n[Epistemic Journey]\n${epistemicJourney}`
        : baseWhy;

      // Build update payload - only include fields that were provided
      const updatePayload: {
        understanding?: string;
        references?: Array<{
          project?: string;
          nodeId?: string;
          url?: string;
          title?: string;
        }>;
        revisionWhy: string;
        conversationId: string | undefined;
        epistemicJourney?: {
          before?: string;
          after?: string;
          pivot?: string;
        };
      } = {
        revisionWhy: fullRevisionWhy,
        conversationId,
      };

      if (args.understanding) {
        updatePayload.understanding = args.understanding as string;
      }
      if (args.references) {
        updatePayload.references = args.references as Array<{
          project?: string;
          nodeId?: string;
          url?: string;
          title?: string;
        }>;
      }

      // Store structured epistemic journey in metadata for programmatic access
      if (before || after || pivot) {
        updatePayload.epistemicJourney = {};
        if (before) updatePayload.epistemicJourney.before = before;
        if (after) updatePayload.epistemicJourney.after = after;
        if (pivot) updatePayload.epistemicJourney.pivot = pivot;
      }

      const store = getGraphStore();
      const node = store.updateNode(resolved.id, updatePayload);

      const response: Record<string, unknown> = {
        success: true,
        id: node.id,
        name: node.title,
        version: node.version,
        message: `Revised concept "${node.title}" (now version ${node.version})`,
      };

      // Include epistemic journey in response if provided
      if (before || after || pivot) {
        response.epistemicJourney = {
          before,
          after,
          pivot,
        };
        response.hint =
          'Epistemic journey recorded in revision history. Use node_get_revisions to see how understanding evolved.';
      }

      return response;
    }

    case 'graph_supersede': {
      const resolved = contextManager.resolveNodeWithSuggestions(
        args.old as string,
        projectId,
      );

      const store = getGraphStore();

      // Create new node
      const newNode = store.createNode({
        title: args.new_name as string,
        trigger: 'foundation',
        why: args.why as string,
        understanding: args.new_understanding as string,
        conversationId,
        toolCallId,
      });

      // Create supersession edge
      const supersessionEdge = store.createEdge({
        fromId: newNode.id,
        toId: resolved.id,
        type: 'supersedes',
        why: args.why as string,
        conversationId,
        toolCallId,
      });

      // Archive the old node
      store.archiveNode(resolved.id, 'Superseded', conversationId);

      return {
        success: true,
        oldId: resolved.id,
        oldName: resolved.title,
        newId: newNode.id,
        newName: newNode.title,
        affectedNodeIds: [newNode.id, resolved.id],
        affectedEdgeIds: [supersessionEdge.id],
        message: `Created "${newNode.title}" superseding "${resolved.title}"`,
        hint: 'The old concept is now hidden from default context but preserved in history',
      };
    }

    case 'graph_add_reference': {
      const resolved = contextManager.resolveNodeWithSuggestions(
        args.node as string,
        projectId,
      );

      // Build reference object - either URL-based or cross-project
      const refProject = args.refProject as string | undefined;
      const refNodeId = args.refNodeId as string | undefined;
      const url = args.url as string | undefined;

      if (!url && (!refProject || !refNodeId)) {
        throw new Error(
          'Either url OR (refProject + refNodeId) must be provided',
        );
      }

      const reference: {
        url?: string;
        title?: string;
        accessed?: string;
        project?: string;
        nodeId?: string;
      } = {
        title: args.title as string | undefined,
        accessed: new Date().toISOString(),
      };

      if (url) {
        reference.url = url;
      } else {
        reference.project = refProject;
        reference.nodeId = refNodeId;
      }

      const store = getGraphStore();
      const node = store.addReference(resolved.id, reference);

      if (!node) {
        throw new Error(`Failed to add reference to node: ${resolved.title}`);
      }

      const refCount = node.references?.length || 0;
      const refType = url
        ? 'URL reference'
        : `cross-project ref to ${refProject}:${refNodeId}`;
      return {
        success: true,
        id: node.id,
        name: node.title,
        referenceCount: refCount,
        message: `Added ${refType} to "${node.title}" (${refCount} total)`,
      };
    }

    case 'node_set_metadata': {
      const resolved = contextManager.resolveNodeWithSuggestions(
        args.node as string,
        projectId,
      );

      const commitMessage = args.commit_message as string;
      const agentName = args.agent_name as string | undefined;
      const commitTimestamp = args.commit_timestamp as string | undefined;

      // A direct mutation owns its commit. Inside graph_batch, the outer batch
      // owns the sole atomic commit and supplies authenticated attribution.
      // Validate before mutating so a missing direct commit message can never
      // leave uncommitted metadata behind.
      if (!internal && !commitMessage) {
        return {
          success: false,
          error: 'MISSING_COMMIT_MESSAGE',
          message: 'commit_message is required. Reflect on your strategy.',
          hint: 'Explain what you noticed, why this metadata matters, what pattern emerged.',
        };
      }

      const store = getGraphStore();
      const metadata = args.metadata as Record<string, unknown>;
      const node = store.setMetadata(resolved.id, metadata);

      if (!node) {
        throw new Error(`Failed to set metadata on node: ${resolved.title}`);
      }

      const commit = internal
        ? undefined
        : (() => {
            const createdCommit = createCommit(
              commitMessage,
              [node.id],
              [],
              agentName,
              commitTimestamp,
              typeof args.author === 'string' ? args.author : undefined,
            );
            return {
              id: createdCommit.id,
              message: createdCommit.message,
              createdAt: createdCommit.createdAt,
            };
          })();

      return {
        success: true,
        id: node.id,
        name: node.title,
        metadata: node.metadata,
        ...(commit ? { commit } : {}),
        message: commit
          ? `Updated metadata on "${node.title}". Commit: "${commit.message}"`
          : `Updated metadata on "${node.title}"`,
      };
    }

    case 'node_get_metadata': {
      const resolved = contextManager.resolveNodeWithSuggestions(
        args.node as string,
        projectId,
      );

      const store = getGraphStore();
      const key = args.key as string | undefined;

      if (key) {
        const value = store.getMetadataKey(resolved.id, key);
        return {
          success: true,
          id: resolved.id,
          name: resolved.title,
          key,
          value,
        };
      } else {
        const metadata = store.getMetadata(resolved.id);
        return {
          success: true,
          id: resolved.id,
          name: resolved.title,
          metadata,
        };
      }
    }

    case 'graph_rename': {
      const resolved = contextManager.resolveNodeWithSuggestions(
        args.node as string,
        projectId,
      );

      const store = getGraphStore();
      const oldName = resolved.title;
      const newName = args.newName as string;

      const updated = store.renameNode(resolved.id, newName);

      if (!updated) {
        throw new Error(`Failed to rename node: ${resolved.id}`);
      }

      return {
        success: true,
        id: updated.id,
        oldName,
        newName: updated.title,
        message: `Renamed "${oldName}" to "${updated.title}"`,
        hint: 'Documents using soft references ({{char:id}}, {{concept:id}}, etc.) will automatically resolve to the new name on regeneration with doc_generate.',
      };
    }

    case 'graph_archive': {
      const resolved = contextManager.resolveNodeWithSuggestions(
        args.node as string,
        projectId,
      );

      const store = getGraphStore();
      const reason = (args.reason as string) || 'Archived by user';
      const node = store.getNode(resolved.id);
      if (!node) {
        throw new Error('Node not found in the current visible graph.');
      }
      if (
        node.isDocRoot ||
        node.content !== null ||
        node.level !== null ||
        node.fileType !== null ||
        store.getDocumentPath(resolved.id)
      ) {
        throw new Error(
          'DOCUMENT_STRUCTURE_CHANGE_NOT_ALLOWED: graph_archive cannot archive a document node. Use atomic document tools that preserve contains/next topology.',
        );
      }

      const success = store.archiveNode(resolved.id, reason, conversationId);

      if (!success) {
        throw new Error(`Failed to archive node: ${resolved.title}`);
      }

      return {
        success: true,
        id: resolved.id,
        name: resolved.title,
        reason,
        message: `Archived "${resolved.title}"`,
        hint: 'Node is hidden from default context but preserved in history. Use show_evolution in graph_context to see archived nodes.',
      };
    }

    case 'node_set_trigger': {
      const resolved = contextManager.resolveNodeWithSuggestions(
        args.node as string,
        projectId,
      );

      const store = getGraphStore();
      const existingNode = store.getNode(resolved.id);
      const oldTrigger = existingNode?.trigger;
      const requestedTrigger = args.trigger;
      if (
        typeof requestedTrigger !== 'string' ||
        !TRIGGER_TYPES.includes(requestedTrigger as TriggerType)
      ) {
        return {
          success: false,
          error: 'INVALID_TRIGGER',
          message: `Invalid trigger. Valid triggers: ${CONCEPT_TRIGGER_TYPES.join(', ')}`,
        };
      }
      const newTrigger = requestedTrigger as TriggerType;

      const node = store.updateNode(resolved.id, {
        trigger: newTrigger,
        revisionWhy: `Changed trigger from ${oldTrigger} to ${newTrigger}`,
        conversationId,
      });

      return {
        success: true,
        id: node.id,
        name: node.title,
        oldTrigger,
        newTrigger: node.trigger,
        message: `Changed "${node.title}" trigger: ${oldTrigger} → ${newTrigger}`,
      };
    }

    default:
      throw new Error(`Unknown concept tool: ${name}`);
  }
}
