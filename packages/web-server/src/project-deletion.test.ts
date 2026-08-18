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
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { projectRouter } from './routes/projects.js';

let server: Server | undefined;
let projectsDirectory: string;
let baseUrl: string;

beforeEach(async () => {
  projectsDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'understanding-graph-web-project-delete-'),
  );
  sqlite.initDatabase(path.join(projectsDirectory, 'fallback'));
  sqlite.initDatabase(path.join(projectsDirectory, 'to-delete'));
  sqlite.setCurrentProject('to-delete');
  resetGraphStore();

  const app = express();
  app.locals.projectDir = projectsDirectory;
  app.locals.projectId = 'to-delete';
  app.use('/api/projects', projectRouter);

  server = await new Promise<Server>((resolve, reject) => {
    const listeningServer = app.listen(0, '127.0.0.1');
    listeningServer.once('error', reject);
    listeningServer.once('listening', () => resolve(listeningServer));
  });
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

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
  fs.rmSync(projectsDirectory, { recursive: true, force: true });
});

describe('DELETE /api/projects/:id', () => {
  it('closes the active database before removing its store and selects a safe fallback', async () => {
    const previousStore = getGraphStore();

    const response = await fetch(`${baseUrl}/api/projects/to-delete`, {
      method: 'DELETE',
    });

    expect(response.status).toBe(204);
    expect(fs.existsSync(path.join(projectsDirectory, 'to-delete'))).toBe(
      false,
    );
    expect(sqlite.isProjectLoaded('to-delete')).toBe(false);
    expect(sqlite.getCurrentProjectId()).toBe('fallback');
    expect(getGraphStore()).not.toBe(previousStore);

    const current = await fetch(`${baseUrl}/api/projects/current`);
    await expect(current.json()).resolves.toMatchObject({ id: 'fallback' });
  });

  it('rejects invalid project identifiers without touching another store', async () => {
    const response = await fetch(`${baseUrl}/api/projects/not!valid`, {
      method: 'DELETE',
    });

    expect(response.status).toBe(400);
    expect(fs.existsSync(path.join(projectsDirectory, 'to-delete'))).toBe(true);
    expect(sqlite.isProjectLoaded('to-delete')).toBe(true);
  });

  it('is idempotent when the project store is already absent', async () => {
    const response = await fetch(`${baseUrl}/api/projects/missing`, {
      method: 'DELETE',
    });

    expect(response.status).toBe(204);
    expect(sqlite.getCurrentProjectId()).toBe('to-delete');
  });
});

describe('POST /api/projects/:id/checkpoint', () => {
  it('flushes a loaded project for a host-controlled snapshot boundary', async () => {
    const response = await fetch(
      `${baseUrl}/api/projects/to-delete/checkpoint`,
      { method: 'POST' },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      id: 'to-delete',
      checkpointed: true,
    });
    expect(sqlite.getCurrentProjectId()).toBe('to-delete');
  });

  it('rejects invalid or unloaded projects', async () => {
    expect(
      (
        await fetch(`${baseUrl}/api/projects/not!valid/checkpoint`, {
          method: 'POST',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await fetch(`${baseUrl}/api/projects/missing/checkpoint`, {
          method: 'POST',
        })
      ).status,
    ).toBe(404);
  });
});
