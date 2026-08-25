import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as sqlite from '../database/sqlite.js';
import { getGraphStore, resetGraphStore } from './GraphStore.js';

const PROJECT_ID = 'document-structure-validation';
let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ug-doc-structure-'));
  sqlite.initDatabase(path.join(tmpDir, PROJECT_ID));
  sqlite.setCurrentProject(PROJECT_ID);
  resetGraphStore();
});

afterEach(() => {
  sqlite.closeAllDatabases();
  resetGraphStore();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('document identity boundaries', () => {
  it('rejects root classification changes through a generic node update', () => {
    const store = getGraphStore();
    const root = store.createDocumentNode({
      title: 'Stable root',
      content: 'Root content',
      isDocRoot: true,
      fileType: 'md',
    });
    const child = store.createDocumentNode({
      title: 'Stable child',
      content: 'Child content',
      parentId: root.id,
      level: 'paragraph',
    });

    expect(() => store.updateNode(root.id, { isDocRoot: false })).toThrow(
      /DOCUMENT_STRUCTURE_CHANGE_NOT_ALLOWED/,
    );
    expect(() => store.updateNode(child.id, { isDocRoot: true })).toThrow(
      /DOCUMENT_STRUCTURE_CHANGE_NOT_ALLOWED/,
    );
    expect(store.getDocumentPath(child.id)?.map((node) => node.id)).toEqual([
      root.id,
      child.id,
    ]);
  });

  it('converts only structurally detached document roots into concepts', () => {
    const store = getGraphStore();
    const root = store.createDocumentNode({
      title: 'Attached root',
      content: 'Root content',
      isDocRoot: true,
      fileType: 'md',
    });
    const child = store.createDocumentNode({
      title: 'Attached child',
      content: 'Child content',
      parentId: root.id,
      level: 'paragraph',
    });
    const rootBefore = store.getNode(root.id);
    const childBefore = store.getNode(child.id);

    expect(() =>
      store.convertToConcept(root.id, {
        trigger: 'analysis',
        moveContent: true,
      }),
    ).toThrow(/DOCUMENT_STRUCTURE_CHANGE_NOT_ALLOWED/);
    expect(() =>
      store.convertToConcept(child.id, {
        trigger: 'analysis',
        moveContent: true,
      }),
    ).toThrow(/DOCUMENT_STRUCTURE_CHANGE_NOT_ALLOWED/);
    expect(store.getNode(root.id)).toEqual(rootBefore);
    expect(store.getNode(child.id)).toEqual(childBefore);

    const detached = store.createDocumentNode({
      title: 'Detached root',
      content: 'Detached content',
      isDocRoot: true,
      fileType: 'md',
    });
    const staleEmbedding = new Float32Array([0.25, 0.75]);
    sqlite
      .getDb()
      .prepare('UPDATE nodes SET embedding = ? WHERE id = ?')
      .run(Buffer.from(staleEmbedding.buffer), detached.id);
    store.invalidateCache();
    const converted = store.convertToConcept(detached.id, {
      trigger: 'analysis',
      moveContent: true,
    });
    expect(converted).toMatchObject({
      id: detached.id,
      trigger: 'analysis',
      understanding: 'Detached content',
      content: null,
      isDocRoot: null,
      embedding: null,
    });
  });
});
