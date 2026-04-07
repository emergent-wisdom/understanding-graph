# Understanding Graph: A Reasoning-Capture Architecture for AI Memory

**Persistent memory for AI agents. Shared cognition through stigmergy.**

[![Paper](https://img.shields.io/badge/Paper-PDF-red)](paper/understanding_graph.pdf)
[![npm version](https://badge.fury.io/js/understanding-graph.svg)](https://www.npmjs.com/package/understanding-graph)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Understanding Graph is an MCP server that gives AI agents structured, persistent memory. Unlike knowledge bases that store facts, it stores the *reasoning process* -- tensions, surprises, decisions, and how beliefs evolved over time. Multiple agents coordinate through the graph itself: each agent reads what others have written, builds on it, and leaves traces for the next -- stigmergy.

## Why Understanding Graph?

| Traditional Memory | Understanding Graph |
|-------------------|---------------------|
| Stores facts | Stores comprehension |
| "User prefers dark mode" | "User switched to dark mode after eye strain -- tension between aesthetics and comfort resolved toward comfort" |
| Flat retrieval | Reasoning trails |
| Forgets context | Preserves the *why* |
| Single agent | Multi-agent coordination through shared graph |

**Core insight:** AI agents don't just need to remember facts -- they need to remember *how they arrived at conclusions* so they can build on previous reasoning. When multiple agents share a graph, they coordinate without direct communication.

---

## Quick Start

### Claude Code (recommended)

One command sets up everything -- MCP server, CLAUDE.md with agent instructions, and project directory:

```bash
cd your-project
npx understanding-graph init
```

This creates:
- `.claude/settings.local.json` -- MCP server config (with agent teams enabled)
- `CLAUDE.md` -- Instructions that all agents and teammates follow automatically
- `projects/default/` -- Graph storage directory

Now open Claude Code. Every session (and every agent team teammate) shares the same graph.

### Claude Desktop

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

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

### Cursor / Windsurf

Add to your MCP config:

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

### Docker (with Web UI)

```bash
docker run -p 3000:3000 -v ~/understanding-data:/data ghcr.io/emergent-wisdom/understanding-graph
```

Open `http://localhost:3000` for the 3D visualization UI.

---

## How It Works

Every mutation goes through `graph_batch` with a required `commit_message` -- git for cognition. Nodes are never deleted, only superseded. The commit stream becomes a metacognitive log that other agents can read to understand what happened and why.

```
1. project_switch("my-project")        # Load a project
2. graph_skeleton()                     # Orient yourself (~150 tokens)
3. graph_semantic_search({ query })     # Find relevant past reasoning
4. graph_batch({ commit_message, ... }) # Mutate with intent
```

---

## Core Concepts

### Nodes (Understanding Units)

Each node captures a moment of comprehension with a **trigger** marking *why* it was created:

| Trigger | When to Use |
|---------|-------------|
| `foundation` | Core concepts, axioms, starting points |
| `surprise` | Unexpected findings, contradicts prior belief |
| `tension` | Conflict between ideas, unresolved |
| `consequence` | Downstream implication |
| `question` | Open question to explore |
| `decision` | Choice made between alternatives |
| `thinking` | Reasoning trace during reading |
| `prediction` | Forward-looking belief |

### Edges (Connections)

| Edge Type | Meaning |
|-----------|---------|
| `supersedes` | New understanding replaces old |
| `contradicts` | Ideas in conflict |
| `refines` | Adds precision to existing understanding |
| `learned_from` | Attribution of insight |
| `answers` / `questions` | Resolves or raises questions |
| `contains` | Parent-child hierarchy |
| `next` | Sequential ordering |

### Documents

Structured content (notes, papers, code) with thinking nodes interleaved -- capturing comprehension as it happens.

### Projects

Isolated graphs for different contexts. Each project has its own SQLite database.

---

## Tools Overview

<details>
<summary>80+ tools across 13 categories (click to expand)</summary>

### Batch Operations
| Tool | Purpose |
|------|---------|
| `graph_batch` | Execute multiple operations atomically with commit message |

### Concept & Node Management
| Tool | Purpose |
|------|---------|
| `graph_add_concept` | Add new concept with duplicate detection |
| `graph_question` | Create question node for exploration |
| `graph_revise` | Update concept understanding |
| `graph_supersede` | Replace outdated concept |
| `graph_add_reference` | Add external/cross-project references |
| `graph_rename` | Rename node (updates soft references) |
| `graph_archive` | Soft-delete preserving history |
| `node_set_metadata` | Set arbitrary metadata on nodes |
| `node_get_metadata` | Retrieve node metadata |
| `node_set_trigger` | Change node classification |
| `node_get_revisions` | Get understanding evolution history |

### Connection Management
| Tool | Purpose |
|------|---------|
| `graph_connect` | Create edges between concepts |
| `graph_answer` | Record answer to a question node |
| `graph_disconnect` | Remove/archive edges |
| `edge_update` | Update edge type or explanation |
| `edge_get_revisions` | Get relationship history |

### Reading & Analysis
| Tool | Purpose |
|------|---------|
| `graph_skeleton` | Structural overview (~150 tokens) |
| `graph_context` | Surrounding context for a concept |
| `graph_context_region` | Context for multiple related nodes |
| `graph_semantic_search` | Find nodes by meaning |
| `graph_similar` | Find conceptually similar nodes |
| `graph_find_by_trigger` | Find nodes by type |
| `graph_analyze` | Concept and pattern frequencies |
| `graph_semantic_gaps` | Find disconnected concepts |
| `graph_score` | Graph health metrics |
| `graph_path` | Reasoning path between concepts |
| `graph_centrality` | Most influential concepts |
| `graph_thermostat` | Regulate graph density |
| `graph_history` | Commit history and changes |

### Synthesis & Exploration
| Tool | Purpose |
|------|---------|
| `graph_discover` | Serendipity pipeline with chaos injection |
| `graph_random` | Random insights from graph |
| `graph_serendipity` | Record synthesized connection |
| `graph_validate` | Validate proposed connections |
| `graph_chaos` | Inject controlled randomness |
| `graph_decide` | Evaluate competing concepts |
| `graph_evaluate_variations` | Compare alternative ideas |

### Document Operations
| Tool | Purpose |
|------|---------|
| `doc_create` | Create document with content |
| `doc_revise` | Modify document text |
| `doc_insert_thinking` | Insert thinking node in document |
| `doc_append_thinking` | Append thinking at end |

### Source Reading
| Tool | Purpose |
|------|---------|
| `source_load` | Load text for staged reading |
| `source_read` | Read next portion, auto-create nodes |
| `source_position` | Get reading progress |
| `source_list` | List loaded sources |
| `source_export` | Export with thinking interleaved |
| `source_commit` | Record thinking during reading |

### Project Management
| Tool | Purpose |
|------|---------|
| `project_switch` | Switch active project |
| `project_list` | List available projects |

### Cross-Project
| Tool | Purpose |
|------|---------|
| `graph_lookup_external` | Look up node in another project |
| `graph_list_external` | List accessible external projects |
| `graph_find_by_reference` | Find nodes referencing a concept |
| `graph_resolve_references` | Verify cross-project references |
| `graph_global_lookup` | Search across all projects |

### Thematic System
| Tool | Purpose |
|------|---------|
| `theme_create` | Define theme with activation zones |
| `theme_activate` | Enter activation zone |
| `theme_landing` | Mark pause point |
| `theme_get_active` | Get active themes |
| `theme_check_alignment` | Validate prose alignment |
| `theme_deactivate` | Leave activation zone |

### Multi-Agent Coordination (Solver)
| Tool | Purpose |
|------|---------|
| `solver_spawn` | Register specialized solver agent |
| `solver_delegate` | Post task to solver queue |
| `solver_claim_task` | Claim pending task (worker mode) |
| `solver_complete_task` | Submit task results |
| `solver_list` | List registered solvers |
| `solver_queue_status` | Task queue statistics |

</details>

---

## Multi-Agent with Claude Code Agent Teams

Understanding Graph is designed as the shared memory layer for [Claude Code Agent Teams](https://code.claude.com/docs/en/agent-teams). After running `npx understanding-graph init`, every teammate in an agent team automatically shares the same graph -- stigmergy out of the box.

### How it works

```
You: "Create an agent team to research and implement auth for this app"

Claude (Team Lead):
  ├── Researcher teammate   ─── reads/writes shared graph ───┐
  ├── Backend teammate       ─── reads/writes shared graph ───┤  Same Understanding Graph
  ├── Security teammate      ─── reads/writes shared graph ───┤  (via MCP)
  └── synthesizes findings from graph_history()               ┘
```

1. **`init` creates the CLAUDE.md** -- Every teammate loads it automatically, so all agents know to use `graph_skeleton()` to orient, `graph_batch` for mutations, and `graph_history()` to read the metacognitive trail.
2. **Commit messages are the coordination layer** -- Each `graph_batch` requires a `commit_message`. When the Security teammate writes "Security Agent: found JWT stored in localStorage -- tension between convenience and XSS risk", the Backend teammate sees it via `graph_history()` and acts on it.
3. **Triggers classify contributions** -- Teammates tag their nodes (`tension`, `question`, `decision`, `surprise`), making it easy to find what matters: "show me all unresolved tensions" or "what questions are still open?"
4. **No direct messaging needed** -- Teammates coordinate through the graph itself. The researcher leaves `question` nodes; the backend agent finds them via `graph_find_by_trigger` and creates `answers` edges.

### Getting started with a swarm

```bash
cd your-project
npx understanding-graph init     # one-time setup
```

Then in Claude Code:
```
Create an agent team with 3 teammates to [your task].
Each teammate should read graph_skeleton() first to orient,
then use graph_batch with descriptive commit messages so
the team can coordinate through the shared understanding graph.
```

### Long-running coordination (solver system)

For tasks that span multiple sessions or need async handoff beyond a single team:

| Tool | Purpose |
|------|---------|
| `solver_spawn` | Register a specialist (e.g., "SecurityReviewer", "ArchiveKeep") |
| `solver_delegate` | Post a task to the queue |
| `solver_claim_task` | Pick up pending work (worker mode) |
| `solver_complete_task` | Submit results |
| `solver_lock` / `solver_unlock` | Prevent conflicts on shared nodes |

The solver system persists in the SQLite database, so tasks survive across sessions. One team can delegate work that a future team picks up.

---

## Architecture

```
packages/
  core/          # Graph logic, SQLite storage, embeddings
  mcp-server/    # MCP server (80+ tools)
  web-server/    # REST API + serves frontend
  frontend/      # 3D visualization (React + Three.js)
```

**Stack:**
- **SQLite** + **better-sqlite3** -- Persistent storage
- **Graphology** -- In-memory graph operations
- **MCP Protocol** -- Agent integration
- **Transformers.js** -- Local embeddings for semantic search

---

## Development

```bash
git clone https://github.com/emergent-wisdom/understanding-graph.git
cd understanding-graph
npm install
npm run build
npm run start:web    # Web UI at http://localhost:3000
```

### Dev mode

```bash
# Terminal 1: Web server with hot reload
npm run dev:web

# Terminal 2: Frontend dev server
cd packages/frontend && npm run dev
```

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PROJECT_DIR` | `./projects` | Where to store project data |
| `PORT` | `3000` | Web server port |
| `ANTHROPIC_API_KEY` | -- | For autonomous workers (optional) |
| `TOOL_MODE` | `full` | Tool exposure: `reading`, `research`, or `full` |
| `DEFAULT_PROJECT` | `default` | Project loaded on startup |

---

## The Five Laws

1. **Git for Cognition** -- Nodes are never deleted, only superseded. Every `graph_batch` requires a `commit_message`.
2. **PURE Standard** -- Quality gates: **P**arsimonious, **U**nique, **R**ealizable, **E**xpansive.
3. **Graph-First Context** -- Always check existing graph before creating new nodes.
4. **Synthesize, Don't Transcribe** -- Capture implications, not just facts.
5. **Delegate by Default** -- Break complex tasks into sub-tasks.

---

## License

MIT -- [LICENSE](LICENSE)

**GitHub:** [emergent-wisdom/understanding-graph](https://github.com/emergent-wisdom/understanding-graph)
**npm:** [understanding-graph](https://www.npmjs.com/package/understanding-graph)
**MCP Protocol:** [modelcontextprotocol.io](https://modelcontextprotocol.io)
