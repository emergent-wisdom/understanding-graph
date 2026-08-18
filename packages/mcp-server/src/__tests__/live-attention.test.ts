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

const PROJECT_ID = 'live-attention';
let tmpDir: string;
let contextManager: ContextManager;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ug-live-attention-'));
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
    // Ignore cleanup after failed assertions.
  }
  resetGraphStore();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('artifact-linked live attention', () => {
  it('captures an optional open thread atomically and resurfaces it on projection', async () => {
    const result = (await handleToolCall(
      'graph_batch',
      {
        commit_message:
          'Start the resolver and preserve the unresolved shadowing choice beside it',
        operations: [
          {
            tool: 'doc_create',
            params: {
              title: 'resolver.py',
              content: '"""Layered resolver."""\n',
              level: 'document',
              isDocRoot: true,
              fileType: 'py',
            },
          },
          {
            tool: 'graph_note',
            params: {
              about: '$0.id',
              title: 'Scalar versus subtree shadowing remains live',
              trigger: 'tension',
              testimony:
                'A higher layer could reject shape conflicts or replace the lower subtree. The next merge unit and provenance tests should distinguish the consequences before this becomes a decision.',
            },
          },
        ],
      },
      contextManager,
      'coding',
    )) as {
      success: boolean;
      results: Array<{ id: string; edgeId?: string }>;
      reentry?: {
        focusNodeIds: string[];
        suggestedCall: {
          arguments: Record<string, unknown>;
        };
      };
    };

    expect(result.success).toBe(true);
    const rootId = result.results[0]?.id;
    const noteId = result.results[1]?.id;
    const noteEdgeId = result.results[1]?.edgeId;
    expect(rootId).toBeTruthy();
    expect(noteId).toBeTruthy();
    expect(result.reentry?.focusNodeIds.slice(0, 2)).toEqual([noteId, rootId]);

    const store = getGraphStore();
    expect(store.getNode(noteId)?.metadata).toEqual(
      expect.objectContaining({
        liveAttention: true,
        attentionStatus: 'open',
        aboutNodeId: rootId,
      }),
    );
    expect(store.getAll().edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: noteEdgeId,
          fromId: noteId,
          toId: rootId,
          type: 'learned_from',
        }),
      ]),
    );

    const generated = (await handleToolCall(
      'doc_generate',
      { rootId },
      contextManager,
      'coding',
    )) as {
      success: boolean;
      openAttention: Array<{
        id: string;
        aboutNodeId: string;
        excerpt: string;
        edge: { id: string; type: string };
      }>;
    };

    expect(generated.success).toBe(true);
    expect(generated.openAttention).toEqual([
      expect.objectContaining({
        id: noteId,
        aboutNodeId: rootId,
        excerpt: expect.stringContaining('provenance tests'),
        edge: { id: noteEdgeId, type: 'learned_from', why: expect.any(String) },
      }),
    ]);

    const reentered = (await handleToolCall(
      'graph_understand',
      result.reentry?.suggestedCall.arguments || {},
      contextManager,
      'coding',
    )) as {
      frame: {
        focus?: Array<{ id: string }>;
        relations: Array<{ id: string; from: string; to: string }>;
      };
    };
    expect(reentered.frame.focus?.map((node) => node.id)).toEqual([
      noteId,
      rootId,
    ]);
    expect(reentered.frame.relations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: noteEdgeId,
          from: noteId,
          to: rootId,
        }),
      ]),
    );
  });

  it('lets changed understanding emerge from re-entering prior graph material', async () => {
    const prior = getGraphStore().createNode({
      title: 'Optimization changes what the system notices',
      trigger: 'model',
      why: 'A prior understanding can itself become the next encounter.',
      understanding:
        'Optimizing one proxy narrows the observations the system can value.',
    });

    const result = (await handleToolCall(
      'graph_batch',
      {
        commit_message:
          'Preserve the new question that emerged while re-entering the prior model',
        operations: [
          {
            tool: 'graph_note',
            params: {
              about: prior.id,
              title: 'Can the graph reveal what its optimization excludes?',
              trigger: 'question',
              testimony:
                'Re-entering the earlier model makes exclusion itself newly salient: the next inquiry should compare what the graph repeatedly retrieves with what remains structurally cold.',
            },
          },
        ],
      },
      contextManager,
      'coding',
    )) as {
      success: boolean;
      results: Array<{ id: string; about: { id: string } }>;
    };

    expect(result.success).toBe(true);
    expect(result.results[0]?.about.id).toBe(prior.id);
    expect(getGraphStore().getAll().edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fromId: result.results[0]?.id,
          toId: prior.id,
          type: 'learned_from',
        }),
      ]),
    );
  });

  it('keeps graph_note batch-only', async () => {
    await expect(
      handleToolCall(
        'graph_note',
        {
          about: 'n_missing',
          testimony: 'This should never bypass the atomic commit surface.',
        },
        contextManager,
        'coding',
      ),
    ).rejects.toThrow(/not available in TOOL_MODE "coding"/);
  });

  it('optionally preserves a genuine cognitive relationship from the new note', async () => {
    const result = (await handleToolCall(
      'graph_batch',
      {
        commit_message:
          'Draft the resolver and preserve how the later question challenges its first assumption',
        ignoreWarnings: true,
        operations: [
          {
            tool: 'doc_create',
            params: {
              title: 'resolver-relations.py',
              content: 'def resolve(value):\n    return value\n',
              level: 'document',
              isDocRoot: true,
              fileType: 'py',
            },
          },
          {
            tool: 'graph_note',
            params: {
              about: '$0.id',
              title: 'Resolution currently assumes one stable value',
              trigger: 'hypothesis',
              testimony:
                'The minimal implementation assumes resolution selects one stable value rather than a context-sensitive view.',
            },
          },
          {
            tool: 'graph_note',
            params: {
              about: '$0.id',
              title: 'Caller context may change what resolution means',
              trigger: 'question',
              testimony:
                'A caller may need the value together with the layer that supplied it, so the current meaning of resolution remains open.',
              relations: [
                {
                  node: 'Resolution currently assumes one stable value',
                  type: 'questions',
                  why: 'The later provenance need directly challenges the earlier stable-value assumption.',
                },
              ],
            },
          },
        ],
      },
      contextManager,
      'coding',
    )) as {
      success: boolean;
      results: Array<{
        id: string;
        affectedEdgeIds?: string[];
        relations?: Array<{
          id: string;
          node: { id: string; title: string };
          type: string;
          why: string;
        }>;
      }>;
    };

    expect(result.success).toBe(true);
    const firstNoteId = result.results[1]?.id;
    const secondNoteId = result.results[2]?.id;
    const relation = result.results[2]?.relations?.[0];
    expect(relation).toEqual(
      expect.objectContaining({
        node: {
          id: firstNoteId,
          title: 'Resolution currently assumes one stable value',
        },
        type: 'questions',
        why: expect.stringContaining('challenges'),
      }),
    );
    expect(result.results[2]?.affectedEdgeIds).toContain(relation?.id);
    expect(getGraphStore().getAll().edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: relation?.id,
          fromId: secondNoteId,
          toId: firstNoteId,
          type: 'questions',
          why: expect.stringContaining('challenges'),
        }),
      ]),
    );
  });

  it('rolls back the whole batch when a graph_note relation target is invalid', async () => {
    const result = (await handleToolCall(
      'graph_batch',
      {
        commit_message:
          'Attempt to capture attention with a relationship whose target is unavailable',
        operations: [
          {
            tool: 'doc_create',
            params: {
              title: 'rolled-back.py',
              content: 'VALUE = "provisional"\n',
              level: 'document',
              isDocRoot: true,
              fileType: 'py',
            },
          },
          {
            tool: 'graph_note',
            params: {
              about: '$0.id',
              title: 'This note must not survive',
              trigger: 'question',
              testimony:
                'The relationship endpoint is missing, so neither the artifact nor this note belongs in the graph.',
              relations: [
                {
                  node: 'A cognitive node that does not exist',
                  type: 'questions',
                  why: 'This deliberately unavailable target exercises atomic validation.',
                },
              ],
            },
          },
        ],
      },
      contextManager,
      'coding',
    )) as {
      success: boolean;
      completed: number;
      errors: Array<{ index: number; tool: string; error: string }>;
    };

    expect(result.success).toBe(false);
    expect(result.completed).toBe(1);
    expect(result.errors).toEqual([
      expect.objectContaining({
        index: 1,
        tool: 'graph_note',
        error: expect.stringContaining('Node not found'),
      }),
    ]);
    expect(getGraphStore().getAll()).toEqual({ nodes: [], edges: [] });
  });

  it('preserves a resolved note in history without resurfacing it as open attention', async () => {
    const result = (await handleToolCall(
      'graph_batch',
      {
        commit_message:
          'Record the compatibility finding and complete its correction atomically',
        operations: [
          {
            tool: 'doc_create',
            params: {
              title: 'compatibility.py',
              content: 'VALUE = "corrected"\n',
              level: 'document',
              isDocRoot: true,
              fileType: 'py',
            },
          },
          {
            tool: 'graph_note',
            params: {
              about: '$0.id',
              title: 'Compatibility mismatch was corrected',
              trigger: 'evaluation',
              testimony:
                'The generated projection exposed a mismatch, and this commit contains the complete correction.',
              status: 'resolved',
            },
          },
        ],
      },
      contextManager,
      'coding',
    )) as {
      success: boolean;
      results: Array<{ id: string; status?: string }>;
    };

    expect(result.success).toBe(true);
    expect(result.results[1]?.status).toBe('resolved');
    const rootId = result.results[0]?.id;
    const noteId = result.results[1]?.id;
    expect(getGraphStore().getNode(noteId)?.metadata).toEqual(
      expect.objectContaining({ attentionStatus: 'resolved' }),
    );

    const reread = (await handleToolCall(
      'doc_read',
      { nodeId: rootId },
      contextManager,
      'coding',
    )) as { success: boolean; openAttention: unknown[] };
    expect(reread.success).toBe(true);
    expect(reread.openAttention).toEqual([]);
  });
});
