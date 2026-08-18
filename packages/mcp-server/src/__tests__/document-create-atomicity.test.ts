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

const PROJECT_ID = 'document-create-atomicity-mcp';

let tmpDir: string;
let contextManager: ContextManager;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ug-doc-create-mcp-'));
  const projectsDir = path.join(tmpDir, 'projects');
  fs.mkdirSync(path.join(projectsDir, PROJECT_ID), { recursive: true });

  contextManager = new ContextManager();
  contextManager.setProjectDir(projectsDir);
  sqlite.initAllDatabases(projectsDir);
  if (!sqlite.getLoadedProjectIds().includes(PROJECT_ID)) {
    sqlite.initDatabase(path.join(projectsDir, PROJECT_ID));
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

function snapshot(parentId: string) {
  const db = sqlite.getDb();
  return {
    nodes: db.prepare('SELECT * FROM nodes ORDER BY id').all(),
    edges: db.prepare('SELECT * FROM edges ORDER BY id').all(),
    events: db.prepare('SELECT * FROM event_log ORDER BY seq').all(),
    commits: db.prepare('SELECT * FROM commits ORDER BY id').all(),
    childOrder: getGraphStore()
      .getChildren(parentId)
      .map((node) => node.id),
  };
}

function createFixture() {
  const store = getGraphStore();
  const root = store.createDocumentNode({
    title: 'Primary document',
    content: '# Primary document',
    level: 'document',
    isDocRoot: true,
    fileType: 'md',
  });
  const first = store.createDocumentNode({
    title: 'First section',
    content: 'First.',
    level: 'section',
    parentId: root.id,
  });
  const second = store.createDocumentNode({
    title: 'Second section',
    content: 'Second.',
    level: 'section',
    parentId: root.id,
    afterId: first.id,
  });
  const otherRoot = store.createDocumentNode({
    title: 'Other document',
    content: '# Other document',
    level: 'document',
    isDocRoot: true,
    fileType: 'md',
  });
  const foreignChild = store.createDocumentNode({
    title: 'Foreign section',
    content: 'Foreign.',
    level: 'section',
    parentId: otherRoot.id,
  });
  return { store, root, first, second, foreignChild };
}

interface BatchResult {
  success: boolean;
  message?: string;
  error?: string;
}

/**
 * Run one document operation through graph_batch, the only path that will
 * remain once the mutating doc_ tools stop being separately advertised.
 *
 * The properties under test are unchanged — the operation is refused and
 * nothing partial is written — but a batch reports refusal by returning
 * success:false and rolling back, where a direct call threw. Asserting on the
 * rolled-back snapshot matters more here than before, not less: the rollback
 * is now doing the work the handler's own validation used to do alone.
 */
async function docOp(
  tool: string,
  params: Record<string, unknown>,
): Promise<BatchResult> {
  return (await handleToolCall(
    'graph_batch',
    {
      agent_name: 'test-agent',
      commit_message: `Attempt ${tool} against document ordering rules`,
      operations: [{ tool, params }],
    },
    contextManager,
    'writing',
  )) as BatchResult;
}

/** Assert a document operation was refused, optionally for a stated reason. */
function expectRefused(result: BatchResult, reason?: string) {
  expect(
    result.success,
    'The operation was accepted. It must be refused, and refused atomically.',
  ).toBe(false);
  if (reason) {
    expect(String(result.message ?? result.error)).toContain(reason);
  }
}

describe('doc_create atomicity through the checked write path', () => {
  it.each([
    ['a missing sibling', 'missing'],
    ['a sibling under another parent', 'wrong-parent'],
    ['a non-tail sibling that would fork the next chain', 'non-tail'],
  ])('rejects %s without persisting any change', async (_label, scenario) => {
    const { root, first, foreignChild } = createFixture();
    const afterId =
      scenario === 'missing'
        ? 'n_missing_after'
        : scenario === 'wrong-parent'
          ? foreignChild.id
          : first.id;
    const before = snapshot(root.id);

    expectRefused(
      await docOp('doc_create', {
        title: 'Rejected section',
        content: 'Must not persist.',
        level: 'section',
        parentId: root.id,
        afterId,
      }),
    );

    expect(snapshot(root.id)).toEqual(before);
  });

  it('rejects a bad later expresses target without partial persistence', async () => {
    const { store, root, second } = createFixture();
    const validConcept = store.createNode({
      title: 'A valid concept',
      trigger: 'foundation',
      why: 'It grounds the document section.',
      understanding: 'This reference should not be written on partial failure.',
    });
    const before = snapshot(root.id);

    expectRefused(
      await docOp('doc_create', {
        title: 'Rejected section',
        content: 'Must not persist.',
        level: 'section',
        parentId: root.id,
        afterId: second.id,
        expressesIds: [validConcept.id, 'n_missing_later_concept'],
      }),
      'Expressed concept not found or inactive',
    );

    expect(snapshot(root.id)).toEqual(before);
  });

  it('rejects direct and doc_weave child creation without afterId under an occupied parent', async () => {
    const { store, root } = createFixture();
    const concept = store.createNode({
      title: 'Weaving target',
      trigger: 'foundation',
      why: 'Grounds the attempted writing operation.',
      understanding: 'The indirect creator must obey document order too.',
    });
    const before = snapshot(root.id);

    expectRefused(
      await docOp('doc_create', {
        title: 'Unordered direct section',
        content: 'Must not persist.',
        level: 'section',
        parentId: root.id,
      }),
      'afterId',
    );
    expect(snapshot(root.id)).toEqual(before);

    expectRefused(
      await docOp('doc_weave', {
        title: 'Unordered woven section',
        content: 'Must not persist either.',
        level: 'section',
        parentId: root.id,
        targetNodeIds: [concept.id],
        connections: [
          {
            nodeId: concept.id,
            why: 'Would connect the manuscript section to its grounding note.',
          },
        ],
      }),
      'afterId',
    );
    expect(snapshot(root.id)).toEqual(before);
  });
});
