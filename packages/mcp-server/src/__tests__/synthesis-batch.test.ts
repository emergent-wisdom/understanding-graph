import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  getGraphStore,
  resetGraphStore,
  sqlite,
} from '@emergent-wisdom/understanding-graph-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ContextManager } from '../context-manager.js';
import { BATCH_OPERATION_TOOLS } from '../tools/batch.js';
import {
  getToolDefinitions,
  handleToolCall,
  TOOL_MODES,
} from '../tools/index.js';

let tmpDir: string;
let contextManager: ContextManager;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ug-synthesis-batch-'));
  const projectDir = path.join(tmpDir, 'projects');
  fs.mkdirSync(path.join(projectDir, 'synthesis-test'), { recursive: true });

  contextManager = new ContextManager();
  contextManager.setProjectDir(projectDir);
  sqlite.initAllDatabases(projectDir);
  if (!sqlite.getLoadedProjectIds().includes('synthesis-test')) {
    sqlite.initDatabase(path.join(projectDir, 'synthesis-test'));
  }
  sqlite.setCurrentProject('synthesis-test');
  await contextManager.switchProject('synthesis-test');
});

afterEach(() => {
  try {
    sqlite.closeAllDatabases();
  } catch {
    // Ignore cleanup after a failed fixture.
  }
  resetGraphStore();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function seedOptions() {
  const store = getGraphStore();
  const optionA = store.createNode({
    title: 'Option A',
    trigger: 'foundation',
    understanding: 'A cautious implementation path.',
    why: 'Provides one grounded synthesis source and decision option.',
  });
  const optionB = store.createNode({
    title: 'Option B',
    trigger: 'foundation',
    understanding: 'A faster but more speculative implementation path.',
    why: 'Provides a contrasting synthesis source and decision option.',
  });
  store.createEdge({
    fromId: optionB.id,
    toId: optionA.id,
    type: 'diverse_from',
    explanation: 'Contrasting implementation paths',
    why: 'The options trade speed against caution.',
  });
  return { optionA, optionB };
}

describe('batch-only synthesis mutations', () => {
  it('rejects top-level synthesis mutations and advertises them only as batch operations', async () => {
    const mutationTools = [
      'graph_serendipity',
      'graph_validate',
      'graph_decide',
    ];

    for (const mode of TOOL_MODES) {
      const advertised = new Set(
        getToolDefinitions(mode).map((definition) => definition.name),
      );
      for (const tool of mutationTools) {
        expect(advertised.has(tool), `${tool} leaked into ${mode}`).toBe(false);
      }
    }
    expect(BATCH_OPERATION_TOOLS).toEqual(
      expect.arrayContaining(mutationTools),
    );

    for (const tool of mutationTools) {
      await expect(
        handleToolCall(tool, {}, contextManager, 'full'),
      ).rejects.toThrow('not available in TOOL_MODE "full"');
    }
    expect(getGraphStore().getAll().nodes).toHaveLength(0);
    expect(getGraphStore().getAll().edges).toHaveLength(0);
  });

  it('commits serendipity, validation, and a typed decision with all source and option edges', async () => {
    const { optionA, optionB } = seedOptions();

    const result = (await handleToolCall(
      'graph_batch',
      {
        commit_message:
          'Preserve and validate a synthesis, then choose an option',
        agent_name: 'Tester',
        ignoreWarnings: true,
        operations: [
          {
            tool: 'graph_serendipity',
            params: {
              name: 'Cautious speed',
              synthesis:
                'Stage the fast path behind the cautious path’s verification boundary.',
              source_elements: [optionA.id, optionB.id],
              why: 'Combines the strongest constraint from each option.',
            },
          },
          {
            tool: 'graph_validate',
            params: {
              node: '$0.id',
              insight: 'The staged boundary is implementable and testable.',
            },
          },
          {
            tool: 'graph_decide',
            params: {
              question: 'Which implementation path should we take?',
              options: [optionA.id, optionB.id],
              chosen: optionA.id,
              reasoning:
                'Choose the cautious path first and preserve the faster path as context.',
            },
          },
        ],
      },
      contextManager,
    )) as {
      success: boolean;
      results: Array<Record<string, unknown>>;
      commit?: { id: string };
    };

    expect(result.success).toBe(true);
    expect(result.commit?.id).toMatch(/^c_/);
    const serendipityId = result.results[0].id as string;
    const decisionId = result.results[2].id as string;
    const graph = getGraphStore().getAll();
    const serendipity = graph.nodes.find((node) => node.id === serendipityId);
    const decision = graph.nodes.find((node) => node.id === decisionId);

    expect(serendipity).toMatchObject({
      trigger: 'serendipity',
      validated: true,
      sourceElements: [optionA.id, optionB.id],
    });
    expect(decision?.trigger).toBe('decision');

    const synthesisEdges = graph.edges.filter(
      (edge) => edge.fromId === serendipityId,
    );
    expect(synthesisEdges).toHaveLength(2);
    expect(synthesisEdges.map((edge) => edge.toId).sort()).toEqual(
      [optionA.id, optionB.id].sort(),
    );
    expect(synthesisEdges.every((edge) => edge.type === 'learned_from')).toBe(
      true,
    );

    const decisionEdges = graph.edges.filter(
      (edge) => edge.fromId === decisionId,
    );
    expect(decisionEdges).toHaveLength(2);
    expect(decisionEdges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          toId: optionA.id,
          type: 'implements',
        }),
        expect.objectContaining({
          toId: optionB.id,
          type: 'contextualizes',
        }),
      ]),
    );
    expect(
      [...synthesisEdges, ...decisionEdges].every(
        (edge) => typeof edge.why === 'string' && edge.why.length >= 3,
      ),
    ).toBe(true);
    expect(
      graph.edges.some((edge) =>
        ['chosen as', 'considered for'].includes(edge.type),
      ),
    ).toBe(false);

    for (const nodeId of [serendipityId, decisionId]) {
      expect(
        graph.edges.some(
          (edge) => edge.fromId === nodeId || edge.toId === nodeId,
        ),
      ).toBe(true);
    }

    const commitRow = sqlite
      .getDb()
      .prepare('SELECT node_ids, edge_ids FROM commits WHERE id = ?')
      .get(result.commit?.id) as { node_ids: string; edge_ids: string };
    expect(JSON.parse(commitRow.node_ids)).toEqual(
      expect.arrayContaining([serendipityId, decisionId]),
    );
    expect(JSON.parse(commitRow.edge_ids)).toEqual(
      expect.arrayContaining(
        [...synthesisEdges, ...decisionEdges].map((edge) => edge.id),
      ),
    );
  });

  it('rolls back an earlier synthesis and its edges when a later decision fails', async () => {
    const { optionA, optionB } = seedOptions();
    const before = getGraphStore().getAll();

    const result = (await handleToolCall(
      'graph_batch',
      {
        commit_message:
          'This invalid decision must roll back its sibling synthesis',
        agent_name: 'Tester',
        ignoreWarnings: true,
        operations: [
          {
            tool: 'graph_serendipity',
            params: {
              name: 'Rollback synthesis',
              synthesis: 'This provisional synthesis must not survive.',
              source_elements: [optionA.id, optionB.id],
              why: 'Exercises all-or-nothing synthesis mutation.',
            },
          },
          {
            tool: 'graph_decide',
            params: {
              question: 'Invalid choice',
              options: [optionA.id],
              chosen: optionB.id,
              reasoning: 'The chosen node is deliberately absent from options.',
            },
          },
        ],
      },
      contextManager,
    )) as {
      success: boolean;
      errors?: Array<{ error: string }>;
    };

    expect(result.success).toBe(false);
    expect(result.errors?.[0]?.error).toContain('not in the options list');
    const after = getGraphStore().getAll();
    expect(after.nodes).toHaveLength(before.nodes.length);
    expect(after.edges).toHaveLength(before.edges.length);
    expect(
      after.nodes.some((node) => node.title === 'Rollback synthesis'),
    ).toBe(false);
    const commitCount = sqlite
      .getDb()
      .prepare('SELECT COUNT(*) AS count FROM commits')
      .get() as { count: number };
    expect(commitCount.count).toBe(0);
  });
});
