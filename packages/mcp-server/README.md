# @understanding-graph/mcp-server

MCP server for building **Understanding Graphs** — persistent AI memory that captures comprehension, not just facts.

## What is this?

AI agents have no persistent memory. Each conversation starts fresh. This MCP server gives agents a way to build and maintain a **living map of understanding** that persists across sessions.

Unlike knowledge bases that store facts, an Understanding Graph stores:
- **Tensions** — Conflicts between ideas that need resolution
- **Synthesis** — How disparate concepts connect and what that means
- **Supersession** — How beliefs evolve over time (never deleted, only superseded)
- **Reasoning traces** — The cognitive journey, not just conclusions

## Quick Start

Add the server configuration to your MCP client settings:

### Configuration Example

```json
{
  "mcpServers": {
    "understanding-graph": {
      "command": "npx",
      "args": ["@understanding-graph/mcp-server"],
      "env": {
        "PROJECT_DIR": "/path/to/your/projects"
      }
    }
  }
}
```

### Usage

Once configured, your agent will have access to graph tools (`graph_add_concept`, `graph_connect`, etc.).

## Core Concepts

### Metabolic vs Crystalline

Standard databases are *crystalline* — they freeze information as static records. Your graph is *metabolic* — understanding grows, adapts, and heals. When you change your mind, you don't delete; you *supersede*.

### Entrainment, Not Retrieval

When reading the graph, you're not looking up data. You're **re-synchronizing with a rhythm** of thought — inhabiting the mind of your past self to continue the thinking process.

### The Five Laws

1. **Git for Cognition** — Nodes are never deleted, only superseded
2. **PURE Standard** — Quality gates for analysis/decision nodes
3. **Graph-First Context** — Check the graph before thinking
4. **Synthesize, Don't Transcribe** — Capture implications, not recordings
5. **Delegate by Default** — Break tasks into sub-tasks for parallel workers

## Key Tools

| Tool | Purpose |
|------|---------|
| `project_switch` | Load a project |
| `graph_skeleton` | Quick graph overview (~150 tokens) |
| `graph_semantic_search` | Find by meaning |
| `graph_batch` | All mutations (requires `commit_message`) |
| `graph_add_concept` | Add a node with trigger type |
| `graph_connect` | Create edge between nodes |
| `graph_score` | Measure graph quality |
| `source_load` | Load text for chronological reading |
| `solver_delegate` | Assign task to parallel worker |

## Commit Workflow

Every `graph_batch` requires a `commit_message` — your commit message explaining the intent.

```javascript
graph_batch({
  commit_message: "Added governance concepts, linked to fabric metaphor",
  agent_name: "Bob",  // Optional
  operations: [...]
})
```

```
1. project_list()                    # See available projects
2. project_switch("PROJECT")         # Load a project
3. graph_skeleton()                  # Orient yourself
4. graph_semantic_search({ query })  # Find relevant past thoughts
5. [do work with graph_batch]        # Include commit_message!
```

## Triggers (Node Types)

| Type | When to Use |
|------|-------------|
| `foundation` | Core concepts, axioms |
| `surprise` | Unexpected findings |
| `tension` | Conflicts, trade-offs |
| `consequence` | Implications |
| `question` | Open questions |
| `decision` | Choice points |
| `thinking` | AI reasoning trace |
| `prediction` | Forward-looking belief |

## Edge Types

| Type | Use |
|------|-----|
| `supersedes` | New understanding replaces old |
| `contradicts` | Opposing ideas (creates tension) |
| `refines` | Adds precision |
| `learned_from` | Cognitive lineage |
| `answers` / `questions` | Resolves or raises doubt |

## Quality Target

Run `graph_score()` periodically. **Target: 70+ with 0 orphan thinking nodes.**

Each thinking node should connect to 2-3 concepts minimum.

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PROJECT_DIR` | Where to store project databases | `./projects` |

## License

MIT

## Repository

https://github.com/emergent-wisdom/understanding-graph