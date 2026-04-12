---
name: web-ui
description: |
  Launch the 3D graph visualization at localhost:3030.
  Use when the user wants to see the graph visually.
user-invocable: true
allowed-tools: |
  Bash(lsof -ti:3030 *)
  Bash(kill *)
  Bash(PROJECT_DIR=* npx -y understanding-graph* start *)
  Bash(mkdir -p *)
---

# Web UI — 3D Graph Visualization

Launch the understanding graph's 3D force-directed visualization.

## CRITICAL: Run from the user's working directory

The web server MUST read the same database as the MCP server. The MCP server resolves `PROJECT_DIR=./projects` relative to the user's cwd. So you MUST launch the web UI from the user's cwd too — **never** from the plugin cache directory or any other directory.

## Launch

Run this exactly from the user's current working directory:

```bash
mkdir -p projects/default
lsof -ti:3030 | xargs kill 2>/dev/null
PROJECT_DIR="$(pwd)/projects" PORT=3030 npx -y understanding-graph start &
```

Then tell the user: **Open http://localhost:3030**

Do NOT `cd` to the plugin cache or any other directory before running this. The `$(pwd)` must resolve to the user's working directory so the web UI reads the same `projects/` folder as the MCP server.

The UI updates live as you commit to the graph — the user can watch the graph grow while you work.
