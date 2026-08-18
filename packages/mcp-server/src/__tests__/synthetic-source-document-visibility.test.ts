import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  getGraphStore,
  getTextSource,
  resetGraphStore,
  sqlite,
  withReservedThinkingVisibility,
} from '@emergent-wisdom/understanding-graph-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContextManager } from '../context-manager.js';
import { handleToolCall } from '../tools/index.js';
import { sourceTools } from '../tools/source.js';

const PUBLIC_A = 'PUBLIC-A|';
const PUBLIC_B = 'PUBLIC-B';
const SOURCE_TEXT = `${PUBLIC_A}${PUBLIC_B}`;
const SECRET_TITLE = 'Confidential Violet Synthesis';
const SECRET_CONTENT =
  'I feel no fear. Secret synthetic reflection: the violet cipher remains sealed.';

let tmpDir: string;
let projectId: string;
let contextManager: ContextManager;
let fixtureNumber = 0;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ug-synthetic-visibility-'));
  projectId = `synthetic-visibility-${++fixtureNumber}`;
  const projectsDir = path.join(tmpDir, 'projects');
  fs.mkdirSync(path.join(projectsDir, projectId), { recursive: true });

  contextManager = new ContextManager();
  contextManager.setProjectDir(projectsDir);
  sqlite.initAllDatabases(projectsDir);
  if (!sqlite.getLoadedProjectIds().includes(projectId)) {
    sqlite.initDatabase(path.join(projectsDir, projectId));
  }
  sqlite.setCurrentProject(projectId);
  await contextManager.switchProject(projectId);
  vi.spyOn(getGraphStore(), 'generateAndStoreEmbedding').mockResolvedValue();
});

afterEach(() => {
  try {
    sqlite.closeAllDatabases();
  } catch {
    // Ignore already-closed test connections.
  }
  resetGraphStore();
  vi.restoreAllMocks();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function loadAndReadFirstPassage(title: string) {
  const loaded = (await handleToolCall(
    'source_load',
    { title, content: SOURCE_TEXT, sourceType: 'article' },
    contextManager,
    'synthetic_reader',
  )) as { sourceId: string };

  const first = (await handleToolCall(
    'source_read',
    {
      sourceId: loaded.sourceId,
      chars: PUBLIC_A.length,
      commit_message: 'Commit the first exact public passage',
    },
    contextManager,
    'synthetic_reader',
  )) as { contentNodeId: string; content: string };
  expect(first.content).toBe(PUBLIC_A);

  const appended = (await handleToolCall(
    'doc_append_thinking',
    {
      sourceId: loaded.sourceId,
      title: SECRET_TITLE,
      thought: SECRET_CONTENT,
      agentId: 'synthesizer',
      synthesizes_nodes: [first.contentNodeId],
      commit_message: 'Insert the reserved synthetic Reader block',
    },
    contextManager,
    'synthetic_reader',
  )) as { success: boolean; thinkingNodeId: string };
  expect(appended.success).toBe(true);

  return {
    sourceId: loaded.sourceId,
    firstNodeId: first.contentNodeId,
    thinkingNodeId: appended.thinkingNodeId,
  };
}

function expectNoSyntheticLeak(value: unknown, thinkingNodeId: string): void {
  const serialized = JSON.stringify(value);
  expect(serialized).not.toContain(SECRET_TITLE);
  expect(serialized).not.toContain(SECRET_CONTENT);
  expect(serialized).not.toContain(thinkingNodeId);
}

describe('reserved synthetic Reader visibility in source workflows', () => {
  it('describes ordinary exclusion at each source read surface', () => {
    for (const name of ['source_read', 'source_position', 'source_export']) {
      const definition = sourceTools.find((tool) => tool.name === name);
      expect(definition?.description).toMatch(/ordinary mode/i);
      expect(definition?.description).toMatch(/excluded|unavailable/i);
      expect(definition?.description).toMatch(/synthetic_reader/i);
    }
  });

  it('rejects ordinary continuation at a hidden synthetic tail without changing source or graph state', async () => {
    const fixture = await loadAndReadFirstPassage('Visible Resume Source');

    const position = (await handleToolCall(
      'source_position',
      { sourceId: fixture.sourceId },
      contextManager,
      'reading',
    )) as Record<string, unknown>;
    expect(position.lastCommittedNodeId).toBe(fixture.firstNodeId);
    expectNoSyntheticLeak(position, fixture.thinkingNodeId);

    const sourceBefore = getTextSource(fixture.sourceId);
    const graphBefore = withReservedThinkingVisibility(true, () => ({
      graph: getGraphStore().getAll(),
      events: sqlite
        .getDb()
        .prepare('SELECT * FROM event_log ORDER BY seq')
        .all(),
      commits: sqlite
        .getDb()
        .prepare('SELECT * FROM commits ORDER BY id')
        .all(),
    }));

    const second = (await handleToolCall(
      'source_read',
      {
        sourceId: fixture.sourceId,
        chars: 10_000,
        commit_message: 'Continue from the last ordinary-visible passage',
      },
      contextManager,
      'reading',
    )) as {
      success: boolean;
      error: string;
      message: string;
      hint: string;
    };
    expect(second).toMatchObject({
      success: false,
      error: 'SOURCE_REQUIRES_SYNTHETIC_READER',
    });
    expect(second.message).toMatch(/cannot continue|chronology/i);
    expect(second.hint).toMatch(/synthetic_reader/i);
    expect(second.hint).toMatch(/separate ordinary source/i);
    expect(second.hint).toMatch(/no source text was consumed/i);
    expectNoSyntheticLeak(second, fixture.thinkingNodeId);

    expect(getTextSource(fixture.sourceId)).toEqual(sourceBefore);
    expect(
      withReservedThinkingVisibility(true, () => ({
        graph: getGraphStore().getAll(),
        events: sqlite
          .getDb()
          .prepare('SELECT * FROM event_log ORDER BY seq')
          .all(),
        commits: sqlite
          .getDb()
          .prepare('SELECT * FROM commits ORDER BY id')
          .all(),
      })),
    ).toEqual(graphBefore);

    const ordinaryExport = (await handleToolCall(
      'source_export',
      { sourceId: fixture.sourceId, format: 'xml' },
      contextManager,
      'reading',
    )) as Record<string, unknown>;
    expect(ordinaryExport.output).toBe(PUBLIC_A);
    expect(ordinaryExport.thinkingCount).toBe(0);
    expectNoSyntheticLeak(ordinaryExport, fixture.thinkingNodeId);
  });

  it('does not hijack a same-title document root and consumes nothing until explicitly anchored', async () => {
    const title = 'Colliding Source Title';
    const unrelatedRoot = getGraphStore().createDocumentNode({
      title,
      content: '# Existing unrelated document',
      isDocRoot: true,
      fileType: 'md',
    });
    const unrelatedChild = getGraphStore().createDocumentNode({
      title: 'Existing unrelated passage',
      content: 'This material belongs to another document.',
      level: 'paragraph',
      parentId: unrelatedRoot.id,
    });

    const loaded = (await handleToolCall(
      'source_load',
      { title, content: SOURCE_TEXT, sourceType: 'article' },
      contextManager,
      'reading',
    )) as { sourceId: string };
    const sourceBefore = getTextSource(loaded.sourceId);
    const graphBefore = {
      graph: getGraphStore().getAll(),
      events: sqlite
        .getDb()
        .prepare('SELECT * FROM event_log ORDER BY seq')
        .all(),
      commits: sqlite
        .getDb()
        .prepare('SELECT * FROM commits ORDER BY id')
        .all(),
    };

    const unanchored = (await handleToolCall(
      'source_read',
      {
        sourceId: loaded.sourceId,
        chars: 10_000,
        commit_message: 'Attempt the colliding source without an anchor',
      },
      contextManager,
      'reading',
    )) as { success: boolean; error: string; hint: string };

    expect(unanchored).toMatchObject({
      success: false,
      error: 'SOURCE_ANCHOR_REQUIRED',
    });
    expect(unanchored.hint).toMatch(/no source text was consumed/i);
    expect(getTextSource(loaded.sourceId)).toEqual(sourceBefore);
    expect({
      graph: getGraphStore().getAll(),
      events: sqlite
        .getDb()
        .prepare('SELECT * FROM event_log ORDER BY seq')
        .all(),
      commits: sqlite
        .getDb()
        .prepare('SELECT * FROM commits ORDER BY id')
        .all(),
    }).toEqual(graphBefore);
    expect(
      getGraphStore()
        .getChildren(unrelatedRoot.id)
        .map((node) => node.id),
    ).toEqual([unrelatedChild.id]);

    const read = (await handleToolCall(
      'source_read',
      {
        sourceId: loaded.sourceId,
        chars: 10_000,
        anchorNode: unrelatedRoot.id,
        commit_message:
          'Create a distinct source tree explicitly contextualized by the existing document',
      },
      contextManager,
      'reading',
    )) as { success: boolean; contentNodeId: string };

    expect(read.success).toBe(true);
    const source = getTextSource(loaded.sourceId);
    expect(source?.rootNodeId).toEqual(expect.stringMatching(/^n_/));
    expect(source?.rootNodeId).not.toBe(unrelatedRoot.id);
    expect(
      getGraphStore()
        .getChildren(unrelatedRoot.id)
        .map((node) => node.id),
    ).toEqual([unrelatedChild.id]);
    expect(
      await handleToolCall(
        'source_export',
        { sourceId: loaded.sourceId, format: 'xml' },
        contextManager,
        'reading',
      ),
    ).toMatchObject({ output: SOURCE_TEXT, thinkingCount: 0 });
  });
});

describe('reserved synthetic Reader visibility in document workflows', () => {
  it('projects A + B in ordinary modes and preserves A -> thinking -> B for synthetic_reader', async () => {
    const fixture = await loadAndReadFirstPassage('A Synthetic Sandwich');

    const second = (await handleToolCall(
      'source_read',
      {
        sourceId: fixture.sourceId,
        chars: 10_000,
        commit_message: 'Commit the public passage after the synthetic block',
      },
      contextManager,
      'synthetic_reader',
    )) as { success: boolean; contentNodeId: string; content: string };
    expect(second).toMatchObject({ success: true, content: PUBLIC_B });

    const rawEdges = withReservedThinkingVisibility(
      true,
      () => getGraphStore().getAll().edges,
    );
    expect(rawEdges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'next',
          fromId: fixture.firstNodeId,
          toId: fixture.thinkingNodeId,
        }),
        expect.objectContaining({
          type: 'next',
          fromId: fixture.thinkingNodeId,
          toId: second.contentNodeId,
        }),
      ]),
    );

    const source = getTextSource(fixture.sourceId);
    expect(source?.rootNodeId).toEqual(expect.stringMatching(/^n_/));
    const rootId = source?.rootNodeId as string;

    const ordinaryExport = (await handleToolCall(
      'source_export',
      { sourceId: fixture.sourceId, format: 'xml', thinkingMode: 'fluid' },
      contextManager,
      'reading',
    )) as Record<string, unknown>;
    expect(ordinaryExport.output).toBe(SOURCE_TEXT);
    expect(ordinaryExport.nodeCount).toBe(2);
    expect(ordinaryExport.contentCount).toBe(2);
    expect(ordinaryExport.thinkingCount).toBe(0);
    expectNoSyntheticLeak(ordinaryExport, fixture.thinkingNodeId);

    const syntheticExport = (await handleToolCall(
      'source_export',
      { sourceId: fixture.sourceId, format: 'xml' },
      contextManager,
      'synthetic_reader',
    )) as Record<string, unknown>;
    expect(syntheticExport.output).toContain(PUBLIC_A);
    expect(syntheticExport.output).toContain(PUBLIC_B);
    expect(syntheticExport.output).toContain('<thinking>');
    expect(syntheticExport.output).toContain(SECRET_CONTENT);
    expect(syntheticExport.nodeCount).toBe(3);
    expect(syntheticExport.thinkingCount).toBe(1);

    for (const tool of ['doc_read', 'doc_flatten'] as const) {
      const idKey = tool === 'doc_read' ? 'nodeId' : 'rootId';
      const ordinary = await handleToolCall(
        tool,
        { [idKey]: rootId },
        contextManager,
        'writing',
      );
      const serialized = JSON.stringify(ordinary);
      expect(serialized).toContain(PUBLIC_A);
      expect(serialized).toContain(PUBLIC_B);
      expectNoSyntheticLeak(ordinary, fixture.thinkingNodeId);

      const synthetic = await handleToolCall(
        tool,
        { [idKey]: rootId },
        contextManager,
        'synthetic_reader',
      );
      const syntheticSerialized = JSON.stringify(synthetic);
      expect(syntheticSerialized).toContain(SECRET_TITLE);
      expect(syntheticSerialized).toContain(fixture.thinkingNodeId);
    }

    const ordinaryTree = (await handleToolCall(
      'doc_get_tree',
      { rootId },
      contextManager,
      'writing',
    )) as { tree: { children: unknown[] } };
    expect(ordinaryTree.tree.children).toHaveLength(2);
    expectNoSyntheticLeak(ordinaryTree, fixture.thinkingNodeId);

    const syntheticTree = (await handleToolCall(
      'doc_get_tree',
      { rootId },
      contextManager,
      'synthetic_reader',
    )) as { tree: { children: unknown[] } };
    expect(syntheticTree.tree.children).toHaveLength(3);
    expect(JSON.stringify(syntheticTree)).toContain(SECRET_TITLE);
    expect(JSON.stringify(syntheticTree)).toContain(fixture.thinkingNodeId);

    const generated = (await handleToolCall(
      'doc_generate',
      { rootId },
      contextManager,
      'writing',
    )) as { success: boolean; outputPath: string; nodeCount: number };
    expect(generated.success).toBe(true);
    expect(generated.nodeCount).toBe(3);
    const generatedText = fs.readFileSync(generated.outputPath, 'utf8');
    expect(generatedText).toContain(PUBLIC_A);
    expect(generatedText).toContain(PUBLIC_B);
    expect(generatedText).not.toContain(SECRET_TITLE);
    expect(generatedText).not.toContain(SECRET_CONTENT);

    for (const [tool, idKey] of [
      ['doc_read', 'nodeId'],
      ['doc_get_tree', 'rootId'],
      ['doc_flatten', 'rootId'],
      ['doc_generate', 'rootId'],
    ] as const) {
      const hiddenRead = (await handleToolCall(
        tool,
        { [idKey]: fixture.thinkingNodeId },
        contextManager,
        'writing',
      )) as Record<string, unknown>;
      expect(hiddenRead.success).toBe(false);
      expect(hiddenRead.error).toMatch(/not found/i);
      expectNoSyntheticLeak(hiddenRead, fixture.thinkingNodeId);
    }

    const syntheticRead = await handleToolCall(
      'doc_read',
      { nodeId: fixture.thinkingNodeId },
      contextManager,
      'synthetic_reader',
    );
    expect(JSON.stringify(syntheticRead)).toContain(SECRET_CONTENT);
  });
});
