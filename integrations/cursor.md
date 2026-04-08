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
      "args": ["-y", "understanding-graph", "mcp"],
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

> "Use graph_skeleton to orient yourself, then tell me what's in the graph"

It should call the tool and return the orientation summary.

## Tool modes

Set `TOOL_MODE` in the `env` block to control how many tools the server
exposes:

- `reading` — ~25 tools, focused on reading and exploration
- `research` — ~32 tools, adds solver coordination
- `full` — all ~51 tools (default)

```json
"env": {
  "PROJECT_DIR": "/path/to/projects",
  "TOOL_MODE": "reading"
}
```

`reading` mode is recommended for editors that render every tool in a UI —
keeps the tool list scannable.

## Also works with

- **Claude Code** — see [claude-code.md](claude-code.md)
- **Claude Desktop** — see [claude-desktop.md](claude-desktop.md)
- **OpenClaw via mcporter** — see [mcporter.md](mcporter.md)
