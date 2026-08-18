import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('understanding-graph init', () => {
  it('installs one canonical subscription-client harness for Codex and Claude', () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'understanding-graph-init-'),
    );
    temporaryDirectories.push(directory);
    const canonicalDirectory = fs.realpathSync(directory);
    const cli = path.resolve(import.meta.dirname, '../../../../bin/cli.js');
    const packageVersion = (
      JSON.parse(
        fs.readFileSync(
          path.resolve(import.meta.dirname, '../../../../package.json'),
          'utf8',
        ),
      ) as { version: string }
    ).version;

    const first = spawnSync(process.execPath, [cli, 'init'], {
      cwd: directory,
      encoding: 'utf8',
    });
    expect(first.status, first.stderr).toBe(0);

    const agents = fs.readFileSync(path.join(directory, 'AGENTS.md'), 'utf8');
    const claude = fs.readFileSync(path.join(directory, 'CLAUDE.md'), 'utf8');
    const codex = fs.readFileSync(
      path.join(directory, '.codex/config.toml'),
      'utf8',
    );
    const claudeSettings = JSON.parse(
      fs.readFileSync(
        path.join(directory, '.claude/settings.local.json'),
        'utf8',
      ),
    ) as {
      mcpServers: Record<
        string,
        { args: string[]; env: { PROJECT_DIR: string } }
      >;
    };

    for (const instructions of [agents, claude]) {
      expect(instructions).toContain(
        'understanding-graph:fluid-understanding-v1',
      );
      expect(instructions).toContain('Do not wait for the user to name a tool');
      expect(instructions).toContain(
        'not merely to write a novel',
      );
    }
    expect(agents).toBe(claude);
    expect(codex).toContain('[mcp_servers.understanding_graph]');
    expect(codex).toContain(`understanding-graph@${packageVersion}`);
    expect(codex).toContain(path.join(canonicalDirectory, 'projects'));
    expect(claudeSettings.mcpServers['understanding-graph'].args).toContain(
      `understanding-graph@${packageVersion}`,
    );
    expect(
      claudeSettings.mcpServers['understanding-graph'].env.PROJECT_DIR,
    ).toBe(path.join(canonicalDirectory, 'projects'));

    const second = spawnSync(process.execPath, [cli, 'init'], {
      cwd: directory,
      encoding: 'utf8',
    });
    expect(second.status, second.stderr).toBe(0);
    expect(fs.readFileSync(path.join(directory, 'AGENTS.md'), 'utf8')).toBe(
      agents,
    );
    expect(fs.readFileSync(path.join(directory, 'CLAUDE.md'), 'utf8')).toBe(
      claude,
    );
    expect(
      fs.readFileSync(path.join(directory, '.codex/config.toml'), 'utf8'),
    ).toBe(codex);
  });
});
