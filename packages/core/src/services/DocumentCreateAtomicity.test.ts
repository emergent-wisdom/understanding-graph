import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as sqlite from '../database/sqlite.js';
import { getGraphStore, resetGraphStore } from './GraphStore.js';

const PROJECT_ID = 'document-create-atomicity-core';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ug-doc-create-core-'));
  sqlite.initDatabase(path.join(tmpDir, PROJECT_ID));
  sqlite.setCurrentProject(PROJECT_ID);
  resetGraphStore();
});

afterEach(() => {
  sqlite.closeAllDatabases();
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

describe('GraphStore.createDocumentNode atomic prevalidation', () => {
  it.each([
    ['a missing sibling', 'missing'],
    ['a sibling under another parent', 'wrong-parent'],
    ['a non-tail sibling that would fork the next chain', 'non-tail'],
  ])('rejects %s without persisting any change', (_label, scenario) => {
    const { store, root, first, foreignChild } = createFixture();
    const afterId =
      scenario === 'missing'
        ? 'n_missing_after'
        : scenario === 'wrong-parent'
          ? foreignChild.id
          : first.id;
    const before = snapshot(root.id);

    expect(() =>
      store.createDocumentNode({
        title: 'Rejected section',
        content: 'Must not persist.',
        level: 'section',
        parentId: root.id,
        afterId,
      }),
    ).toThrow();

    expect(snapshot(root.id)).toEqual(before);
  });

  it('resolves every expresses target before creating the node or any edge', () => {
    const { store, root, second } = createFixture();
    const validConcept = store.createNode({
      title: 'A valid concept',
      trigger: 'foundation',
      why: 'It grounds the document section.',
      understanding: 'This reference should not be written on partial failure.',
    });
    const before = snapshot(root.id);

    expect(() =>
      store.createDocumentNode({
        title: 'Rejected section',
        content: 'Must not persist.',
        level: 'section',
        parentId: root.id,
        afterId: second.id,
        expressesIds: [validConcept.id, 'n_missing_later_concept'],
      }),
    ).toThrow('Expressed concept not found or inactive');

    expect(snapshot(root.id)).toEqual(before);
  });

  it('requires afterId before adding another child to an occupied parent', () => {
    const { store, root } = createFixture();
    const before = snapshot(root.id);

    expect(() =>
      store.createDocumentNode({
        title: 'Unordered section',
        content: 'Must not persist.',
        level: 'section',
        parentId: root.id,
      }),
    ).toThrow('afterId is required');

    expect(snapshot(root.id)).toEqual(before);
  });
});
