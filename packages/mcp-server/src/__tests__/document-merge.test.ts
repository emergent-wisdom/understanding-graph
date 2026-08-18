import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  getGraphStore,
  resetGraphStore,
  sqlite,
  withReservedThinkingVisibility,
} from '@emergent-wisdom/understanding-graph-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ContextManager } from '../context-manager.js';
import { handleToolCall } from '../tools/index.js';

const PROJECT_ID = 'document-merge-test';
let tmpDir: string;
let contextManager: ContextManager;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ug-document-merge-'));
  const projectDir = path.join(tmpDir, 'projects');

  contextManager = new ContextManager();
  contextManager.setProjectDir(projectDir);
  sqlite.initAllDatabases(projectDir);
  await contextManager.switchProject(PROJECT_ID);
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

function createRoot(title = 'merged.py') {
  return getGraphStore().createDocumentNode({
    title,
    content: '# graph-native merge test',
    level: 'document',
    isDocRoot: true,
    fileType: 'py',
  });
}

function createChild(
  parentId: string,
  title: string,
  content: string,
  afterId?: string,
) {
  return getGraphStore().createDocumentNode({
    title,
    content,
    level: 'section',
    parentId,
    afterId,
  });
}

function activeStructuralRows() {
  return sqlite
    .getDb()
    .prepare(
      `SELECT from_id, to_id, type
       FROM edges
       WHERE active = 1 AND type IN ('contains', 'next')
       ORDER BY type, from_id, to_id`,
    )
    .all() as Array<{ from_id: string; to_id: string; type: string }>;
}

describe('doc_merge structural integrity', () => {
  it('atomically merges consecutive leaf siblings and generates one valid ordered artifact', async () => {
    const store = getGraphStore();
    const root = createRoot();
    const alpha = createChild(root.id, 'Alpha', 'ALPHA = 1');
    const beta = createChild(root.id, 'Beta', 'BETA = 2', alpha.id);
    const gamma = createChild(root.id, 'Gamma', 'GAMMA = 3', beta.id);
    const delta = createChild(root.id, 'Delta', 'DELTA = 4', gamma.id);

    const sharedConcept = store.createNode({
      title: 'Shared invariant',
      trigger: 'foundation',
      understanding: 'Both sections implement the same durable invariant.',
      why: 'Exercises relationship deduplication during a merge.',
    });
    const incomingConcept = store.createNode({
      title: 'Incoming rationale',
      trigger: 'analysis',
      understanding: 'An external rationale supports the section.',
      why: 'Exercises incoming relationship redirection during a merge.',
    });
    store.createEdge({
      fromId: beta.id,
      toId: sharedConcept.id,
      type: 'expresses',
      why: 'Beta expresses the shared invariant.',
    });
    store.createEdge({
      fromId: gamma.id,
      toId: sharedConcept.id,
      type: 'expresses',
      why: 'Gamma expresses the same shared invariant.',
    });
    store.createEdge({
      fromId: incomingConcept.id,
      toId: gamma.id,
      type: 'contextualizes',
      why: 'The external rationale contextualizes Gamma.',
    });
    store.createEdge({
      fromId: beta.id,
      toId: gamma.id,
      type: 'refines',
      why: 'Gamma refines the immediately preceding section.',
    });

    const result = (await handleToolCall(
      'doc_merge',
      {
        nodeIds: [beta.id, gamma.id],
        separator: '\n\n',
        newTitle: 'Beta and Gamma',
      },
      contextManager,
      'coding',
    )) as {
      success: boolean;
      id: string;
      archivedNodes: string[];
      finalChildren: Array<{ id: string; title: string }>;
      deduplicatedRelationshipCount: number;
      collapsedInternalRelationshipCount: number;
    };

    expect(result).toMatchObject({
      success: true,
      id: beta.id,
      archivedNodes: [gamma.id],
      deduplicatedRelationshipCount: 1,
      collapsedInternalRelationshipCount: 1,
    });
    expect(result.finalChildren.map((child) => child.id)).toEqual([
      alpha.id,
      beta.id,
      delta.id,
    ]);
    expect(store.getChildren(root.id).map((child) => child.id)).toEqual([
      alpha.id,
      beta.id,
      delta.id,
    ]);
    expect(store.getNode(beta.id)).toMatchObject({
      title: 'Beta and Gamma',
      content: 'BETA = 2\n\nGAMMA = 3',
      version: 2,
    });
    expect(store.getNode(gamma.id)).toMatchObject({
      active: false,
      archiveReason: `Merged into ${beta.id}`,
    });

    const structural = activeStructuralRows();
    const contains = structural.filter(
      (edge) => edge.type === 'contains' && edge.from_id === root.id,
    );
    expect(contains).toHaveLength(3);
    expect(contains).toEqual(
      expect.arrayContaining([
        { from_id: root.id, to_id: alpha.id, type: 'contains' },
        { from_id: root.id, to_id: beta.id, type: 'contains' },
        { from_id: root.id, to_id: delta.id, type: 'contains' },
      ]),
    );
    const next = structural.filter((edge) => edge.type === 'next');
    expect(next).toHaveLength(2);
    expect(next).toEqual(
      expect.arrayContaining([
        { from_id: alpha.id, to_id: beta.id, type: 'next' },
        { from_id: beta.id, to_id: delta.id, type: 'next' },
      ]),
    );

    const activeEdgesTouchingArchived = (
      sqlite
        .getDb()
        .prepare(
          `SELECT COUNT(*) AS count FROM edges
           WHERE active = 1 AND (from_id = ? OR to_id = ?)`,
        )
        .get(gamma.id, gamma.id) as { count: number }
    ).count;
    expect(activeEdgesTouchingArchived).toBe(0);
    expect(store.getEdgesBetween(beta.id, sharedConcept.id)).toHaveLength(1);
    expect(store.getEdgesBetween(incomingConcept.id, beta.id)).toHaveLength(1);
    expect(store.getEdgesBetween(beta.id, gamma.id)).toHaveLength(0);

    const generated = (await handleToolCall(
      'doc_generate',
      { rootId: root.id },
      contextManager,
      'coding',
    )) as { success: boolean; outputPath: string };
    expect(generated.success).toBe(true);
    const output = fs.readFileSync(generated.outputPath, 'utf8');
    expect(output.match(/BETA = 2/g)).toHaveLength(1);
    expect(output.match(/GAMMA = 3/g)).toHaveLength(1);
    expect(output.indexOf('ALPHA = 1')).toBeLessThan(
      output.indexOf('BETA = 2'),
    );
    expect(output.indexOf('BETA = 2')).toBeLessThan(
      output.indexOf('GAMMA = 3'),
    );
    expect(output.indexOf('GAMMA = 3')).toBeLessThan(
      output.indexOf('DELTA = 4'),
    );
    const compiled = spawnSync(
      'python3',
      ['-m', 'py_compile', generated.outputPath],
      { encoding: 'utf8' },
    );
    expect(compiled.status, compiled.stderr || compiled.stdout).toBe(0);
  });

  it('works as a nested raw batch mutation and regenerates after commit', async () => {
    const root = createRoot('batch-merged.py');
    const first = createChild(root.id, 'First', 'FIRST = 1');
    const second = createChild(root.id, 'Second', 'SECOND = 2', first.id);
    const third = createChild(root.id, 'Third', 'THIRD = 3', second.id);

    const result = (await handleToolCall(
      'graph_batch',
      {
        commit_message: 'Fuse two adjacent implementation units',
        agent_name: 'merge-test',
        ignoreWarnings: true,
        operations: [
          {
            tool: 'doc_merge',
            params: { nodeIds: [first.id, second.id], separator: '\n' },
          },
        ],
      },
      contextManager,
      'coding',
    )) as {
      success: boolean;
      results?: Array<{ id: string; finalChildren: Array<{ id: string }> }>;
      regeneratedDocuments?: Array<{ rootId: string; outputPath: string }>;
      commit?: { id: string };
    };

    expect(result.success).toBe(true);
    expect(result.commit?.id).toMatch(/^c_/);
    expect(result.results?.[0]?.finalChildren.map((child) => child.id)).toEqual(
      [first.id, third.id],
    );
    const regenerated = result.regeneratedDocuments?.find(
      (document) => document.rootId === root.id,
    );
    expect(regenerated).toBeDefined();
    expect(fs.readFileSync(regenerated?.outputPath || '', 'utf8')).toContain(
      'FIRST = 1\nSECOND = 2',
    );
  });

  it('rolls back every direct-call write when rebuilding the sibling chain fails', async () => {
    const store = getGraphStore();
    const root = createRoot('direct-rollback.py');
    const first = createChild(root.id, 'First', 'FIRST = 1');
    const second = createChild(root.id, 'Second', 'SECOND = 2', first.id);
    const third = createChild(root.id, 'Third', 'THIRD = 3', second.id);
    const firstBefore = store.getNode(first.id);
    const secondBefore = store.getNode(second.id);
    const structuralBefore = activeStructuralRows();
    const eventCountBefore = (
      sqlite
        .getDb()
        .prepare('SELECT COUNT(*) AS count FROM event_log')
        .get() as { count: number }
    ).count;

    sqlite.getDb().exec(`
      CREATE TRIGGER reject_merge_order_edge
      BEFORE INSERT ON edges
      WHEN NEW.explanation = 'Document sibling order after merge'
      BEGIN
        SELECT RAISE(ABORT, 'forced merge rebuild failure');
      END
    `);

    await expect(
      handleToolCall(
        'doc_merge',
        { nodeIds: [first.id, second.id] },
        contextManager,
        'coding',
      ),
    ).rejects.toThrow('forced merge rebuild failure');

    expect(store.getNode(first.id)).toMatchObject({
      title: firstBefore?.title,
      content: firstBefore?.content,
      active: true,
      version: firstBefore?.version,
      revisions: firstBefore?.revisions,
    });
    expect(store.getNode(second.id)).toMatchObject({
      title: secondBefore?.title,
      content: secondBefore?.content,
      active: true,
      version: secondBefore?.version,
      revisions: secondBefore?.revisions,
    });
    expect(store.getChildren(root.id).map((child) => child.id)).toEqual([
      first.id,
      second.id,
      third.id,
    ]);
    expect(activeStructuralRows()).toEqual(structuralBefore);
    expect(
      (
        sqlite
          .getDb()
          .prepare('SELECT COUNT(*) AS count FROM event_log')
          .get() as { count: number }
      ).count,
    ).toBe(eventCountBefore);
  });

  it('rejects mixed ordinary/reserved siblings without declassifying synthetic content', async () => {
    const store = getGraphStore();
    const root = createRoot('visibility-boundary.py');
    const ordinary = createChild(root.id, 'Public unit', 'PUBLIC = True');
    const marker = 'PRIVATE_SYNTHETIC_MARKER';
    const reserved = withReservedThinkingVisibility(true, () =>
      store.createDocumentNode({
        title: 'Reserved synthetic block',
        content: marker,
        level: 'section',
        parentId: root.id,
        afterId: ordinary.id,
        trigger: 'thinking',
        fileType: 'thinking',
      }),
    );
    const ordinaryBefore = store.getNode(ordinary.id);
    const eventCountBefore = (
      sqlite
        .getDb()
        .prepare('SELECT COUNT(*) AS count FROM event_log')
        .get() as { count: number }
    ).count;

    const result = (await handleToolCall(
      'graph_batch',
      {
        commit_message: 'Mixed visibility classes must never be merged',
        agent_name: 'synthesizer',
        ignoreWarnings: true,
        operations: [
          {
            tool: 'doc_merge',
            params: { nodeIds: [ordinary.id, reserved.id] },
          },
        ],
      },
      contextManager,
      'synthetic_reader',
    )) as {
      success: boolean;
      completed: number;
      errors?: Array<{ error: string }>;
    };

    expect(result.success).toBe(false);
    expect(result.completed).toBe(0);
    expect(result.errors?.[0]?.error).toContain(
      'RESERVED_CLASSIFICATION_MISMATCH',
    );
    expect(store.getNode(ordinary.id)).toMatchObject({
      content: ordinaryBefore?.content,
      version: ordinaryBefore?.version,
      active: true,
    });
    expect(store.getNode(ordinary.id)?.content).not.toContain(marker);
    expect(store.getNode(reserved.id)).toBeNull();
    expect(
      withReservedThinkingVisibility(true, () => store.getNode(reserved.id)),
    ).toMatchObject({ content: marker, active: true, version: 1 });
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

  it('rejects a concept malformed into document topology without creating a hybrid survivor', async () => {
    const store = getGraphStore();
    const root = createRoot('malformed-concept.py');
    const concept = store.createNode({
      title: 'Concept posing as a section',
      trigger: 'analysis',
      understanding: 'This is cognitive testimony, not source code.',
      why: 'Seeds a malformed legacy contains topology.',
    });
    store.createEdge({
      fromId: root.id,
      toId: concept.id,
      type: 'contains',
      why: 'Simulates a malformed legacy tree containing a concept.',
    });
    const document = createChild(
      root.id,
      'Real document section',
      'DOCUMENT = True',
      concept.id,
    );
    const conceptBefore = store.getNode(concept.id);
    const structuralBefore = activeStructuralRows();
    const eventCountBefore = (
      sqlite
        .getDb()
        .prepare('SELECT COUNT(*) AS count FROM event_log')
        .get() as { count: number }
    ).count;

    await expect(
      handleToolCall(
        'doc_merge',
        { nodeIds: [concept.id, document.id] },
        contextManager,
        'coding',
      ),
    ).rejects.toThrow('INVALID_DOCUMENT_NODE');

    expect(store.getNode(concept.id)).toMatchObject({
      content: conceptBefore?.content,
      level: conceptBefore?.level,
      trigger: 'analysis',
      active: true,
      version: conceptBefore?.version,
    });
    expect(store.getNode(document.id)).toMatchObject({
      content: 'DOCUMENT = True',
      active: true,
      version: 1,
    });
    expect(activeStructuralRows()).toEqual(structuralBefore);
    expect(
      (
        sqlite
          .getDb()
          .prepare('SELECT COUNT(*) AS count FROM event_log')
          .get() as { count: number }
      ).count,
    ).toBe(eventCountBefore);
  });

  it.each([
    {
      label: 'duplicate node IDs',
      nodeIds: (firstId: string, _otherId: string) => [firstId, firstId],
      expectedError: 'distinct node IDs',
    },
    {
      label: 'nodes with different parents',
      nodeIds: (firstId: string, otherId: string) => [firstId, otherId],
      expectedError: 'direct siblings under the same parent',
    },
  ])(
    'rolls back earlier raw batch operations when doc_merge rejects $label',
    async ({ nodeIds, expectedError }) => {
      const store = getGraphStore();
      const firstRoot = createRoot('first.py');
      const first = createChild(firstRoot.id, 'First', 'FIRST = 1');
      const firstTail = createChild(
        firstRoot.id,
        'First tail',
        'FIRST_TAIL = 2',
        first.id,
      );
      const otherRoot = createRoot('other.py');
      const other = createChild(otherRoot.id, 'Other', 'OTHER = 1');
      const before = store.getNode(first.id);
      const structuralBefore = activeStructuralRows();
      const eventCountBefore = (
        sqlite
          .getDb()
          .prepare('SELECT COUNT(*) AS count FROM event_log')
          .get() as { count: number }
      ).count;

      const result = (await handleToolCall(
        'graph_batch',
        {
          commit_message: 'This invalid merge must leave no provisional edit',
          agent_name: 'merge-test',
          ignoreWarnings: true,
          operations: [
            {
              tool: 'doc_revise',
              params: {
                nodeId: first.id,
                content: 'PROVISIONAL = True',
                why: 'A provisional edit that must roll back.',
              },
            },
            {
              tool: 'doc_merge',
              params: { nodeIds: nodeIds(first.id, other.id) },
            },
          ],
        },
        contextManager,
        'coding',
      )) as {
        success: boolean;
        completed: number;
        errors?: Array<{ error: string }>;
      };

      expect(result.success).toBe(false);
      expect(result.completed).toBe(1);
      expect(result.errors?.[0]?.error).toContain(expectedError);
      expect(store.getNode(first.id)).toMatchObject({
        content: before?.content,
        version: before?.version,
        revisions: before?.revisions,
      });
      expect(store.getNode(firstTail.id)?.active).toBe(true);
      expect(store.getNode(other.id)?.active).toBe(true);
      expect(activeStructuralRows()).toEqual(structuralBefore);
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
    },
  );
});
