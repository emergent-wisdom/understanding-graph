# Understanding Graph: A Reasoning-Capture Architecture for AI Memory

**Persistent memory for AI agents. Shared cognition through stigmergy.**

[![Paper](https://img.shields.io/badge/Paper-PDF-red)](https://github.com/emergent-wisdom/understanding-graph/blob/main/paper/understanding_graph.pdf)
[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.19462908.svg)](https://doi.org/10.5281/zenodo.19462908)
[![npm version](https://img.shields.io/npm/v/understanding-graph.svg)](https://www.npmjs.com/package/understanding-graph)
[![MCP Registry](https://img.shields.io/badge/MCP_Registry-listed-blue)](https://registry.modelcontextprotocol.io/servers/io.github.emergent-wisdom/understanding-graph)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Understanding Graph is an MCP server that gives AI agents structured, persistent memory. Unlike knowledge bases that store facts, it stores externally useful *understanding updates* -- tensions, surprises, decisions, evidence, and how beliefs evolved over time. It does not require private chain-of-thought. Multiple agents can coordinate through the graph itself: each agent reads what others have written, builds on it, and leaves inspectable traces for the next -- stigmergy.

## Why Understanding Graph?

| Traditional Memory | Understanding Graph |
|-------------------|---------------------|
| Stores facts | Stores comprehension |
| "User prefers dark mode" | "User switched to dark mode after eye strain -- tension between aesthetics and comfort resolved toward comfort" |
| Flat retrieval | Reasoning trails |
| Forgets context | Preserves the *why* |
| Single agent | Multi-agent coordination through shared graph |

**Core insight:** AI agents don't just need to remember facts -- they need the usable before state, pivoting evidence, updated conclusion, and remaining uncertainty. That lets later work test or revise a conclusion without reconstructing hidden deliberation.

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

This gives you the MCP server **and** 9 skills:

| Skill | Invoke | What it teaches |
|-------|--------|-----------------|
| orient | `/understanding-graph:orient` | Read graph state at conversation start |
| quality-check | `/understanding-graph:quality-check` | Score, analyze, thermostat |
| reading-mode | `/understanding-graph:reading-mode` | Deep source reading with source_read |
| serendipity | `/understanding-graph:serendipity` | Inject novelty via grounded/pure serendipity |
| web-ui | `/understanding-graph:web-ui` | Launch 3D visualization at :3030 |
| graph-workflow | *(auto-loaded)* | Shared graph laws plus task-to-workflow routing |
| code-work | *(auto-loaded)* | Graph-native code nodes, generation, and executable evidence |
| collaborative-code | *(auto-loaded)* | Code-subtree ownership, handoffs, locks, and integration evidence |
| creative-work | *(auto-loaded)* | Books, prose, scripts, and editorial revision |

The MCP server works with any client. The skills are a Claude Code bonus — use whichever fits your setup.

### Claude Code project setup

Run the init flow inside a project directory to add the MCP server and workflow guidance. It supports focused reading, coding, writing, general analysis, and agent teams when parallel work is actually useful:

```bash
cd your-project
npx -y understanding-graph init
```

This creates:
- `.claude/settings.local.json` -- MCP server config (with agent teams enabled)
- `CLAUDE.md` -- Instructions that all agents and teammates follow automatically
- `projects/default/` -- Graph storage directory

Now open Claude Code. Every session—and any teammate you deliberately add—shares the same graph.

Per-client setup guides: [Claude Code](https://github.com/emergent-wisdom/understanding-graph/blob/main/integrations/claude-code.md) · [Claude Desktop](https://github.com/emergent-wisdom/understanding-graph/blob/main/integrations/claude-desktop.md) · [Cursor](https://github.com/emergent-wisdom/understanding-graph/blob/main/integrations/cursor.md) · [mcporter](https://github.com/emergent-wisdom/understanding-graph/blob/main/integrations/mcporter.md)

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

### Web UI / 3D visualization

The root npm package includes the built frontend and depends on the web server,
so the published package can launch the UI directly:

```bash
PROJECT_DIR=/path/to/your/projects npx -y understanding-graph start
# open http://localhost:3000
```

Run independent sidecars by giving each process its own port and project-store
root. The roots may be sibling directories on the same volume:

```bash
PORT=3101 PROJECT_DIR=/srv/undergraph/worker-1 npx -y understanding-graph start
PORT=3102 PROJECT_DIR=/srv/undergraph/worker-2 npx -y understanding-graph start
```

Use absolute paths in deployments. Sharing the installed package and its
read-only frontend is safe; do not point independent sidecars at the same
`PROJECT_DIR`.

The server binds to loopback by default. To run a worker on another host,
explicitly set `HOST` and a private worker token; non-loopback startup fails
closed without both:

```bash
HOST=0.0.0.0 PORT=3101 \
UG_WORKER_TOKEN=replace-with-a-long-random-secret \
PROJECT_DIR=/srv/undergraph/worker-1 \
npx -y understanding-graph start
```

The trusted caller must send `Authorization: Bearer <UG_WORKER_TOKEN>` on every
`/api` or `/admin` request. Put remote traffic behind TLS or a private
authenticated network.

To develop the UI from a checkout instead:

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

Without it, the rest of the graph works normally. `graph_understand` and
`graph_semantic_search` use deterministic lexical retrieval when embeddings are
unavailable; semantic-only analysis tools explain when the optional model is
needed.

---

## How It Works

Direct concept and edge mutations go through `graph_batch`. Relevant workflow
modes also expose document helpers at the top level; use a batch when related
document, concept, and edge changes must land together. Every batch requires a
`commit_message` and runs in a SQLite transaction: if any operation fails, the
entire batch rolls back as if it never ran. Workflow tools such as `source_read`
manage their own atomic updates. Nodes are never deleted, only superseded. The
commit stream becomes an inspectable update log—each node's commit message
becomes its *Origin Story*.

```
1. project_switch("my-project")        # Load (or create) a project
2. graph_skeleton()                     # Orient yourself (~150 tokens)
3. graph_history()                      # See what other agents did recently
4. graph_understand({ query, workflow: "coding" }) # Route the real workflow
5. graph_semantic_search({ query })     # Hybrid or lexical fallback
6. graph_batch({ commit_message, ... }) # Mutate with intent — atomic
```

### Atomic commits

`graph_batch` is the entry point for concept and edge mutations, and for atomic
multi-step document changes. Inside one batch you can chain
`graph_add_concept`, `graph_connect`, `graph_question`, `graph_supersede`,
`doc_create`, and others. The pre-validation check accepts both ID and *title*
references for `graph_connect`, and computes transitive reachability (so a chain
`A → B → existing` is valid even though A doesn't directly touch existing). On
any failure mid-batch, the entire transaction rolls back; no half-state.

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

Less common but available: `hypothesis`, `model`, `evaluation`, `analysis`, `experiment`, `serendipity`, `repetition`, `randomness`, `reference`, `library`. These ordinary cognitive nodes may preserve rich, provisional, unresolved testimony—not only settled conclusions—when it will help a future agent re-enter the work. The `thinking` trigger is different: it is reserved for the separate synthetic Reader/CMP synthesizer, which reconstructs chronological inner-voice training blocks from the underlying graph. Reserved blocks are hidden from and immutable to ordinary reading, writing, coding, and general workflows; only `TOOL_MODE=synthetic_reader` can access them. The full, deliberately chosen set of 18 trigger types is documented in the [understanding-graph paper](https://github.com/emergent-wisdom/understanding-graph/blob/main/paper/understanding_graph.pdf) (Section 3.1); it is an evolving design rather than a claimed formal minimum.

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

Structured prose, source material, and graph-native code. Code document roots
generate runnable files; a leaf can be split atomically into ordered children,
then units can be merged, moved, and reordered before regeneration.

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

### Concept & Node Management (batch operations unless listed by the selected mode)
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

### Connection Management (batch operations unless listed by the selected mode)
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
| `graph_understand` | Compose a workflow-specific re-entry packet with priors, resistance, evidence, and typed relations |
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
| `graph_serendipity` | Batch-only: record a synthesis with source edges |
| `graph_validate` | Batch-only: validate a proposed synthesis |
| `graph_chaos` | Inject controlled randomness |
| `graph_decide` | Batch-only: record a typed decision over options |
| `graph_evaluate_variations` | Compare alternative ideas |

### Document Operations (availability varies by workflow mode)
| Tool | Purpose |
|------|---------|
| `doc_create` | Create document with content |
| `doc_revise` | Modify document text |
| `doc_insert_thinking` | `synthetic_reader` only: insert a reconstructed Reader/CMP pretraining block |
| `doc_append_thinking` | `synthetic_reader` only: append a reconstructed Reader/CMP pretraining block |

### Source Reading
| Tool | Purpose |
|------|---------|
| `source_load` | Load text for staged reading |
| `source_read` | Read next portion, auto-create nodes |
| `source_position` | Get reading progress |
| `source_list` | List loaded sources |
| `source_export` | Reconstruct exact source text; `synthetic_reader` may additionally export its reserved Reader/CMP blocks |

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
  mcp-server/    # MCP server (70+ listed tools + batch-only operations)
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
| `HOST` | `127.0.0.1` | Web bind address; non-loopback requires `UG_WORKER_TOKEN` |
| `UG_WORKER_TOKEN` | -- | Bearer secret required for remote worker API/admin requests |
| `ANTHROPIC_API_KEY` | -- | For repository autonomous-worker scripts (optional) |
| `TOOL_MODE` | `full` | Enforced tool surface: `reading`, `research`, `coding`, `collaborative_coding`, `writing`, `full`, or the reserved `synthetic_reader` pretraining producer |
| `DEFAULT_PROJECT` | `default` | Project loaded on startup |

---

## The Five Laws

1. **Git for Cognition** — Nodes are never deleted, only superseded. The supersession edge preserves the *epistemic journey*: a future agent reading the chain learns not just the current belief but the path from the wrong belief to the right one. Every `graph_batch` requires a `commit_message` that becomes the node's *Origin Story*.
2. **PURE Standard** — After open exploration, use **P**arsimonious, **U**nique, **R**ealizable, **E**xpansive as non-compensatory gates when stabilizing a generalized analysis, model, or decision. Do not use PURE to suppress an early surprise, question, tension, or hypothesis.
3. **Graph-First Context** — Always check existing graph before creating new nodes. Duplicate detection is a forcing function, not a check: it pulls prior cognition into the current moment.
4. **Synthesize, Don't Transcribe** — Capture what an encounter did to attention and understanding, including unresolved implications and tensions—not a generic copy of the input.
5. **Coordinate Deliberately** — In collaborative workflows, make ownership, handoffs, and integration evidence explicit through the solver system. Focused work does not need a ceremonial team.

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

Full walkthrough: [using Understanding Graph with sema](https://github.com/emergent-wisdom/understanding-graph/blob/main/docs/using-with-sema.md)

### Coding inside the graph

Code lives in graph document roots and their ordered child nodes. Generate
runnable files with `doc_generate` or `doc_generate_all`, run the real build and
tests, then revise or rearrange the source nodes and regenerate—never patch the
generated projection directly.

See [coding-inside-the-graph](https://github.com/emergent-wisdom/understanding-graph/blob/main/docs/coding-inside-the-graph.md) for the basic
shape; the current dogfood suite extends this pattern to multi-file projects,
structural reordering, and debugging from executable evidence.

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

See [`CITATION.cff`](https://github.com/emergent-wisdom/understanding-graph/blob/main/CITATION.cff) for the machine-readable version (GitHub
renders a "Cite this repository" button from it).

## License

MIT -- [LICENSE](LICENSE)

**GitHub:** [emergent-wisdom/understanding-graph](https://github.com/emergent-wisdom/understanding-graph)
**npm:** [understanding-graph](https://www.npmjs.com/package/understanding-graph)
**MCP Protocol:** [modelcontextprotocol.io](https://modelcontextprotocol.io)
