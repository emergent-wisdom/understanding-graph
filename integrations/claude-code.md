# Understanding Graph + Claude Code

Give every Claude Code session and agent team persistent, shared understanding.
One command to connect, one command to install the local graph workflow.

## Setup

### Fastest: zero-install via npx

```bash
claude mcp add ug -- npx -y understanding-graph@0.1.31 mcp
```

`npx -y` downloads, caches, and runs `understanding-graph` on first
invocation. No global install, no clone, no build step. Claude's default MCP
scope is local to the current project. Use `--scope user` only if you
deliberately want the server available from every directory; project setup
below is recommended because it also installs the understanding protocol.

### One-command project setup

If you want the graph to live inside your project — so agent teams share it
automatically — run the init flow inside the project directory:

```bash
cd your-project
npx -y understanding-graph@0.1.31 init
```

This creates:

- `.mcp.json` — Claude Code project MCP config (mergeable and shareable)
- `CLAUDE.md` — instructions that every agent and teammate loads automatically
- Adds `projects/` to `.gitignore`; no starter graph is installed

When substantive work begins, the agent creates a descriptively named project
through `project_switch`. Until then the project list is genuinely empty.

The generated MCP config also limits `source_load.filePath` to this project
root. Pass external text as `content`, or deliberately change
`UG_SOURCE_ROOT` when broader file access is intended.

## Verify

Ask Claude Code:

> "Call graph_skeleton() and tell me what you see"

It should return the graph's structural overview (~150 tokens). If it says
the tool isn't registered, re-run `claude mcp list` to confirm `ug` is
listed.

## Using with agent teams

Understanding Graph is designed as a shared medium for Claude Code Agent Teams.
After `npx -y understanding-graph@0.1.31 init`, the lead creates or selects a
named graph. Every teammate working in that project root can then share it.

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
graph_suggest_next({ task: "...", workflow: "coding" }) # weighted concrete possibilities; choose or reject
graph_understand({ query: "...", workflow: "coding", stance: "resist" }) # route-selected re-entry
graph_history()                      # inspect attributed recent work
graph_skeleton()                     # compact connectivity/orientation check
```

There is no mandatory sequence. Keep substantive artifact state and
communicable, material understanding graph-canonical, and use the suggestions when
they may help rather than turning them into ceremony.

For coding, source lives in ordered document nodes. Generate runnable files for
builds and tests, then revise or rearrange the nodes and regenerate; do not edit
the generated projection directly.

## Also works with

- **Claude Desktop** — see [claude-desktop.md](claude-desktop.md)
- **Cursor / Windsurf** — see [cursor.md](cursor.md)
- **OpenClaw via mcporter** — see [mcporter.md](mcporter.md)
- **Any MCP client** — Understanding Graph exposes a standard stdio server
  (`npx -y understanding-graph@0.1.31 mcp`)
