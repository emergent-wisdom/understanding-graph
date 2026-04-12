# Understanding Graph: A Reasoning-Capture Architecture for AI Memory

**Persistent memory for AI agents. Shared cognition through stigmergy.**

[![Paper](https://img.shields.io/badge/Paper-PDF-red)](paper/understanding_graph.pdf)
[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.19462908.svg)](https://doi.org/10.5281/zenodo.19462908)
[![npm version](https://img.shields.io/npm/v/understanding-graph.svg)](https://www.npmjs.com/package/understanding-graph)
[![MCP Registry](https://img.shields.io/badge/MCP_Registry-listed-blue)](https://registry.modelcontextprotocol.io/servers/io.github.emergent-wisdom/understanding-graph)
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

### Claude Code (zero-install)

Add understanding-graph to Claude Code with one command -- no global install, nothing to clone:

```bash
claude mcp add ug -- npx -y understanding-graph mcp
```

`npx -y` downloads, caches, and runs the package on first invocation. After this, `ug` is available as an MCP server in every Claude Code session.

### Claude Code plugin (MCP server + skills)

The npm package also ships as a Claude Code plugin — the MCP server plus skills that teach the agent how to use the graph effectively:

```bash
# One-time: add the Emergent Wisdom marketplace
claude plugin marketplace add emergent-wisdom/marketplace

# Install the plugin
claude plugin install understanding-graph
```

For local development:

```bash
claude --plugin-dir /path/to/understanding-graph
```

This gives you the MCP server **and** 7 skills:

| Skill | Invoke | What it teaches |
|-------|--------|-----------------|
| orient | `/understanding-graph:orient` | Read graph state at conversation start |
| quality-check | `/understanding-graph:quality-check` | Score, analyze, thermostat |
| reading-mode | `/understanding-graph:reading-mode` | Deep source reading with source_read |
| serendipity | `/understanding-graph:serendipity` | Inject novelty via grounded/pure serendipity |
| web-ui | `/understanding-graph:web-ui` | Launch 3D visualization at :3030 |
| graph-workflow | *(auto-loaded)* | Five laws, batches, edges, triggers, API reference |
| creative-work | *(auto-loaded)* | Two surfaces: concepts + doc trees |

The MCP server works with any client. The skills are a Claude Code bonus — use whichever fits your setup.

### Claude Code with agent teams (one-command project setup)

For projects where you want agent teams to share the graph automatically, run the init flow inside the project directory:

```bash
cd your-project
npx -y understanding-graph init
```

This creates:
- `.claude/settings.local.json` -- MCP server config (with agent teams enabled)
- `CLAUDE.md` -- Instructions that all agents and teammates follow automatically
- `projects/default/` -- Graph storage directory

Now open Claude Code. Every session (and every agent team teammate) shares the same graph.

Per-client setup guides: [integrations/claude-code.md](integrations/claude-code.md) · [integrations/claude-desktop.md](integrations/claude-desktop.md) · [integrations/cursor.md](integrations/cursor.md) · [integrations/mcporter.md](integrations/mcporter.md)

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

### Web UI / 3D visualization (build from source)

The npm package ships only what the MCP server needs (~1.5 MB) so `npx -y understanding-graph mcp` stays fast. The web UI and 3D visualization require the frontend bundle (~160 MB of three.js + react + onnxruntime), which is not in the published tarball for v0.1.0. To run the UI, clone the repo:

```bash
git clone https://github.com/emergent-wisdom/understanding-graph.git
cd understanding-graph
npm install
npm run build
npm run start:web
# open http://localhost:3000
```

### Optional: enable embedding-based search

`graph_semantic_search`, `graph_similar`, `graph_semantic_gaps`, and `graph_backfill_embeddings` all rely on `@xenova/transformers` (a local embedding model, ~160 MB once compiled). It is declared as an *optional peer dependency* so the default install stays small. If you need those tools:

```bash
npm install -g @xenova/transformers
```

Without it, the rest of the graph (skeleton, history, batch, supersede, semantic_search via metadata, find_by_trigger, etc.) works fine — the embedding tools will return a clear error if you call them without installing the peer.

---

## How It Works

Every mutation goes through `graph_batch` with a required `commit_message` — git for cognition. The batch is wrapped in a SQLite transaction: if any operation fails, the entire batch rolls back as if it never ran. Nodes are never deleted, only superseded. The commit stream becomes a metacognitive log that other agents can read to understand what happened and why — each node's commit message becomes its *Origin Story*, the agent's inner monologue at the moment of creation.

```
1. project_switch("my-project")        # Load (or create) a project
2. graph_skeleton()                     # Orient yourself (~150 tokens)
3. graph_history()                      # See what other agents did recently
4. graph_semantic_search({ query })     # Find relevant past reasoning (optional embeddings)
5. graph_batch({ commit_message, ... }) # Mutate with intent — atomic
```

### Atomic commits

`graph_batch` is the only mutation entry point. Inside one batch you can chain `graph_add_concept`, `graph_connect`, `graph_question`, `graph_supersede`, `doc_create`, and others. The pre-validation check accepts both ID and *title* references for `graph_connect`, and computes transitive reachability (so a chain `A → B → existing` is valid even though A doesn't directly touch existing). On any failure mid-batch, the entire transaction rolls back; no half-state.

### Cross-project references

A graph node in one project can reference a node in another project via `graph_add_reference({ refProject, refNodeId })`. Other projects can then read it without switching via `graph_lookup_external` or find it by ID alone via `graph_global_lookup`. This is the substrate for the *Hierarchical Understanding Graph* used by the [entangled-alignment](https://github.com/emergent-wisdom/entangled-alignment) chronological annotation pipeline, where eras and documents draw cross-references.

---

## Core Concepts

### Nodes (Understanding Units)

Each node captures a moment of comprehension with a **trigger** marking *why* it was created:

Triggers are *cognitive acts*, not categories — they capture *why* the agent created the node at this exact moment, not what kind of thing it is. The seven you'll use most often:

| Trigger | When to Use |
|---------|-------------|
| `foundation` | Core concepts, axioms, starting points |
| `surprise` | Unexpected findings, contradicts prior belief |
| `tension` | Conflict between ideas, unresolved |
| `consequence` | Downstream implication |
| `question` | Open question to explore |
| `decision` | Choice made between alternatives, with rationale |
| `prediction` | Forward-looking belief that can be validated later |

Less common but available: `hypothesis`, `model`, `evaluation`, `analysis`, `experiment`, `serendipity`, `repetition`, `randomness`, `reference`, `library`. The `thinking` trigger is reserved for the synthesizer agent and rejected for normal use. The full set of 18 trigger types is documented in the [understanding-graph paper](paper/understanding_graph.pdf) (Section 3.1) and described as the *minimum* count for cognitive distinguishability — collapsing them would dissolve the Cognitive Guardrail.

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
<summary>50+ top-level tools listed via <code>tools/list</code>, plus additional batch-only operations callable through <code>graph_batch</code> (click to expand)</summary>

### Batch Operations
| Tool | Purpose |
|------|---------|
| `graph_batch` | Execute multiple operations as an **atomic commit** with a required `commit_message`. Wrapped in a SQLite transaction: if any operation fails, the entire batch is rolled back. The `commit_message` is preserved as the node's *Origin Story* — future agents reading those nodes see not just the content but the intent that created it. |

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
  mcp-server/    # MCP server (~50 listed tools + batch-only operations)
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

1. **Git for Cognition** — Nodes are never deleted, only superseded. The supersession edge preserves the *epistemic journey*: a future agent reading the chain learns not just the current belief but the path from the wrong belief to the right one. Every `graph_batch` requires a `commit_message` that becomes the node's *Origin Story*.
2. **PURE Standard** — Quality gates: **P**arsimonious, **U**nique, **R**ealizable, **E**xpansive. Non-compensatory: any RED gate halts.
3. **Graph-First Context** — Always check existing graph before creating new nodes. Duplicate detection is a forcing function, not a check: it pulls prior cognition into the current moment.
4. **Synthesize, Don't Transcribe** — Capture *implications* and *tensions*, not raw facts. The graph is for your understanding, not your input.
5. **Delegate by Default** — Break complex tasks into sub-tasks via the solver system; let specialized agents (Skeptic, Connector, Synthesizer) coordinate stigmergically through the graph.

---

## Using with sema

Understanding Graph gives your agents shared *episodic* memory — the reasoning trail behind a decision. [Sema](https://github.com/emergent-wisdom/sema) gives them shared *semantic* memory — a content-addressed vocabulary of cognitive patterns. They compose:

```bash
# Add both to Claude Code
claude mcp add ug   -- npx -y understanding-graph mcp
claude mcp add sema -- uvx --from semahash sema mcp
```

With both installed, an agent can:

1. Reference a sema pattern hash (e.g. `StateLock#7859`) inside an understanding-graph node's `mechanism` field to pin the meaning of a coordination primitive.
2. Use `graph_semantic_search` to find all graph nodes that reference a given sema pattern, across projects and agent teams.
3. Call `sema_handshake` to verify that two agents share the *same* definition of a pattern *before* building on each other's thinking in the graph — the fail-closed handshake prevents silent semantic drift.

Full walkthrough: [docs/using-with-sema.md](docs/using-with-sema.md)

### Coding inside the graph

A concrete end-to-end example: build a Bloom filter entirely as graph
nodes — design as `foundation` + `decision` concepts grounded in sema
`Check#1544`, implementation as a `.py` doc tree, empirical verification
as an `evaluation` node — then `doc_generate` it to a runnable file
whose self-test prints `AcceptSpec#70dd: PASS`.

See [docs/coding-inside-the-graph.md](docs/coding-inside-the-graph.md).

---

## Citing

```bibtex
@misc{westerberg2026understanding,
  title        = {Understanding Graph: Persisting the Invisible Thinking},
  author       = {Westerberg, Henrik},
  year         = {2026},
  month        = apr,
  publisher    = {Zenodo},
  doi          = {10.5281/zenodo.19462908},
  url          = {https://doi.org/10.5281/zenodo.19462908}
}
```

See [`CITATION.cff`](CITATION.cff) for the machine-readable version (GitHub
renders a "Cite this repository" button from it).

## License

MIT -- [LICENSE](LICENSE)

**GitHub:** [emergent-wisdom/understanding-graph](https://github.com/emergent-wisdom/understanding-graph)
**npm:** [understanding-graph](https://www.npmjs.com/package/understanding-graph)
**MCP Protocol:** [modelcontextprotocol.io](https://modelcontextprotocol.io)
