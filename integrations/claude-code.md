# Understanding Graph + Claude Code

Give every Claude Code session and agent team persistent, shared reasoning
memory. One command to install, one command to bootstrap a project.

## Setup

### Fastest: zero-install via npx

```bash
claude mcp add ug -- npx -y understanding-graph mcp
```

`npx -y` downloads, caches, and runs `understanding-graph` on first
invocation. No global install, no clone, no build step. After this, every
Claude Code session in every directory can talk to the graph.

### One-command project bootstrap

If you want the graph to live inside your project — so agent teams share it
automatically — run the init flow inside the project directory:

```bash
cd your-project
npx -y understanding-graph init
```

This creates:

- `.claude/settings.local.json` — local MCP config (project-scoped)
- `CLAUDE.md` — instructions that every agent and teammate loads automatically
- `projects/default/` — the SQLite-backed graph storage directory
- Adds `projects/` to `.gitignore`

## Verify

Ask Claude Code:

> "Call graph_skeleton() and tell me what you see"

It should return the graph's structural overview (~150 tokens). If it says
the tool isn't registered, re-run `claude mcp list` to confirm `ug` is
listed.

## Using with agent teams

Understanding Graph is designed as the shared memory layer for Claude Code
Agent Teams. After `npx -y understanding-graph init`, every teammate shares
the same graph automatically — stigmergy out of the box.

```
You: "Create an agent team to research and implement auth for this app"

Claude (Team Lead):
  ├── Researcher teammate   ─── reads/writes shared graph ───┐
  ├── Backend teammate       ─── reads/writes shared graph ───┤  Same graph
  ├── Security teammate      ─── reads/writes shared graph ───┤  via MCP
  └── synthesizes findings from graph_history()               ┘
```

Commit messages are the coordination layer. When the Security teammate writes
*"Security Agent: found JWT stored in localStorage — tension between
convenience and XSS risk"*, the Backend teammate sees it via `graph_history()`
and acts on it. No direct messaging needed.

## Useful first calls

```
graph_skeleton()                     # orient yourself (~150 tokens)
graph_semantic_search({ query: "..." })  # find relevant past reasoning
graph_history()                      # see what other agents did recently
graph_find_by_trigger({ trigger: "question" })  # open questions to pick up
```

## Also works with

- **Claude Desktop** — see [claude-desktop.md](claude-desktop.md)
- **Cursor / Windsurf** — see [cursor.md](cursor.md)
- **OpenClaw via mcporter** — see [mcporter.md](mcporter.md)
- **Any MCP client** — Understanding Graph exposes a standard stdio server
  (`npx -y understanding-graph mcp`)
