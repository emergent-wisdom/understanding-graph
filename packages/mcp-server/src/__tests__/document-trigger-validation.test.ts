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
import { handleDocumentTools } from '../tools/document.js';
import { handleToolCall } from '../tools/index.js';

const PROJECT_ID = 'document-trigger-validation';
let tmpDir: string;
let contextManager: ContextManager;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ug-document-trigger-'));
  const projectDir = path.join(tmpDir, 'projects');
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

function createDocument() {
  return getGraphStore().createDocumentNode({
    title: 'Raw conversion target',
    content: 'Preserve this content until a canonical conversion succeeds.',
    level: 'document',
    isDocRoot: true,
    fileType: 'md',
  });
}

describe('doc_to_concept trigger validation', () => {
  it('returns INVALID_TRIGGER for malformed raw-handler values without mutation', async () => {
    const document = createDocument();
    const before = getGraphStore().getNode(document.id);

    for (const trigger of ['not-a-trigger', ' Analysis ', 42]) {
      const result = (await handleDocumentTools(
        'doc_to_concept',
        { nodeId: document.id, trigger },
        contextManager,
        'full',
      )) as { success: boolean; error?: string };

      expect(result).toMatchObject({
        success: false,
        error: 'INVALID_TRIGGER',
      });
      expect(getGraphStore().getNode(document.id)).toEqual(before);
    }

    const converted = (await handleDocumentTools(
      'doc_to_concept',
      {
        nodeId: document.id,
        trigger: 'analysis',
        why: 'A canonical conversion remains supported.',
      },
      contextManager,
      'full',
    )) as Record<string, unknown>;
    expect(converted).toMatchObject({ success: true, trigger: 'analysis' });
    expect(getGraphStore().getNode(document.id)).toMatchObject({
      trigger: 'analysis',
      content: null,
      understanding:
        'Preserve this content until a canonical conversion succeeds.',
    });
  });

  it('retains the ordinary-mode rejection for the reserved thinking trigger', async () => {
    const document = createDocument();
    const before = getGraphStore().getNode(document.id);

    await expect(
      handleToolCall(
        'graph_batch',
        {
          commit_message: 'Attempt a reserved document conversion',
          agent_name: 'ordinary-agent',
          operations: [
            {
              tool: 'doc_to_concept',
              params: { nodeId: document.id, trigger: 'thinking' },
            },
          ],
        },
        contextManager,
        'full',
      ),
    ).rejects.toThrow('TOOL_MODE "synthetic_reader"');

    expect(getGraphStore().getNode(document.id)).toEqual(before);
  });

  it('rejects structural document identity changes without mutation', async () => {
    const store = getGraphStore();
    const root = createDocument();
    const child = store.createDocumentNode({
      title: 'Attached conversion target',
      content: 'This child must remain in the document tree.',
      level: 'paragraph',
      parentId: root.id,
    });
    const rootBefore = store.getNode(root.id);
    const childBefore = store.getNode(child.id);

    const revise = (await handleDocumentTools(
      'doc_revise',
      {
        nodeId: child.id,
        content: 'A rejected topology change must not revise adjacent fields.',
        why: 'Attempt to promote a child through a prose revision.',
        isDocRoot: true,
      },
      contextManager,
      'full',
    )) as { success: boolean; error?: string };
    expect(revise).toMatchObject({
      success: false,
      error: 'DOCUMENT_STRUCTURE_CHANGE_NOT_ALLOWED',
    });

    await expect(
      handleDocumentTools(
        'doc_to_concept',
        {
          nodeId: child.id,
          trigger: 'analysis',
          moveContent: true,
        },
        contextManager,
        'full',
      ),
    ).rejects.toThrow(/DOCUMENT_STRUCTURE_CHANGE_NOT_ALLOWED/);
    await expect(
      handleDocumentTools(
        'doc_to_concept',
        {
          nodeId: root.id,
          trigger: 'analysis',
          moveContent: true,
        },
        contextManager,
        'full',
      ),
    ).rejects.toThrow(/DOCUMENT_STRUCTURE_CHANGE_NOT_ALLOWED/);

    expect(store.getNode(root.id)).toEqual(rootBefore);
    expect(store.getNode(child.id)).toEqual(childBefore);
    expect(store.getDocumentPath(child.id)?.map((node) => node.id)).toEqual([
      root.id,
      child.id,
    ]);
  });
});
