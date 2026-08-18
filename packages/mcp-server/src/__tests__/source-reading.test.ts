import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  getGraphStore,
  getTextSource,
  resetGraphStore,
  sqlite,
} from '@emergent-wisdom/understanding-graph-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContextManager } from '../context-manager.js';
import { handleToolCall } from '../tools/index.js';

let tmpDir: string;
let contextManager: ContextManager;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ug-source-reading-'));
  const projectsDir = path.join(tmpDir, 'projects');
  fs.mkdirSync(path.join(projectsDir, 'reading-test'), { recursive: true });

  contextManager = new ContextManager();
  contextManager.setProjectDir(projectsDir);
  sqlite.initAllDatabases(projectsDir);
  if (!sqlite.getLoadedProjectIds().includes('reading-test')) {
    sqlite.initDatabase(path.join(projectsDir, 'reading-test'));
  }
  sqlite.setCurrentProject('reading-test');
  await contextManager.switchProject('reading-test');
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
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

describe('source reading bootstrap', () => {
  it('restores the staged cursor when graph persistence throws', async () => {
    const loaded = (await handleToolCall(
      'source_load',
      {
        title: 'A Retriable Reading',
        content: 'This passage must remain unread after a persistence failure.',
        sourceType: 'article',
      },
      contextManager,
    )) as { sourceId: string };
    const before = getTextSource(loaded.sourceId);
    vi.spyOn(getGraphStore(), 'getEmbeddingStats').mockImplementation(() => {
      throw new Error('forced pre-transaction persistence failure');
    });

    await expect(
      handleToolCall(
        'source_read',
        {
          sourceId: loaded.sourceId,
          chars: 12,
          commit_message: 'Attempt a read whose graph persistence throws',
        },
        contextManager,
        'reading',
      ),
    ).rejects.toThrow('forced pre-transaction persistence failure');

    const after = getTextSource(loaded.sourceId);
    expect(after).toMatchObject({
      position: before?.position,
      status: before?.status,
      rootNodeId: before?.rootNodeId,
      lastCommittedNodeId: before?.lastCommittedNodeId,
    });
    expect(getGraphStore().getAll()).toMatchObject({ nodes: [], edges: [] });
  });

  it('loads and reads a short source into a fresh graph without a manual doc root', async () => {
    const sourceText =
      'The first claim creates a frame. The second claim changes it.';
    const loaded = (await handleToolCall(
      'source_load',
      {
        title: 'A Short Reading',
        content: sourceText,
        sourceType: 'article',
      },
      contextManager,
    )) as Record<string, unknown>;

    expect(loaded.success).toBe(true);
    expect(loaded.nextSteps).toContain('graph_understand');
    expect(loaded.nextSteps).toContain('workflow: "reading"');
    expect(loaded.nextSteps).not.toContain('doc_create');
    expect(getGraphStore().getAll().nodes).toHaveLength(0);

    const sourceId = loaded.sourceId as string;
    const read = (await handleToolCall(
      'source_read',
      {
        sourceId,
        commit_message: 'Read the first source passage chronologically',
      },
      contextManager,
    )) as Record<string, unknown>;

    expect(read.success).toBe(true);
    expect(read.done).toBe(true);
    expect(read.content).toBe(sourceText);
    expect(read.contentNodeId).toEqual(expect.stringMatching(/^n_/));
    expect(read.hint).toContain('graph_note');
    expect(read.hint).toContain(`learned_from`);
    expect(read.hint).toContain(read.contentNodeId as string);
    expect(read.hint).toContain('RE-ENTER THIS ENCOUNTER');
    expect(read.reentry).toMatchObject({
      focusNodeIds: [read.contentNodeId],
      suggestedCall: {
        tool: 'graph_understand',
        arguments: {
          workflow: 'reading',
          focusNodeIds: [read.contentNodeId],
        },
      },
    });
    expect(read.hint).not.toContain('doc_append_thinking');
    expect(read.hint).not.toContain('MILESTONE');

    const { nodes, edges } = getGraphStore().getAll();
    expect(nodes).toHaveLength(2);
    const root = nodes.find((node) => node.isDocRoot);
    const content = nodes.find((node) => node.id === read.contentNodeId);
    expect(root?.title).toBe('A Short Reading');
    expect(content?.content).toBe(sourceText);
    expect(
      edges.some(
        (edge) =>
          edge.type === 'contains' &&
          edge.fromId === root?.id &&
          edge.toId === content?.id,
      ),
    ).toBe(true);
    expect(
      edges.some(
        (edge) =>
          edge.type === 'next' &&
          edge.fromId === root?.id &&
          edge.toId === content?.id,
      ),
    ).toBe(false);

    const connectedIds = new Set(
      edges.flatMap((edge) => [edge.fromId, edge.toId]),
    );
    expect(nodes.every((node) => connectedIds.has(node.id))).toBe(true);

    const stagedSource = getTextSource(sourceId);
    expect(stagedSource?.rootNodeId).toBe(root?.id);
    expect(stagedSource?.lastCommittedNodeId).toBe(content?.id);
    expect(stagedSource?.status).toBe('completed');

    const exported = (await handleToolCall(
      'source_export',
      { sourceId, format: 'xml' },
      contextManager,
    )) as Record<string, unknown>;
    expect(exported.success).toBe(true);
    expect(exported.output).toBe(sourceText);
    expect(exported.nodeCount).toBe(1);
    expect(exported.contentCount).toBe(1);
    expect(exported.thinkingCount).toBe(0);
  });

  it('preserves chronological chunks while grounding updates in typed passage evidence', async () => {
    const firstPassage =
      'Mira expected sunlight to preserve the blue petals.\n\n';
    const secondPassage =
      'The covered petals stayed vivid while exposed petals faded.';
    const sourceText = firstPassage + secondPassage;
    const loaded = (await handleToolCall(
      'source_load',
      {
        title: 'A Reversed Expectation',
        content: sourceText,
        sourceType: 'article',
      },
      contextManager,
    )) as Record<string, unknown>;
    const sourceId = loaded.sourceId as string;

    const orientation = (await handleToolCall(
      'graph_understand',
      {
        query: 'What should I expect before reading this source?',
        workflow: 'reading',
        retrieval: 'lexical',
      },
      contextManager,
    )) as Record<string, unknown>;
    expect(orientation.status).toBe('no_relevant_context');
    expect(orientation.workflow).toEqual({
      requested: 'reading',
      resolved: 'reading',
    });

    const firstRead = (await handleToolCall(
      'source_read',
      {
        sourceId,
        until: '\n\n',
        commit_message: 'Stop after the opening expectation',
      },
      contextManager,
    )) as Record<string, unknown>;
    expect(firstRead.content).toBe(firstPassage);
    expect(firstRead.done).toBe(false);

    const expectationBatch = (await handleToolCall(
      'graph_batch',
      {
        commit_message:
          'Capture the expectation and its exact chronological evidence',
        agent_name: 'reading_test',
        operations: [
          {
            tool: 'graph_add_concept',
            params: {
              title: 'Sunlight preservation expectation',
              trigger: 'prediction',
              understanding:
                'Mira expects sunlight to preserve the blue petals.',
              why: 'The first passage states this expectation explicitly.',
              skipDuplicateCheck: true,
            },
          },
          {
            tool: 'graph_connect',
            params: {
              from: '$0.id',
              to: firstRead.contentNodeId,
              type: 'learned_from',
              relation: 'is stated in the first passage',
              why: 'The first content node is the verbatim source evidence.',
            },
          },
        ],
      },
      contextManager,
    )) as {
      success?: boolean;
      results?: Array<{ id?: string }>;
    };
    expect(expectationBatch.success).toBe(true);
    const expectationId = expectationBatch.results?.[0]?.id;

    const secondRead = (await handleToolCall(
      'source_read',
      {
        sourceId,
        chars: 10_000,
        commit_message: 'Read the observation that tests the expectation',
      },
      contextManager,
    )) as Record<string, unknown>;
    expect(secondRead.content).toBe(secondPassage);
    expect(secondRead.done).toBe(true);

    const reversalBatch = (await handleToolCall(
      'graph_batch',
      {
        commit_message:
          'Record the reversal, its source evidence, and the changed direction',
        agent_name: 'reading_test',
        operations: [
          {
            tool: 'graph_add_concept',
            params: {
              title: 'Covered petals remain vivid',
              trigger: 'surprise',
              understanding:
                'Covered petals stayed vivid while exposed petals faded.',
              why: 'The observation reverses the expected direction.',
              skipDuplicateCheck: true,
            },
          },
          {
            tool: 'graph_connect',
            params: {
              from: '$0.id',
              to: secondRead.contentNodeId,
              type: 'learned_from',
              relation: 'is observed in the second passage',
              why: 'The second content node contains the exact observation.',
            },
          },
          {
            tool: 'graph_connect',
            params: {
              from: '$0.id',
              to: expectationId,
              type: 'contradicts',
              relation: 'reverses the expected direction',
              why: 'The exposed petals faded instead of being preserved.',
            },
          },
        ],
      },
      contextManager,
    )) as { success?: boolean };
    expect(reversalBatch.success).toBe(true);

    const update = (await handleToolCall(
      'graph_understand',
      {
        query:
          'How did the petals observation change the sunlight expectation?',
        workflow: 'reading',
        retrieval: 'lexical',
      },
      contextManager,
    )) as {
      frame?: {
        relations?: Array<{ type?: string; why?: string }>;
      };
    };
    expect(update.frame?.relations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'learned_from',
          why: 'The second content node contains the exact observation.',
        }),
        expect.objectContaining({
          type: 'contradicts',
          why: 'The exposed petals faded instead of being preserved.',
        }),
      ]),
    );

    const { nodes, edges } = getGraphStore().getAll();
    const root = nodes.find(
      (node) => node.isDocRoot && node.title === 'A Reversed Expectation',
    );
    expect(
      edges.some(
        (edge) =>
          edge.type === 'next' &&
          edge.fromId === firstRead.contentNodeId &&
          edge.toId === secondRead.contentNodeId,
      ),
    ).toBe(true);
    expect(
      edges.some((edge) => edge.type === 'next' && edge.fromId === root?.id),
    ).toBe(false);

    const exported = (await handleToolCall(
      'source_export',
      { sourceId, format: 'xml' },
      contextManager,
    )) as Record<string, unknown>;
    expect(exported.output).toBe(sourceText);
    expect(exported.nodeCount).toBe(2);
    expect(exported.contentCount).toBe(2);
    expect(exported.thinkingCount).toBe(0);
  });

  it('requires and uses an explicit anchor when starting in a non-empty graph', async () => {
    const seeded = (await handleToolCall(
      'graph_batch',
      {
        commit_message: 'Seed existing understanding for source anchoring',
        agent_name: 'Tester',
        operations: [
          {
            tool: 'graph_add_concept',
            params: {
              title: 'Existing Frame',
              trigger: 'foundation',
              understanding: 'The prior frame this source may test.',
              why: 'Provides an explicit, meaningful reading anchor.',
              skipDuplicateCheck: true,
            },
          },
          {
            tool: 'graph_add_concept',
            params: {
              title: 'Existing Question',
              trigger: 'question',
              understanding: 'How might the prior frame change?',
              why: 'Keeps the seed graph connected.',
              skipDuplicateCheck: true,
            },
          },
          {
            tool: 'graph_connect',
            params: {
              from: '$1.id',
              to: '$0.id',
              type: 'questions',
              why: 'The question tests the existing frame.',
            },
          },
        ],
      },
      contextManager,
    )) as {
      success?: boolean;
      results?: Array<{ id?: string }>;
    };
    expect(seeded.success).toBe(true);
    const anchorId = seeded.results?.[0]?.id;
    expect(anchorId).toEqual(expect.stringMatching(/^n_/));

    const loaded = (await handleToolCall(
      'source_load',
      {
        title: 'A Source With Context',
        content: 'This passage may qualify the existing frame.',
        sourceType: 'paper',
      },
      contextManager,
    )) as Record<string, unknown>;
    const sourceId = loaded.sourceId as string;
    expect(loaded.nextSteps).toContain('anchorNode');

    const withoutAnchor = (await handleToolCall(
      'source_read',
      {
        sourceId,
        commit_message: 'Attempt to begin contextual reading',
      },
      contextManager,
    )) as Record<string, unknown>;
    expect(withoutAnchor.success).toBe(false);
    expect(withoutAnchor.error).toBe('SOURCE_ANCHOR_REQUIRED');
    expect(getTextSource(sourceId)?.position).toBe(0);

    const read = (await handleToolCall(
      'source_read',
      {
        sourceId,
        anchorNode: anchorId,
        commit_message: 'Read this source against the existing frame',
      },
      contextManager,
    )) as Record<string, unknown>;
    expect(read.success).toBe(true);
    expect(read.contentNodeId).toEqual(expect.stringMatching(/^n_/));

    const { nodes, edges } = getGraphStore().getAll();
    const sourceRoot = nodes.find(
      (node) => node.isDocRoot && node.title === 'A Source With Context',
    );
    expect(sourceRoot).toBeTruthy();
    expect(
      edges.some(
        (edge) =>
          edge.type === 'contextualizes' &&
          edge.fromId === sourceRoot?.id &&
          edge.toId === anchorId,
      ),
    ).toBe(true);
  });
});
