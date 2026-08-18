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

async function directDocCreate(args: Record<string, unknown>) {
  return handleToolCall('doc_create', args, contextManager, 'writing');
}

describe('direct MCP doc_create atomicity', () => {
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

    await expect(
      directDocCreate({
        title: 'Rejected section',
        content: 'Must not persist.',
        level: 'section',
        parentId: root.id,
        afterId,
      }),
    ).rejects.toThrow();

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

    await expect(
      directDocCreate({
        title: 'Rejected section',
        content: 'Must not persist.',
        level: 'section',
        parentId: root.id,
        afterId: second.id,
        expressesIds: [validConcept.id, 'n_missing_later_concept'],
      }),
    ).rejects.toThrow('Expressed concept not found or inactive');

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

    await expect(
      directDocCreate({
        title: 'Unordered direct section',
        content: 'Must not persist.',
        level: 'section',
        parentId: root.id,
      }),
    ).rejects.toThrow('afterId is required');
    expect(snapshot(root.id)).toEqual(before);

    await expect(
      handleToolCall(
        'doc_weave',
        {
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
        },
        contextManager,
        'writing',
      ),
    ).rejects.toThrow('afterId is required');
    expect(snapshot(root.id)).toEqual(before);
  });
});
