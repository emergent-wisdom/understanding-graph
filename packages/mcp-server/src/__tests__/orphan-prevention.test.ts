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

// Tests for orphan prevention in graph_batch, including doc_create nodes.
// Every new node must be reachable from the existing graph through edges
// in the same batch. Doc root nodes need explicit graph_connect; child
// doc nodes are anchored via their parentId (implicit contains edge).

let tmpDir: string;
let contextManager: ContextManager;

async function batch(
  ops: Array<{ tool: string; params: Record<string, unknown> }>,
  msg = 'test batch',
  extra: Record<string, unknown> = {},
) {
  return (await handleToolCall(
    'graph_batch',
    {
      commit_message: msg,
      agent_name: 'Tester',
      operations: ops,
      ...extra,
    },
    contextManager,
  )) as Record<string, unknown>;
}

async function seed() {
  return batch(
    [
      {
        tool: 'graph_add_concept',
        params: {
          title: 'Seed Concept',
          trigger: 'foundation',
          understanding: 'Anchors the test graph.',
          why: 'Seed node.',
        },
      },
    ],
    'seed',
  );
}

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ug-orphan-'));
  fs.mkdirSync(path.join(tmpDir, 'projects', 'orphan-test'), {
    recursive: true,
  });

  contextManager = new ContextManager();
  contextManager.setProjectDir(path.join(tmpDir, 'projects'));
  sqlite.initAllDatabases(path.join(tmpDir, 'projects'));
  if (!sqlite.getLoadedProjectIds().includes('orphan-test')) {
    sqlite.initDatabase(path.join(tmpDir, 'projects', 'orphan-test'));
  }
  sqlite.setCurrentProject('orphan-test');
  await contextManager.switchProject('orphan-test');
});

afterEach(() => {
  try {
    sqlite.closeAllDatabases();
  } catch {
    // ignore
  }
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

describe('orphan prevention — concept nodes', () => {
  it('rejects orphan concept in non-empty graph', async () => {
    await seed();
    const result = await batch([
      {
        tool: 'graph_add_concept',
        params: {
          title: 'Orphan',
          trigger: 'tension',
          understanding: 'Not connected.',
          why: 'Missing edge.',
        },
      },
    ]);
    expect(result.success).toBe(false);
    expect(result.error).toBe('ORPHAN_PREVENTION');
  });

  it('allows first concept in empty graph', async () => {
    const result = await batch([
      {
        tool: 'graph_add_concept',
        params: {
          title: 'First Node',
          trigger: 'foundation',
          understanding: 'First.',
          why: 'First.',
        },
      },
    ]);
    expect(result.success).toBe(true);
  });

  it('allows connected concept', async () => {
    await seed();
    const result = await batch([
      {
        tool: 'graph_add_concept',
        params: {
          title: 'Connected',
          trigger: 'decision',
          understanding: 'Linked.',
          why: 'Connected.',
        },
      },
      {
        tool: 'graph_connect',
        params: {
          from: 'Connected',
          to: 'Seed Concept',
          type: 'refines',
          why: 'Test edge.',
        },
      },
    ]);
    expect(result.success).toBe(true);
  });
});

describe('orphan prevention — doc_create nodes', () => {
  it('rejects orphan doc root in non-empty graph', async () => {
    await seed();
    const result = await batch([
      {
        tool: 'doc_create',
        params: {
          title: 'Orphan Doc',
          fileType: 'md',
          isDocRoot: true,
        },
      },
    ]);
    expect(result.success).toBe(false);
    expect(result.error).toBe('ORPHAN_PREVENTION');
  });

  it('allows doc root as first node in empty graph', async () => {
    const result = await batch([
      {
        tool: 'doc_create',
        params: {
          title: 'First Doc',
          fileType: 'md',
          isDocRoot: true,
        },
      },
    ]);
    expect(result.success).toBe(true);
  });

  it('allows doc root with graph_connect edge', async () => {
    await seed();
    const result = await batch([
      {
        tool: 'doc_create',
        params: {
          title: 'Connected Doc',
          fileType: 'md',
          isDocRoot: true,
        },
      },
      {
        tool: 'graph_connect',
        params: {
          from: '$0.id',
          to: 'Seed Concept',
          type: 'expresses',
          why: 'Doc expresses concept.',
        },
      },
    ]);
    expect(result.success).toBe(true);
  });

  it('allows child doc with parentId (anchored via contains)', async () => {
    // Create a connected doc root first
    await seed();
    const rootResult = await batch([
      {
        tool: 'doc_create',
        params: {
          title: 'Doc Root',
          fileType: 'md',
          isDocRoot: true,
        },
      },
      {
        tool: 'graph_connect',
        params: {
          from: '$0.id',
          to: 'Seed Concept',
          type: 'expresses',
          why: 'Root expresses concept.',
        },
      },
    ]);
    expect(rootResult.success).toBe(true);
    const rootId = (rootResult.results as Array<{ id?: string }>)?.[0]?.id;
    expect(rootId).toBeTruthy();

    // Now create a child doc — no explicit edge needed
    const childResult = await batch([
      {
        tool: 'doc_create',
        params: {
          title: 'Child Section',
          parentId: rootId,
          content: 'Body text.',
        },
      },
    ]);
    expect(childResult.success).toBe(true);
  });

  it('allows doc root + concept + edges in same batch', async () => {
    await seed();
    const result = await batch([
      {
        tool: 'graph_add_concept',
        params: {
          title: 'Design Decision',
          trigger: 'decision',
          understanding: 'Chose approach A.',
          why: 'Rationale.',
        },
      },
      {
        tool: 'doc_create',
        params: {
          title: 'Implementation',
          fileType: 'python',
          isDocRoot: true,
        },
      },
      {
        tool: 'graph_connect',
        params: {
          from: '$0.id',
          to: 'Seed Concept',
          type: 'refines',
          why: 'Decision refines seed.',
        },
      },
      {
        tool: 'graph_connect',
        params: {
          from: '$1.id',
          to: '$0.id',
          type: 'expresses',
          why: 'Doc expresses decision.',
        },
      },
    ]);
    expect(result.success).toBe(true);
  });
});

describe('doc_create — null content handling', () => {
  it('creates doc root without content (no crash)', async () => {
    const result = await batch([
      {
        tool: 'doc_create',
        params: {
          title: 'Empty Root',
          fileType: 'md',
          isDocRoot: true,
        },
      },
    ]);
    // Should succeed (first node exemption) without crashing on null content
    expect(result.success).toBe(true);
    const nodeId = (result.results as Array<{ id?: string }>)?.[0]?.id;
    expect(nodeId).toBeTruthy();

    const node = getGraphStore().getNode(nodeId!);
    expect(node).toBeTruthy();
    expect(node!.title).toBe('Empty Root');
  });
});
