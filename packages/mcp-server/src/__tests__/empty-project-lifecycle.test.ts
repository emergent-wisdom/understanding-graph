import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sqlite } from '@emergent-wisdom/understanding-graph-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ContextManager } from '../context-manager.js';
import { handleToolCall } from '../tools/index.js';

let temporaryDirectory: string;
let projectsDirectory: string;
let contextManager: ContextManager;

beforeEach(() => {
  temporaryDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'understanding-graph-empty-projects-'),
  );
  projectsDirectory = path.join(temporaryDirectory, 'projects');
  contextManager = new ContextManager();
  contextManager.setProjectDir(projectsDirectory);
  sqlite.initAllDatabases(projectsDirectory);
});

afterEach(() => {
  sqlite.closeAllDatabases();
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

describe('empty project lifecycle', () => {
  it('keeps a fresh data root empty until a project is explicitly named', async () => {
    expect(contextManager.listProjects()).toEqual([]);
    expect(contextManager.getCurrentProjectId()).toBe('');
    await expect(contextManager.getContext()).rejects.toThrow(
      'No active project',
    );
    await expect(
      handleToolCall('graph_skeleton', {}, contextManager, 'general'),
    ).rejects.toThrow('No active project');
    expect(fs.readdirSync(projectsDirectory)).toEqual([]);
  });

  it('keeps several loaded databases inactive until one is selected', async () => {
    for (const projectId of ['alpha', 'beta']) {
      sqlite.initDatabase(path.join(projectsDirectory, projectId));
    }
    sqlite.clearCurrentProject();

    expect(sqlite.getLoadedProjectIds().sort()).toEqual(['alpha', 'beta']);
    expect(sqlite.getCurrentProjectId()).toBeNull();
    expect(contextManager.getCurrentProjectId()).toBe('');
    await expect(
      handleToolCall('graph_skeleton', {}, contextManager, 'general'),
    ).rejects.toThrow('Available projects: [alpha, beta]');

    await handleToolCall(
      'project_switch',
      { project: 'beta' },
      contextManager,
      'general',
    );
    expect(contextManager.getCurrentProjectId()).toBe('beta');
    expect(sqlite.getCurrentProjectId()).toBe('beta');
  });

  it('ignores placeholder directories and creates only the selected project', async () => {
    fs.mkdirSync(path.join(projectsDirectory, 'default'));
    expect(contextManager.listProjects()).toEqual([]);
    await expect(contextManager.getContext('default')).rejects.toThrow(
      'does not exist',
    );
    expect(
      fs.existsSync(path.join(projectsDirectory, 'default', 'store.db')),
    ).toBe(false);

    await contextManager.switchProject(
      'release-notes',
      'Prepare release notes',
    );

    expect(contextManager.listProjects()).toEqual(['release-notes']);
    expect(contextManager.getCurrentProjectId()).toBe('release-notes');
    expect(
      fs.existsSync(path.join(projectsDirectory, 'release-notes', 'store.db')),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(projectsDirectory, 'default', 'store.db')),
    ).toBe(false);
  });
});
