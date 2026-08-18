import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  createDocumentWriter,
  getGraphStore,
  resetGraphStore,
  sqlite,
} from '@emergent-wisdom/understanding-graph-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ContextManager } from '../context-manager.js';
import { handleToolCall } from '../tools/index.js';
import { docCall } from './support/doc-batch.js';

let tmpDir: string;
let contextManager: ContextManager;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ug-writing-document-'));
  const projectDir = path.join(tmpDir, 'projects');
  fs.mkdirSync(path.join(projectDir, 'writing-test'), { recursive: true });

  contextManager = new ContextManager();
  contextManager.setProjectDir(projectDir);
  sqlite.initAllDatabases(projectDir);
  if (!sqlite.getLoadedProjectIds().includes('writing-test')) {
    sqlite.initDatabase(path.join(projectDir, 'writing-test'));
  }
  sqlite.setCurrentProject('writing-test');
  await contextManager.switchProject('writing-test');
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

async function createRoot(content: string, summary?: string) {
  return (await docCall(
    'doc_create',
    {
      title: 'The Map That Looked Back',
      content,
      summary,
      level: 'document',
      isDocRoot: true,
      fileType: 'md',
    },
    contextManager,
  )) as { id: string };
}

describe('writing document revisions', () => {
  it('preserves genuine graph influence as inspired_by without leaking the note into prose', async () => {
    const store = getGraphStore();
    const cognitiveTestimony =
      'PRIVATE CRAFT TESTIMONY: let rain repeat only promises a speaker abandoned.';
    const sourceMaterial = store.createNode({
      title: 'Rain remembers interrupted promises',
      trigger: 'serendipity',
      why: 'A possible image available to the writer.',
      understanding: cognitiveTestimony,
    });
    const root = await createRoot('# The Map That Looked Back');
    const causalWhy =
      'The abandoned-promise image became rain repeating the unsent farewell.';

    const woven = (await docCall(
      'doc_weave',
      {
        parentId: root.id,
        title: 'The Unsent Farewell',
        level: 'paragraph',
        targetNodeIds: [sourceMaterial.id],
        content:
          'Rain tapped her unsent farewell against the station glass, one unfinished word at a time.',
        connections: [{ nodeId: sourceMaterial.id, why: causalWhy }],
      },
      contextManager,
      'writing',
    )) as {
      id: string;
      connections: Array<{
        edgeId: string;
        nodeId: string;
        type: string;
        why: string;
      }>;
    };

    const provenance = store
      .getEdgesBetween(woven.id, sourceMaterial.id)
      .find((edge) => edge.active);
    expect(provenance).toEqual(
      expect.objectContaining({
        fromId: woven.id,
        toId: sourceMaterial.id,
        type: 'inspired_by',
        why: causalWhy,
      }),
    );
    expect(
      store
        .getEdgesBetween(woven.id, sourceMaterial.id)
        .some((edge) => edge.type === 'expresses'),
    ).toBe(false);
    expect(woven.connections).toEqual([
      {
        edgeId: provenance?.id,
        nodeId: sourceMaterial.id,
        nodeName: sourceMaterial.title,
        type: 'inspired_by',
        why: causalWhy,
      },
    ]);

    const generated = createDocumentWriter(
      path.join(tmpDir, 'woven-output'),
    ).writeDocument(root.id);
    expect(generated).not.toBeNull();
    const manuscript = fs.readFileSync(generated?.outputPath || '', 'utf8');
    expect(manuscript).toContain(
      'Rain tapped her unsent farewell against the station glass',
    );
    expect(manuscript).not.toContain(sourceMaterial.title);
    expect(manuscript).not.toContain(cognitiveTestimony);
    expect(manuscript).not.toContain(causalWhy);
  });

  it('surfaces a neutral creative-center review on multi-block prose leaves', async () => {
    const created = (await docCall(
      'doc_create',
      {
        title: 'Two Rooms',
        content: 'The first room remembered her.\n\nThe second room refused.',
        level: 'document',
        isDocRoot: true,
        fileType: 'md',
      },
      contextManager,
      'writing',
    )) as {
      id: string;
      granularityReview?: {
        status: string;
        structuralBlockCount: number;
        observed: { candidateSplitLines: number[] };
        message: string;
        nextAction: string;
      };
    };

    expect(created.granularityReview).toEqual(
      expect.objectContaining({
        status: 'review',
        structuralBlockCount: 2,
        observed: expect.objectContaining({ candidateSplitLines: [2] }),
      }),
    );
    expect(created.granularityReview?.message).toContain(
      'move, replace, compare, annotate, or revise',
    );
    expect(created.granularityReview?.nextAction).toContain(
      'If independent passage-level work is plausible',
    );

    const revised = (await docCall(
      'doc_revise',
      {
        nodeId: created.id,
        content:
          'The first room remembered her.\n\n* * *\n\nThe second room refused.',
        why: 'Let the threshold become visible.',
      },
      contextManager,
      'writing',
    )) as { granularityReview?: { structuralBlockCount: number } };
    expect(revised.granularityReview?.structuralBlockCount).toBe(3);

    const read = (await handleToolCall(
      'doc_read',
      { nodeId: created.id },
      contextManager,
      'writing',
    )) as {
      granularityReviews: Array<{
        nodeId: string;
        observed: { sceneBreakLines: number[] };
      }>;
    };
    expect(read.granularityReviews).toEqual([
      expect.objectContaining({
        nodeId: created.id,
        observed: expect.objectContaining({ sceneBreakLines: [2] }),
      }),
    ]);

    const generated = (await handleToolCall(
      'doc_generate',
      { rootId: created.id },
      contextManager,
      'writing',
    )) as { granularityReviews: Array<{ nodeId: string }> };
    expect(generated.granularityReviews).toEqual([
      expect.objectContaining({ nodeId: created.id }),
    ]);

    const batched = (await handleToolCall(
      'graph_batch',
      {
        agent_name: 'test-agent',
        commit_message: 'Let the two rooms answer each other',
        ignoreWarnings: true,
        operations: [
          {
            tool: 'doc_revise',
            params: {
              nodeId: created.id,
              content: 'The first room remembered her.\n\nThe second refused.',
              why: 'Test the ordinary atomic writing path.',
            },
          },
        ],
      },
      contextManager,
      'writing',
    )) as {
      results: Array<{
        granularityReview?: { structuralBlockCount: number };
      }>;
    };
    expect(batched.results[0]?.granularityReview?.structuralBlockCount).toBe(2);
  });

  it('does not review a single-block leaf, a container, or code', async () => {
    const root = (await docCall(
      'doc_create',
      {
        title: 'One Center',
        content: 'The room remembered only her.',
        level: 'document',
        isDocRoot: true,
        fileType: 'md',
      },
      contextManager,
      'writing',
    )) as { id: string; granularityReview?: unknown };
    expect(root).not.toHaveProperty('granularityReview');

    const nonWritingRevision = (await docCall(
      'doc_revise',
      {
        nodeId: root.id,
        content: 'One responsibility.\n\nA second responsibility.',
        why: 'Exercise the non-writing document surface.',
      },
      contextManager,
      'coding',
    )) as { granularityReview?: unknown };
    expect(nonWritingRevision).not.toHaveProperty('granularityReview');

    await docCall(
      'doc_create',
      {
        title: 'A held image',
        content: 'Dust moved through one blade of light.',
        level: 'paragraph',
        parentId: root.id,
      },
      contextManager,
      'writing',
    );
    const read = (await handleToolCall(
      'doc_read',
      { nodeId: root.id },
      contextManager,
      'writing',
    )) as { granularityReviews: unknown[] };
    expect(read.granularityReviews).toEqual([]);

    const codeRoot = (await docCall(
      'doc_create',
      {
        title: 'story_helper.py',
        content: 'VALUE = 1\n\nOTHER = 2',
        level: 'document',
        isDocRoot: true,
        fileType: 'py',
        afterId: root.id,
      },
      contextManager,
      'writing',
    )) as { granularityReview?: unknown };
    expect(codeRoot).not.toHaveProperty('granularityReview');
  });

  it('persists and renders the prior prose and summary', async () => {
    const root = await createRoot(
      'The city became a set of promises.',
      'The map organizes the city.',
    );

    await docCall(
      'doc_revise',
      {
        nodeId: root.id,
        content: 'Before I moved, the map had taught my eyes what to count.',
        summary: "The map alters the traveler's attention.",
        why: 'Move from description to a reader-facing perceptual shift.',
      },
      contextManager,
    );

    const stored = getGraphStore().getNode(root.id);
    expect(stored?.revisions[0]).toEqual(
      expect.objectContaining({
        version: 1,
        content: 'The city became a set of promises.',
        summary: 'The map organizes the city.',
      }),
    );

    const read = (await handleToolCall(
      'doc_read',
      { nodeId: root.id, showRevisions: true },
      contextManager,
    )) as {
      content: string;
      structure: Array<{
        revisions: Array<{
          content: string;
          summary: string;
          contentStored: boolean;
        }>;
      }>;
    };

    expect(read.structure[0].revisions[0]).toEqual(
      expect.objectContaining({
        content: 'The city became a set of promises.',
        summary: 'The map organizes the city.',
        contentStored: true,
      }),
    );
    expect(read.content).toContain(
      'SUMMARY:\n        The map organizes the city.',
    );
    expect(read.content).toContain(
      'CONTENT:\n        The city became a set of promises.',
    );
    expect(read.content).toContain(
      'CURRENT (v2):\nBefore I moved, the map had taught my eyes what to count.',
    );
  });

  it('renders legacy revision metadata without pretending old prose is known', async () => {
    const root = await createRoot('Current manuscript text.');
    sqlite
      .getDb()
      .prepare('UPDATE nodes SET version = 2, revisions = ? WHERE id = ?')
      .run(
        JSON.stringify([
          {
            title: 'The Map That Looked Back',
            trigger: 'foundation',
            version: 1,
            timestamp: '2026-01-01T00:00:00.000Z',
            revisionWhy: 'Legacy editorial revision',
            conversationId: null,
          },
        ]),
        root.id,
      );

    const read = (await handleToolCall(
      'doc_read',
      { nodeId: root.id, showRevisions: true },
      contextManager,
    )) as {
      content: string;
      structure: Array<{
        revisions: Array<{
          content?: string;
          contentStored: boolean;
        }>;
      }>;
    };

    expect(read.structure[0].revisions[0]).toEqual(
      expect.objectContaining({ contentStored: false }),
    );
    expect(read.structure[0].revisions[0]).not.toHaveProperty('content');
    expect(read.content).toContain('Legacy editorial revision');
    expect(read.content).toContain(
      'CONTENT: [not stored in this legacy revision]',
    );
    expect(read.content).not.toContain('undefined');
  });
});
