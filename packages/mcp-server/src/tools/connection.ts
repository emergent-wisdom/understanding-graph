import { getGraphStore } from '@emergent-wisdom/understanding-graph-core';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ContextManager } from '../context-manager.js';

export const connectionTools: Tool[] = [
  {
    name: 'graph_connect',
    description: `Create edge between nodes.

COGNITIVE PURPOSE: Edges are thinking scaffolds, not metadata. Only create an edge if it helps future agents reason better. Ask: "When thinking about X, should I also consider Y?" If yes, explain WHY in the relation field.

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
            'How these concepts relate (e.g., "enables", "depends on", "contradicts")',
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

EPISTEMIC (for learning trails):
- "learned_from" - cognitive lineage: "I understood X by studying Y"
  Use to mark which concepts/sources led to understanding another.
  Creates visible learning trails in the graph.

PREDICTIVE (for forecasts):
- "validates" - later evidence confirms a prediction was correct
- "invalidates" - later evidence refutes a prediction`,
          enum: [
            'relates',
            'next',
            'contains',
            'expresses',
            'supersedes',
            'contradicts',
            'diverse_from',
            'refines',
            'implements',
            'abstracts_from',
            'contextualizes',
            'questions',
            'answers',
            'learned_from',
            'validates',
            'invalidates',
          ],
        },
        project: {
          type: 'string',
          description: 'Project ID (optional)',
        },
      },
      required: ['from', 'to', 'relation'],
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
          enum: [
            'relates',
            'next',
            'contains',
            'expresses',
            'supersedes',
            'contradicts',
            'diverse_from',
            'refines',
            'implements',
            'abstracts_from',
            'contextualizes',
            'questions',
            'answers',
            'learned_from',
            'validates',
            'invalidates',
          ],
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
          enum: [
            'relates',
            'next',
            'contains',
            'expresses',
            'supersedes',
            'contradicts',
            'diverse_from',
            'refines',
            'implements',
            'abstracts_from',
            'contextualizes',
            'questions',
            'answers',
            'learned_from',
            'validates',
            'invalidates',
          ],
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
      const edge = store.createEdge({
        fromId: fromResolved.id,
        toId: toResolved.id,
        type: (args.type as string) || 'relates',
        explanation: args.relation as string,
        why: args.why as string | undefined,
        conversationId,
        toolCallId,
      });

      return {
        success: true,
        id: edge.id,
        from: fromResolved.title,
        to: toResolved.title,
        relation: args.relation,
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

      // Archive all matching edges
      for (const edge of toRemove) {
        store.archiveEdge(edge.id, conversationId);
      }

      return {
        success: true,
        from: fromResolved.title,
        to: toResolved.title,
        removedCount: toRemove.length,
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
      const newType = args.type as string | undefined;
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

      // Update the first edge (or we could require specifying which one)
      const edge = edges[0];
      const oldType = edge.type;

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
        message: newType
          ? `Updated edge "${fromResolved.title}" → "${toResolved.title}": ${oldType} → ${newType}`
          : `Updated edge explanation for "${fromResolved.title}" → "${toResolved.title}"`,
      };
    }

    default:
      throw new Error(`Unknown connection tool: ${name}`);
  }
}
