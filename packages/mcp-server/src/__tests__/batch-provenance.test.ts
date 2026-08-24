import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  getGraphStore,
  resetGraphStore,
  sqlite,
} from '@emergent-wisdom/understanding-graph-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContextManager } from '../context-manager.js';
import { handleToolCall } from '../tools/index.js';

const PROJECT_ID = 'batch-provenance';
let temporaryDirectory: string;
let contextManager: ContextManager;

beforeEach(async () => {
  temporaryDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'ug-batch-provenance-'),
  );
  const projectDirectory = path.join(temporaryDirectory, 'projects');
  fs.mkdirSync(path.join(projectDirectory, PROJECT_ID), { recursive: true });

  contextManager = new ContextManager();
  contextManager.setProjectDir(projectDirectory);
  sqlite.initAllDatabases(projectDirectory);
  if (!sqlite.getLoadedProjectIds().includes(PROJECT_ID)) {
    sqlite.initDatabase(path.join(projectDirectory, PROJECT_ID));
  }
  sqlite.setCurrentProject(PROJECT_ID);
  await contextManager.switchProject(PROJECT_ID);
  vi.spyOn(getGraphStore(), 'generateAndStoreEmbedding').mockResolvedValue();
});

afterEach(() => {
  try {
    sqlite.closeAllDatabases();
  } catch {
    // Ignore cleanup after a failed assertion.
  }
  resetGraphStore();
  vi.restoreAllMocks();
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

describe('graph_batch provenance footprint', () => {
  it('attributes relation mutations once and re-enters every visible endpoint', async () => {
    const store = getGraphStore();
    const connectFrom = store.createNode({
      title: 'Connection source',
      trigger: 'foundation',
      why: 'Fixture for a new relation.',
      understanding: 'A source whose new relation should become visible.',
    });
    const connectTo = store.createNode({
      title: 'Connection target',
      trigger: 'analysis',
      why: 'Fixture for a new relation.',
      understanding: 'A target whose new relation should become visible.',
    });
    const relationFrom = store.createNode({
      title: 'Mutable relation source',
      trigger: 'model',
      why: 'Fixture for relation revision and removal.',
      understanding: 'The source side of a relation whose meaning changes.',
    });
    const relationTo = store.createNode({
      title: 'Mutable relation target',
      trigger: 'hypothesis',
      why: 'Fixture for relation revision and removal.',
      understanding: 'The target side of a relation whose meaning changes.',
    });
    const mutableEdge = store.createEdge({
      fromId: relationFrom.id,
      toId: relationTo.id,
      type: 'relates',
      why: 'The initial relation is deliberately weak.',
    });
    const question = store.createNode({
      title: 'Which mechanism survives?',
      trigger: 'question',
      why: 'Fixture for graph_answer provenance.',
      understanding:
        'An answer should remain tied to the question it resolves.',
    });
    const concept = store.createNode({
      title: 'Rendered mechanism',
      trigger: 'model',
      why: 'Fixture for document/concept provenance.',
      understanding: 'A document will render this mechanism.',
    });
    const documentNode = store.createNode({
      title: 'Mechanism passage',
      content: 'The mechanism appears here in executable detail.',
      isDocRoot: true,
      level: 'document',
      fileType: 'md',
    });

    const result = (await handleToolCall(
      'graph_batch',
      {
        workflow: 'writing',
        author: '@authenticated',
        agent_name: 'provenance-test-agent',
        commit_message:
          'Exercise relation provenance and return its endpoints to attention',
        ignoreWarnings: true,
        operations: [
          {
            tool: 'graph_connect',
            params: {
              from: connectFrom.id,
              to: connectTo.id,
              type: 'refines',
              why: 'The target makes the source more precise.',
            },
          },
          {
            tool: 'edge_update',
            params: {
              from: relationFrom.id,
              to: relationTo.id,
              type: 'contradicts',
              explanation: 'The relation now records resistance.',
            },
          },
          {
            tool: 'graph_disconnect',
            params: {
              from: relationFrom.id,
              to: relationTo.id,
              edgeType: 'contradicts',
            },
          },
          {
            tool: 'graph_answer',
            params: {
              question: question.id,
              answer: 'The observable mechanism',
              explanation: 'Runtime evidence distinguishes it.',
            },
          },
          {
            tool: 'doc_link_concept',
            params: {
              docNodeId: documentNode.id,
              conceptId: concept.id,
            },
          },
          {
            tool: 'node_set_metadata',
            params: {
              node: concept.id,
              metadata: { reviewState: 'ready' },
            },
          },
        ],
      },
      contextManager,
      'full',
    )) as {
      success: boolean;
      results: Array<{
        id?: string;
        edgeId?: string;
        answerId?: string;
        commit?: unknown;
        affectedNodeIds: string[];
        affectedEdgeIds: string[];
      }>;
      navigation?: {
        focusNodeIds: string[];
        suggestedCall: {
          arguments: { workflow: string; focusNodeIds: string[] };
        };
      };
      understandingMode?: {
        protocol: string;
        mode: string;
        moment: string;
        evidence: Record<string, unknown>;
      };
    };

    expect(result.success).toBe(true);
    expect(result.results).toHaveLength(6);

    const expectedEndpoints = [
      [connectFrom.id, connectTo.id],
      [relationFrom.id, relationTo.id],
      [relationFrom.id, relationTo.id],
      [question.id],
      [documentNode.id, concept.id],
      [concept.id],
    ];
    for (const [index, expectedNodeIds] of expectedEndpoints.entries()) {
      const operationResult = result.results[index];
      expect(operationResult.affectedNodeIds).toEqual(
        expect.arrayContaining(expectedNodeIds),
      );
      expect(
        operationResult.affectedNodeIds.length +
          operationResult.affectedEdgeIds.length,
      ).toBeGreaterThan(0);
    }
    expect(result.results[3]?.affectedNodeIds).toContain(
      result.results[3]?.answerId,
    );
    expect(result.results[5]).not.toHaveProperty('commit');

    const commits = sqlite
      .getDb()
      .prepare(
        'SELECT author, agent_name, node_ids, edge_ids FROM commits ORDER BY created_at',
      )
      .all() as Array<{
      author: string | null;
      agent_name: string | null;
      node_ids: string;
      edge_ids: string;
    }>;
    expect(commits).toHaveLength(1);
    expect(commits[0]).toMatchObject({
      author: '@authenticated',
      agent_name: 'provenance-test-agent',
    });
    expect(JSON.parse(commits[0].node_ids)).toEqual(
      expect.arrayContaining([
        connectFrom.id,
        connectTo.id,
        relationFrom.id,
        relationTo.id,
        question.id,
        documentNode.id,
        concept.id,
        result.results[3]?.answerId,
      ]),
    );
    expect(JSON.parse(commits[0].edge_ids)).toEqual(
      expect.arrayContaining([
        result.results[0]?.id,
        mutableEdge.id,
        result.results[3]?.edgeId,
        result.results[4]?.edgeId,
      ]),
    );

    expect(result.navigation?.focusNodeIds).toEqual(
      expect.arrayContaining([
        connectFrom.id,
        connectTo.id,
        relationFrom.id,
        relationTo.id,
        question.id,
        documentNode.id,
        concept.id,
        result.results[3]?.answerId,
      ]),
    );
    expect(result.navigation?.suggestedCall).toMatchObject({
      tool: 'graph_suggest_next',
      arguments: {
        workflow: 'writing',
        focusNodeIds: result.navigation?.focusNodeIds,
      },
    });
    expect(result.understandingMode).toMatchObject({
      protocol: 'fluid-understanding-v1',
      mode: 'understanding',
      moment: 'committed',
      evidence: {
        workflow: 'writing',
        reentryFocusNodeIds: result.navigation?.focusNodeIds,
      },
    });
    expect(store.getNode(concept.id)?.metadata).toEqual({
      reviewState: 'ready',
    });
  });

  it('returns re-entry focus without ambient next-move aid in direct mode', async () => {
    const result = (await handleToolCall(
      'graph_batch',
      {
        workflow: 'general',
        agent_name: 'direct-mode-test',
        commit_message: 'Create a directly navigable graph artifact',
        operations: [
          {
            tool: 'doc_create',
            params: {
              title: 'Direct artifact',
              content: 'The agent chose this operation without a chooser.',
              isDocRoot: true,
              level: 'document',
            },
          },
        ],
      },
      contextManager,
      'full',
      false,
      'direct',
    )) as {
      success: boolean;
      navigation?: Record<string, unknown>;
      understandingMode?: Record<string, unknown>;
    };

    expect(result.success).toBe(true);
    expect(result.navigation?.focusNodeIds).toEqual([
      expect.stringMatching(/^n_/),
    ]);
    expect(result.navigation).not.toHaveProperty('suggestedCall');
    expect(result.navigation).not.toHaveProperty('guidance');
    expect(result.understandingMode).toMatchObject({
      mode: 'understanding',
      moment: 'committed',
    });
  });

  it('rejects an unknown re-entry workflow before changing the graph', async () => {
    const result = (await handleToolCall(
      'graph_batch',
      {
        workflow: 'storytelling',
        commit_message: 'This invalid workflow must not land',
        operations: [
          {
            tool: 'doc_create',
            params: {
              title: 'Must not exist',
              content: 'No mutation should occur.',
              isDocRoot: true,
              level: 'document',
            },
          },
        ],
      },
      contextManager,
      'full',
    )) as { success: boolean; error?: string };

    expect(result).toMatchObject({
      success: false,
      error: 'INVALID_BATCH_WORKFLOW',
    });
    expect(getGraphStore().getAll().nodes).toHaveLength(0);
    expect(
      (
        sqlite
          .getDb()
          .prepare('SELECT COUNT(*) AS count FROM commits')
          .get() as { count: number }
      ).count,
    ).toBe(0);
  });
});
