import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import * as sqlite from '../database/sqlite.js';
import { withReservedThinkingVisibility } from '../visibility.js';
import { analyzeGraph } from './AnalysisService.js';
import { getGraphStore, resetGraphStore } from './GraphStore.js';

const PROJECT_ID = 'visibility-test';

function initializeGraph() {
  const tempDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'understanding-graph-visibility-'),
  );
  const projectsDirectory = path.join(tempDirectory, 'projects');
  fs.mkdirSync(projectsDirectory, { recursive: true });
  sqlite.initAllDatabases(projectsDirectory);
  sqlite.initDatabase(path.join(projectsDirectory, PROJECT_ID));
  sqlite.setCurrentProject(PROJECT_ID);
  resetGraphStore();
  return getGraphStore();
}

afterEach(() => {
  sqlite.closeAllDatabases();
  resetGraphStore();
});

describe('mode-scoped reserved thinking visibility', () => {
  it('projects nodes, incident edges, algorithms, documents, and cross-project queries', () => {
    const store = initializeGraph();
    const visibleA = store.createNode({
      title: 'Visible A',
      trigger: 'foundation',
      why: 'Starts the visible path',
      understanding: 'A visible concept',
    });
    const hidden = withReservedThinkingVisibility(true, () =>
      store.createNode({
        title: 'Reserved thought',
        trigger: 'thinking',
        why: 'Synthetic Reader artifact',
        understanding: 'Reserved reasoning block',
      }),
    );
    const visibleB = store.createNode({
      title: 'Visible B',
      trigger: 'analysis',
      why: 'Ends the visible path',
      understanding: 'Another visible concept',
    });
    const legacyHidden = withReservedThinkingVisibility(true, () =>
      store.createDocumentNode({
        title: 'Legacy reserved root',
        content: 'Legacy thinking content',
        isDocRoot: true,
        fileType: 'thinking',
      }),
    );

    withReservedThinkingVisibility(true, () => {
      store.createEdge({
        fromId: visibleA.id,
        toId: hidden.id,
        type: 'contextualizes',
        why: 'The reserved artifact sits between visible concepts',
      });
      store.createEdge({
        fromId: hidden.id,
        toId: visibleB.id,
        type: 'contextualizes',
        why: 'The reserved artifact continues to the visible conclusion',
      });
    });

    const documentRoot = store.createDocumentNode({
      title: 'Visible document',
      content: 'Document root',
      isDocRoot: true,
      fileType: 'md',
    });
    const paragraphA = store.createDocumentNode({
      title: 'Paragraph A',
      content: 'A',
      level: 'paragraph',
      parentId: documentRoot.id,
    });
    const { thinkingParagraph, paragraphB } = withReservedThinkingVisibility(
      true,
      () => {
        const thinkingParagraph = store.createDocumentNode({
          title: 'Thinking between paragraphs',
          content: 'Reserved',
          level: 'thinking',
          trigger: 'thinking',
          parentId: documentRoot.id,
          afterId: paragraphA.id,
        });
        const paragraphB = store.createDocumentNode({
          title: 'Paragraph B',
          content: 'B',
          level: 'paragraph',
          parentId: documentRoot.id,
          afterId: thinkingParagraph.id,
        });
        return { thinkingParagraph, paragraphB };
      },
    );

    // Unscoped direct core callers fail closed just like ordinary MCP modes.
    expect(store.getNode(hidden.id)).toBeNull();
    expect(store.getAll().nodes).toHaveLength(5);
    expect(store.loadGraph().hasNode(hidden.id)).toBe(false);
    expect(store.loadGraph().hasNode(legacyHidden.id)).toBe(false);
    expect(store.findPath(visibleA.id, visibleB.id).exists).toBe(false);
    expect(
      analyzeGraph(PROJECT_ID).stats.triggerDistribution,
    ).not.toHaveProperty('thinking');

    withReservedThinkingVisibility(false, () => {
      const all = store.getAll();
      expect(all.nodes.map((node) => node.id)).not.toContain(hidden.id);
      expect(all.nodes.map((node) => node.id)).not.toContain(legacyHidden.id);
      expect(all.edges).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ fromId: visibleA.id, toId: hidden.id }),
        ]),
      );
      expect(store.getNode(hidden.id)).toBeNull();
      expect(store.getNode(legacyHidden.id)).toBeNull();
      expect(store.findPath(visibleA.id, visibleB.id).exists).toBe(false);
      expect(store.getChildren(documentRoot.id).map((node) => node.id)).toEqual(
        [paragraphA.id, paragraphB.id],
      );
      expect(store.getNextChain(paragraphA.id).map((node) => node.id)).toEqual([
        paragraphA.id,
        paragraphB.id,
      ]);
      expect(sqlite.queryNodes(PROJECT_ID, { limit: 100 })).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: hidden.id }),
          expect.objectContaining({ id: legacyHidden.id }),
        ]),
      );
      expect(sqlite.queryEdges(PROJECT_ID, { limit: 100 })).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ fromId: visibleA.id, toId: hidden.id }),
        ]),
      );
      expect(sqlite.globalNodeLookup(hidden.id)).toBeNull();
      expect(sqlite.lookupExternalNode('', PROJECT_ID, hidden.id)).toBeNull();
      expect(
        sqlite.listExternalNodes('', PROJECT_ID, 100).map((node) => node.id),
      ).not.toContain(hidden.id);
    });

    withReservedThinkingVisibility(true, () => {
      expect(store.getNode(hidden.id)?.title).toBe('Reserved thought');
      expect(store.getNode(legacyHidden.id)?.title).toBe(
        'Legacy reserved root',
      );
      expect(store.findPath(visibleA.id, visibleB.id).exists).toBe(true);
      expect(store.getChildren(documentRoot.id).map((node) => node.id)).toEqual(
        [paragraphA.id, thinkingParagraph.id, paragraphB.id],
      );
      expect(analyzeGraph(PROJECT_ID).stats.triggerDistribution).toHaveProperty(
        'thinking',
        2,
      );
      expect(sqlite.queryNodes(PROJECT_ID, { limit: 100 })).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: hidden.id }),
          expect.objectContaining({ id: legacyHidden.id }),
        ]),
      );
      expect(sqlite.globalNodeLookup(hidden.id)?.node.id).toBe(hidden.id);
      expect(sqlite.lookupExternalNode('', PROJECT_ID, hidden.id)?.id).toBe(
        hidden.id,
      );
    });
  });

  it('keeps concurrent async visibility scopes isolated', async () => {
    const store = initializeGraph();
    expect(() =>
      store.createNode({
        title: 'Rejected direct thought',
        trigger: 'thinking',
        why: 'Exercises the fail-closed core mutation boundary',
        understanding: 'An unscoped direct caller cannot create this artifact',
      }),
    ).toThrow(/explicit synthetic visibility scope/i);
    expect(() =>
      store.createNode({
        title: 'Rejected padded thought',
        trigger: ' ThInKiNg ' as unknown as 'thinking',
        why: 'Exercises canonical trigger classification',
        understanding: 'Whitespace and case cannot bypass the boundary',
      }),
    ).toThrow(/INVALID_TRIGGER/);
    expect(() =>
      store.createDocumentNode({
        title: 'Rejected padded legacy thought',
        content: 'Whitespace and case cannot bypass legacy file classification',
        isDocRoot: true,
        fileType: ' THINKING ',
      }),
    ).toThrow(/explicit synthetic visibility scope/i);
    const hidden = withReservedThinkingVisibility(true, () =>
      store.createNode({
        title: 'Concurrent reserved thought',
        trigger: 'thinking',
        why: 'Exercises AsyncLocalStorage isolation',
        understanding: 'Only the synthetic scope may retrieve this artifact',
      }),
    );
    expect(() =>
      withReservedThinkingVisibility(true, () =>
        store.createNode({
          title: 'Synthetic padded thought',
          trigger: ' ThInKiNg ' as unknown as 'thinking',
          why: 'Exercises canonical trigger validation in synthetic scope',
          understanding: 'Even synthetic callers must use the exact vocabulary',
        }),
      ),
    ).toThrow(/INVALID_TRIGGER/);
    const paddedLegacyHidden = withReservedThinkingVisibility(true, () =>
      store.createDocumentNode({
        title: 'Canonical legacy reserved thought',
        content: 'Synthetic scope accepts the canonical legacy file type',
        isDocRoot: true,
        fileType: ' THINKING ',
      }),
    );

    const ordinary = store.createNode({
      title: 'Ordinary mutation target',
      trigger: 'analysis',
      why: 'Exercises update classification',
      understanding: 'Starts as an ordinary node',
    });
    expect(() =>
      store.updateNode(ordinary.id, {
        trigger: 'thinking',
        revisionWhy: 'Attempt an unauthorized conversion',
      }),
    ).toThrow(/explicit synthetic visibility scope/i);
    expect(() =>
      store.convertToConcept(ordinary.id, { trigger: 'thinking' }),
    ).toThrow(/explicit synthetic visibility scope/i);

    const [ordinaryResult, syntheticResult] = await Promise.all([
      withReservedThinkingVisibility(false, async () => {
        await Promise.resolve();
        return store.getNode(hidden.id);
      }),
      withReservedThinkingVisibility(true, async () => {
        await Promise.resolve();
        return store.getNode(hidden.id);
      }),
    ]);

    expect(ordinaryResult).toBeNull();
    expect(syntheticResult?.id).toBe(hidden.id);
    expect(store.getNode(paddedLegacyHidden.id)).toBeNull();
    withReservedThinkingVisibility(true, () => {
      expect(store.getNode(paddedLegacyHidden.id)?.id).toBe(
        paddedLegacyHidden.id,
      );
    });
  });

  it('rejects non-canonical document conversion triggers without mutation', () => {
    const store = initializeGraph();
    const document = store.createDocumentNode({
      title: 'Conversion target',
      content: 'Content that must survive rejected conversions.',
      level: 'document',
      isDocRoot: true,
      fileType: 'md',
    });
    const before = store.getNode(document.id);

    for (const trigger of ['not-a-trigger', ' Analysis ', 42]) {
      expect(() =>
        store.convertToConcept(document.id, {
          trigger: trigger as unknown as string,
          moveContent: true,
        }),
      ).toThrow(/INVALID_TRIGGER/);
      expect(store.getNode(document.id)).toEqual(before);
    }

    const converted = store.convertToConcept(document.id, {
      trigger: 'analysis',
      moveContent: true,
      why: 'A canonical conversion remains supported.',
    });
    expect(converted.trigger).toBe('analysis');
    expect(converted.content).toBeNull();
    expect(converted.understanding).toBe(
      'Content that must survive rejected conversions.',
    );
    expect(converted.version).toBe((before?.version ?? 0) + 1);
  });

  it('rejects non-canonical triggers at direct create and update boundaries', () => {
    const store = initializeGraph();
    const initialNodeCount = store.getAll().nodes.length;

    for (const trigger of ['not-a-trigger', ' Analysis ', 42]) {
      expect(() =>
        store.createNode({
          title: 'Rejected direct trigger',
          trigger: trigger as unknown as 'analysis',
          why: 'Exercises canonical trigger enforcement at creation.',
          understanding: 'This node must never be persisted.',
        }),
      ).toThrow(/INVALID_TRIGGER/);
      expect(store.getAll().nodes).toHaveLength(initialNodeCount);
    }

    const ordinary = store.createNode({
      title: 'Direct trigger update target',
      trigger: 'analysis',
      why: 'Exercises canonical trigger enforcement at update.',
      understanding: 'This state must survive rejected trigger changes.',
    });
    const beforeUpdate = store.getNode(ordinary.id);
    for (const trigger of ['not-a-trigger', ' Analysis ', 42]) {
      expect(() =>
        store.updateNode(ordinary.id, {
          trigger: trigger as unknown as 'analysis',
          understanding: 'A rejected call must not change adjacent fields.',
          revisionWhy: 'Attempt a malformed trigger update.',
        }),
      ).toThrow(/INVALID_TRIGGER/);
      expect(store.getNode(ordinary.id)).toEqual(beforeUpdate);
    }

    const canonicalUpdate = store.updateNode(ordinary.id, {
      trigger: 'decision',
      revisionWhy: 'A canonical trigger remains supported.',
    });
    expect(canonicalUpdate.trigger).toBe('decision');
    expect(canonicalUpdate.version).toBe((beforeUpdate?.version ?? 0) + 1);
  });

  it('preserves an existing legacy trigger only when update omits trigger', () => {
    const store = initializeGraph();
    const legacy = store.createNode({
      title: 'Legacy trigger target',
      trigger: 'analysis',
      why: 'Provides a fixture that predates canonical enforcement.',
      understanding: 'The trigger will be rewritten directly as legacy data.',
    });
    sqlite
      .getDb()
      .prepare('UPDATE nodes SET trigger = ? WHERE id = ?')
      .run('legacy-trigger', legacy.id);

    const preserved = store.updateNode(legacy.id, {
      understanding: 'A non-trigger field may still be revised.',
      revisionWhy:
        'Preserve legacy trigger because no new trigger was supplied.',
    });
    expect(preserved.trigger).toBe('legacy-trigger');
    expect(preserved.understanding).toBe(
      'A non-trigger field may still be revised.',
    );

    expect(() =>
      store.updateNode(legacy.id, {
        trigger: 'legacy-trigger' as unknown as 'analysis',
        revisionWhy: 'Supplying the legacy value anew must be rejected.',
      }),
    ).toThrow(/INVALID_TRIGGER/);
  });

  it('keeps reserved classification sticky while allowing reserved maintenance', () => {
    const store = initializeGraph();

    withReservedThinkingVisibility(true, () => {
      const reservedConcept = store.createNode({
        title: 'Sticky reserved concept',
        trigger: 'thinking',
        why: 'Exercises the immutable reserved classification boundary.',
        understanding: 'Synthetic content may be maintained but not relabeled.',
      });
      const reservedDocument = store.createDocumentNode({
        title: 'Sticky legacy reserved document',
        content: 'Synthetic document content.',
        level: 'thinking',
        isDocRoot: true,
        fileType: 'thinking',
      });
      const conceptBefore = store.getNode(reservedConcept.id);
      const documentBefore = store.getNode(reservedDocument.id);

      expect(() =>
        store.updateNode(reservedConcept.id, {
          trigger: 'analysis',
          revisionWhy: 'Attempt in-place declassification.',
        }),
      ).toThrow(/RESERVED_RECLASSIFICATION/);
      expect(() =>
        store.updateNode(reservedDocument.id, {
          fileType: 'md',
          revisionWhy: 'Attempt legacy in-place declassification.',
        }),
      ).toThrow(/RESERVED_RECLASSIFICATION/);
      expect(() =>
        store.convertToConcept(reservedDocument.id, {
          trigger: 'analysis',
          why: 'Attempt document conversion into an ordinary node.',
        }),
      ).toThrow(/RESERVED_RECLASSIFICATION/);
      expect(store.getNode(reservedConcept.id)).toEqual(conceptBefore);
      expect(store.getNode(reservedDocument.id)).toEqual(documentBefore);

      const maintainedConcept = store.updateNode(reservedConcept.id, {
        understanding: 'Synthetic content can still be revised in place.',
        metadata: { translated: true },
        revisionWhy: 'Maintain the block without changing classification.',
      });
      const maintainedDocument = store.updateNode(reservedDocument.id, {
        content: 'Revised synthetic document content.',
        revisionWhy: 'Maintain the reserved document in place.',
      });
      expect(maintainedConcept).toMatchObject({
        trigger: 'thinking',
        understanding: 'Synthetic content can still be revised in place.',
        metadata: { translated: true },
      });
      expect(maintainedDocument).toMatchObject({
        fileType: 'thinking',
        content: 'Revised synthetic document content.',
      });
    });
  });

  it('quarantines legacy nodes whose revisions prove prior thinking classification', () => {
    initializeGraph();
    const projectPath = sqlite.getProjectPath();
    expect(projectPath).toBeTruthy();
    const legacyId = 'n_legacy_declassified';
    sqlite
      .getDb()
      .prepare(
        `INSERT INTO nodes (
          id, title, trigger, why, understanding, content, file_type, revisions
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        legacyId,
        'LEGACY_DECLASSIFIED_TITLE',
        'analysis',
        'Legacy conversion fixture',
        'LEGACY_PRIVATE_CURRENT_CONTENT',
        null,
        null,
        JSON.stringify([
          {
            title: 'Former reserved block',
            trigger: ' ThInKiNg ',
            content: 'LEGACY_PRIVATE_REVISION_CONTENT',
            version: 1,
            timestamp: '2025-01-01T00:00:00.000Z',
          },
        ]),
      );

    sqlite.closeAllDatabases();
    resetGraphStore();
    sqlite.initDatabase(projectPath as string);
    sqlite.setCurrentProject(PROJECT_ID);
    const reloaded = getGraphStore();

    expect(reloaded.getNode(legacyId)).toBeNull();
    expect(
      reloaded.getAllWithSuperseded().nodes.map((node) => node.id),
    ).not.toContain(legacyId);
    const synthetic = withReservedThinkingVisibility(true, () =>
      reloaded.getNode(legacyId),
    );
    expect(synthetic).toMatchObject({
      id: legacyId,
      fileType: 'thinking',
      understanding: 'LEGACY_PRIVATE_CURRENT_CONTENT',
    });
    expect(synthetic?.revisions[0]?.content).toBe(
      'LEGACY_PRIVATE_REVISION_CONTENT',
    );
  });

  it('fails closed for raw web helpers and projects aggregate statistics', () => {
    const store = initializeGraph();
    const visibleA = store.createNode({
      title: 'Visible statistics node A',
      trigger: 'foundation',
      why: 'Provides ordinary aggregate evidence',
      understanding: 'Visible to every mode',
    });
    const visibleB = store.createNode({
      title: 'Visible statistics node B',
      trigger: 'analysis',
      why: 'Provides an ordinary visible edge',
      understanding: 'Visible to every mode',
    });
    store.createEdge({
      fromId: visibleA.id,
      toId: visibleB.id,
      type: 'relates',
      why: 'Ordinary aggregate edge',
    });
    store.createDocumentNode({
      title: 'Visible statistics document',
      content: 'Visible document content',
      isDocRoot: true,
      fileType: 'md',
    });
    sqlite.createCommit(
      'visible statistics commit',
      [visibleA.id],
      [],
      'ordinary-agent',
    );
    sqlite.saveConversation(
      'private-statistics-session',
      'reserved synthesis prompt text',
      'reserved synthesis response text',
    );
    sqlite.logToolCall({
      sessionId: 'private-statistics-session',
      toolName: 'synthetic_private_tool',
      arguments: { privatePrompt: 'reserved synthesis prompt text' },
      result: { privateResult: 'reserved synthesis response text' },
    });

    const { hidden, legacyHidden } = withReservedThinkingVisibility(
      true,
      () => {
        const hidden = store.createNode({
          title: 'Reserved statistics thought',
          trigger: 'thinking',
          why: 'Must not affect ordinary aggregates',
          understanding: 'Reserved aggregate evidence',
          metadata: { translated: true },
        });
        const legacyHidden = store.createDocumentNode({
          title: 'Reserved statistics legacy document',
          content: 'Reserved legacy content',
          isDocRoot: true,
          fileType: ' thinking ',
        });
        store.createEdge({
          fromId: visibleA.id,
          toId: hidden.id,
          type: 'contextualizes',
          why: 'Incident edge must not affect ordinary aggregates',
        });
        store.updateNode(hidden.id, {
          understanding: 'Reserved aggregate evidence, revised',
          revisionWhy: 'Make reserved revision statistics distinguishable',
        });
        sqlite.createCommit(
          'reserved statistics commit',
          [hidden.id],
          [],
          'synthetic-agent',
        );
        sqlite.createCommit(
          'mixed statistics commit with private prose',
          [visibleB.id, hidden.id],
          [],
          'mixed-agent',
        );
        return { hidden, legacyHidden };
      },
    );

    expect(
      sqlite.getConversation('private-statistics-session'),
    ).toBeUndefined();
    expect(sqlite.getRecentConversations()).toEqual([]);
    expect(sqlite.getToolCallsBySession('private-statistics-session')).toEqual(
      [],
    );
    expect(sqlite.getRecentToolCalls()).toEqual([]);
    expect(sqlite.getToolUsageFrequency()).toEqual([]);
    expect(sqlite.getTableRows('nodes')).toBeNull();
    expect(sqlite.getTableRow('nodes', hidden.id)).toBeNull();
    expect(sqlite.getTableSchema('nodes')?.rowCount).toBe(0);

    const ordinaryStats = sqlite.getDatabaseStats();
    expect(ordinaryStats.nodes).toMatchObject({
      total: 3,
      active: 3,
      archived: 0,
    });
    expect(
      ordinaryStats.nodes.byTrigger.some(
        ({ trigger }) => trigger?.trim().toLowerCase() === 'thinking',
      ),
    ).toBe(false);
    expect(ordinaryStats.edges.total).toBe(1);
    expect(ordinaryStats.commits.total).toBe(1);
    expect(ordinaryStats.commits.byAgent).toEqual([
      expect.objectContaining({ agent: 'ordinary-agent', count: 1 }),
    ]);
    expect(ordinaryStats.documents).toEqual({ roots: 1, contentNodes: 1 });
    expect(ordinaryStats.thinking).toEqual({ total: 0, translated: 0 });
    expect(ordinaryStats.revisions).toEqual({ avgVersion: 1, maxVersion: 1 });
    expect(
      ordinaryStats.connectivity.mostConnected.map(({ id }) => id),
    ).not.toEqual(expect.arrayContaining([hidden.id, legacyHidden.id]));

    withReservedThinkingVisibility(true, () => {
      expect(sqlite.getConversation('private-statistics-session')?.query).toBe(
        'reserved synthesis prompt text',
      );
      expect(sqlite.getRecentConversations()).toHaveLength(1);
      expect(
        sqlite.getToolCallsBySession('private-statistics-session'),
      ).toHaveLength(1);
      expect(sqlite.getRecentToolCalls()).toHaveLength(1);
      expect(sqlite.getToolUsageFrequency()).toEqual([
        expect.objectContaining({
          tool_name: 'synthetic_private_tool',
          count: 1,
        }),
      ]);
      expect(sqlite.getTableSchema('nodes')?.rowCount).toBe(5);
      expect(sqlite.getTableRows('nodes')?.total).toBe(5);
      expect(sqlite.getTableRow('nodes', hidden.id)?.id).toBe(hidden.id);

      const syntheticStats = sqlite.getDatabaseStats();
      expect(syntheticStats.nodes.total).toBe(5);
      expect(syntheticStats.edges.total).toBe(2);
      expect(syntheticStats.commits.total).toBe(3);
      expect(syntheticStats.documents).toEqual({ roots: 2, contentNodes: 2 });
      expect(syntheticStats.thinking).toEqual({ total: 2, translated: 1 });
      expect(syntheticStats.revisions.maxVersion).toBe(2);
    });
  });

  it('drops mixed provenance records rather than leaking their free-form text', () => {
    const store = initializeGraph();
    const visible = store.createNode({
      title: 'Visible provenance node',
      trigger: 'foundation',
      why: 'Provides the visible half of a mixed commit',
      understanding: 'Ordinary artifact',
    });
    const hidden = withReservedThinkingVisibility(true, () =>
      store.createNode({
        title: 'Reserved provenance node',
        trigger: 'thinking',
        why: 'Provides the reserved half of a mixed commit',
        understanding: 'Synthetic Reader artifact',
      }),
    );
    const commit = sqlite.createCommit(
      'message names reserved synthesis details',
      [visible.id, hidden.id],
    );
    sqlite.logEvent(
      'created',
      'batch',
      'mixed_batch',
      null,
      'batch summary names reserved synthesis details',
      { nodeIds: [visible.id, hidden.id] },
    );

    withReservedThinkingVisibility(false, () => {
      expect(sqlite.getCommit(commit.id)).toBeNull();
      expect(
        sqlite.getRecentCommits(20).map((entry) => entry.id),
      ).not.toContain(commit.id);
      expect(
        sqlite.getRecentEvents(20).map((entry) => entry.entity_id),
      ).not.toContain('mixed_batch');
      expect(sqlite.getEntityHistory(hidden.id)).toEqual([]);
    });

    withReservedThinkingVisibility(true, () => {
      expect(sqlite.getCommit(commit.id)?.id).toBe(commit.id);
      expect(sqlite.getRecentCommits(20).map((entry) => entry.id)).toContain(
        commit.id,
      );
      expect(
        sqlite.getRecentEvents(20).map((entry) => entry.entity_id),
      ).toContain('mixed_batch');
      expect(sqlite.getEntityHistory(hidden.id).length).toBeGreaterThan(0);
    });
  });

  it('never joins private conversation text onto visible events in ordinary mode', () => {
    const store = initializeGraph();
    const visible = store.createNode({
      title: 'Visible event entity',
      trigger: 'analysis',
      why: 'The event itself remains visible',
      understanding: 'Its synthetic-session provenance remains private',
    });
    sqlite.saveConversation(
      'private-visible-event-session',
      'private synthetic prompt for an ordinary node',
      'private synthetic response for an ordinary node',
    );
    const eventSequence = sqlite.logEvent(
      'revised',
      'node',
      visible.id,
      'private-visible-event-session',
      'Visible structural event',
    );

    const ordinaryEvent = sqlite
      .getEventLog({ entityId: visible.id, includeConversations: true })
      .find(({ seq }) => seq === eventSequence);
    expect(ordinaryEvent).toBeDefined();
    expect(ordinaryEvent).not.toHaveProperty('user_query');
    expect(ordinaryEvent).not.toHaveProperty('ai_response');

    withReservedThinkingVisibility(true, () => {
      const syntheticEvent = sqlite
        .getEventLog({ entityId: visible.id, includeConversations: true })
        .find(({ seq }) => seq === eventSequence);
      expect(syntheticEvent?.user_query).toBe(
        'private synthetic prompt for an ordinary node',
      );
      expect(syntheticEvent?.ai_response).toBe(
        'private synthetic response for an ordinary node',
      );
    });
  });

  it('rejects an ordinary purge that would cascade through a hidden edge', () => {
    const store = initializeGraph();
    const visible = store.createNode({
      title: 'Visible purge target',
      trigger: 'analysis',
      why: 'Exercises cascade visibility',
      understanding: 'Must survive a rejected ordinary purge',
    });
    const { hidden, incidentEdge } = withReservedThinkingVisibility(
      true,
      () => {
        const hidden = store.createNode({
          title: 'Reserved purge neighbor',
          trigger: 'thinking',
          why: 'Makes the incident edge reserved',
          understanding: 'Must not be mutated indirectly by ordinary mode',
        });
        const incidentEdge = store.createEdge({
          fromId: visible.id,
          toId: hidden.id,
          type: 'contextualizes',
          why: 'Hidden incident edge',
        });
        return { hidden, incidentEdge };
      },
    );

    expect(() =>
      sqlite.purgeNodes([visible.id], [], 'ordinary cascade must fail closed'),
    ).toThrow(/cascade.*not visible/i);
    expect(store.getNode(visible.id)?.id).toBe(visible.id);
    withReservedThinkingVisibility(true, () => {
      expect(store.getNode(hidden.id)?.id).toBe(hidden.id);
      expect(store.getEdge(incidentEdge.id)?.id).toBe(incidentEdge.id);

      const result = sqlite.purgeNodes(
        [visible.id],
        [],
        'explicit synthetic cascade is authorized',
      );
      expect(result).toMatchObject({ deletedNodes: 1, cascadeEdges: 1 });
      expect(store.getNode(visible.id)).toBeNull();
      expect(store.getNode(hidden.id)?.id).toBe(hidden.id);
      expect(store.getEdge(incidentEdge.id)).toBeNull();
    });
  });

  it('rolls back the purge audit claim when deletion fails', () => {
    const store = initializeGraph();
    const target = store.createNode({
      title: 'Failed purge target',
      trigger: 'analysis',
      why: 'Exercises audit and deletion atomicity.',
      understanding:
        'A forced SQL failure must preserve this node and history.',
    });
    const db = sqlite.getDb();
    const eventCountBefore = (
      db.prepare('SELECT COUNT(*) AS count FROM event_log').get() as {
        count: number;
      }
    ).count;
    db.exec(`
      CREATE TRIGGER force_purge_failure
      BEFORE DELETE ON nodes
      BEGIN
        SELECT RAISE(ABORT, 'forced purge failure');
      END;
    `);

    expect(() =>
      sqlite.purgeNodes([target.id], [], 'This audit must roll back'),
    ).toThrow(/forced purge failure/);
    db.exec('DROP TRIGGER force_purge_failure');

    expect(store.getNode(target.id)?.id).toBe(target.id);
    expect(
      (
        db.prepare('SELECT COUNT(*) AS count FROM event_log').get() as {
          count: number;
        }
      ).count,
    ).toBe(eventCountBefore);
  });

  it('filters reserved rows before limits so they cannot crowd ordinary results', () => {
    const store = initializeGraph();
    const visible = store.createNode({
      title: 'crowdtoken visible ordinary result',
      trigger: 'analysis',
      why: 'Must remain retrievable behind arbitrarily many reserved rows',
      understanding: 'crowdtoken ordinary evidence',
    });
    sqlite.createCommit(
      'old visible commit',
      [visible.id],
      [],
      'ordinary-agent',
      '2000-01-01T00:00:00.000Z',
    );

    withReservedThinkingVisibility(true, () => {
      for (let index = 0; index < 8; index++) {
        const hidden = store.createNode({
          title: `crowdtoken ${index}`,
          trigger: 'thinking',
          why: 'Would crowd a limit-before-filter query',
          understanding: 'crowdtoken reserved artifact',
        });
        sqlite.createCommit(
          `new hidden commit ${index}`,
          [hidden.id],
          [],
          'synthetic-agent',
          `2026-01-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
        );
      }
    });

    const database = sqlite.getDb();
    database
      .prepare('UPDATE nodes SET access_count = 100 WHERE id = ?')
      .run(visible.id);

    expect(
      store.findSimilarNodes('crowdtoken', 1).map((node) => node.id),
    ).toEqual([visible.id]);
    expect(store.searchNodes('crowdtoken', 1).map((node) => node.id)).toEqual([
      visible.id,
    ]);
    expect(store.getColdNodes(1).map(({ node }) => node.id)).toEqual([
      visible.id,
    ]);
    expect(sqlite.getRecentCommits(1)[0]?.message).toBe('old visible commit');
    expect(sqlite.getRecentEvents(1)[0]?.entity_id).toBe(visible.id);
  });
});
