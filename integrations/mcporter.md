# Understanding Graph + OpenClaw (via mcporter)

[mcporter](https://www.npmjs.com/package/mcporter) is a generic MCP client
used by OpenClaw and other agent frameworks to wrap MCP servers as callable
tools.

## Setup

```bash
npm install -g mcporter
mcporter config add ug \
  --command npx \
  --arg -y --arg understanding-graph --arg mcp \
  --scope home \
  --description "Understanding Graph: persistent reasoning memory for agents"
```

`--scope home` stores the config in your home directory so it's shared
across workspaces. Use `--scope local` to scope it to the current directory.

## Set the project directory

Most agents want a persistent project dir outside the cwd. Pass it via
`--env`:

```bash
mcporter config add ug \
  --command npx \
  --arg -y --arg understanding-graph --arg mcp \
  --env PROJECT_DIR=/Users/you/.ug/projects \
  --scope home
```

## Verify

```bash
mcporter list ug --schema     # should show ~51 tools
mcporter call ug.graph_skeleton
```

The second call should return a JSON blob with the graph's structural
summary.

## Using from an OpenClaw agent

Any OpenClaw agent with the `mcporter` skill can now call any understanding
graph tool:

```
mcporter call ug.graph_skeleton
mcporter call ug.graph_semantic_search query="auth flow"
mcporter call ug.graph_batch operations='[...]' commit_message="Agent: ..."
```

## Agent configuration

Add a section to your agent's `AGENTS.md` or `SOUL.md`:

```markdown
## Persistent Memory Protocol

This agent uses Understanding Graph (via mcporter `ug`) for persistent,
shared reasoning memory.

Before starting any non-trivial task:

1. `mcporter call ug.graph_skeleton` — orient yourself in the graph
2. `mcporter call ug.graph_semantic_search query="<task keywords>"` — find
   relevant past reasoning
3. `mcporter call ug.graph_history` — see what other agents did recently

For every mutation, use `graph_batch` with a descriptive `commit_message`
that names the agent and explains intent. Other agents read the commit
stream to coordinate.
```

## Also works with

- **Claude Code** — see [claude-code.md](claude-code.md)
- **Claude Desktop** — see [claude-desktop.md](claude-desktop.md)
- **Cursor / Windsurf** — see [cursor.md](cursor.md)
