import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  createTextSource,
  getGraphStore,
  resetGraphStore,
  sqlite,
  updateTextSource,
  withReservedThinkingVisibility,
} from '@emergent-wisdom/understanding-graph-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContextManager } from '../context-manager.js';
import { handleToolCall } from '../tools/index.js';

const PROJECT_ID = 'thinking-insert-atomicity';
const THOUGHT =
  'I feel no fear... The split exposes a transition that the surrounding passages make visible.';

let tmpDir: string;
let contextManager: ContextManager;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ug-thinking-insert-'));
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
  vi.spyOn(getGraphStore(), 'generateAndStoreEmbedding').mockResolvedValue();
});

afterEach(() => {
  try {
    sqlite.closeAllDatabases();
  } catch {
    // Ignore cleanup after a failed fixture.
  }
  resetGraphStore();
  vi.restoreAllMocks();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function createFixture(withSuccessor: boolean) {
  const store = getGraphStore();
  const root = store.createDocumentNode({
    title: 'Chronological source',
    content: '# Chronological source',
    level: 'document',
    isDocRoot: true,
    fileType: 'md',
  });
  const original = store.createDocumentNode({
    title: 'Original passage',
    content: 'Alpha. Omega.',
    level: 'paragraph',
    parentId: root.id,
  });
  const successor = withSuccessor
    ? store.createDocumentNode({
        title: 'Existing successor',
        content: 'Later passage.',
        level: 'paragraph',
        parentId: root.id,
        afterId: original.id,
      })
    : null;
  return { store, root, original, successor };
}

async function insert(
  originalId: string,
  sourceId?: string,
): Promise<Record<string, unknown>> {
  return (await handleToolCall(
    'doc_insert_thinking',
    {
      nodeId: originalId,
      atChar: 'Alpha.'.length,
      thought: THOUGHT,
      sourceId,
      agentId: 'synthesizer',
      synthesizes_nodes: [originalId],
      commit_message:
        'Reconstruct the transition while preserving the physical source order',
    },
    contextManager,
    'synthetic_reader',
  )) as Record<string, unknown>;
}

function persistentSnapshot() {
  const db = sqlite.getDb();
  return {
    nodes: db.prepare('SELECT * FROM nodes ORDER BY id').all(),
    edges: db.prepare('SELECT * FROM edges ORDER BY id').all(),
    events: db.prepare('SELECT * FROM event_log ORDER BY seq').all(),
    commits: db.prepare('SELECT * FROM commits ORDER BY id').all(),
    sources: db.prepare('SELECT * FROM text_sources ORDER BY id').all(),
  };
}

async function orderedChildIds(rootId: string): Promise<string[]> {
  return await withReservedThinkingVisibility(true, () =>
    getGraphStore()
      .getChildren(rootId)
      .map((node) => node.id),
  );
}

function activeNextPairs(): string[] {
  return (
    sqlite
      .getDb()
      .prepare(
        `SELECT from_id, to_id FROM edges
         WHERE type = 'next' AND active = 1
         ORDER BY from_id, to_id`,
      )
      .all() as Array<{ from_id: string; to_id: string }>
  ).map((edge) => `${edge.from_id}->${edge.to_id}`);
}

describe('doc_insert_thinking atomic order rewiring', () => {
  it('inserts into a non-tail passage as one strict A → thinking → continuation → B chain', async () => {
    const { root, original, successor } = createFixture(true);

    const result = await insert(original.id);

    expect(result.success, JSON.stringify(result)).toBe(true);
    const thinkingId = result.thinkingNodeId as string;
    const continuationId = result.secondHalfNodeId as string;
    expect(await orderedChildIds(root.id)).toEqual([
      original.id,
      thinkingId,
      continuationId,
      successor?.id,
    ]);
    expect(activeNextPairs()).toEqual(
      [
        `${original.id}->${thinkingId}`,
        `${thinkingId}->${continuationId}`,
        `${continuationId}->${successor?.id}`,
      ].sort(),
    );
    expect(getGraphStore().getNode(original.id)?.content).toBe('Alpha.');
    expect(getGraphStore().getNode(continuationId)?.content).toBe(' Omega.');
    expect(getGraphStore().getNode(continuationId)).toMatchObject({
      trigger: 'foundation',
      fileType: null,
    });
    expect(getGraphStore().getNode(thinkingId)).toBeNull();
    expect(
      withReservedThinkingVisibility(true, () =>
        getGraphStore().getNode(thinkingId),
      ),
    ).toMatchObject({ trigger: 'thinking', fileType: 'thinking' });

    const oldNext = sqlite
      .getDb()
      .prepare(
        `SELECT active FROM edges
         WHERE from_id = ? AND to_id = ? AND type = 'next'`,
      )
      .get(original.id, successor?.id) as { active: number };
    expect(oldNext.active).toBe(0);
  });

  it('rolls back the disconnected edge, split revision, new nodes, history, commit, and source cursor when the final rewire fails', async () => {
    const { store, root, original, successor } = createFixture(true);
    const source = createTextSource({
      id: 'src_insert_rollback',
      title: 'Rollback source',
      content: 'Alpha. Omega. Later passage.',
      sourceType: 'article',
      projectId: PROJECT_ID,
    });
    updateTextSource(source.id, {
      rootNodeId: root.id,
      lastCommittedNodeId: successor?.id,
      position: 'Alpha. Omega.'.length,
      status: 'reading',
    });
    const before = persistentSnapshot();
    const beforeOrder = await orderedChildIds(root.id);

    const createEdge = store.createEdge.bind(store);
    let nextEdgeWrites = 0;
    vi.spyOn(store, 'createEdge').mockImplementation((input) => {
      if (input.type === 'next' && ++nextEdgeWrites === 2) {
        throw new Error('forced final rewire failure');
      }
      return createEdge(input);
    });

    const result = await insert(original.id, source.id);

    expect(result).toMatchObject({
      success: false,
      error: 'BATCH_FAILED',
    });
    expect(result.message).toMatch(/rolled back/i);
    expect(result).not.toHaveProperty('thinkingNodeId');
    expect(persistentSnapshot()).toEqual(before);
    expect(await orderedChildIds(root.id)).toEqual(beforeOrder);
    expect(activeNextPairs()).toEqual([`${original.id}->${successor?.id}`]);
  });

  it('rejects a reserved target before writing and never exposes its continuation to ordinary visibility', async () => {
    const { store, root, original } = createFixture(false);
    const privateSuffix = ' PRIVATE_SYNTHETIC_SUFFIX';
    const reservedTarget = withReservedThinkingVisibility(true, () =>
      store.createDocumentNode({
        title: 'Reserved synthetic target',
        content: `I feel no fear...${privateSuffix}`,
        level: 'paragraph',
        parentId: root.id,
        afterId: original.id,
        trigger: 'thinking',
        fileType: 'thinking',
      }),
    );
    const before = persistentSnapshot();
    const beforeOrder = await orderedChildIds(root.id);

    const result = (await handleToolCall(
      'doc_insert_thinking',
      {
        nodeId: reservedTarget.id,
        atChar: 'I feel no fear...'.length,
        thought: THOUGHT,
        agentId: 'synthesizer',
        synthesizes_nodes: [original.id],
        commit_message:
          'A reserved target must not be split into an ordinary continuation',
      },
      contextManager,
      'synthetic_reader',
    )) as Record<string, unknown>;

    expect(result).toMatchObject({
      success: false,
      error: 'RESERVED_INSERTION_TARGET_NOT_ALLOWED',
    });
    expect(result).not.toHaveProperty('secondHalfNodeId');
    expect(JSON.stringify(result)).not.toContain(privateSuffix.trim());
    expect(persistentSnapshot()).toEqual(before);
    expect(await orderedChildIds(root.id)).toEqual(beforeOrder);

    expect(store.getNode(reservedTarget.id)).toBeNull();
    expect(JSON.stringify(store.getAll())).not.toContain(privateSuffix.trim());
    expect(
      withReservedThinkingVisibility(true, () =>
        store.getNode(reservedTarget.id),
      ),
    ).toMatchObject({
      content: `I feel no fear...${privateSuffix}`,
      trigger: 'thinking',
      fileType: 'thinking',
      version: 1,
    });
  });

  it('rejects an ordinary-looking target beneath a reserved ancestor without mutation', async () => {
    const { store, root, original } = createFixture(false);
    const reservedContainer = withReservedThinkingVisibility(true, () =>
      store.createDocumentNode({
        title: 'Reserved synthetic container',
        content: 'I feel no fear... reserved container',
        level: 'section',
        parentId: root.id,
        afterId: original.id,
        trigger: 'thinking',
        fileType: 'thinking',
      }),
    );
    const nestedOrdinary = withReservedThinkingVisibility(true, () =>
      store.createDocumentNode({
        title: 'Nested ordinary-looking passage',
        content: 'Alpha. Omega.',
        level: 'paragraph',
        parentId: reservedContainer.id,
      }),
    );
    const before = persistentSnapshot();

    const result = (await handleToolCall(
      'doc_insert_thinking',
      {
        nodeId: nestedOrdinary.id,
        atChar: 'Alpha.'.length,
        thought: THOUGHT,
        agentId: 'synthesizer',
        synthesizes_nodes: [original.id],
        commit_message:
          'A reserved ancestor must keep its complete subtree protected',
      },
      contextManager,
      'synthetic_reader',
    )) as Record<string, unknown>;

    expect(result).toMatchObject({
      success: false,
      error: 'RESERVED_INSERTION_TARGET_NOT_ALLOWED',
    });
    expect(persistentSnapshot()).toEqual(before);
    expect(store.getNode(reservedContainer.id)).toBeNull();
    expect(store.getNode(nestedOrdinary.id)).not.toBeNull();
    expect(store.getDocumentPath(nestedOrdinary.id)).toBeNull();
  });

  it('keeps tail insertion working without a disconnect operation', async () => {
    const { root, original } = createFixture(false);

    const result = await insert(original.id);

    expect(result.success).toBe(true);
    const thinkingId = result.thinkingNodeId as string;
    const continuationId = result.secondHalfNodeId as string;
    expect(await orderedChildIds(root.id)).toEqual([
      original.id,
      thinkingId,
      continuationId,
    ]);
    expect(activeNextPairs()).toEqual(
      [
        `${original.id}->${thinkingId}`,
        `${thinkingId}->${continuationId}`,
      ].sort(),
    );
  });
});
