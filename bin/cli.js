#!/usr/bin/env node
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const command = process.argv[2];
const args = process.argv.slice(3);

// Paths to our built servers
const webServer = path.join(__dirname, '../packages/web-server/dist/index.js');
const mcpServer = path.join(__dirname, '../packages/mcp-server/dist/index.js');

if (command === 'start') {
  console.log('Starting Understanding Graph (Web + Frontend)...');
  console.log('Open http://localhost:' + (process.env.PORT || 3000));

  // Pass through environment variables like PORT and PROJECT_DIR
  spawn('node', [webServer], { stdio: 'inherit' });

} else if (command === 'mcp') {
  // Silent mode for MCP (stdio is used for JSON-RPC)
  spawn('node', [mcpServer], { stdio: 'inherit' });

} else if (command === 'init') {
  init();

} else {
  console.log(`
Usage:
  npx understanding-graph init    # Set up MCP + CLAUDE.md for agent teams
  npx understanding-graph start   # Run the UI and API
  npx understanding-graph mcp     # Run the MCP server (for Claude)

Environment variables:
  PORT          - Server port (default: 3000)
  PROJECT_DIR   - Directory for project data (default: ./projects)
  `);
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
    settings.mcpServers['understanding-graph'] = {
      command: 'npx',
      args: ['-y', 'understanding-graph', 'mcp'],
      env: {
        PROJECT_DIR: './projects'
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
    2. Ask Claude to create an agent team for your task
    3. All teammates share the understanding graph automatically

  Or use directly:
    claude "Read graph_skeleton() and orient yourself"
`);
}

function getClaudeMdSection() {
  return `# Understanding Graph

This project uses an Understanding Graph for persistent memory and multi-agent coordination.
All agents (including agent team teammates) share the same graph automatically via MCP.

## Every Session

1. \`graph_skeleton()\` — orient yourself (~150 tokens)
2. \`graph_semantic_search({ query: "..." })\` — find relevant past reasoning
3. \`graph_history()\` — see what other agents did recently

## Rules

- **All mutations go through \`graph_batch\`** with a \`commit_message\` explaining intent
- **Include your name** in commit messages (e.g., "Backend Agent: mapped auth flow")
- **Check before creating** — \`graph_semantic_search\` to avoid duplicates
- **Never delete, only supersede** — understanding evolves, it doesn't get erased
- **Synthesize, don't transcribe** — capture implications, not just facts

## Agent Team Coordination

When working as part of an agent team:
- Read \`graph_history()\` to see what teammates have done and why
- Use descriptive commit messages so teammates can follow your reasoning trail
- Use \`graph_question\` to flag open questions for other teammates to pick up
- Use \`graph_connect\` to link your work to existing concepts
- Triggers classify contributions: \`foundation\`, \`surprise\`, \`tension\`, \`consequence\`, \`question\`, \`decision\`, \`thinking\`

## Long-Running Coordination

For tasks that span multiple sessions or need async handoff:
- \`solver_spawn\` — register a specialist agent (e.g., "SecurityReviewer")
- \`solver_delegate\` — post a task to the queue
- \`solver_claim_task\` — pick up pending work
- \`solver_complete_task\` — submit results
- \`solver_lock\` / \`solver_unlock\` — prevent conflicts on shared nodes
`;
}
