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
import { handleToolCall } from '../tools/index.js';

const PROJECT_ID = 'document-topology-boundary';
let tmpDir: string;
let contextManager: ContextManager;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ug-doc-topology-'));
  const projectDir = path.join(tmpDir, 'projects');
  contextManager = new ContextManager();
  contextManager.setProjectDir(projectDir);
  sqlite.initAllDatabases(projectDir);
  await contextManager.switchProject(PROJECT_ID);
});

afterEach(() => {
  sqlite.closeAllDatabases();
  resetGraphStore();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function createChain() {
  const store = getGraphStore();
  const root = store.createDocumentNode({
    title: 'ordered.py',
    content: '# ordered source',
    isDocRoot: true,
    fileType: 'py',
  });
  const first = store.createDocumentNode({
    title: 'A',
    content: 'A = 1',
    level: 'section',
    parentId: root.id,
  });
  const second = store.createDocumentNode({
    title: 'B',
    content: 'B = 2',
    level: 'section',
    parentId: root.id,
    afterId: first.id,
  });
  const third = store.createDocumentNode({
    title: 'C',
    content: 'C = 3',
    level: 'section',
    parentId: root.id,
    afterId: second.id,
  });
  return { root, first, second, third };
}

function structuralState() {
  return sqlite
    .getDb()
    .prepare(
      `SELECT id, from_id, to_id, type, active FROM edges
       WHERE type IN ('contains', 'next') ORDER BY id`,
    )
    .all();
}

async function batch(operation: {
  tool: string;
  params: Record<string, unknown>;
}) {
  return handleToolCall(
    'graph_batch',
    {
      agent_name: 'test-agent',
      commit_message: 'Generic graph mutations must not rewrite documents',
      ignoreWarnings: true,
      operations: [operation],
    },
    contextManager,
    'writing',
  ) as Promise<{ success: boolean; errors?: Array<{ error: string }> }>;
}

describe('document topology mutation boundary', () => {
  it.each([
    {
      tool: 'graph_connect',
      params: (ids: ReturnType<typeof createChain>) => ({
        from: ids.first.id,
        to: ids.third.id,
        type: 'next',
        why: 'This would create a branch.',
      }),
    },
    {
      tool: 'graph_disconnect',
      params: (ids: ReturnType<typeof createChain>) => ({
        from: ids.first.id,
        to: ids.second.id,
        edgeType: 'next',
      }),
    },
    {
      tool: 'edge_update',
      params: (ids: ReturnType<typeof createChain>) => ({
        from: ids.first.id,
        to: ids.second.id,
        type: 'relates',
      }),
    },
  ])(
    'rejects $tool against structural edges without mutation',
    async (testCase) => {
      const ids = createChain();
      const before = structuralState();
      const result = await batch({
        tool: testCase.tool,
        params: testCase.params(ids),
      });

      expect(result.success).toBe(false);
      expect(result.errors?.[0]?.error).toContain(
        'DOCUMENT_STRUCTURE_CHANGE_NOT_ALLOWED',
      );
      expect(structuralState()).toEqual(before);
      expect(
        getGraphStore()
          .getChildren(ids.root.id)
          .map((node) => node.title),
      ).toEqual(['A', 'B', 'C']);
      expect(sqlite.getRecentCommits()).toHaveLength(0);
    },
  );

  it('rejects archiving a document node while preserving its chain', async () => {
    const ids = createChain();
    const before = structuralState();
    const result = await batch({
      tool: 'graph_archive',
      params: { node: ids.second.id, reason: 'Must use document tools.' },
    });

    expect(result.success).toBe(false);
    expect(result.errors?.[0]?.error).toContain(
      'DOCUMENT_STRUCTURE_CHANGE_NOT_ALLOWED',
    );
    expect(getGraphStore().getNode(ids.second.id)).toMatchObject({
      active: true,
    });
    expect(structuralState()).toEqual(before);
    expect(
      getGraphStore()
        .getChildren(ids.root.id)
        .map((node) => node.title),
    ).toEqual(['A', 'B', 'C']);
    expect(sqlite.getRecentCommits()).toHaveLength(0);
  });

  it('still permits semantic graph relations between document and concept nodes', async () => {
    const ids = createChain();
    const concept = getGraphStore().createNode({
      title: 'Ordering rationale',
      trigger: 'decision',
      understanding: 'A must execute before B.',
      why: 'Confirms semantic edges remain available.',
    });
    const result = await batch({
      tool: 'graph_connect',
      params: {
        from: concept.id,
        to: ids.first.id,
        type: 'implements',
        why: 'The first unit realizes the ordering decision.',
      },
    });

    expect(result.success).toBe(true);
    expect(getGraphStore().getEdgesBetween(concept.id, ids.first.id)).toEqual([
      expect.objectContaining({ type: 'implements' }),
    ]);
  });
});
