#!/usr/bin/env node
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const command = process.argv[2];
const args = process.argv.slice(3);

// Resolve the MCP server and web server entry points via require.resolve
// on their scoped package names. Since v0.1.8 the three workspace
// packages (@emergent-wisdom/understanding-graph-core,
// @emergent-wisdom/understanding-graph-mcp-server, and
// @emergent-wisdom/understanding-graph-web-server) are published as
// separate npm packages under the @emergent-wisdom scope. Global
// installs, npx, and local checkouts all resolve via the normal npm
// dependency tree.
//
// The frontend bundle is still shipped inside the root package at
// packages/frontend/dist (static assets, served by the web-server).
const packageRoot = path.dirname(require.resolve('../package.json'));
const resolveMcpServer = () =>
  require.resolve('@emergent-wisdom/understanding-graph-mcp-server/server');
const resolveWebServer = () =>
  require.resolve('@emergent-wisdom/understanding-graph-web-server');

if (command === 'start') {
  const webServer = resolveWebServer();
  // Web UI + 3D visualization. As of v0.1.6 the frontend bundle (~2.3 MB
  // minified) and the web-server dist (~200 KB) are shipped in the npm
  // package, so this works straight from `npx -y understanding-graph start`
  // without cloning the repo.
  if (!fs.existsSync(webServer)) {
    console.error(
      "The 'start' command needs packages/web-server/dist/index.js, but it\n" +
      "was not found in this install. This usually means you installed an\n" +
      "older version of understanding-graph that did not ship the web UI.\n" +
      "Upgrade with: npm install -g understanding-graph@latest\n"
    );
    process.exit(2);
  }

  if (!process.env.PROJECT_DIR) {
    console.warn(`
⚠  PROJECT_DIR not set — defaulting to ./projects relative to current directory.
   If your MCP server uses a different path, the UI will show an empty graph.
   Set PROJECT_DIR explicitly:  PROJECT_DIR=/path/to/projects npx understanding-graph start
`);
  }
  console.log('Starting Understanding Graph (Web + Frontend)...');
  console.log(
    'Open http://' +
      (process.env.HOST || '127.0.0.1') +
      ':' +
      (process.env.PORT || 3000),
  );

  // The frontend bundle lives in the root understanding-graph package
  // (packages/frontend/dist/). Pass its path to web-server via
  // UG_FRONTEND_DIR so the server can serve static assets regardless of
  // whether it was installed as a standalone package or via the
  // monolithic root package.
  const frontendDir = path.join(packageRoot, 'packages/frontend/dist');
  runServer(webServer, {
    stdio: 'inherit',
    env: { ...process.env, UG_FRONTEND_DIR: frontendDir },
  });

} else if (command === 'mcp') {
  // Silent mode for MCP (stdio is used for JSON-RPC)
  runServer(resolveMcpServer(), { stdio: 'inherit' });

} else if (command === 'init') {
  init();

} else if (command === '--version' || command === '-v') {
  const pkg = require('../package.json');
  console.log(pkg.version);

} else {
  // Print usage. If the user typed an unrecognized command (not just no
  // command and not --help/-h), surface that explicitly so they don't think
  // their command silently succeeded.
  if (command && command !== '--help' && command !== '-h') {
    console.error(`Unknown command: ${command}\n`);
  }
  console.log(`Usage:
  understanding-graph init    Set up MCP + workflow guidance (run inside a project)
  understanding-graph start   Run the web UI and REST API
  understanding-graph mcp     Run the MCP server over stdio (for Claude / agents)
  understanding-graph --version

Environment variables:
  PORT          Web server port (default: 3000)
  HOST          Web bind address (default: 127.0.0.1)
  UG_WORKER_TOKEN
                Required as Authorization: Bearer <token> when HOST is not loopback
  PROJECT_DIR   Where graph data lives (default: ./projects relative to cwd)
  UG_SOURCE_ROOT
                Directory source_load may read files from (default: current cwd)
  TOOL_MODE     MCP tool exposure: general | reading | research | coding |
                collaborative_coding | writing | full | synthetic_reader
                (default: general; full is explicit broad access;
                synthetic_reader is reserved Reader/CMP production)

Quick start with Claude Code:
  claude mcp add ug -- npx -y understanding-graph mcp
`);
  if (command && command !== '--help' && command !== '-h') {
    process.exit(2);
  }
}

function runServer(entryPoint, options) {
  const child = spawn(process.execPath, [entryPoint], options);
  const forwardSigint = () => child.kill('SIGINT');
  const forwardSigterm = () => child.kill('SIGTERM');
  process.once('SIGINT', forwardSigint);
  process.once('SIGTERM', forwardSigterm);
  child.once('error', (error) => {
    console.error(`Failed to start Understanding Graph: ${error.message}`);
    process.exitCode = 1;
  });
  child.once('exit', (code, signal) => {
    process.removeListener('SIGINT', forwardSigint);
    process.removeListener('SIGTERM', forwardSigterm);
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exitCode = code ?? 1;
  });
}

function init() {
  const cwd = process.cwd();
  const packageVersion = require('../package.json').version;
  let created = [];
  let skipped = [];

  // 1. Create Claude Code's supported project-scoped MCP configuration.
  // MCP servers do not load from .claude/settings.local.json. Migrate only a
  // previously generated UG entry from that legacy location and leave every
  // unrelated setting untouched.
  const claudeMcpPath = path.join(cwd, '.mcp.json');
  const legacyClaudeSettingsPath = path.join(
    cwd,
    '.claude',
    'settings.local.json',
  );
  const legacyClaudeSettings = readJsonObject(legacyClaudeSettingsPath);
  const legacyClaudeServer =
    legacyClaudeSettings &&
    isJsonObject(legacyClaudeSettings.mcpServers) &&
    isManagedClaudeMcpConfig(
      legacyClaudeSettings.mcpServers['understanding-graph'],
    )
      ? legacyClaudeSettings.mcpServers['understanding-graph']
      : null;
  const claudeMcp = fs.existsSync(claudeMcpPath)
    ? readJsonObject(claudeMcpPath)
    : {};

  if (claudeMcp === null) {
    skipped.push('.mcp.json (invalid JSON preserved; MCP config not changed)');
  } else {
    if (!isJsonObject(claudeMcp.mcpServers)) claudeMcp.mcpServers = {};
    const servers = claudeMcp.mcpServers;
    let managedKey = 'understanding-graph';
    let existingClaudeServer = servers[managedKey];

    if (!existingClaudeServer) {
      const managedEntry = Object.entries(servers).find(([, config]) =>
        isManagedClaudeMcpConfig(config),
      );
      if (managedEntry) {
        [managedKey, existingClaudeServer] = managedEntry;
      }
    }

    let claudeConfigReady = false;
    if (
      existingClaudeServer &&
      !isManagedClaudeMcpConfig(existingClaudeServer)
    ) {
      skipped.push('.mcp.json (custom Understanding Graph server preserved)');
    } else {
      const managedServer = existingClaudeServer ?? legacyClaudeServer ?? {
        command: 'npx',
        args: ['-y', `understanding-graph@${packageVersion}`, 'mcp'],
        env: {
          PROJECT_DIR: '${CLAUDE_PROJECT_DIR:-.}/projects',
          UG_SOURCE_ROOT: '${CLAUDE_PROJECT_DIR:-.}',
        },
      };
      const packageArg = managedServer.args.findIndex((arg) =>
        /^understanding-graph@[^/\s]+$/.test(arg),
      );
      managedServer.args[packageArg] = `understanding-graph@${packageVersion}`;
      if (!isJsonObject(managedServer.env)) managedServer.env = {};
      if (!Object.hasOwn(managedServer.env, 'UG_SOURCE_ROOT')) {
        managedServer.env.UG_SOURCE_ROOT = '${CLAUDE_PROJECT_DIR:-.}';
      }
      servers[managedKey] = managedServer;

      const serialized = `${JSON.stringify(claudeMcp, null, 2)}\n`;
      const current = fs.existsSync(claudeMcpPath)
        ? fs.readFileSync(claudeMcpPath, 'utf8')
        : '';
      if (current === serialized) {
        skipped.push('.mcp.json (managed Claude MCP server is current)');
      } else {
        fs.writeFileSync(claudeMcpPath, serialized);
        created.push(
          current
            ? '.mcp.json (updated managed Claude MCP version)'
            : '.mcp.json',
        );
      }
      claudeConfigReady = true;
    }

    if (claudeConfigReady && legacyClaudeServer) {
      delete legacyClaudeSettings.mcpServers['understanding-graph'];
      if (Object.keys(legacyClaudeSettings.mcpServers).length === 0) {
        delete legacyClaudeSettings.mcpServers;
      }
      fs.writeFileSync(
        legacyClaudeSettingsPath,
        `${JSON.stringify(legacyClaudeSettings, null, 2)}\n`,
      );
      created.push(
        '.claude/settings.local.json (removed obsolete managed MCP entry)',
      );
    }
  }

  // 2. Create project-scoped Codex MCP configuration.
  const codexDir = path.join(cwd, '.codex');
  const codexConfigPath = path.join(codexDir, 'config.toml');
  const sourceRoot = fs.realpathSync(cwd);
  const codexSection = `[mcp_servers.understanding_graph]\ncommand = "npx"\nargs = ["-y", "understanding-graph@${packageVersion}", "mcp"]\nenv = { PROJECT_DIR = ${JSON.stringify(path.join(cwd, 'projects'))}, UG_SOURCE_ROOT = ${JSON.stringify(sourceRoot)} }\n`;
  if (!fs.existsSync(codexDir)) {
    fs.mkdirSync(codexDir, { recursive: true });
  }
  const existingCodex = fs.existsSync(codexConfigPath)
    ? fs.readFileSync(codexConfigPath, 'utf8')
    : '';
  if (existingCodex.includes('[mcp_servers.understanding_graph]')) {
    const updated = updateManagedCodexMcpVersion(
      existingCodex,
      packageVersion,
      sourceRoot,
    );
    if (updated === null) {
      skipped.push('.codex/config.toml (custom MCP server preserved)');
    } else if (updated === existingCodex) {
      skipped.push('.codex/config.toml (managed MCP server is current)');
    } else {
      fs.writeFileSync(codexConfigPath, updated);
      created.push('.codex/config.toml (updated managed MCP version)');
    }
  } else {
    const prefix = existingCodex ? `${existingCodex.trimEnd()}\n\n` : '';
    fs.writeFileSync(codexConfigPath, `${prefix}${codexSection}`);
    created.push('.codex/config.toml');
  }

  // 3. Give both subscription clients the same canonical workflow skill.
  const ugSection = getUnderstandingWorkSection(packageVersion);
  installInstructionFile(path.join(cwd, 'CLAUDE.md'), ugSection, created, skipped);
  installInstructionFile(path.join(cwd, 'AGENTS.md'), ugSection, created, skipped);

  // 4. Create projects/default/ directory
  const projectsDir = path.join(cwd, 'projects', 'default');
  if (fs.existsSync(projectsDir)) {
    skipped.push('projects/default/ (already exists)');
  } else {
    fs.mkdirSync(projectsDir, { recursive: true });
    created.push('projects/default/');
  }

  // 5. Ensure projects/ is in .gitignore
  const gitignorePath = path.join(cwd, '.gitignore');
  if (fs.existsSync(gitignorePath)) {
    const gitignore = fs.readFileSync(gitignorePath, 'utf-8');
    if (!gitignore.includes('projects/')) {
      fs.appendFileSync(gitignorePath, '\n# Understanding Graph data\nprojects/\n');
      created.push('.gitignore (added projects/)');
    }
  } else {
    fs.writeFileSync(gitignorePath, '# Understanding Graph data\nprojects/\n');
    created.push('.gitignore');
  }

  // Report
  console.log('\n  Understanding Graph initialized.\n');

  if (created.length > 0) {
    console.log('  Created:');
    for (const f of created) {
      console.log('    + ' + f);
    }
  }

  if (skipped.length > 0) {
    console.log('  Skipped:');
    for (const f of skipped) {
      console.log('    - ' + f);
    }
  }

  console.log(`
  Next steps:
    1. Open Codex or Claude Code in this directory and sign in with your normal
       ChatGPT or Claude subscription
    2. Ask naturally for substantive work; you do not need to say "use the graph"
    3. The agent should work in the graph, preserve material understanding as it
       emerges, and use weighted suggestions or re-entry at natural choice points

  Both client configurations resolve this project's graph storage and source
  root regardless of the agent process's launch directory.
`);
}

function isManagedClaudeMcpConfig(config) {
  return Boolean(
    config &&
      typeof config === 'object' &&
      config.command === 'npx' &&
      Array.isArray(config.args) &&
      config.args.includes('mcp') &&
      config.args.some(
        (arg) =>
          typeof arg === 'string' && /^understanding-graph@[^/\s]+$/.test(arg),
      ),
  );
}

function isJsonObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function readJsonObject(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return isJsonObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function updateManagedCodexMcpVersion(content, packageVersion, sourceRoot) {
  const start = content.indexOf('[mcp_servers.understanding_graph]');
  if (start < 0) return null;
  if (/^\[mcp_servers\.understanding_graph\.env\]\s*$/m.test(content)) {
    return null;
  }
  const nextSection = content.indexOf('\n[', start + 1);
  const end = nextSection < 0 ? content.length : nextSection + 1;
  const section = content.slice(start, end);
  if (/^env\s*\./m.test(section)) return null;
  if (
    !/^command\s*=\s*"npx"\s*$/m.test(section) ||
    !/understanding-graph@[^"\s,]+/.test(section) ||
    !/args\s*=\s*\[[^\]]*"mcp"[^\]]*\]/s.test(section)
  ) {
    return null;
  }
  let updatedSection = section.replace(
    /understanding-graph@[^"\s,]+/,
    `understanding-graph@${packageVersion}`,
  );
  if (!/\bUG_SOURCE_ROOT\s*=/.test(updatedSection)) {
    const inlineEnv = /^(env\s*=\s*\{)([^}\n]*)(\}\s*)$/m;
    if (inlineEnv.test(updatedSection)) {
      updatedSection = updatedSection.replace(
        inlineEnv,
        (_match, opening, entries, closing) => {
          const existingEntries = entries.trim();
          const prefix = existingEntries ? `${existingEntries}, ` : '';
          return `${opening} ${prefix}UG_SOURCE_ROOT = ${JSON.stringify(sourceRoot)} ${closing}`;
        },
      );
    } else {
      updatedSection = `${updatedSection.trimEnd()}\nenv = { UG_SOURCE_ROOT = ${JSON.stringify(sourceRoot)} }\n`;
    }
  }
  return `${content.slice(0, start)}${updatedSection}${content.slice(end)}`;
}

function getUnderstandingWorkSection(packageVersion) {
  const skillPath = path.join(
    packageRoot,
    'skills',
    'understanding-work',
    'SKILL.md',
  );
  const skill = fs.readFileSync(skillPath, 'utf8');
  const body = skill
    .replace(/^---\n[\s\S]*?\n---\n/, '')
    .replace(/^# Work through Understanding\n+/, '')
    .trim();
  return `<!-- understanding-graph:fluid-understanding-v1 package=${packageVersion} -->
# Understanding Graph

${body}

---

*Generated from the bundled \`understanding-work\` skill by \`npx understanding-graph init\`. The graph workflow applies automatically to substantive work; the user does not need to name it.*
<!-- /understanding-graph -->
`;
}

function installInstructionFile(filePath, section, created, skipped) {
  const label = path.basename(filePath);
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, section);
    created.push(label);
    return;
  }

  const existing = fs.readFileSync(filePath, 'utf8');
  if (existing.includes(section)) {
    skipped.push(`${label} (current Understanding Graph protocol already present)`);
    return;
  }

  const boundedGeneratedSection =
    /<!-- understanding-graph:[^>]+ -->[\s\S]*?<!-- \/understanding-graph -->\n?/;
  const priorGeneratedSection =
    /<!-- understanding-graph:[^>]+ -->[\s\S]*?\*Generated from the bundled `understanding-work` skill by `npx understanding-graph init`\.[^\n]*\*\n?/;
  const generatedSection = boundedGeneratedSection.test(existing)
    ? boundedGeneratedSection
    : priorGeneratedSection;
  if (generatedSection.test(existing)) {
    fs.writeFileSync(filePath, existing.replace(generatedSection, section));
    created.push(`${label} (updated Understanding Graph protocol)`);
    return;
  }

  const generatedLegacy =
    /# Understanding Graph[\s\S]*?\*This file was generated by `npx understanding-graph init`\.[^\n]*\*\n?/;
  if (generatedLegacy.test(existing)) {
    fs.writeFileSync(filePath, existing.replace(generatedLegacy, section));
    created.push(`${label} (updated Understanding Graph protocol)`);
    return;
  }

  fs.appendFileSync(filePath, `\n${section}`);
  created.push(`${label} (appended Understanding Graph protocol)`);
}
