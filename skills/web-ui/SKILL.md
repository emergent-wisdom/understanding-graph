---
name: web-ui
description: |
  Launch the 3D graph visualization at localhost:3030.
  Use when the user wants to see the graph visually.
user-invocable: true
allowed-tools: |
  Bash(lsof -ti:3030 *)
  Bash(kill *)
  Bash(npx -y understanding-graph start *)
  Bash(mkdir -p *)
---

# Web UI — 3D Graph Visualization

Launch the understanding graph's 3D force-directed visualization.

## Launch

```bash
# Ensure project directory exists
mkdir -p projects/default

# Kill any existing instance
lsof -ti:3030 | xargs kill 2>/dev/null

# Launch the web UI (runs in background, reads same DB as MCP server)
PROJECT_DIR="$(pwd)/projects" PORT=3030 npx -y understanding-graph start &
```

Then tell the user: **Open http://localhost:3030**

## Troubleshooting

If the UI shows an empty graph: the web server and MCP server are reading different databases. Make sure `PROJECT_DIR` in the launch command matches the `PROJECT_DIR` in your MCP server config.

The UI updates live as you commit to the graph — the user can watch the graph grow while you work.
