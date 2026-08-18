import fs from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {
  getGraphStore,
  resetGraphStore,
  sqlite,
} from '@emergent-wisdom/understanding-graph-core';
import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { graphRouter } from './routes/graph.js';

/**
 * The read path must agree with the write path about what counts as a
 * connection.
 *
 * They did not. Orphan prevention counts a `supersedes` edge as grounding, so
 * a node whose only relation is "this replaces that" is legitimately connected
 * and the write path permits it. The default graph response then dropped every
 * `supersedes` edge, and that node rendered with no edges at all — an orphan on
 * screen, correctly grounded in the store. A human seeing it has no way to tell
 * a display bug from a corrupt graph, so the cost is trust rather than data.
 *
 * The original filter was aimed at a real hazard, just too broadly: when
 * superseded nodes are hidden, edges pointing at them dangle. That is a
 * statement about ENDPOINT VISIBILITY, not about edge type, and this pins both
 * halves of it. Either half alone is satisfiable by a wrong filter — dropping
 * everything passes the no-dangling half, and returning everything passes the
 * no-dropping half.
 */
let server: Server | undefined;
let temporaryDirectory: string | undefined;

afterEach(async () => {
  if (server) {
    const activeServer = server;
    await new Promise<void>((resolve, reject) => {
      activeServer.close((error) => (error ? reject(error) : resolve()));
    });
    server = undefined;
  }
  sqlite.closeAllDatabases();
  resetGraphStore();
  if (temporaryDirectory) {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    temporaryDirectory = undefined;
  }
});

async function startGraphServer() {
  temporaryDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'understanding-graph-web-agreement-'),
  );
  sqlite.initDatabase(path.join(temporaryDirectory, 'default'));
  sqlite.setCurrentProject('default');
  resetGraphStore();

  const app = express();
  app.use(express.json());
  app.use('/api', graphRouter);

  server = await new Promise<Server>((resolve, reject) => {
    const listeningServer = app.listen(0, '127.0.0.1');
    listeningServer.once('error', reject);
    listeningServer.once('listening', () => resolve(listeningServer));
  });
  const { port } = server.address() as AddressInfo;
  return { store: getGraphStore(), port };
}

interface GraphResponse {
  nodes: Array<{ id: string }>;
  edges: Array<{ id: string; type: string; from: string; to: string }>;
}

describe('the rendered graph agrees with the stored graph', () => {
  it('renders a supersedes edge between two active nodes', async () => {
    const { store, port } = await startGraphServer();

    const older = store.createNode({
      title: 'Delivery decides medium from store',
      trigger: 'model',
      why: 'Stands as the claim a later node replaces',
      understanding:
        'An earlier position, kept so its replacement can be read against it.',
    });
    const newer = store.createNode({
      title: 'The essay already contained that distinction',
      trigger: 'tension',
      why: 'Replaces the earlier claim with the passage that already made it',
      understanding:
        'The distinction was already written, so the later node supersedes the earlier.',
    });
    const edge = store.createEdge({
      fromId: newer.id,
      toId: older.id,
      type: 'supersedes',
      explanation: 'supersedes',
      why: 'Following this reaches the claim that was replaced and why.',
    });

    const response = (await (
      await fetch(`http://127.0.0.1:${port}/api/graph`)
    ).json()) as GraphResponse;

    // Both endpoints are active, so the relation is real and must be shown.
    // Dropping it is what made a correctly grounded node look like an orphan.
    expect(
      response.edges.map((e) => e.id),
      'A supersedes edge between two active nodes was dropped from the ' +
        'default response. Orphan prevention counts supersedes as grounding, ' +
        'so hiding it makes the viewer contradict the invariant and report a ' +
        'healthy graph as broken.',
    ).toContain(edge.id);
  });

  it('never returns an edge whose endpoints are not both rendered', async () => {
    const { store, port } = await startGraphServer();

    const a = store.createNode({
      title: 'A grounded concept',
      trigger: 'analysis',
      why: 'Provides one endpoint for the edge under test',
      understanding: 'Present so the response has a relation to check.',
    });
    const b = store.createNode({
      title: 'Another grounded concept',
      trigger: 'analysis',
      why: 'Provides the other endpoint for the edge under test',
      understanding: 'Present so the response has a relation to check.',
    });
    store.createEdge({
      fromId: a.id,
      toId: b.id,
      type: 'relates',
      explanation: 'relates',
      why: 'Following this reaches the neighbouring concept.',
    });

    const response = (await (
      await fetch(`http://127.0.0.1:${port}/api/graph`)
    ).json()) as GraphResponse;

    const renderedNodeIds = new Set(response.nodes.map((n) => n.id));
    const dangling = response.edges.filter(
      (e) => !renderedNodeIds.has(e.from) || !renderedNodeIds.has(e.to),
    );

    // The half the original filter was reaching for, stated as endpoint
    // visibility instead of as edge type.
    expect(
      dangling,
      'An edge was returned pointing at a node absent from the same response. ' +
        'It cannot be drawn, and it is what the supersedes filter was aimed at.',
    ).toEqual([]);
  });

  it('drops no stored edge whose endpoints are both rendered', async () => {
    const { store, port } = await startGraphServer();

    const first = store.createNode({
      title: 'First concept',
      trigger: 'analysis',
      why: 'Anchors a set of edges spanning several relation types',
      understanding: 'One end of every edge created below.',
    });
    const second = store.createNode({
      title: 'Second concept',
      trigger: 'analysis',
      why: 'Receives edges of several relation types',
      understanding: 'The other end of every edge created below.',
    });

    // Lifecycle, cognitive and structural types together: the bug was specific
    // to one category, so a single type would not have caught it.
    for (const type of [
      'supersedes',
      'refines',
      'contradicts',
      'learned_from',
    ]) {
      store.createEdge({
        fromId: first.id,
        toId: second.id,
        type: type as Parameters<typeof store.createEdge>[0]['type'],
        explanation: type,
        why: `Following this reaches the second concept via ${type}.`,
      });
    }

    const response = (await (
      await fetch(`http://127.0.0.1:${port}/api/graph`)
    ).json()) as GraphResponse;

    const renderedNodeIds = new Set(response.nodes.map((n) => n.id));
    const renderedEdgeIds = new Set(response.edges.map((e) => e.id));
    const droppedButDrawable = store
      .getAll()
      .edges.filter(
        (e) =>
          renderedNodeIds.has(e.fromId) &&
          renderedNodeIds.has(e.toId) &&
          !renderedEdgeIds.has(e.id),
      )
      .map((e) => `${e.type} (${e.id})`);

    expect(
      droppedButDrawable,
      'These stored edges connect two rendered nodes and were still omitted. ' +
        'Every such edge is a relation the graph knows about and the human ' +
        'cannot see, which is how a connected node reads as an orphan.',
    ).toEqual([]);
  });
});
