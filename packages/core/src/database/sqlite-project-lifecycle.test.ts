import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as sqlite from './sqlite.js';

let projectsDirectory: string;

beforeEach(() => {
  projectsDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'understanding-graph-project-lifecycle-'),
  );
});

afterEach(() => {
  sqlite.closeAllDatabases();
  fs.rmSync(projectsDirectory, { recursive: true, force: true });
});

describe('closeProjectDatabase', () => {
  it('closes only the requested project and clears it when active', () => {
    sqlite.initDatabase(path.join(projectsDirectory, 'first'));
    sqlite.initDatabase(path.join(projectsDirectory, 'second'));
    sqlite.setCurrentProject('first');

    expect(sqlite.closeProjectDatabase('first')).toBe(true);
    expect(sqlite.getLoadedProjectIds()).toEqual(['second']);
    expect(sqlite.getCurrentProjectId()).toBeNull();
    expect(() => sqlite.getDb('first')).toThrow('not loaded yet');
  });

  it('leaves the active project unchanged when unloading another project', () => {
    sqlite.initDatabase(path.join(projectsDirectory, 'active'));
    sqlite.initDatabase(path.join(projectsDirectory, 'inactive'));
    sqlite.setCurrentProject('active');

    expect(sqlite.closeProjectDatabase('inactive')).toBe(true);
    expect(sqlite.getCurrentProjectId()).toBe('active');
    expect(sqlite.getDb()).toBe(sqlite.getDb('active'));
  });

  it('is idempotent for projects that are not loaded', () => {
    expect(sqlite.closeProjectDatabase('missing')).toBe(false);
  });
});
