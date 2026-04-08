#!/usr/bin/env node
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const command = process.argv[2];
const args = process.argv.slice(3);

// Resolve paths relative to the package root via require.resolve so that
// npx, global installs, and symlinked dev checkouts all work correctly.
// Using __dirname + '../packages/...' fails when the bin file is symlinked
// into a global bin directory because the relative path resolves from the
// symlink's location, not the real package directory.
const packageRoot = path.dirname(require.resolve('../package.json'));
const webServer = path.join(packageRoot, 'packages/web-server/dist/index.js');
const mcpServer = path.join(packageRoot, 'packages/mcp-server/dist/index.js');

if (command === 'start') {
  // The npm package ships only what `mcp` needs (~1.5 MB). The web UI / 3D
  // visualization (`start`) requires the frontend bundle and web-server dist,
  // which together pull in ~160 MB of onnxruntime + three.js + react. To keep
  // `npx -y understanding-graph mcp` fast and small, those are NOT in the
  // published tarball for v0.1.0. If you want the web UI, clone the repo.
  if (!fs.existsSync(webServer)) {
    console.error(
      "The 'start' command (web UI + 3D visualization) is not included in the\n" +
      "npm package for v0.1.0 because the frontend bundle is ~160 MB and most\n" +
      "users only need the MCP server.\n\n" +
      "To run the web UI, clone the repo and build from source:\n\n" +
      "  git clone https://github.com/emergent-wisdom/understanding-graph.git\n" +
      "  cd understanding-graph\n" +
      "  npm install\n" +
      "  npm run build\n" +
      "  npm run start:web\n\n" +
      "Then open http://localhost:3000\n\n" +
      "If you only need the MCP server (the primary use case), use:\n" +
      "  understanding-graph mcp\n"
    );
    process.exit(2);
  }

  console.log('Starting Understanding Graph (Web + Frontend)...');
  console.log('Open http://localhost:' + (process.env.PORT || 3000));

  // Pass through environment variables like PORT and PROJECT_DIR
  spawn('node', [webServer], { stdio: 'inherit' });

} else if (command === 'mcp') {
  // Silent mode for MCP (stdio is used for JSON-RPC)
  spawn('node', [mcpServer], { stdio: 'inherit' });

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
  understanding-graph init    Set up MCP + CLAUDE.md for agent teams (run inside a project)
  understanding-graph start   Run the web UI and REST API
  understanding-graph mcp     Run the MCP server over stdio (for Claude / agents)
  understanding-graph --version

Environment variables:
  PORT          Web server port (default: 3000)
  PROJECT_DIR   Where graph data lives (default: ./projects relative to cwd)
  TOOL_MODE     MCP tool exposure: reading | research | full (default: full)

Quick start with Claude Code:
  claude mcp add ug -- npx -y understanding-graph mcp
`);
  if (command && command !== '--help' && command !== '-h') {
    process.exit(2);
  }
}

function init() {
  const cwd = process.cwd();
  let created = [];
  let skipped = [];

  // 1. Create .claude/settings.local.json with MCP config
  const claudeDir = path.join(cwd, '.claude');
  const settingsPath = path.join(claudeDir, 'settings.local.json');

  if (!fs.existsSync(claudeDir)) {
    fs.mkdirSync(claudeDir, { recursive: true });
  }

  let settings = {};
  if (fs.existsSync(settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    } catch (e) {
      // Corrupted file, start fresh
    }
  }

  if (!settings.mcpServers) {
    settings.mcpServers = {};
  }

  if (settings.mcpServers['understanding-graph']) {
    skipped.push('.claude/settings.local.json (MCP server already configured)');
  } else {
    // Use an absolute PROJECT_DIR so the MCP server finds the graph regardless
    // of where Claude Code is launched from (a common foot-gun with cwd-relative
    // paths is launching Claude from a parent directory and getting an "empty"
    // graph because ./projects doesn't exist relative to the new cwd).
    settings.mcpServers['understanding-graph'] = {
      command: 'npx',
      args: ['-y', 'understanding-graph', 'mcp'],
      env: {
        PROJECT_DIR: path.join(cwd, 'projects')
      }
    };

    // Enable agent teams
    if (!settings.env) {
      settings.env = {};
    }
    if (!settings.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS) {
      settings.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = '1';
    }

    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
    created.push('.claude/settings.local.json');
  }

  // 2. Create or append to CLAUDE.md
  const claudeMdPath = path.join(cwd, 'CLAUDE.md');
  const ugSection = getClaudeMdSection();

  if (fs.existsSync(claudeMdPath)) {
    const existing = fs.readFileSync(claudeMdPath, 'utf-8');
    if (existing.includes('Understanding Graph')) {
      skipped.push('CLAUDE.md (already has Understanding Graph section)');
    } else {
      fs.appendFileSync(claudeMdPath, '\n' + ugSection);
      created.push('CLAUDE.md (appended Understanding Graph section)');
    }
  } else {
    fs.writeFileSync(claudeMdPath, ugSection);
    created.push('CLAUDE.md');
  }

  // 3. Create projects/default/ directory
  const projectsDir = path.join(cwd, 'projects', 'default');
  if (fs.existsSync(projectsDir)) {
    skipped.push('projects/default/ (already exists)');
  } else {
    fs.mkdirSync(projectsDir, { recursive: true });
    created.push('projects/default/');
  }

  // 4. Ensure projects/ is in .gitignore
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
    1. Open Claude Code in this directory
    2. Ask Claude: "Call graph_skeleton and tell me what's in the graph"
    3. From there, ask Claude to create an agent team for your task —
       all teammates share the same understanding graph automatically

  PROJECT_DIR was written as an absolute path in
  .claude/settings.local.json so the graph is found regardless of where
  you launch Claude Code from.
`);
}

function getClaudeMdSection() {
  return `# Understanding Graph

This project uses an Understanding Graph for persistent memory and multi-agent coordination.
All agents (including agent team teammates) share the same graph automatically via MCP.

## Every Session

Start each session with these three calls:

1. \`graph_skeleton\` — orient yourself (~150 tokens; shows regions, hubs, recent activity)
2. \`graph_semantic_search\` with the topic of your task — find relevant past reasoning
3. \`graph_history\` — see what other agents did recently and why

## Rules

- **All mutations go through \`graph_batch\`** with a \`commit_message\` explaining intent. graph_batch is an **atomic commit**: if any operation in the batch fails, the entire batch is rolled back as if it never ran — the graph stays in exactly the state it was in before. The \`commit_message\` is preserved as each node's *Origin Story* so future agents see the intent that created it, not just the result.
- **Include your name** in commit messages (e.g., "Backend Agent: mapped auth flow") so teammates can follow your reasoning trail.
- **Check before creating** — call \`graph_semantic_search\` first to avoid creating duplicates of existing concepts.
- **Never delete, only supersede** — use \`graph_supersede\` when understanding evolves. The old node stays in history.
- **Synthesize, don't transcribe** — capture implications and tensions, not raw facts. The graph is for your *understanding*, not your input.

## Triggers (when to use which)

Every concept node carries a \`trigger\` that classifies *why* it was created. The seven you'll use most often:

- \`foundation\` — A core concept, axiom, or starting point for a region of the graph
- \`surprise\` — Something unexpected; contradicts a prior belief
- \`tension\` — Two ideas in conflict, not yet resolved
- \`consequence\` — A downstream implication of an existing concept
- \`question\` — An open question to come back to (use \`graph_question\` for this)
- \`decision\` — A choice made between alternatives, with rationale
- \`prediction\` — A forward-looking belief that can be checked later

Less common but available: \`hypothesis\`, \`model\`, \`evaluation\`, \`analysis\`, \`experiment\`, \`serendipity\`, \`repetition\`, \`randomness\`, \`reference\`, \`library\`. See \`graph_add_concept\` tool docs for the full set.

Note: the \`thinking\` trigger is reserved for the synthesizer agent and will be rejected for normal use. Pick another trigger that classifies the *why* of your contribution.

## Example: a minimal first commit

\`graph_add_concept\` requires four fields: \`title\`, \`trigger\`, \`understanding\` (your synthesis), and \`why\` (why it matters). Here is a real two-node, one-edge commit:

\`\`\`
graph_batch with:
  commit_message: "Researcher: capture initial auth flow understanding"
  agent_name: "Researcher"
  operations:
    - tool: graph_add_concept
      params:
        title: "Session token storage"
        trigger: "foundation"
        understanding: "Tokens live in httpOnly cookies, not localStorage."
        why: "Foundation for every later auth decision; needs to be visible upfront."
    - tool: graph_add_concept
      params:
        title: "XSS vs UX tension"
        trigger: "tension"
        understanding: "httpOnly cookies block XSS but make cross-tab logout harder."
        why: "Unresolved trade-off that the team will hit when implementing logout."
    - tool: graph_connect
      params:
        fromTitle: "XSS vs UX tension"
        toTitle: "Session token storage"
        type: "questions"
\`\`\`

Use \`graph_connect\` to link new work into existing concepts. Orphan nodes are rejected by graph_batch.

## Agent Team Coordination

When working as part of an agent team:
- Read \`graph_history\` first to see what teammates have done and why
- Use \`graph_question\` to flag open questions for teammates to pick up
- Use \`graph_find_by_trigger\` with \`question\` or \`tension\` to find work that needs you
- Triggers + commit messages are the entire coordination protocol. There is no chat channel.

## Long-Running Coordination

For tasks that span multiple sessions or need async handoff between specialist agents:

- \`solver_spawn\` — register a specialist (e.g., "SecurityReviewer")
- \`solver_delegate\` — post a task to the queue
- \`solver_claim_task\` — pick up pending work
- \`solver_complete_task\` — submit results
- \`solver_lock\` / \`solver_unlock\` — cooperative *subtree-partition* locks for parallel cognition. Use \`scope: "subtree"\` to claim an entire branch (e.g. one agent locks the "Economics" subtree, another locks "Ethics", and they refactor in parallel without colliding). Storage-layer advisory: cooperating agents check before mutating; the mutation path does not enforce the lock against an adversary.
`;
}
