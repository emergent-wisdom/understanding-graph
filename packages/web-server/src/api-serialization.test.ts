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
import { createApiSerializationMiddleware } from './api-serialization.js';

let server: Server | undefined;
let temporaryDirectory: string | undefined;

afterEach(async () => {
  if (server) {
    const activeServer = server;
    server = undefined;
    await new Promise<void>((resolve, reject) => {
      activeServer.close((error) => (error ? reject(error) : resolve()));
      activeServer.closeAllConnections();
    });
  }
  sqlite.closeAllDatabases();
  resetGraphStore();
  if (temporaryDirectory) {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    temporaryDirectory = undefined;
  }
});

function seedProject(projectId: string, title: string): void {
  if (!temporaryDirectory) throw new Error('Temporary directory missing');
  sqlite.initDatabase(path.join(temporaryDirectory, projectId));
  sqlite.setCurrentProject(projectId);
  resetGraphStore();
  getGraphStore().createNode({
    title,
    trigger: 'foundation',
    understanding: `State owned by ${projectId}`,
    why: 'Make cross-project leakage observable.',
  });
}

describe('process-wide API serialization', () => {
  it('keeps two independent clients on their requested projects through response completion', async () => {
    temporaryDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'understanding-graph-api-serialization-'),
    );
    seedProject('project-a', 'Only A');
    seedProject('project-b', 'Only B');

    let releaseFirstResponse = () => {};
    const firstResponseCanFinish = new Promise<void>((resolve) => {
      releaseFirstResponse = resolve;
    });
    let markFirstEntered = () => {};
    const firstEntered = new Promise<void>((resolve) => {
      markFirstEntered = resolve;
    });
    const enteredProjects: string[] = [];

    const app = express();
    app.use('/api', createApiSerializationMiddleware());
    app.use('/api', (req, res, next) => {
      const projectId = req.get('x-project-id');
      if (!projectId || !sqlite.isProjectLoaded(projectId)) {
        res.status(404).end();
        return;
      }
      sqlite.setCurrentProject(projectId);
      resetGraphStore();
      enteredProjects.push(projectId);
      next();
    });
    app.get('/api/probe', async (req, res) => {
      const requestedProject = req.get('x-project-id');
      if (requestedProject === 'project-a') {
        markFirstEntered();
        await firstResponseCanFinish;
      }
      res.json({
        requestedProject,
        activeProject: sqlite.getCurrentProjectId(),
        titles: getGraphStore()
          .getAll()
          .nodes.map((node) => node.title),
      });
    });

    server = await new Promise<Server>((resolve, reject) => {
      const listeningServer = app.listen(0, '127.0.0.1');
      listeningServer.once('error', reject);
      listeningServer.once('listening', () => resolve(listeningServer));
    });
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const first = fetch(`${baseUrl}/api/probe`, {
      headers: { 'x-project-id': 'project-a' },
    });
    await firstEntered;
    const second = fetch(`${baseUrl}/api/probe`, {
      headers: { 'x-project-id': 'project-b' },
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(enteredProjects).toEqual(['project-a']);
    releaseFirstResponse();

    await expect((await first).json()).resolves.toEqual({
      requestedProject: 'project-a',
      activeProject: 'project-a',
      titles: ['Only A'],
    });
    await expect((await second).json()).resolves.toEqual({
      requestedProject: 'project-b',
      activeProject: 'project-b',
      titles: ['Only B'],
    });
    expect(enteredProjects).toEqual(['project-a', 'project-b']);
  });

  it('releases an abandoned queued request instead of stranding later clients', async () => {
    let releaseFirstResponse = () => {};
    const firstResponseCanFinish = new Promise<void>((resolve) => {
      releaseFirstResponse = resolve;
    });
    let markFirstEntered = () => {};
    const firstEntered = new Promise<void>((resolve) => {
      markFirstEntered = resolve;
    });
    let markSecondQueued = () => {};
    const secondQueued = new Promise<void>((resolve) => {
      markSecondQueued = resolve;
    });

    const app = express();
    app.use('/api', (req, _res, next) => {
      if (req.query.client === 'second') markSecondQueued();
      next();
    });
    app.use('/api', createApiSerializationMiddleware());
    app.get('/api/probe', async (req, res) => {
      if (req.query.client === 'first') {
        markFirstEntered();
        await firstResponseCanFinish;
      }
      res.json({ client: req.query.client });
    });

    server = await new Promise<Server>((resolve, reject) => {
      const listeningServer = app.listen(0, '127.0.0.1');
      listeningServer.once('error', reject);
      listeningServer.once('listening', () => resolve(listeningServer));
    });
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const first = fetch(`${baseUrl}/api/probe?client=first`);
    await firstEntered;

    const abortSecond = new AbortController();
    const second = fetch(`${baseUrl}/api/probe?client=second`, {
      signal: abortSecond.signal,
    });
    await secondQueued;
    abortSecond.abort();
    await expect(second).rejects.toThrow();

    releaseFirstResponse();
    expect((await first).status).toBe(200);

    const third = await fetch(`${baseUrl}/api/probe?client=third`);
    expect(third.status).toBe(200);
    await expect(third.json()).resolves.toEqual({ client: 'third' });
  });
});
