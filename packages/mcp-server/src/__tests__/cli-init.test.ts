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
    const claudeMcp = JSON.parse(
      fs.readFileSync(path.join(directory, '.mcp.json'), 'utf8'),
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
      expect(instructions).toContain('not merely to write a novel');
    }
    expect(agents).toBe(claude);
    expect(codex).toContain('[mcp_servers.understanding_graph]');
    expect(codex).toContain(`understanding-graph@${packageVersion}`);
    expect(codex).toContain(path.join(canonicalDirectory, 'projects'));
    expect(claudeMcp.mcpServers['understanding-graph'].args).toContain(
      `understanding-graph@${packageVersion}`,
    );
    expect(claudeMcp.mcpServers['understanding-graph'].env.PROJECT_DIR).toBe(
      `\${CLAUDE_PROJECT_DIR:-.}/projects`,
    );
    expect(
      fs.existsSync(path.join(directory, '.claude/settings.local.json')),
    ).toBe(false);

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
    expect(fs.readFileSync(path.join(directory, '.mcp.json'), 'utf8')).toBe(
      `${JSON.stringify(claudeMcp, null, 2)}\n`,
    );
  });

  it('upgrades managed 0.1.27 clients and bounded guidance without touching user content', () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'understanding-graph-upgrade-'),
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
    fs.mkdirSync(path.join(directory, '.claude'), { recursive: true });
    fs.mkdirSync(path.join(directory, '.codex'), { recursive: true });
    fs.writeFileSync(
      path.join(directory, '.claude/settings.local.json'),
      JSON.stringify(
        {
          permissions: { allow: ['Read'] },
          mcpServers: {
            'understanding-graph': {
              command: 'npx',
              args: ['-y', 'understanding-graph@0.1.27', 'mcp'],
              env: {
                PROJECT_DIR: path.join(canonicalDirectory, 'projects'),
                CUSTOM_FLAG: 'preserve-me',
              },
            },
          },
        },
        null,
        2,
      ),
    );
    fs.writeFileSync(
      path.join(directory, '.codex/config.toml'),
      `[model]\nname = "keep-me"\n\n[mcp_servers.understanding_graph]\ncommand = "npx"\nargs = ["-y", "understanding-graph@0.1.27", "mcp"]\nenv = { PROJECT_DIR = ${JSON.stringify(path.join(canonicalDirectory, 'projects'))} }\n\n[other]\nvalue = "survives"\n`,
    );
    const oldGenerated = `<!-- understanding-graph:fluid-understanding-v1 -->\n# Understanding Graph\n\nOld generated guidance.\n\n---\n\n*Generated from the bundled \`understanding-work\` skill by \`npx understanding-graph init\`. The graph workflow applies automatically to substantive work; the user does not need to name it.*\n`;
    fs.writeFileSync(
      path.join(directory, 'AGENTS.md'),
      `# User instructions\n\nKeep this before.\n\n${oldGenerated}\n## User appendix\n\nKeep this after.\n`,
    );
    fs.writeFileSync(path.join(directory, 'CLAUDE.md'), oldGenerated);

    const run = spawnSync(process.execPath, [cli, 'init'], {
      cwd: directory,
      encoding: 'utf8',
    });
    expect(run.status, run.stderr).toBe(0);

    const settings = JSON.parse(
      fs.readFileSync(
        path.join(directory, '.claude/settings.local.json'),
        'utf8',
      ),
    ) as {
      permissions: { allow: string[] };
    };
    expect(settings.permissions.allow).toEqual(['Read']);
    expect(settings).not.toHaveProperty('mcpServers');
    const claudeMcp = JSON.parse(
      fs.readFileSync(path.join(directory, '.mcp.json'), 'utf8'),
    ) as {
      mcpServers: Record<
        string,
        { args: string[]; env: Record<string, string> }
      >;
    };
    expect(claudeMcp.mcpServers['understanding-graph'].args).toContain(
      `understanding-graph@${packageVersion}`,
    );
    expect(claudeMcp.mcpServers['understanding-graph'].env.CUSTOM_FLAG).toBe(
      'preserve-me',
    );

    const codex = fs.readFileSync(
      path.join(directory, '.codex/config.toml'),
      'utf8',
    );
    expect(codex).toContain(`understanding-graph@${packageVersion}`);
    expect(codex).toContain('name = "keep-me"');
    expect(codex).toContain('value = "survives"');

    const agents = fs.readFileSync(path.join(directory, 'AGENTS.md'), 'utf8');
    expect(agents).toContain(
      `understanding-graph:fluid-understanding-v1 package=${packageVersion}`,
    );
    expect(agents).toContain('Keep this before.');
    expect(agents).toContain('Keep this after.');
    expect(agents.match(/# Understanding Graph/g)).toHaveLength(1);
  });

  it('preserves custom MCP entries instead of claiming ownership', () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'understanding-graph-custom-mcp-'),
    );
    temporaryDirectories.push(directory);
    const cli = path.resolve(import.meta.dirname, '../../../../bin/cli.js');
    fs.mkdirSync(path.join(directory, '.claude'), { recursive: true });
    fs.mkdirSync(path.join(directory, '.codex'), { recursive: true });
    const legacyCustomClaude = {
      mcpServers: {
        'understanding-graph': {
          command: '/custom/ug-wrapper',
          args: ['serve'],
        },
      },
    };
    fs.writeFileSync(
      path.join(directory, '.claude/settings.local.json'),
      JSON.stringify(legacyCustomClaude, null, 2),
    );
    const customClaude = {
      mcpServers: {
        'understanding-graph': {
          command: '/custom/project-ug-wrapper',
          args: ['serve-project'],
        },
      },
    };
    fs.writeFileSync(
      path.join(directory, '.mcp.json'),
      JSON.stringify(customClaude, null, 2),
    );
    const customCodex = `[mcp_servers.understanding_graph]\ncommand = "/custom/ug-wrapper"\nargs = ["serve"]\n`;
    fs.writeFileSync(path.join(directory, '.codex/config.toml'), customCodex);

    const run = spawnSync(process.execPath, [cli, 'init'], {
      cwd: directory,
      encoding: 'utf8',
    });
    expect(run.status, run.stderr).toBe(0);
    expect(
      JSON.parse(
        fs.readFileSync(
          path.join(directory, '.claude/settings.local.json'),
          'utf8',
        ),
      ),
    ).toEqual(legacyCustomClaude);
    expect(
      JSON.parse(fs.readFileSync(path.join(directory, '.mcp.json'), 'utf8')),
    ).toEqual(customClaude);
    expect(
      fs.readFileSync(path.join(directory, '.codex/config.toml'), 'utf8'),
    ).toBe(customCodex);
  });
});
