import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveServerJsonPath } from './mcp-discovery.js';

const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ug-discovery-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('MCP discovery record resolution', () => {
  it('prefers an explicitly configured record', () => {
    const root = temporaryDirectory();
    const moduleDir = path.join(root, 'dist');
    const configured = path.join(root, 'configured.json');
    fs.mkdirSync(moduleDir);
    fs.writeFileSync(configured, '{}');

    expect(resolveServerJsonPath(moduleDir, configured)).toBe(configured);
  });

  it('uses the record bundled beside the built server', () => {
    const root = temporaryDirectory();
    const moduleDir = path.join(root, 'dist');
    const bundled = path.join(moduleDir, 'server.json');
    fs.mkdirSync(moduleDir);
    fs.writeFileSync(bundled, '{}');

    expect(resolveServerJsonPath(moduleDir)).toBe(bundled);
  });

  it('falls back to the repository record during source development', () => {
    const root = temporaryDirectory();
    const moduleDir = path.join(root, 'packages', 'web-server', 'src');
    const repositoryRecord = path.join(root, 'server.json');
    fs.mkdirSync(moduleDir, { recursive: true });
    fs.writeFileSync(repositoryRecord, '{}');

    expect(resolveServerJsonPath(moduleDir)).toBe(repositoryRecord);
  });

  it('fails closed when no record exists', () => {
    const root = temporaryDirectory();
    const moduleDir = path.join(root, 'dist');
    fs.mkdirSync(moduleDir);

    expect(resolveServerJsonPath(moduleDir)).toBeNull();
  });
});
