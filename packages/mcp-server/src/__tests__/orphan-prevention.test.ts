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

// Tests for orphan prevention in graph_batch. New cognitive concepts must be
// grounded through relationships. Document nodes are canonical artifacts, so
// roots and children may exist without unrelated semantic edges; they can also
// serve as grounding anchors for concepts created in the same batch.

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
          skipDuplicateCheck: true,
        },
      },
      {
        tool: 'graph_add_concept',
        params: {
          title: 'Open Question About Testing',
          trigger: 'question',
          understanding: 'What invariants should orphan prevention enforce?',
          why: 'Drives the test suite.',
          skipDuplicateCheck: true,
        },
      },
      {
        tool: 'graph_connect',
        params: {
          from: '$0.id',
          to: '$1.id',
          type: 'questions',
          why: 'The question challenges the seed concept.',
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

  it('rejects single concept in empty graph (no edges)', async () => {
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
    expect(result.success).toBe(false);
    expect(result.error).toBe('ORPHAN_PREVENTION');
  });

  it('allows two connected concepts in empty graph', async () => {
    const result = await batch([
      {
        tool: 'graph_add_concept',
        params: {
          title: 'First Node',
          trigger: 'foundation',
          understanding: 'First.',
          why: 'First.',
          skipDuplicateCheck: true,
        },
      },
      {
        tool: 'graph_add_concept',
        params: {
          title: 'Second Node',
          trigger: 'tension',
          understanding: 'Second.',
          why: 'Second.',
          skipDuplicateCheck: true,
        },
      },
      {
        tool: 'graph_connect',
        params: {
          from: '$0.id',
          to: '$1.id',
          type: 'refines',
          why: 'Bootstrap edge.',
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
  it('allows a standalone doc root in a non-empty graph', async () => {
    await seed();
    const result = await batch([
      {
        tool: 'doc_create',
        params: {
          title: 'Canonical Doc',
          fileType: 'md',
          isDocRoot: true,
        },
      },
    ]);
    expect(result.success).toBe(true);
  });

  it('allows a doc root as the sole node in an empty graph', async () => {
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
    // A document root needs no unrelated semantic edge.
    const rootResult = await batch([
      {
        tool: 'doc_create',
        params: {
          title: 'Doc Root',
          fileType: 'md',
          isDocRoot: true,
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

  it('treats a new document as a grounding anchor for a new concept', async () => {
    const result = await batch([
      {
        tool: 'doc_create',
        params: {
          title: 'Resolver implementation',
          content: 'def resolve(): pass\n',
          fileType: 'py',
          isDocRoot: true,
        },
      },
      {
        tool: 'graph_add_concept',
        params: {
          title: 'Structural shadowing',
          trigger: 'decision',
          understanding: 'A higher-precedence scalar replaces a lower subtree.',
          why: 'This rule determines the resolver behavior.',
        },
      },
      {
        tool: 'graph_connect',
        params: {
          from: '$1.id',
          to: '$0.id',
          type: 'contextualizes',
          why: 'The decision explains the behavior encoded by the artifact.',
        },
      },
    ]);

    expect(result.success).toBe(true);
  });

  it('models doc_create expressesIds as a grounding relationship', async () => {
    const result = await batch([
      {
        tool: 'graph_add_concept',
        params: {
          title: 'Precedence invariant',
          trigger: 'decision',
          understanding: 'Runtime values override environment values.',
          why: 'The implementation needs a deterministic winner.',
        },
      },
      {
        tool: 'doc_create',
        params: {
          title: 'Configuration resolver',
          content: 'runtime_overrides_environment = True\n',
          fileType: 'py',
          isDocRoot: true,
          expressesIds: ['$0.id'],
        },
      },
    ]);

    expect(result.success).toBe(true);
    const conceptId = (result.results as Array<{ id?: string }>)[0]?.id;
    const docId = (result.results as Array<{ id?: string }>)[1]?.id;
    const expressesEdge = getGraphStore()
      .getAll()
      .edges.find(
        (edge) =>
          edge.fromId === docId &&
          edge.toId === conceptId &&
          edge.type === 'expresses',
      );
    expect(expressesEdge).toBeTruthy();
  });

  it('models graph_note learned_from as an implicit grounding relationship', async () => {
    const result = await batch([
      {
        tool: 'doc_create',
        params: {
          title: 'Merge implementation',
          content: 'function merge() {}\n',
          fileType: 'ts',
          isDocRoot: true,
        },
      },
      {
        tool: 'graph_note',
        params: {
          about: '$0.id',
          testimony:
            'Array replacement feels safer than positional merging, but a test with sparse arrays should decide it.',
        },
      },
    ]);

    expect(result.success).toBe(true);
    const docId = (result.results as Array<{ id?: string }>)[0]?.id;
    const noteId = (result.results as Array<{ id?: string }>)[1]?.id;
    const learnedFromEdge = getGraphStore()
      .getAll()
      .edges.find(
        (edge) =>
          edge.fromId === noteId &&
          edge.toId === docId &&
          edge.type === 'learned_from',
      );
    expect(learnedFromEdge).toBeTruthy();
  });

  it('still rejects an ungrounded concept beside a valid document', async () => {
    const result = await batch([
      {
        tool: 'doc_create',
        params: {
          title: 'Valid artifact',
          content: '# Artifact\n',
          fileType: 'md',
          isDocRoot: true,
        },
      },
      {
        tool: 'graph_add_concept',
        params: {
          title: 'Unrelated assertion',
          trigger: 'foundation',
          understanding: 'This has no relationship to evidence or artifact.',
          why: 'Exercises the grounding boundary.',
        },
      },
    ]);

    expect(result.success).toBe(false);
    expect(result.error).toBe('ORPHAN_PREVENTION');
    expect(result.message).toContain('ungrounded');
    expect(getGraphStore().getAll().nodes).toHaveLength(0);
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
    expect(result.success).toBe(true);
    const nodeId = (result.results as Array<{ id?: string }>)?.[0]?.id;
    expect(nodeId).toBeTruthy();

    const node = getGraphStore().getNode(nodeId as string);
    expect(node).toBeTruthy();
    expect(node?.title).toBe('Empty Root');
  });
});
