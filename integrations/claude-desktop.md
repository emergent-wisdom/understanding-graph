# Understanding Graph + Claude Desktop

Claude Desktop reads MCP server configuration from a JSON file. Add an
`understanding-graph` entry and restart the app.

## Config file location

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux:** `~/.config/Claude/claude_desktop_config.json`

## Config

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

`PROJECT_DIR` is where the graph SQLite databases live. Each subdirectory
becomes a separate project. If you omit it, the server uses `./projects`
relative to its working directory (which Claude Desktop sets to the user's
home directory), which is usually not what you want — set it explicitly.

## Verify

1. Restart Claude Desktop.
2. Open a new conversation.
3. Type: *"Call graph_skeleton() and summarize what you see"*.

If the tool isn't available, check the log file:

- **macOS:** `~/Library/Logs/Claude/mcp-server-understanding-graph.log`
- **Windows:** `%APPDATA%\Claude\logs\mcp-server-understanding-graph.log`

The log will show startup errors (missing project dir, bad permissions, etc).

## Multiple projects

To work in multiple isolated graphs, run `project_switch` from the chat:

```
project_switch({ projectId: "my-other-project" })
```

Or set `DEFAULT_PROJECT` in the `env` block to load a specific project at
startup.

## Also works with

- **Claude Code** — see [claude-code.md](claude-code.md)
- **Cursor / Windsurf** — see [cursor.md](cursor.md)
- **OpenClaw via mcporter** — see [mcporter.md](mcporter.md)
