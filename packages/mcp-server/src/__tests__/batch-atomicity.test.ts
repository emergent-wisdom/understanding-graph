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
});
