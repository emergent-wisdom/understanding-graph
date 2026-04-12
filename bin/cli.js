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
const mcpServer = require.resolve('@emergent-wisdom/understanding-graph-mcp-server');
const webServer = require.resolve('@emergent-wisdom/understanding-graph-web-server');

if (command === 'start') {
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
  console.log('Open http://localhost:' + (process.env.PORT || 3000));

  // The frontend bundle lives in the root understanding-graph package
  // (packages/frontend/dist/). Pass its path to web-server via
  // UG_FRONTEND_DIR so the server can serve static assets regardless of
  // whether it was installed as a standalone package or via the
  // monolithic root package.
  const frontendDir = path.join(packageRoot, 'packages/frontend/dist');
  spawn('node', [webServer], {
    stdio: 'inherit',
    env: { ...process.env, UG_FRONTEND_DIR: frontendDir },
  });

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

This project uses an Understanding Graph as persistent, shared cognitive memory. Without it, you are amnesic. With it, your thinking becomes durable, and future sessions (including teammate agents) can re-inhabit it instead of starting over.

## The living memory principle

The graph is **metabolic, not crystalline**. It stores comprehension (shifts in your understanding) rather than facts (frozen final states). When your thinking moves, a surprise, a tension, a decision, a foundation becoming explicit, capture the movement as a node in the same batch as the artifact it produced. Make the invisible visible.

The operational question, asked before and after every batch:

> **What changed in my understanding just now? What did I believe before, and what do I believe after?**

If you can't answer it, the batch is premature. Pause and name the thing that actually shifted, or hold off on the batch until something does.

**Your gradual understanding belongs in the graph, not just the artifacts you produce with it.** The graph is the record of your learning, not a place you file outputs. When you come to understand the task differently than you did an hour ago, that is a node. When the user corrects a mistake you didn't know you were making, that is a node. When you realize your approach was wrong and you need to restart, that is a node. When a tool you thought you understood behaves surprisingly, that is a node. These are not "meta" work that happens outside the graph; they are the gradual understanding that is the whole point of having an Understanding Graph in the first place.

Two failure modes you should recognize in yourself:

- **Filing, not thinking.** You pre-wrote a plan and are dumping it into the graph as a single scaffold. The graph will look organized but dead. The reasoning trail is absent because there was no reasoning in flight, only retrieval from your already-made-up mind.
- **Retroactive rationalization.** You finished a thing and are now writing "decision" nodes to explain what you chose. Those nodes are rationalization, not thinking. If you catch yourself doing this, stop and notice that the next unit of real work is the place to capture shifts as they happen, not to keep adding explanatory debt to the already-done work.

## Every session: orient before acting

1. \`graph_skeleton\`: orient yourself (~150 tokens). Shows regions, hubs, recent activity.
2. \`graph_history\` with a small limit: see what shifted recently and why. Commit messages are the reasoning trail.
3. \`graph_semantic_search\` with your task's keywords: find relevant prior thinking you can extend instead of duplicating.

You wake up with no memory. These three calls give you back yesterday.

## The primitives

**All mutations go through \`graph_batch\`**, with a required \`commit_message\` that explains the intent of the batch. Each batch is atomic: if any operation fails, the whole batch rolls back as if it never ran. The commit message is preserved as each node's *Origin Story*.

- Include your agent name in the message: \`"Writer: opened with 'tired' after the planned abstract opening felt cold by sentence three."\`
- Check before creating. \`graph_semantic_search\` first; if a similar node exists, \`graph_revise\` over duplicate.
- Never delete. Use \`graph_supersede\` when understanding evolves. The old node stays in history with a \`supersedes\` edge pointing from the new one.
- No orphans. Every new concept must connect to at least one existing or just-created node through a graph_connect operation in the same batch.

## Triggers: the *why* of a node

Every concept node carries a \`trigger\` that classifies why it was created. The seven you'll use most often:

- \`foundation\`: bedrock. The thing other nodes rest on.
- \`surprise\`: "wait, that's not what I expected."
- \`tension\`: two ideas in conflict, not yet resolved.
- \`consequence\`: "so therefore..."
- \`question\`: a real uncertainty, not a rhetorical device. Use \`graph_question\` as a shortcut.
- \`decision\`: a choice made, with rationale.
- \`prediction\`: forward-looking belief that can be validated later.

Also available: \`hypothesis\`, \`model\`, \`evaluation\`, \`analysis\`, \`experiment\`, \`serendipity\`, \`repetition\`, \`randomness\`, \`reference\`, \`library\`. The \`thinking\` trigger is reserved for the synthesizer agent.

Pick the trigger that most honestly classifies *why* the node exists. If none of them fit, the node probably shouldn't exist yet.

## Edges: the *how* of relation

Every \`graph_connect\` edge needs a type and a \`why\` string. Common types:

- \`refines\`: X adds precision to Y.
- \`supersedes\`: X replaces Y; Y stays in history.
- \`contradicts\`: X and Y are in unresolved conflict.
- \`learned_from\`: X was arrived at by engaging with Y. Cognitive lineage.
- \`answers\` / \`questions\`: X resolves or raises Y.
- \`expresses\`: a doc node renders a concept.
- \`validates\` / \`invalidates\`: later evidence confirms or refutes a prediction or hypothesis.

If you can't articulate in one sentence *why* two nodes connect, don't connect them.

## How you batch is up to you

The tool is yours. How many operations per batch, how fine-grained to capture shifts, how to balance prose and thinking, when to commit: these are your judgment calls, not the tool's prescription. The rules above (atomic batches, commit messages, no orphans, never delete) are the minimum; everything else is your call.

That said, a few red flags to watch for in your own batches:

- **A batch with only \`doc_create\` operations.** You're treating the graph as a file store, not a reasoning memory. Did something in your thinking shift while you drafted that prose? If yes, the shift belongs in the same batch as the prose.
- **A batch with only concept nodes and no connection to anything you're actually making.** You're planning in the graph rather than thinking in it. Plans made this way tend to be reverse-engineered from assumptions you haven't examined.
- **A very large batch (many sections of prose plus many concept nodes).** It probably means you drafted the artifact in your head first and are now filing it. The reasoning trail you would have captured between sections is missing.

None of these are forbidden. Occasionally they are the right shape for the work. But if you notice them, pause and ask whether the batch is actually alive or just convenient.

## Coordination with other agents

When working with teammates, future-you, or parallel solvers, the graph is the coordination protocol. There is no chat channel.

- \`graph_history\` shows what they did and why.
- \`graph_find_by_trigger\` with \`question\` or \`tension\` finds threads waiting for an answer or a resolution.
- Commit messages let you follow the reasoning trail across sessions.

For long-running handoff across sessions, use the solver tools: \`solver_spawn\`, \`solver_delegate\`, \`solver_claim_task\`, \`solver_complete_task\`, and \`solver_lock\` / \`solver_unlock\` for cooperative subtree-partition locks.

---

*This file was generated by \`npx understanding-graph init\`. Edit freely. For a walkthrough of one specific way the primitives were used to build a Bloom filter, see \`docs/coding-inside-the-graph.md\` in the understanding-graph repository. Your task will be different; use the primitives however fits your work.*
`;
}
