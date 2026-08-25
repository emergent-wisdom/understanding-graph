import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as sqlite from '../database/sqlite.js';
import { getGraphStore, resetGraphStore } from './GraphStore.js';

const PROJECT_ID = 'edge-validation-test';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ug-edge-validation-'));
  sqlite.initDatabase(path.join(tmpDir, PROJECT_ID));
  sqlite.setCurrentProject(PROJECT_ID);
  resetGraphStore();
});

afterEach(() => {
  vi.restoreAllMocks();
  sqlite.closeAllDatabases();
  resetGraphStore();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('GraphStore edge invariants', () => {
  it('clears a stale embedding whenever semantic node material changes', () => {
    const store = getGraphStore();
    const node = store.createNode({
      title: 'Revision embedding fixture',
      trigger: 'analysis',
      understanding: 'The old semantic material.',
      why: 'Exercises embedding invalidation on revision.',
    });
    const embedding = new Float32Array([1, 0.5]);
    sqlite
      .getDb()
      .prepare('UPDATE nodes SET embedding = ? WHERE id = ?')
      .run(Buffer.from(embedding.buffer), node.id);
    store.invalidateCache();
    expect(store.getNode(node.id)?.embedding).not.toBeNull();

    store.updateNode(node.id, {
      understanding: 'The revised semantic material.',
      revisionWhy: 'The meaning changed.',
    });

    expect(store.getNode(node.id)?.embedding).toBeNull();
  });

  it('clears a stale embedding after an applied semantic bulk replacement', () => {
    const store = getGraphStore();
    const node = store.createNode({
      title: 'Bulk replacement fixture',
      trigger: 'analysis',
      understanding: 'The old phrase defines this node.',
      why: 'Exercises embedding invalidation outside GraphStore.updateNode.',
    });
    const embedding = new Float32Array([0.1, 0.9]);
    sqlite
      .getDb()
      .prepare('UPDATE nodes SET embedding = ? WHERE id = ?')
      .run(Buffer.from(embedding.buffer), node.id);

    sqlite.bulkReplace({
      find: 'old phrase',
      replace: 'new phrase',
      fields: ['understanding'],
      preview: false,
    });
    store.invalidateCache();

    expect(store.getNode(node.id)?.understanding).toContain('new phrase');
    expect(store.getNode(node.id)?.embedding).toBeNull();
  });

  it('invalidates legacy embeddings once when their representation version changes', () => {
    const store = getGraphStore();
    const node = store.createNode({
      title: 'Legacy document embedding',
      trigger: 'reference',
      content: 'Exact document content omitted by the legacy representation.',
      why: 'Exercises the one-time embedding migration.',
    });
    const embedding = new Float32Array([0.25, 0.75]);
    sqlite
      .getDb()
      .prepare('UPDATE nodes SET embedding = ? WHERE id = ?')
      .run(Buffer.from(embedding.buffer), node.id);
    sqlite.setProjectMeta('embedding_representation_version', 1);

    resetGraphStore();
    const migrated = getGraphStore();

    expect(migrated.getNode(node.id)?.embedding).toBeNull();
    expect(sqlite.getProjectMeta('embedding_representation_version')).toBe(2);
  });

  it('invalidates graph-backed node data after a rename', () => {
    const store = getGraphStore();
    const first = store.createNode({
      title: 'Name before rename',
      trigger: 'foundation',
      understanding: 'Provides the graph cache rename fixture.',
      why: 'Exercises graph-backed reads after a SQL mutation.',
    });
    const second = store.createNode({
      title: 'Neighbor',
      trigger: 'analysis',
      understanding: 'Keeps the renamed node in a path.',
      why: 'Makes stale graph attributes externally observable.',
    });
    store.createEdge({
      fromId: first.id,
      toId: second.id,
      type: 'relates',
      why: 'The rename fixture needs a graph-backed neighborhood.',
    });

    // Prime the in-memory graph and node cache before mutating SQLite.
    expect(store.getNeighborhood(first.id).nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: 'Name before rename' }),
      ]),
    );

    expect(store.renameNode(first.id, 'Name after rename')?.title).toBe(
      'Name after rename',
    );
    expect(store.getNode(first.id)?.title).toBe('Name after rename');
    expect(store.getNeighborhood(first.id).nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: 'Name after rename' }),
      ]),
    );
    expect(store.findPath(first.id, second.id).pathNodes[0]?.title).toBe(
      'Name after rename',
    );
  });

  it('rejects a self-loop before persisting an edge or event', () => {
    const store = getGraphStore();
    const node = store.createNode({
      title: 'Single endpoint',
      trigger: 'foundation',
      understanding: 'A node cannot form a relationship with itself.',
      why: 'Exercises the core edge persistence boundary.',
    });
    const eventCountBefore = (
      sqlite
        .getDb()
        .prepare('SELECT COUNT(*) AS count FROM event_log')
        .get() as { count: number }
    ).count;

    expect(() =>
      store.createEdge({
        fromId: node.id,
        toId: node.id,
        type: 'relates',
        why: 'This invalid relation must never be persisted.',
      }),
    ).toThrow('Self-loop edges are not allowed');

    expect(
      (
        sqlite.getDb().prepare('SELECT COUNT(*) AS count FROM edges').get() as {
          count: number;
        }
      ).count,
    ).toBe(0);
    expect(
      (
        sqlite
          .getDb()
          .prepare('SELECT COUNT(*) AS count FROM event_log')
          .get() as { count: number }
      ).count,
    ).toBe(eventCountBefore);
  });

  it('quarantines a persisted legacy self-loop without deleting it or bricking graph reads', () => {
    const store = getGraphStore();
    const node = store.createNode({
      title: 'Legacy endpoint',
      trigger: 'foundation',
      understanding: 'Represents a node from an older graph database.',
      why: 'Exercises upgrade-safe loading.',
    });
    sqlite
      .getDb()
      .prepare(
        `INSERT INTO edges (id, from_id, to_id, type, why)
         VALUES (?, ?, ?, 'relates', ?)`,
      )
      .run(
        'e_legacy_self_loop',
        node.id,
        node.id,
        'Persisted before self-loop validation existed.',
      );
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const graph = store.loadGraph();

    expect(graph.hasNode(node.id)).toBe(true);
    expect(graph.hasEdge(node.id, node.id)).toBe(false);
    expect(store.getNeighborhood(node.id)).toMatchObject({
      nodes: [expect.objectContaining({ id: node.id })],
      edges: [],
    });
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining(
        'Quarantined legacy self-loop edge "e_legacy_self_loop"',
      ),
    );

    // Quarantine is non-destructive: explicit repair tooling can still find
    // the original row after ordinary graph algorithms have loaded safely.
    expect(
      sqlite
        .getDb()
        .prepare('SELECT active FROM edges WHERE id = ?')
        .get('e_legacy_self_loop'),
    ).toEqual({ active: 1 });
  });
});
