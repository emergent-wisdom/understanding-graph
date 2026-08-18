import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  getGraphStore,
  sqlite,
} from '@emergent-wisdom/understanding-graph-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ContextManager } from '../context-manager.js';
import { handleToolCall } from '../tools/index.js';

// These tests cover the graph_batch atomicity guarantee documented in the
// understanding-graph paper as "Atomic Commits". The handler wraps the
// entire batch (operation loop + post-execution orphan sweep + commit
// record creation) in a SQLite transaction. A mid-batch failure must
// leave the graph in EXACTLY the state it was in before the batch ran.
//
// The batch handler talks to a single per-process project store. We point
// it at a fresh tmpdir per test so the assertions are isolated.

let tmpDir: string;
let contextManager: ContextManager;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ug-atomicity-'));
  fs.mkdirSync(path.join(tmpDir, 'projects', 'atomicity'), { recursive: true });

  contextManager = new ContextManager();
  contextManager.setProjectDir(path.join(tmpDir, 'projects'));
  sqlite.initAllDatabases(path.join(tmpDir, 'projects'));
  // Bootstrap the project the same way the production server does
  if (!sqlite.getLoadedProjectIds().includes('atomicity')) {
    sqlite.initDatabase(path.join(tmpDir, 'projects', 'atomicity'));
  }
  sqlite.setCurrentProject('atomicity');
  await contextManager.switchProject('atomicity');
});

afterEach(() => {
  try {
    sqlite.closeAllDatabases();
  } catch {
    // Some closes throw if the connection is already gone
  }
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

describe('graph_batch atomicity', () => {
  it('rejects oversized batches before any operation can mutate the graph', async () => {
    const result = (await handleToolCall(
      'graph_batch',
      {
        commit_message: 'This oversized batch must never begin',
        operations: Array.from({ length: 101 }, (_, index) => ({
          tool: 'graph_add_concept',
          params: {
            title: `Oversized ${index}`,
            trigger: 'analysis',
            understanding: 'Must not persist.',
            why: 'Capacity boundary test.',
          },
        })),
      },
      contextManager,
    )) as { success: boolean; error?: string };

    expect(result).toMatchObject({
      success: false,
      error: 'BATCH_OPERATION_LIMIT_EXCEEDED',
    });
    expect(getGraphStore().getAll().nodes).toEqual([]);
    expect(sqlite.getRecentCommits(10)).toEqual([]);
  });

  it('rejects nested project overrides before either project can change', async () => {
    const projectsDir = path.join(tmpDir, 'projects');
    const secondProject = 'atomicity-other';
    fs.mkdirSync(path.join(projectsDir, secondProject), { recursive: true });
    sqlite.initDatabase(path.join(projectsDir, secondProject));
    sqlite.setCurrentProject('atomicity');
    await contextManager.switchProject('atomicity');

    const result = (await handleToolCall(
      'graph_batch',
      {
        commit_message: 'A batch must never cross project transactions',
        operations: [
          {
            tool: 'doc_create',
            params: {
              project: secondProject,
              title: 'Cross-project partial write marker',
              content: 'This must not land in either database.',
              isDocRoot: true,
            },
          },
        ],
      },
      contextManager,
    )) as { success: boolean; error?: string };

    expect(result).toMatchObject({
      success: false,
      error: 'BATCH_PROJECT_OVERRIDE_NOT_ALLOWED',
    });
    for (const projectId of ['atomicity', secondProject]) {
      expect(
        (
          sqlite
            .getDb(projectId)
            .prepare('SELECT COUNT(*) AS count FROM nodes')
            .get() as { count: number }
        ).count,
      ).toBe(0);
      expect(
        (
          sqlite
            .getDb(projectId)
            .prepare('SELECT COUNT(*) AS count FROM commits')
            .get() as { count: number }
        ).count,
      ).toBe(0);
    }
    expect(contextManager.getCurrentProjectId()).toBe('atomicity');
  });

  it('rejects an invented edge type on update without revising the edge or creating a commit', async () => {
    const store = getGraphStore();
    const from = store.createNode({
      title: 'Stable source',
      trigger: 'foundation',
      understanding: 'The source side of a persisted relation.',
      why: 'Seeds the edge-update boundary test.',
    });
    const to = store.createNode({
      title: 'Stable target',
      trigger: 'analysis',
      understanding: 'The target side of a persisted relation.',
      why: 'Seeds the edge-update boundary test.',
    });
    const edge = store.createEdge({
      fromId: from.id,
      toId: to.id,
      type: 'refines',
      explanation: 'Original explanation',
      why: 'The target gives the source greater precision.',
    });
    const eventCountBefore = (
      sqlite
        .getDb()
        .prepare('SELECT COUNT(*) AS count FROM event_log')
        .get() as { count: number }
    ).count;

    // Raw batch dispatch bypasses the advertised JSON Schema, so the core
    // persistence boundary must still reject this invented relation type.
    const result = (await handleToolCall(
      'graph_batch',
      {
        commit_message: 'An invalid edge update must never land',
        agent_name: 'Tester',
        ignoreWarnings: true,
        operations: [
          {
            tool: 'edge_update',
            params: {
              from: from.id,
              to: to.id,
              explanation: 'Provisional explanation that must roll back',
            },
          },
          {
            tool: 'edge_update',
            params: {
              from: from.id,
              to: to.id,
              type: 'chosen_as',
            },
          },
        ],
      },
      contextManager,
    )) as {
      success: boolean;
      completed: number;
      errors?: Array<{ error: string }>;
    };

    expect(result.success).toBe(false);
    expect(result.completed).toBe(1);
    expect(result.errors?.[0]?.error).toContain(
      'Invalid edge type: "chosen_as"',
    );
    expect(store.getEdge(edge.id)).toMatchObject({
      type: 'refines',
      explanation: 'Original explanation',
      version: 1,
      revisions: [],
    });
    expect(
      (
        sqlite
          .getDb()
          .prepare('SELECT COUNT(*) AS count FROM event_log')
          .get() as { count: number }
      ).count,
    ).toBe(eventCountBefore);
    expect(
      (
        sqlite
          .getDb()
          .prepare('SELECT COUNT(*) AS count FROM commits')
          .get() as { count: number }
      ).count,
    ).toBe(0);
  });

  it('rolls back a batch when graph_connect attempts a self-loop', async () => {
    const store = getGraphStore();
    const from = store.createNode({
      title: 'Self-loop source',
      trigger: 'foundation',
      understanding: 'A stable source for the batch rollback test.',
      why: 'Seeds a valid edge before the invalid self-loop operation.',
    });
    const to = store.createNode({
      title: 'Self-loop target',
      trigger: 'analysis',
      understanding: 'A distinct target for the stable relation.',
      why: 'Keeps the seed graph valid and connected.',
    });
    const edge = store.createEdge({
      fromId: from.id,
      toId: to.id,
      type: 'refines',
      explanation: 'Stable explanation',
      why: 'The target gives the source greater precision.',
    });
    const eventCountBefore = (
      sqlite
        .getDb()
        .prepare('SELECT COUNT(*) AS count FROM event_log')
        .get() as { count: number }
    ).count;

    const result = (await handleToolCall(
      'graph_batch',
      {
        commit_message: 'A self-loop must roll back the whole batch',
        agent_name: 'Tester',
        ignoreWarnings: true,
        operations: [
          {
            tool: 'edge_update',
            params: {
              from: from.id,
              to: to.id,
              explanation: 'Provisional explanation that must roll back',
            },
          },
          {
            tool: 'graph_connect',
            params: {
              from: from.id,
              to: from.id,
              type: 'relates',
              why: 'This invalid self-loop must fail the atomic batch.',
            },
          },
        ],
      },
      contextManager,
    )) as {
      success: boolean;
      completed: number;
      errors?: Array<{ error: string }>;
    };

    expect(result.success).toBe(false);
    expect(result.completed).toBe(1);
    expect(result.errors?.[0]?.error).toContain(
      'Self-loop edges are not allowed',
    );
    expect(store.getEdge(edge.id)).toMatchObject({
      type: 'refines',
      explanation: 'Stable explanation',
      version: 1,
      revisions: [],
    });
    expect(
      (
        sqlite.getDb().prepare('SELECT COUNT(*) AS count FROM edges').get() as {
          count: number;
        }
      ).count,
    ).toBe(1);
    expect(
      (
        sqlite
          .getDb()
          .prepare('SELECT COUNT(*) AS count FROM event_log')
          .get() as { count: number }
      ).count,
    ).toBe(eventCountBefore);
    expect(
      (
        sqlite
          .getDb()
          .prepare('SELECT COUNT(*) AS count FROM commits')
          .get() as { count: number }
      ).count,
    ).toBe(0);
  });

  it('does not tunnel focused modes into arbitrary routed tools', async () => {
    const result = (await handleToolCall(
      'graph_batch',
      {
        commit_message: 'an internal batch flag must not bypass mode policy',
        operations: [
          {
            tool: 'solver_spawn',
            params: {
              name: 'ForbiddenTunnel',
              role: 'creative',
              manifest: 'This solver must never be registered.',
            },
          },
        ],
      },
      contextManager,
      'reading',
    )) as { success: boolean; error: string; allowedTools: string[] };

    expect(result).toMatchObject({
      success: false,
      error: 'BATCH_OPERATION_NOT_ALLOWED',
    });
    expect(result.allowedTools).not.toContain('solver_spawn');
    const solverCount = sqlite
      .getDb()
      .prepare(
        "SELECT COUNT(*) AS count FROM solvers WHERE name = 'ForbiddenTunnel'",
      )
      .get() as { count: number };
    expect(solverCount.count).toBe(0);
  });

  it('rolls back when a nested handler explicitly returns success false', async () => {
    const result = (await handleToolCall(
      'graph_batch',
      {
        commit_message: 'must roll back a structured nested failure',
        agent_name: 'Tester',
        operations: [
          {
            tool: 'graph_add_concept',
            params: {
              title: 'Structured Failure A',
              trigger: 'foundation',
              understanding: 'This successful mutation must not survive.',
              why: 'Exercises rollback after a later soft failure.',
              skipDuplicateCheck: true,
            },
          },
          {
            tool: 'graph_add_concept',
            params: {
              title: 'Structured Failure B',
              trigger: 'question',
              understanding: 'Provides a valid connection for pre-validation.',
              why: 'Lets execution reach the malformed operation.',
              skipDuplicateCheck: true,
            },
          },
          {
            tool: 'graph_connect',
            params: {
              from: '$0.id',
              to: '$1.id',
              type: 'questions',
              why: 'Keeps both new nodes connected before the failure.',
            },
          },
          {
            tool: 'graph_connect',
            params: {
              from: '$0.id',
              type: 'relates',
              why: 'Missing to returns a structured MISSING_PARAMETER failure.',
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
    expect(result.errors?.[0]?.error).toContain('MISSING_PARAMETER');
    expect(getGraphStore().getAll().nodes).toHaveLength(0);
    expect(getGraphStore().getAll().edges).toHaveLength(0);

    const commitCount = sqlite
      .getDb()
      .prepare('SELECT COUNT(*) AS count FROM commits')
      .get() as { count: number };
    expect(commitCount.count).toBe(0);
  });

  it('collects later errors without weakening atomicity when stopOnError is false', async () => {
    const result = (await handleToolCall(
      'graph_batch',
      {
        commit_message: 'collect failures but never land a partial commit',
        agent_name: 'Tester',
        stopOnError: false,
        ignoreWarnings: true,
        operations: [
          {
            tool: 'graph_add_concept',
            params: {
              title: 'Provisional A',
              trigger: 'foundation',
              understanding: 'Must disappear when any sibling operation fails.',
              why: 'Exercises all-or-nothing behavior while collecting errors.',
              skipDuplicateCheck: true,
            },
          },
          {
            tool: 'graph_add_concept',
            params: {
              title: 'Provisional B',
              trigger: 'question',
              understanding:
                'Also remains provisional until the full batch succeeds.',
              why: 'Provides a valid connected pair.',
              skipDuplicateCheck: true,
            },
          },
          {
            tool: 'graph_connect',
            params: {
              from: '$0.id',
              to: '$1.id',
              type: 'questions',
              why: 'Keeps the two provisional concepts connected.',
            },
          },
          {
            tool: 'graph_connect',
            params: {
              from: '$0.id',
              type: 'relates',
              why: 'Missing to is collected instead of stopping immediately.',
            },
          },
          {
            tool: 'graph_connect',
            params: {
              from: '$1.id',
              to: '$0.id',
              type: 'answers',
              why: 'Proves execution continued after the collected failure.',
            },
          },
        ],
      },
      contextManager,
    )) as {
      success: boolean;
      completed: number;
      results: unknown[];
      errors?: Array<{ error: string }>;
      message?: string;
    };

    expect(result.success).toBe(false);
    expect(result.completed).toBe(5);
    expect(result.results).toHaveLength(5);
    expect(result.errors?.[0]?.error).toContain('MISSING_PARAMETER');
    expect(result.message).toContain('Entire batch rolled back');
    expect(getGraphStore().getAll().nodes).toHaveLength(0);
    expect(getGraphStore().getAll().edges).toHaveLength(0);

    const commitCount = sqlite
      .getDb()
      .prepare('SELECT COUNT(*) AS count FROM commits')
      .get() as { count: number };
    expect(commitCount.count).toBe(0);
  });

  it('rolls back ALL prior ops when a later op throws (stopOnError: true)', async () => {
    // Seed two connected nodes so the graph is non-empty.
    await handleToolCall(
      'graph_batch',
      {
        commit_message: 'seed foundation',
        agent_name: 'Tester',
        operations: [
          {
            tool: 'graph_add_concept',
            params: {
              title: 'Existing Foundation',
              trigger: 'foundation',
              understanding: 'Anchors the test graph.',
              why: 'Needed so the next batch is not against an empty graph.',
              skipDuplicateCheck: true,
            },
          },
          {
            tool: 'graph_add_concept',
            params: {
              title: 'Open Question About Atomicity',
              trigger: 'question',
              understanding:
                'What happens when a batch operation fails mid-way?',
              why: 'Drives the atomicity test.',
              skipDuplicateCheck: true,
            },
          },
          {
            tool: 'graph_connect',
            params: {
              from: '$0.id',
              to: '$1.id',
              type: 'questions',
              why: 'The question challenges the foundation.',
            },
          },
        ],
      },
      contextManager,
    );

    const beforeNodes = getGraphStore().getAll().nodes.length;
    const beforeEdges = getGraphStore().getAll().edges.length;

    // Now run a batch with FOUR ops, the LAST of which is invalid (uses an
    // edge type that doesn't exist). The first three should be rolled back.
    const result = (await handleToolCall(
      'graph_batch',
      {
        commit_message: 'should be fully rolled back',
        agent_name: 'Tester',
        operations: [
          {
            tool: 'graph_add_concept',
            params: {
              title: 'Concept A (should not survive)',
              trigger: 'tension',
              understanding: 'A tension that shows up briefly then vanishes.',
              why: 'Will be rolled back when the bad edge type fails the batch.',
            },
          },
          {
            tool: 'graph_add_concept',
            params: {
              title: 'Concept B (should not survive)',
              trigger: 'decision',
              understanding: 'A decision that resolves the tension.',
              why: 'Will be rolled back along with the tension above.',
            },
          },
          {
            tool: 'graph_connect',
            params: {
              from: 'Concept B (should not survive)',
              to: 'Concept A (should not survive)',
              type: 'answers',
              why: 'The decision answers the tension.',
            },
          },
          {
            tool: 'graph_connect',
            params: {
              from: 'Concept B (should not survive)',
              to: 'Existing Foundation',
              // INVALID edge type — guaranteed to throw at the runtime
              // edge handler. Picked because it's the kind of typo a real
              // agent could make.
              type: 'totally-not-a-real-edge-type',
              why: 'Should make the batch fail and roll back the prior ops.',
            },
          },
        ],
      },
      contextManager,
    )) as Record<string, unknown>;

    expect(result.success).toBe(false);

    // The graph should be IDENTICAL to its pre-batch state. Same node count,
    // same edge count, no traces of "Concept A" or "Concept B".
    const afterNodes = getGraphStore().getAll().nodes;
    const afterEdges = getGraphStore().getAll().edges;
    expect(afterNodes.length).toBe(beforeNodes);
    expect(afterEdges.length).toBe(beforeEdges);
    const titles = afterNodes.map((n) => (n as { title?: string }).title);
    expect(titles).not.toContain('Concept A (should not survive)');
    expect(titles).not.toContain('Concept B (should not survive)');
  });

  it('persists everything when the batch succeeds', async () => {
    const result = (await handleToolCall(
      'graph_batch',
      {
        commit_message: 'should fully persist',
        agent_name: 'Tester',
        operations: [
          {
            tool: 'graph_add_concept',
            params: {
              title: 'Survivor A',
              trigger: 'foundation',
              understanding: 'Anchors the success-path test.',
              why: 'Should be present after the batch commits.',
            },
          },
          {
            tool: 'graph_add_concept',
            params: {
              title: 'Survivor B',
              trigger: 'decision',
              understanding: 'A decision built on Survivor A.',
              why: 'Should be present and connected after commit.',
            },
          },
          {
            tool: 'graph_connect',
            params: {
              from: 'Survivor B',
              to: 'Survivor A',
              type: 'refines',
              why: 'B refines A; valid edge that should land in the graph.',
            },
          },
        ],
      },
      contextManager,
    )) as Record<string, unknown>;

    expect(result.success).toBe(true);

    const titles = getGraphStore()
      .getAll()
      .nodes.map((n) => (n as { title?: string }).title);
    expect(titles).toContain('Survivor A');
    expect(titles).toContain('Survivor B');
  });

  it('routes graph_archive inside a batch and rolls it back with a later failure', async () => {
    const seeded = (await handleToolCall(
      'graph_batch',
      {
        commit_message: 'seed connected archive targets',
        agent_name: 'Tester',
        ignoreWarnings: true,
        operations: [
          {
            tool: 'graph_add_concept',
            params: {
              title: 'Archive Anchor',
              trigger: 'foundation',
              understanding: 'Keeps both archive targets connected.',
              why: 'Anchors the routing and rollback test.',
              skipDuplicateCheck: true,
            },
          },
          {
            tool: 'graph_add_concept',
            params: {
              title: 'Successful Archive Target',
              trigger: 'analysis',
              understanding:
                'This node should be archived by a committed batch.',
              why: 'Exercises the successful nested route.',
              skipDuplicateCheck: true,
            },
          },
          {
            tool: 'graph_add_concept',
            params: {
              title: 'Rollback Archive Target',
              trigger: 'analysis',
              understanding: 'This node must remain active after rollback.',
              why: 'Exercises transactional archive rollback.',
              skipDuplicateCheck: true,
            },
          },
          {
            tool: 'graph_connect',
            params: {
              from: '$1.id',
              to: '$0.id',
              type: 'refines',
              why: 'Connects the successful target to its anchor.',
            },
          },
          {
            tool: 'graph_connect',
            params: {
              from: '$2.id',
              to: '$0.id',
              type: 'refines',
              why: 'Connects the rollback target to its anchor.',
            },
          },
        ],
      },
      contextManager,
    )) as { success: boolean; results: Array<{ id?: string }> };
    expect(seeded.success).toBe(true);

    const successfulId = seeded.results[1]?.id;
    const rollbackId = seeded.results[2]?.id;
    expect(successfulId).toBeTruthy();
    expect(rollbackId).toBeTruthy();

    const archived = (await handleToolCall(
      'graph_batch',
      {
        commit_message: 'archive the superseded target atomically',
        agent_name: 'Tester',
        operations: [
          {
            tool: 'graph_archive',
            params: {
              node: successfulId,
              reason: 'The test verifies the nested concept-tool route.',
            },
          },
        ],
      },
      contextManager,
    )) as { success: boolean };
    expect(archived.success).toBe(true);

    const successfulRow = sqlite
      .getDb()
      .prepare('SELECT active FROM nodes WHERE id = ?')
      .get(successfulId) as { active: number };
    expect(successfulRow.active).toBe(0);

    const rolledBack = (await handleToolCall(
      'graph_batch',
      {
        commit_message: 'this archive must roll back',
        agent_name: 'Tester',
        operations: [
          {
            tool: 'graph_archive',
            params: {
              node: rollbackId,
              reason: 'A later failure must undo this archive.',
            },
          },
          {
            tool: 'graph_connect',
            params: {
              from: rollbackId,
              type: 'refines',
              why: 'A missing target must roll back the preceding archive.',
            },
          },
        ],
      },
      contextManager,
    )) as { success: boolean; errors?: Array<{ error: string }> };
    expect(rolledBack.success).toBe(false);
    expect(rolledBack.errors?.[0]?.error).toContain('MISSING_PARAMETER');

    const rollbackRow = sqlite
      .getDb()
      .prepare('SELECT active FROM nodes WHERE id = ?')
      .get(rollbackId) as { active: number };
    expect(rollbackRow.active).toBe(1);
  });
});
