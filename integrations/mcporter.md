# Understanding Graph + OpenClaw (via mcporter)

[mcporter](https://www.npmjs.com/package/mcporter) is a generic MCP client
used by OpenClaw and other agent frameworks to wrap MCP servers as callable
tools.

## Setup

```bash
npm install -g mcporter
mcporter config add ug \
  --command npx \
  --arg -y --arg understanding-graph@0.1.31 --arg mcp \
  --scope home \
  --description "Understanding Graph: a persistent medium for agent understanding"
```

`--scope home` stores the config in your home directory so it's shared
across workspaces. Use `--scope local` to scope it to the current directory.

## Set the project directory

Most agents want a persistent project dir outside the cwd. Pass it via
`--env`:

```bash
mcporter config add ug \
  --command npx \
  --arg -y --arg understanding-graph@0.1.31 --arg mcp \
  --env PROJECT_DIR=/Users/you/.ug/projects \
  --scope home
```

## Verify

```bash
mcporter list ug --schema     # inspect the current safe general catalog
mcporter call ug.project_list # verify the connection without creating data
```

On a fresh data directory, the second call should return an empty project list.

## Using from an OpenClaw agent

Any OpenClaw agent with the `mcporter` skill can now call any understanding
graph tool:

```
mcporter call ug.project_list
mcporter call ug.project_switch project=auth-review goal="Review the auth flow"
mcporter call ug.graph_skeleton
mcporter call ug.graph_semantic_search query="auth flow"
mcporter call ug.graph_batch operations='[...]' commit_message="Agent: ..."
```

## Agent configuration

Add a section to your agent's `AGENTS.md` or `SOUL.md`:

```markdown
## Persistent Memory Protocol

This agent uses Understanding Graph (via mcporter `ug`) as the canonical
medium for persistent, shared understanding and substantive artifact work.

Before the first graph operation, call `mcporter call ug.project_list`. If no
project is active, select an exact existing match or create a descriptive,
task-scoped project with `mcporter call ug.project_switch project=<name>`.

When graph-specific navigation would help at a real choice point, you may call:

`mcporter call ug.graph_suggest_next task="<user task>" workflow="<reading|research|coding|collaborative_coding|writing|general>"`

Judge the returned weighted, concrete routes against the user task. Choose,
combine, modify, reject, or replace them. Use `graph_understand` with the
selected route's explicit stance when prior state may change the next move;
there is no mandatory call sequence. If the aid is disabled or unnecessary,
use the graph tools directly and choose for yourself when to deepen, diversify,
connect, test, revisit, disrupt, or pause.

For direct concept and document-tree mutation, use `graph_batch` with a
descriptive `commit_message` that names the agent and explains intent. Preserve
communicable, material understanding as it emerges rather than reconstructing it at
the end. Other agents can use `graph_history` or `graph_updates` to coordinate.
```

## Also works with

- **Claude Code** — see [claude-code.md](claude-code.md)
- **Claude Desktop** — see [claude-desktop.md](claude-desktop.md)
- **Cursor / Windsurf** — see [cursor.md](cursor.md)
