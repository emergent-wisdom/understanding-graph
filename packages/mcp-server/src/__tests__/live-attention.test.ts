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
  it('captures an open thread atomically and resurfaces it on projection', async () => {
    const result = (await handleToolCall(
      'graph_batch',
      {
        agent_name: 'test-agent',
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
            tool: 'graph_add_understanding',
            params: {
              title: 'Scalar versus subtree shadowing remains live',
              trigger: 'tension',
              understanding:
                'A higher layer could reject shape conflicts or replace the lower subtree.',
              why: 'Opens the shadowing choice the next merge unit has to settle',
              attend:
                'The next merge unit and provenance tests should distinguish the consequences before this becomes a decision.',
            },
          },
          {
            tool: 'graph_connect',
            params: {
              from: '$1.id',
              to: '$0.id',
              type: 'learned_from',
              why: 'The tension arose while starting the resolver',
            },
          },
        ],
      },
      contextManager,
      'coding',
    )) as {
      success: boolean;
      results: Array<{ id: string }>;
      navigation?: { focusNodeIds: string[] };
    };

    expect(result.success).toBe(true);
    const rootId = result.results[0]?.id;
    const nodeId = result.results[1]?.id;
    const edgeId = result.results[2]?.id;
    expect(rootId).toBeTruthy();
    expect(nodeId).toBeTruthy();
    expect(result.navigation?.focusNodeIds).toEqual(
      expect.arrayContaining([nodeId, rootId]),
    );

    const store = getGraphStore();
    expect(store.getNode(nodeId)?.metadata).toEqual(
      expect.objectContaining({
        liveAttention: true,
        attentionStatus: 'open',
      }),
    );
    expect(store.getAll().edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: edgeId,
          fromId: nodeId,
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
        id: nodeId,
        aboutNodeId: rootId,
        excerpt: expect.stringContaining('lower subtree'),
        edge: { id: edgeId, type: 'learned_from', why: expect.any(String) },
      }),
    ]);

    const reentered = (await handleToolCall(
      'graph_understand',
      {
        query: 'Re-enter the newly recorded shadowing tension',
        workflow: 'coding',
        focusNodeIds: [nodeId, rootId],
      },
      contextManager,
      'coding',
    )) as {
      frame: {
        focus?: Array<{ id: string }>;
        relations: Array<{ id: string; from: string; to: string }>;
      };
    };
    expect(reentered.frame.focus?.map((node) => node.id)).toEqual([
      nodeId,
      rootId,
    ]);
    expect(reentered.frame.relations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: edgeId,
          from: nodeId,
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
        agent_name: 'test-agent',
        commit_message:
          'Preserve the new question that emerged while re-entering the prior model',
        operations: [
          {
            tool: 'graph_add_understanding',
            params: {
              title: 'Can the graph reveal what its optimization excludes?',
              trigger: 'question',
              understanding:
                'Re-entering the earlier model makes exclusion itself newly salient: compare what the graph repeatedly retrieves with what remains structurally cold.',
              why: 'Opens a question about what the earlier model leaves out',
            },
          },
          {
            tool: 'graph_connect',
            params: {
              from: '$0.id',
              to: prior.id,
              type: 'learned_from',
              why: 'The question arose while re-entering the earlier model',
            },
          },
        ],
      },
      contextManager,
      'coding',
    )) as {
      success: boolean;
      results: Array<{ id: string }>;
    };

    expect(result.success).toBe(true);
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

  it('refuses the removed operation names with a pointer to graph_add_understanding', async () => {
    for (const name of ['graph_note', 'graph_add_concept']) {
      await expect(
        handleToolCall(
          name,
          { title: 'x', understanding: 'y' },
          contextManager,
          'coding',
        ),
      ).rejects.toThrow(/graph_add_understanding/);

      const batch = (await handleToolCall(
        'graph_batch',
        {
          agent_name: 'test-agent',
          commit_message: 'Attempt a removed operation name',
          operations: [
            {
              tool: name,
              params: {
                title: 'Removed operation',
                trigger: 'question',
                understanding: 'This must not be written.',
                why: 'Exercises the refusal',
              },
            },
          ],
        },
        contextManager,
        'coding',
      )) as { success: boolean; error: string; message: string };
      expect(batch.success).toBe(false);
      expect(batch.error).toBe('BATCH_OPERATION_REMOVED');
      expect(batch.message).toContain('graph_add_understanding');
    }
    expect(getGraphStore().getAll()).toEqual({ nodes: [], edges: [] });
  });

  it('does not resurface an understanding recorded without attend', async () => {
    const result = (await handleToolCall(
      'graph_batch',
      {
        agent_name: 'test-agent',
        commit_message:
          'Record the compatibility finding together with its complete correction',
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
            tool: 'graph_add_understanding',
            params: {
              title: 'Compatibility mismatch was corrected',
              trigger: 'evaluation',
              understanding:
                'The generated projection exposed a mismatch, and this commit contains the complete correction.',
              why: 'Settles the mismatch the projection exposed',
            },
          },
          {
            tool: 'graph_connect',
            params: {
              from: '$1.id',
              to: '$0.id',
              type: 'learned_from',
              why: 'The finding came from this file',
            },
          },
        ],
      },
      contextManager,
      'coding',
    )) as {
      success: boolean;
      results: Array<{ id: string }>;
    };

    expect(result.success).toBe(true);
    const rootId = result.results[0]?.id;
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
