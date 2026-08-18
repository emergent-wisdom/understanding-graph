import {
  EDGE_TYPES,
  type EdgeType,
  getGraphStore,
} from '@emergent-wisdom/understanding-graph-core';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ContextManager } from '../context-manager.js';
import { hasAtomicDocumentRewireCapability } from './document-rewire-capability.js';

const DOCUMENT_STRUCTURE_EDGE_TYPES = new Set<EdgeType>(['contains', 'next']);

function rejectGenericDocumentStructureMutation(params: {
  currentType?: string;
  requestedType?: string;
  authorized?: boolean;
}): void {
  if (params.authorized) return;
  if (
    (params.currentType &&
      DOCUMENT_STRUCTURE_EDGE_TYPES.has(params.currentType as EdgeType)) ||
    (params.requestedType &&
      DOCUMENT_STRUCTURE_EDGE_TYPES.has(params.requestedType as EdgeType))
  ) {
    throw new Error(
      'DOCUMENT_STRUCTURE_CHANGE_NOT_ALLOWED: contains/next relations are owned by atomic document tools. Use doc_create to append, doc_move to reorder/reparent, doc_merge to fuse siblings, or doc_split to divide a leaf.',
    );
  }
}

export const connectionTools: Tool[] = [
  {
    name: 'graph_connect',
    description: `Create edge between nodes.

COGNITIVE PURPOSE: Edges are thinking scaffolds, not metadata. Only create an edge if it helps future agents reason better. Ask: "When thinking about X, should I also consider Y?" If yes, explain WHY in the why field.

Good edges: "this tension led to that insight", "this question was answered here", "this pattern repeats there"
Bad edges: "both about topic X" (too vague), "for completeness" (doesn't aid thinking)

WARNING: edge type param is "type" (NOT "edgeType" - graph_disconnect uses edgeType).`,
    inputSchema: {
      type: 'object',
      properties: {
        from: {
          type: 'string',
          description: 'Source concept name or ID',
        },
        to: {
          type: 'string',
          description: 'Target concept name or ID',
        },
        relation: {
          type: 'string',
          description:
            'Optional short label for how the concepts relate. The typed edge and why fields carry the durable semantics.',
        },
        why: {
          type: 'string',
          description: 'Why this connection matters',
        },
        type: {
          type: 'string',
          description: `Edge type. WARNING: param is "type", NOT "edgeType".

STRUCTURAL (for documents):
- "relates" (default) - general connection
- "next" - sequential ordering (section 1 → section 2)
- "contains" - parent→child hierarchy

SEMANTIC (for concepts):
- "expresses" - document expresses a concept
- "supersedes" - newer understanding replaces older
- "contradicts" - opposing ideas (one is wrong)
- "diverse_from" - different perspective (both valid)
- "refines" - adds precision to existing concept
- "implements" - abstract → concrete realization
- "abstracts_from" - concrete → abstract pattern
- "contextualizes" - provides framing for another concept
- "questions" - raises doubt about
- "answers" - resolves a question

CREATIVE PROVENANCE (document → graph material):
- "inspired_by" - the target genuinely shaped a choice in this artifact unit
  This is causal provenance, not a claim that the passage thematically expresses the target.

EPISTEMIC (for learning trails):
- "learned_from" - cognitive lineage: "I understood X by studying Y"
  Use to mark which concepts/sources led to understanding another.
  Creates visible learning trails in the graph.

PREDICTIVE (for forecasts):
- "validates" - later evidence confirms a prediction was correct
- "invalidates" - later evidence refutes a prediction`,
          enum: [...EDGE_TYPES],
        },
        project: {
          type: 'string',
          description: 'Project ID (optional)',
        },
      },
      required: ['from', 'to', 'type', 'why'],
    },
  },
  {
    name: 'graph_answer',
    description:
      'Answer a previously asked question. Creates a new concept with the answer and connects it to the question.',
    inputSchema: {
      type: 'object',
      properties: {
        question: {
          type: 'string',
          description: 'The question node name or ID',
        },
        answer: {
          type: 'string',
          description: 'The answer to the question',
        },
        explanation: {
          type: 'string',
          description: 'Detailed explanation of the answer',
        },
        project: {
          type: 'string',
          description: 'Project ID (optional)',
        },
      },
      required: ['question', 'answer', 'explanation'],
    },
  },
  {
    name: 'graph_disconnect',
    description:
      'Remove/archive edge between nodes. WARNING: edge type param is "edgeType" (NOT "type" - graph_connect uses type). Edges are soft-deleted (active=0).',
    inputSchema: {
      type: 'object',
      properties: {
        from: {
          type: 'string',
          description: 'Source node name or ID',
        },
        to: {
          type: 'string',
          description: 'Target node name or ID',
        },
        edgeType: {
          type: 'string',
          description:
            'Edge type to remove. WARNING: param is "edgeType", NOT "type". Specify if multiple edges exist between nodes.',
          enum: [...EDGE_TYPES],
        },
        project: {
          type: 'string',
          description: 'Project ID (optional)',
        },
      },
      required: ['from', 'to'],
    },
  },
  {
    name: 'edge_update',
    description:
      "Update an edge's type or explanation. Use to change edge types (e.g., relates→contains) or update descriptions.",
    inputSchema: {
      type: 'object',
      properties: {
        from: {
          type: 'string',
          description: 'Source node name or ID',
        },
        to: {
          type: 'string',
          description: 'Target node name or ID',
        },
        type: {
          type: 'string',
          description: 'New edge type',
          enum: [...EDGE_TYPES],
        },
        explanation: {
          type: 'string',
          description: 'New explanation for the edge',
        },
        project: {
          type: 'string',
          description: 'Project ID (optional)',
        },
      },
      required: ['from', 'to'],
    },
  },
];

export async function handleConnectionTools(
  name: string,
  args: Record<string, unknown>,
  contextManager: ContextManager,
): Promise<unknown> {
  const projectId =
    (args.project as string) || contextManager.getCurrentProjectId();
  const conversationId =
    await contextManager.getCurrentConversationId(projectId);
  const toolCallId = contextManager.getCurrentToolCall();

  switch (name) {
    case 'graph_connect': {
      // `relation` is the free-text explanation; `type` is the edge category.
      // Passing an edge type as `relation` used to succeed silently: the edge
      // became a generic `relates` and the intended semantics ended up buried
      // in a text field. That is worse than an error — the value of the graph
      // is in typed relations, and nothing surfaced that they had been lost.
      if (
        !args.type &&
        typeof args.relation === 'string' &&
        (EDGE_TYPES as readonly string[]).includes(args.relation)
      ) {
        return {
          success: false,
          error: 'INVALID_PARAMETER',
          message:
            `You passed "${args.relation}" as "relation", but "relation" is ` +
            'the free-text explanation. The edge category goes in "type" — ' +
            'without it this edge would silently have become "relates".',
          hint: `Please retry with type: "${args.relation}"`,
        };
      }

      // `why` is listed in this tool's required schema, but nothing enforced
      // it: graph_batch — the only write path — calls handlers directly, so a
      // schema `required` never runs. An edge is exactly where the question is
      // worth answering, because the answer is not a restatement of either
      // endpoint: it says what following the link buys a later instance. That
      // is why `why` became optional on nodes and stays mandatory here.
      if (!String(args.why || '').trim()) {
        return {
          success: false,
          error: 'MISSING_REQUIRED_FIELDS',
          message:
            'graph_connect requires "why": what does following this edge tell ' +
            'a later instance that reading either node alone would not?',
          hint:
            'An edge without why is a line on a picture. If no answer exists, ' +
            'the relationship probably should not be recorded.',
        };
      }

      // Check for common parameter mistakes
      if (!args.type && args.edgeType) {
        return {
          success: false,
          error: 'INVALID_PARAMETER',
          message:
            'You used "edgeType" but this tool requires "type" for the edge category (relates, supersedes, etc).',
          hint: `Please retry with type: "${args.edgeType}"`,
        };
      }

      // Resolve both nodes
      const fromArg = (args.from || args.fromId) as string;
      const toArg = (args.to || args.toId) as string;

      if (!fromArg || !toArg) {
        return {
          success: false,
          error: 'MISSING_PARAMETER',
          message:
            'Must provide both "from" (or "fromId") and "to" (or "toId").',
        };
      }

      const fromResolved = contextManager.resolveNodeWithSuggestions(
        fromArg,
        projectId,
      );
      const toResolved = contextManager.resolveNodeWithSuggestions(
        toArg,
        projectId,
      );

      const store = getGraphStore();

      // An edge landing on a prediction is a verdict, and a verdict has a
      // sign. Typed `answers`, it records that the question was settled but
      // not how it came out, so refutation and confirmation become
      // indistinguishable in the structure and the outcome survives only in
      // prose — where nothing can count it.
      //
      // The tool description already says this, under its own PREDICTIVE
      // heading, naming both validates and invalidates. It was read and
      // ignored six times in a row by an agent who had just written about
      // typed edges making influence inspectable. That is the whole argument
      // for making it a refusal instead of a sentence: advice this specific
      // did not move behaviour, and the failing batch does.
      // An omitted type is not a relation, and `relates` must be asked for.
      //
      // The contract says to use specific typed edges, and the schema defaulted
      // an absent `type` to `relates` — so the cheapest possible path, leaving
      // a field out, produced exactly the generic edge the contract
      // discourages, silently and with no refusal. That is the same shape as
      // the passage-granularity defect: the advice sat in one place and the
      // cheap route led somewhere else.
      //
      // Three levers have now been measured on this tool. Advising fails:
      // agent_name was supplied in zero of seventy-seven commits while it was
      // merely recommended. Refusing works: it has been supplied in every
      // commit since it was required. Removing the alternative works: coarse
      // passages stopped when doc_create ceased to be reachable, without the
      // fine-grained path getting any cheaper. This takes the third lever.
      // `relates` remains available to anyone who means it; it stops being
      // what you get by accident.
      if (args.type === undefined || args.type === null || args.type === '') {
        return {
          success: false,
          error: 'EDGE_TYPE_REQUIRED',
          message:
            'graph_connect requires an explicit "type". An omitted type used ' +
            'to become "relates", which records that two nodes are connected ' +
            'without recording how — so following it later buys nothing a ' +
            'search would not. Choose the relation you actually mean: ' +
            'learned_from, refines, contradicts, questions, answers, ' +
            'validates, invalidates, supersedes, implements, expresses, ' +
            'inspired_by, diverse_from, contains, next — or "relates" ' +
            'explicitly, if the connection genuinely has no better name.',
        };
      }

      const targetNode = store.getNode(toResolved.id);
      const VERDICT_TYPES = ['validates', 'invalidates', 'contradicts'];
      const requestedType = (args.type as string) || 'relates';
      if (
        targetNode?.trigger === 'prediction' &&
        !VERDICT_TYPES.includes(requestedType)
      ) {
        return {
          success: false,
          error: 'UNSIGNED_VERDICT',
          message:
            `This edge points at a prediction ("${targetNode.title}") but is ` +
            `typed "${requestedType}", which does not say how the prediction ` +
            'turned out. A verdict must carry its sign in the type, not only ' +
            'in the why.',
          hint:
            'Use "validates" if the evidence upheld the prediction, ' +
            '"invalidates" or "contradicts" if it overturned it. Where a ' +
            'prediction split by clause, record one edge per sign.',
        };
      }

      rejectGenericDocumentStructureMutation({
        requestedType: args.type as string | undefined,
        authorized: hasAtomicDocumentRewireCapability(args),
      });
      const edge = store.createEdge({
        fromId: fromResolved.id,
        toId: toResolved.id,
        type: (args.type as EdgeType) || 'relates',
        explanation: args.relation as string | undefined,
        why: args.why as string | undefined,
        conversationId,
        toolCallId,
      });

      return {
        success: true,
        id: edge.id,
        from: fromResolved.title,
        to: toResolved.title,
        relation: (args.relation as string | undefined) || edge.type,
        affectedNodeIds: [fromResolved.id, toResolved.id],
        affectedEdgeIds: [edge.id],
        message: `Connected "${fromResolved.title}" → "${toResolved.title}"`,
      };
    }

    case 'graph_answer': {
      // Resolve the question node
      const questionResolved = contextManager.resolveNodeWithSuggestions(
        args.question as string,
        projectId,
      );

      const store = getGraphStore();

      // Create answer node
      const answerNode = store.createNode({
        title: args.answer as string,
        trigger: 'foundation',
        why: 'Answer to open question',
        understanding: args.explanation as string,
        conversationId,
        toolCallId,
      });

      // Connect answer to question
      const edge = store.createEdge({
        fromId: answerNode.id,
        toId: questionResolved.id,
        type: 'answers',
        explanation: 'answers',
        why: 'Resolves the question',
        conversationId,
        toolCallId,
      });

      return {
        success: true,
        answerId: answerNode.id,
        answerName: answerNode.title,
        questionId: questionResolved.id,
        questionName: questionResolved.title,
        edgeId: edge.id,
        affectedNodeIds: [answerNode.id, questionResolved.id],
        affectedEdgeIds: [edge.id],
        message: `Answered question "${questionResolved.title}" with "${answerNode.title}"`,
        hint: 'The question node remains in the graph with the answer connected to it',
      };
    }

    case 'graph_disconnect': {
      const fromArg = (args.from || args.fromId) as string;
      const toArg = (args.to || args.toId) as string;

      if (!fromArg || !toArg) {
        throw new Error(
          'Must provide both "from" (or "fromId") and "to" (or "toId")',
        );
      }

      const fromResolved = contextManager.resolveNodeWithSuggestions(
        fromArg,
        projectId,
      );
      const toResolved = contextManager.resolveNodeWithSuggestions(
        toArg,
        projectId,
      );

      const store = getGraphStore();
      const edgeType = args.edgeType as string | undefined;

      // Find the edge(s) between these nodes
      const edges = store.getEdgesBetween(fromResolved.id, toResolved.id);

      if (edges.length === 0) {
        throw new Error(
          `No edge found from "${fromResolved.title}" to "${toResolved.title}"`,
        );
      }

      // Filter by type if specified
      const toRemove = edgeType
        ? edges.filter((e) => e.type === edgeType)
        : edges;

      if (toRemove.length === 0) {
        throw new Error(
          `No "${edgeType}" edge found from "${fromResolved.title}" to "${toResolved.title}"`,
        );
      }

      for (const edge of toRemove) {
        rejectGenericDocumentStructureMutation({
          currentType: edge.type,
          authorized: hasAtomicDocumentRewireCapability(args),
        });
      }

      // Archive all matching edges
      for (const edge of toRemove) {
        store.archiveEdge(edge.id, conversationId);
      }

      return {
        success: true,
        from: fromResolved.title,
        to: toResolved.title,
        removedCount: toRemove.length,
        affectedNodeIds: [fromResolved.id, toResolved.id],
        affectedEdgeIds: toRemove.map((edge) => edge.id),
        message: `Removed ${toRemove.length} edge(s) from "${fromResolved.title}" to "${toResolved.title}"`,
      };
    }

    case 'edge_update': {
      const fromResolved = contextManager.resolveNodeWithSuggestions(
        args.from as string,
        projectId,
      );
      const toResolved = contextManager.resolveNodeWithSuggestions(
        args.to as string,
        projectId,
      );

      const store = getGraphStore();
      const newType = args.type as EdgeType | undefined;
      const newExplanation = args.explanation as string | undefined;

      if (!newType && !newExplanation) {
        throw new Error('Must provide either type or explanation to update');
      }

      // Find the edge between these nodes
      const edges = store.getEdgesBetween(fromResolved.id, toResolved.id);

      if (edges.length === 0) {
        throw new Error(
          `No edge found from "${fromResolved.title}" to "${toResolved.title}"`,
        );
      }

      if (edges.length > 1) {
        throw new Error(
          `Multiple edges found from "${fromResolved.title}" to "${toResolved.title}"; edge_update requires an unambiguous endpoint pair.`,
        );
      }

      const edge = edges[0];
      const oldType = edge.type;
      rejectGenericDocumentStructureMutation({
        currentType: oldType,
        requestedType: newType,
        authorized: hasAtomicDocumentRewireCapability(args),
      });

      const updated = store.updateEdge(edge.id, {
        type: newType,
        explanation: newExplanation,
        revisionWhy: newType
          ? `Changed edge type from ${oldType} to ${newType}`
          : 'Updated edge explanation',
        conversationId,
      });

      return {
        success: true,
        id: updated.id,
        from: fromResolved.title,
        to: toResolved.title,
        oldType,
        newType: updated.type,
        affectedNodeIds: [fromResolved.id, toResolved.id],
        affectedEdgeIds: [updated.id],
        message: newType
          ? `Updated edge "${fromResolved.title}" → "${toResolved.title}": ${oldType} → ${newType}`
          : `Updated edge explanation for "${fromResolved.title}" → "${toResolved.title}"`,
      };
    }

    default:
      throw new Error(`Unknown connection tool: ${name}`);
  }
}
