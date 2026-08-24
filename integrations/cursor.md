# Understanding Graph + Cursor / Windsurf

Both Cursor and Windsurf support MCP servers via a JSON config file, with
the same shape as Claude Desktop.

## Cursor

Open Cursor settings → Features → Model Context Protocol → Edit config. Or
edit directly:

- **macOS / Linux:** `~/.cursor/mcp.json`
- **Windows:** `%USERPROFILE%\.cursor\mcp.json`

```json
{
  "mcpServers": {
    "understanding-graph": {
      "command": "npx",
      "args": ["-y", "understanding-graph@0.1.30", "mcp"],
      "env": {
        "PROJECT_DIR": "/path/to/your/projects"
      }
    }
  }
}
```

Reload the window after saving (Cmd/Ctrl+Shift+P → "Reload Window").

## Windsurf

Windsurf uses the same config shape. The file lives at:

- **macOS / Linux:** `~/.codeium/windsurf/mcp_config.json`
- **Windows:** `%USERPROFILE%\.codeium\windsurf\mcp_config.json`

Use the exact same JSON as above. Restart Windsurf after saving.

## Verify

Ask the assistant:

> "Call project_list and tell me whether Understanding Graph is connected. Do not create a project yet."

A fresh data directory should report an empty list. When real work begins, the
assistant should select or create a descriptive project with `project_switch`
before calling other graph tools.

## Tool modes

Set `TOOL_MODE` in the `env` block to control how many tools the server
exposes:

- `reading` — chronological source reading and interpretation
- `research` — reading/research plus solver coordination
- `coding` — graph-native code document nodes, structural editing, and generation
- `collaborative_coding` — coding plus subtree ownership, locks, and handoffs
- `writing` — graph-backed drafting and editorial revision
- `general` — safe cross-domain ordinary work (default)
- `full` — explicit broad ordinary access; reserved synthetic production stays isolated
- `synthetic_reader` — dedicated producer for reconstructed Reader/CMP pretraining blocks

```json
"env": {
  "PROJECT_DIR": "/path/to/projects",
  "TOOL_MODE": "reading"
}
```

Choose the mode that matches the work when an editor renders every tool in a
UI. The focused modes keep the list scannable and avoid teaching a coding agent
to advance a reading source, or a reader to treat source text like code.

## Also works with

- **Claude Code** — see [claude-code.md](claude-code.md)
- **Claude Desktop** — see [claude-desktop.md](claude-desktop.md)
- **OpenClaw via mcporter** — see [mcporter.md](mcporter.md)
