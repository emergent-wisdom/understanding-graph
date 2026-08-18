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
import { getToolDefinitions, handleToolCall } from '../tools/index.js';

const PROJECT_ID = 'document-move-test';
let tmpDir: string;
let projectDir: string;
let contextManager: ContextManager;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ug-document-move-'));
  projectDir = path.join(tmpDir, 'projects');
  fs.mkdirSync(path.join(projectDir, PROJECT_ID), { recursive: true });

  contextManager = new ContextManager();
  contextManager.setProjectDir(projectDir);
  sqlite.initAllDatabases(projectDir);
  if (!sqlite.getLoadedProjectIds().includes(PROJECT_ID)) {
    sqlite.initDatabase(path.join(projectDir, PROJECT_ID));
  }
  sqlite.setCurrentProject(PROJECT_ID);
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

function createDocument(title: string, fileType = 'md') {
  return getGraphStore().createDocumentNode({
    title,
    content: fileType === 'md' ? `# ${title}` : '# file container',
    level: 'document',
    isDocRoot: true,
    fileType,
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

async function move(params: {
  nodeId: string;
  parentId?: string;
  afterId?: string;
}) {
  return (await handleToolCall(
    'graph_batch',
    {
      commit_message: 'Move a document subtree without changing its content',
      agent_name: 'move-test',
      operations: [{ tool: 'doc_move', params }],
    },
    contextManager,
    'coding',
  )) as {
    success: boolean;
    results?: Array<{
      id: string;
      finalChildren: Array<{ id: string; title: string }>;
      sourceChildren?: Array<{ id: string; title: string }>;
      affectedRootIds: string[];
    }>;
    errors?: Array<{ error: string }>;
    commit?: { id: string; message: string };
    regeneratedDocuments?: Array<{ rootId: string; outputPath: string }>;
  };
}

describe('batch-only doc_move', () => {
  it('reorders siblings, preserves subtree/history, and regenerates code in final order', async () => {
    const root = createDocument('move-order.py', 'py');
    const alpha = createChild(root.id, 'Alpha', 'ALPHA = 1');
    const beta = createChild(root.id, 'Beta', 'BETA = 2', alpha.id);
    const gamma = createChild(root.id, 'Gamma', 'GAMMA = 3', beta.id);
    const nested = createChild(
      beta.id,
      'Beta helper',
      'def beta():\n    return BETA',
    );

    getGraphStore().updateNode(beta.id, {
      content: 'BETA = 20',
      revisionWhy: 'Preserve this prior implementation across the move.',
    });
    const before = getGraphStore().getNode(beta.id);

    const result = await move({ nodeId: beta.id, afterId: gamma.id });

    expect(result.success).toBe(true);
    expect(result.commit).toEqual(
      expect.objectContaining({
        id: expect.stringMatching(/^c_/),
        message: 'Move a document subtree without changing its content',
      }),
    );
    expect(
      result.results?.[0]?.finalChildren.map((child) => child.title),
    ).toEqual(['Alpha', 'Gamma', 'Beta']);
    expect(
      getGraphStore()
        .getChildren(root.id)
        .map((child) => child.title),
    ).toEqual(['Alpha', 'Gamma', 'Beta']);
    expect(getGraphStore().getParent(nested.id)?.id).toBe(beta.id);

    const after = getGraphStore().getNode(beta.id);
    expect(after?.content).toBe(before?.content);
    expect(after?.version).toBe(before?.version);
    expect(after?.revisions).toEqual(before?.revisions);

    const regenerated = result.regeneratedDocuments?.find(
      (document) => document.rootId === root.id,
    );
    expect(regenerated).toBeDefined();
    const generated = fs.readFileSync(regenerated?.outputPath || '', 'utf8');
    expect(generated.indexOf('ALPHA = 1')).toBeLessThan(
      generated.indexOf('GAMMA = 3'),
    );
    expect(generated.indexOf('GAMMA = 3')).toBeLessThan(
      generated.indexOf('BETA = 20'),
    );
    expect(generated.indexOf('BETA = 20')).toBeLessThan(
      generated.indexOf('def beta()'),
    );
  });

  it('moves a subtree across parents and regenerates both affected roots', async () => {
    const sourceRoot = createDocument('source.py', 'py');
    const sourceFirst = createChild(
      sourceRoot.id,
      'Source first',
      'SOURCE_FIRST = True',
    );
    const moving = createChild(
      sourceRoot.id,
      'Moving subtree',
      'MOVING = True',
      sourceFirst.id,
    );
    const sourceLast = createChild(
      sourceRoot.id,
      'Source last',
      'SOURCE_LAST = True',
      moving.id,
    );
    const nested = createChild(
      moving.id,
      'Nested implementation',
      'NESTED = True',
    );

    const destinationRoot = createDocument('destination.py', 'py');
    const destinationFirst = createChild(
      destinationRoot.id,
      'Destination first',
      'DESTINATION_FIRST = True',
    );
    const destinationLast = createChild(
      destinationRoot.id,
      'Destination last',
      'DESTINATION_LAST = True',
      destinationFirst.id,
    );

    const result = await move({
      nodeId: moving.id,
      parentId: destinationRoot.id,
      afterId: destinationFirst.id,
    });

    expect(result.success).toBe(true);
    expect(
      result.results?.[0]?.sourceChildren?.map((child) => child.title),
    ).toEqual(['Source first', 'Source last']);
    expect(
      result.results?.[0]?.finalChildren.map((child) => child.title),
    ).toEqual(['Destination first', 'Moving subtree', 'Destination last']);
    expect(getGraphStore().getParent(moving.id)?.id).toBe(destinationRoot.id);
    expect(getGraphStore().getParent(nested.id)?.id).toBe(moving.id);
    expect(
      getGraphStore()
        .getChildren(sourceRoot.id)
        .map((child) => child.id),
    ).toEqual([sourceFirst.id, sourceLast.id]);
    expect(
      getGraphStore()
        .getChildren(destinationRoot.id)
        .map((child) => child.id),
    ).toEqual([destinationFirst.id, moving.id, destinationLast.id]);

    expect(
      new Set(result.regeneratedDocuments?.map((document) => document.rootId)),
    ).toEqual(new Set([sourceRoot.id, destinationRoot.id]));
    const sourceOutput = result.regeneratedDocuments?.find(
      (document) => document.rootId === sourceRoot.id,
    )?.outputPath;
    const destinationOutput = result.regeneratedDocuments?.find(
      (document) => document.rootId === destinationRoot.id,
    )?.outputPath;
    expect(fs.readFileSync(sourceOutput || '', 'utf8')).not.toContain(
      'MOVING = True',
    );
    const generatedDestination = fs.readFileSync(
      destinationOutput || '',
      'utf8',
    );
    expect(
      generatedDestination.indexOf('DESTINATION_FIRST = True'),
    ).toBeLessThan(generatedDestination.indexOf('MOVING = True'));
    expect(generatedDestination.indexOf('MOVING = True')).toBeLessThan(
      generatedDestination.indexOf('NESTED = True'),
    );
    expect(generatedDestination.indexOf('NESTED = True')).toBeLessThan(
      generatedDestination.indexOf('DESTINATION_LAST = True'),
    );
  });

  it.each([
    {
      label: 'descendant parent',
      params: (fixture: MoveFixture) => ({
        nodeId: fixture.parent.id,
        parentId: fixture.child.id,
      }),
      error: 'descendants',
    },
    {
      label: 'self parent',
      params: (fixture: MoveFixture) => ({
        nodeId: fixture.parent.id,
        parentId: fixture.parent.id,
      }),
      error: 'own parent',
    },
    {
      label: 'foreign afterId',
      params: (fixture: MoveFixture) => ({
        nodeId: fixture.sibling.id,
        parentId: fixture.root.id,
        afterId: fixture.child.id,
      }),
      error: 'not a direct child',
    },
  ])('rolls back malformed $label moves', async ({ params, error }) => {
    const root = createDocument('rollback.md');
    const parent = createChild(root.id, 'Parent', 'Parent content');
    const sibling = createChild(
      root.id,
      'Sibling',
      'Sibling content',
      parent.id,
    );
    const child = createChild(parent.id, 'Child', 'Child content');
    const fixture = { root, parent, sibling, child };
    const beforeEdges = sqlite
      .getDb()
      .prepare(
        `SELECT id, from_id, to_id, type, active
         FROM edges ORDER BY id`,
      )
      .all();

    const result = await move(params(fixture));

    expect(result.success).toBe(false);
    expect(result.errors?.[0]?.error).toContain(error);
    const afterEdges = sqlite
      .getDb()
      .prepare(
        `SELECT id, from_id, to_id, type, active
         FROM edges ORDER BY id`,
      )
      .all();
    expect(afterEdges).toEqual(beforeEdges);
    expect(getGraphStore().getParent(parent.id)?.id).toBe(root.id);
    expect(getGraphStore().getParent(sibling.id)?.id).toBe(root.id);
    expect(getGraphStore().getParent(child.id)?.id).toBe(parent.id);
  });

  it('rejects moving a document root', async () => {
    const root = createDocument('root-move.md');
    const child = createChild(root.id, 'Child', 'Child content');
    const beforeEdges = sqlite
      .getDb()
      .prepare('SELECT id, from_id, to_id, type, active FROM edges ORDER BY id')
      .all();

    const result = await move({ nodeId: root.id, parentId: child.id });

    expect(result.success).toBe(false);
    expect(result.errors?.[0]?.error).toContain(
      'Document roots cannot be moved',
    );
    expect(
      sqlite
        .getDb()
        .prepare(
          'SELECT id, from_id, to_id, type, active FROM edges ORDER BY id',
        )
        .all(),
    ).toEqual(beforeEdges);
  });

  it('rolls back completed edge rewiring when a later batch operation fails', async () => {
    const root = createDocument('late-failure.py', 'py');
    const first = createChild(root.id, 'First', 'FIRST = True');
    const second = createChild(root.id, 'Second', 'SECOND = True', first.id);
    const third = createChild(root.id, 'Third', 'THIRD = True', second.id);
    const beforeEdges = sqlite
      .getDb()
      .prepare(
        `SELECT id, from_id, to_id, type, active
         FROM edges ORDER BY id`,
      )
      .all();

    const result = (await handleToolCall(
      'graph_batch',
      {
        commit_message: 'This structural move must not survive a later failure',
        agent_name: 'move-test',
        operations: [
          {
            tool: 'doc_move',
            params: { nodeId: second.id, afterId: third.id },
          },
          {
            tool: 'graph_connect',
            params: {
              from: first.id,
              type: 'refines',
              why: 'A missing target must roll the completed move back.',
            },
          },
        ],
      },
      contextManager,
      'coding',
    )) as {
      success: boolean;
      completed: number;
      errors: Array<{ error: string }>;
      regeneratedDocuments?: unknown;
    };

    expect(result.success).toBe(false);
    expect(result.completed).toBe(1);
    expect(result.errors[0]?.error).toContain('MISSING_PARAMETER');
    expect(result.regeneratedDocuments).toBeUndefined();
    expect(
      getGraphStore()
        .getChildren(root.id)
        .map((child) => child.id),
    ).toEqual([first.id, second.id, third.id]);
    const afterEdges = sqlite
      .getDb()
      .prepare(
        `SELECT id, from_id, to_id, type, active
         FROM edges ORDER BY id`,
      )
      .all();
    expect(afterEdges).toEqual(beforeEdges);
  });

  it('does not advertise doc_move as a top-level mutation', async () => {
    for (const mode of [
      'coding',
      'collaborative_coding',
      'writing',
      'full',
    ] as const) {
      expect(
        getToolDefinitions(mode).some(
          (definition) => definition.name === 'doc_move',
        ),
      ).toBe(false);
      await expect(
        handleToolCall(
          'doc_move',
          { nodeId: 'n_missing' },
          contextManager,
          mode,
        ),
      ).rejects.toThrow(`not available in TOOL_MODE "${mode}"`);
    }
  });
});

interface MoveFixture {
  root: { id: string };
  parent: { id: string };
  sibling: { id: string };
  child: { id: string };
}
