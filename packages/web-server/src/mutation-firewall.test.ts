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
import { createRestMutationFirewall } from './mutation-firewall.js';
import { graphRouter } from './routes/graph.js';

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

describe('REST mutation firewall', () => {
  it('returns HTTP 405 for graph batches without mutating the database', async () => {
    temporaryDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'understanding-graph-web-firewall-'),
    );
    const projectPath = path.join(temporaryDirectory, 'default');
    sqlite.initDatabase(projectPath);
    sqlite.setCurrentProject('default');
    resetGraphStore();
    const store = getGraphStore();

    const app = express();
    app.use(express.json());
    app.use(createRestMutationFirewall(false));
    app.use('/api', graphRouter);

    server = await new Promise<Server>((resolve, reject) => {
      const listeningServer = app.listen(0, '127.0.0.1');
      listeningServer.once('error', reject);
      listeningServer.once('listening', () => resolve(listeningServer));
    });
    const { port } = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${port}/api/graph/batch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        commit_message: 'This REST batch must never execute',
        operations: [
          {
            tool: 'graph_add_concept',
            params: {
              text: 'Forbidden REST mutation',
              trigger: 'analysis',
              why: 'Exercises the HTTP mutation firewall',
              understanding: 'The graph must remain unchanged',
            },
          },
        ],
      }),
    });

    expect(response.status).toBe(405);
    await expect(response.json()).resolves.toMatchObject({
      error: 'REST mutations are disabled',
    });
    expect(store.getAll().nodes).toEqual([]);
    expect(sqlite.getRecentCommits()).toEqual([]);
  });
});
