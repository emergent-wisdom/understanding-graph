import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  getGraphStore,
  resetGraphStore,
  sqlite,
  withReservedThinkingVisibility,
} from '@emergent-wisdom/understanding-graph-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ContextManager } from '../context-manager.js';
import { handleToolCall } from '../tools/index.js';
import { handleReflectionTools } from '../tools/reflection.js';

const PROJECT_ID = 'reflection-visibility';
const SINCE_BEFORE_FIXTURES = '1970-01-01 00:00:00';

let tmpDir: string;
let contextManager: ContextManager;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ug-reflection-visibility-'));
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

async function callOrdinary(
  name: string,
  args: Record<string, unknown> = {},
): Promise<unknown> {
  return handleToolCall(name, args, contextManager, 'full');
}

async function callSynthetic(
  name: string,
  args: Record<string, unknown> = {},
): Promise<unknown> {
  return handleToolCall(name, args, contextManager, 'synthetic_reader');
}

function serialized(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function ordinaryRegionContaining(nodeId: string): number {
  return withReservedThinkingVisibility(false, () => {
    for (const [regionId, nodes] of getGraphStore().detectCommunities()
      .communities) {
      if (nodes.some((node) => node.id === nodeId)) return regionId;
    }
    throw new Error(`No ordinary region contains ${nodeId}`);
  });
}

function seedVisibilityFixture() {
  const store = getGraphStore();
  const anchor = store.createNode({
    title: 'Visible reflection anchor',
    trigger: 'foundation',
    why: 'Anchors ordinary reflection outputs.',
    understanding: 'Visible shared structure remains available.',
  });
  const refinement = store.createNode({
    title: 'Visible reflection refinement',
    trigger: 'analysis',
    why: 'Exercises ordinary graph algorithms.',
    understanding: 'Visible shared structure becomes more precise.',
  });
  const remote = store.createNode({
    title: 'Visible remote concept',
    trigger: 'question',
    why: 'Provides a path whose only bridge is reserved.',
    understanding: 'Visible shared structure asks what connects the regions.',
  });
  const ordinaryEdge = store.createEdge({
    fromId: refinement.id,
    toId: anchor.id,
    type: 'refines',
    explanation: 'Visible refinement relation',
    why: 'Keeps ordinary output meaningfully connected.',
  });
  sqlite.createCommit(
    'Visible ordinary reflection commit',
    [anchor.id, refinement.id, remote.id],
    [ordinaryEdge.id],
    'ordinary-agent',
  );

  sqlite.saveConversation(
    'reserved-tool-session',
    'Create a reserved Reader block',
  );
  const toolCallId = sqlite.startToolCall(
    'reserved-tool-session',
    'doc_append_thinking',
    { title: 'RESERVED_TOOL_ARGUMENT_MARKER' },
  );
  const { reserved, legacyReserved, incidentToAnchor, incidentFromRemote } =
    withReservedThinkingVisibility(true, () => {
      const reserved = store.createNode({
        title: 'RESERVED_REFLECTION_TITLE',
        trigger: 'thinking',
        why: 'RESERVED_WHY_MARKER',
        understanding: 'RESERVED_SIGNATURE_MARKER',
        content: 'ultravioletquasar RESERVED_BODY_MARKER',
        level: 'paragraph',
        fileType: 'thinking',
        references: [
          {
            url: 'https://reserved.invalid/RESERVED_REFERENCE_MARKER',
            title: 'Reserved reference',
          },
        ],
        metadata: { classified: 'RESERVED_METADATA_VALUE' },
        toolCallId,
      });
      const legacyReserved = store.createNode({
        title: 'RESERVED_LEGACY_TITLE',
        trigger: 'analysis',
        content: 'A legacy reserved block with shared structure language.',
        level: 'paragraph',
        fileType: 'thinking',
      });
      const incidentToAnchor = store.createEdge({
        fromId: reserved.id,
        toId: anchor.id,
        type: 'refines',
        explanation: 'RESERVED_EDGE_MARKER',
        why: 'RESERVED_EDGE_WHY_MARKER',
        toolCallId,
      });
      const incidentFromRemote = store.createEdge({
        fromId: remote.id,
        toId: reserved.id,
        type: 'questions',
        explanation: 'RESERVED_BRIDGE_MARKER',
        why: 'Makes the synthetic-only path observable.',
        toolCallId,
      });
      store.createEdge({
        fromId: legacyReserved.id,
        toId: refinement.id,
        type: 'relates',
        explanation: 'RESERVED_LEGACY_EDGE_MARKER',
        why: 'Exercises legacy file-type projection.',
        toolCallId,
      });
      sqlite.completeToolCall(toolCallId, {
        nodeId: reserved.id,
        marker: 'RESERVED_TOOL_RESULT_MARKER',
      });
      sqlite.createCommit(
        'RESERVED_COMMIT_MARKER',
        [reserved.id, legacyReserved.id],
        [incidentToAnchor.id, incidentFromRemote.id],
        'synthetic-agent',
      );
      return {
        reserved,
        legacyReserved,
        incidentToAnchor,
        incidentFromRemote,
      };
    });

  return {
    anchor,
    refinement,
    remote,
    reserved,
    legacyReserved,
    incidentToAnchor,
    incidentFromRemote,
  };
}

describe('reflection reserved-artifact visibility', () => {
  it('finds exact document language even when a summary is also present', async () => {
    const document = getGraphStore().createNode({
      title: 'Document search fixture',
      trigger: 'foundation',
      why: 'Exercises exact document retrieval in lexical fallback mode.',
      understanding: 'A compressed interpretation that omits the marker.',
      summary: 'A short summary that also omits it.',
      content: 'The mirroredchambertoken occurs only in exact document text.',
      level: 'document',
      isDocRoot: true,
      fileType: 'md',
    });

    const result = (await callOrdinary('graph_semantic_search', {
      query: 'mirroredchambertoken',
    })) as {
      searchMode: string;
      results: Array<{ id: string; region_id: number | null }>;
    };

    expect(result.searchMode).toBe('lexical_fallback');
    expect(result.results).toEqual([
      expect.objectContaining({
        id: document.id,
        region_id: ordinaryRegionContaining(document.id),
      }),
    ]);
  });

  it('keeps ordinary renderers, enumeration, and graph algorithms free of reserved artifacts', async () => {
    const fixture = seedVisibilityFixture();
    const regionId = ordinaryRegionContaining(fixture.anchor.id);

    const outputs = [
      await callOrdinary('graph_context', { compact: false }),
      await callOrdinary('graph_context', { nodeId: fixture.anchor.id }),
      await callOrdinary('graph_context', { compact: true }),
      await callOrdinary('graph_context_region', { region_id: regionId }),
      await withReservedThinkingVisibility(false, () =>
        handleReflectionTools(
          'graph_updates',
          { since: SINCE_BEFORE_FIXTURES },
          contextManager,
        ),
      ),
      await callOrdinary('graph_skeleton'),
      await callOrdinary('graph_path', {
        from: fixture.remote.id,
        to: fixture.anchor.id,
      }),
      await callOrdinary('graph_analyze'),
      await callOrdinary('graph_semantic_search', {
        query: 'ultravioletquasar',
      }),
      await callOrdinary('graph_similar', { node: fixture.anchor.id }),
      await callOrdinary('graph_semantic_gaps', { use_embeddings: false }),
      await callOrdinary('graph_centrality'),
      await callOrdinary('graph_history'),
      await callOrdinary('graph_find_by_reference', {
        url: 'reserved.invalid',
      }),
      await callOrdinary('graph_search_metadata', { field: 'classified' }),
      await callOrdinary('graph_find_by_trigger', { trigger: 'analysis' }),
      await callOrdinary('node_get_revisions', {
        nodeId: fixture.reserved.id,
      }),
      await callOrdinary('edge_get_revisions', {
        edgeId: fixture.incidentToAnchor.id,
      }),
      await callOrdinary('graph_similar', { node: fixture.reserved.id }),
      await callOrdinary('graph_resolve_references', {
        nodeId: fixture.reserved.id,
      }),
      await callOrdinary('graph_global_lookup', {
        nodeId: fixture.reserved.id,
      }),
      await callOrdinary('graph_lookup_external', {
        project: PROJECT_ID,
        nodeId: fixture.reserved.id,
      }),
    ];

    const forbidden = [
      fixture.reserved.id,
      fixture.legacyReserved.id,
      fixture.incidentToAnchor.id,
      fixture.incidentFromRemote.id,
      'RESERVED_REFLECTION_TITLE',
      'RESERVED_LEGACY_TITLE',
      'RESERVED_BODY_MARKER',
      'RESERVED_EDGE_MARKER',
      'RESERVED_BRIDGE_MARKER',
      'RESERVED_LEGACY_EDGE_MARKER',
      'RESERVED_REFERENCE_MARKER',
      'RESERVED_METADATA_VALUE',
      'RESERVED_COMMIT_MARKER',
      'RESERVED_TOOL_ARGUMENT_MARKER',
      'RESERVED_TOOL_RESULT_MARKER',
    ];

    for (const output of outputs) {
      const text = serialized(output);
      for (const marker of forbidden) expect(text).not.toContain(marker);
    }

    expect(serialized(outputs[6])).toContain('No path between');
    expect(outputs[8]).toMatchObject({ count: 0 });
    expect(outputs[13]).toMatchObject({ total: 0, nodes: [] });
    expect(outputs[14]).toMatchObject({ total: 0, nodes: [] });
  });

  it('rejects direct thinking enumeration in ordinary modes and surfaces it in synthetic mode', async () => {
    const fixture = seedVisibilityFixture();

    await expect(
      callOrdinary('graph_find_by_trigger', { trigger: 'thinking' }),
    ).rejects.toThrow('only visible in TOOL_MODE "synthetic_reader"');

    const found = await callSynthetic('graph_find_by_trigger', {
      trigger: 'thinking',
    });
    expect(serialized(found)).toContain(fixture.reserved.id);
    expect(serialized(found)).toContain('RESERVED_REFLECTION_TITLE');
  });

  it('lets synthetic reflection read the reserved context, path, search, updates, and history', async () => {
    const fixture = seedVisibilityFixture();

    const outputs = [
      await callSynthetic('graph_context', { compact: false }),
      await callSynthetic('graph_path', {
        from: fixture.remote.id,
        to: fixture.anchor.id,
      }),
      await callSynthetic('graph_semantic_search', {
        query: 'ultravioletquasar',
      }),
      await callSynthetic('graph_history'),
      await withReservedThinkingVisibility(true, () =>
        handleReflectionTools(
          'graph_updates',
          { since: SINCE_BEFORE_FIXTURES },
          contextManager,
        ),
      ),
    ].map(serialized);

    expect(outputs[0]).toContain('RESERVED_REFLECTION_TITLE');
    expect(outputs[0]).toContain('RESERVED_EDGE_MARKER');
    expect(outputs[1]).toContain('RESERVED_REFLECTION_TITLE');
    expect(outputs[2]).toContain(fixture.reserved.id);
    expect(outputs[3]).toContain('RESERVED_COMMIT_MARKER');
    expect(outputs[4]).toContain('RESERVED_TOOL_ARGUMENT_MARKER');
  });

  it('prevents ordinary bulk replacement or purge from mutating reserved artifacts', async () => {
    const fixture = seedVisibilityFixture();

    const replace = await callOrdinary('graph_bulk_replace', {
      find: 'RESERVED_BODY_MARKER',
      replace: 'MUTATED_RESERVED_MARKER',
      preview: false,
    });
    expect(replace).toMatchObject({ matchCount: 0, nodesAffected: 0 });

    const preview = await callOrdinary('graph_purge', {
      nodeIds: [fixture.reserved.id],
      confirm: false,
      reason: 'Reserved target must remain hidden',
    });
    expect(preview).toMatchObject({
      willDelete: { nodes: 0, edges: 0, cascadeEdges: 0 },
    });
    await expect(
      callOrdinary('graph_purge', {
        nodeIds: [fixture.reserved.id],
        confirm: true,
        reason: 'Reserved target must be rejected',
      }),
    ).rejects.toThrow(/reserved|not visible/i);

    const synthetic = await callSynthetic('graph_context', {
      nodeId: fixture.reserved.id,
    });
    expect(serialized(synthetic)).toContain('RESERVED_BODY_MARKER');
    expect(serialized(synthetic)).not.toContain('MUTATED_RESERVED_MARKER');
  });

  it('refreshes graph-backed reads after bulk replacement and purge', async () => {
    const store = getGraphStore();
    const first = store.createNode({
      title: 'Cache Admin Before',
      trigger: 'foundation',
      why: 'Exercises administrative cache invalidation.',
      understanding: 'This title will change through bulk replacement.',
    });
    const second = store.createNode({
      title: 'Cache Admin Neighbor',
      trigger: 'analysis',
      why: 'Exercises graph-backed reads after permanent deletion.',
      understanding: 'This node will be purged after the cache is loaded.',
    });
    store.createEdge({
      fromId: first.id,
      toId: second.id,
      type: 'relates',
      why: 'Keeps both admin fixtures in one cached neighborhood.',
    });
    expect(store.findPath(first.id, second.id).exists).toBe(true);

    await callOrdinary('graph_bulk_replace', {
      find: 'Cache Admin Before',
      replace: 'Cache Admin After',
      fields: ['title'],
      preview: false,
    });
    expect(store.getNeighborhood(first.id).nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: first.id,
          title: 'Cache Admin After',
        }),
      ]),
    );

    await callOrdinary('graph_purge', {
      nodeIds: [second.id],
      confirm: true,
      reason: 'Verify graph cache refresh after a confirmed purge',
    });
    expect(store.getNode(second.id)).toBeNull();
    expect(store.getGraph().hasNode(second.id)).toBe(false);
    expect(store.findPath(first.id, second.id).exists).toBe(false);
  });
});
