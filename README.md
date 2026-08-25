# Understanding Graph: A Persistent Medium for Recursive Understanding

**A persistent medium for recursive, inspectable understanding.**

[![Paper](https://img.shields.io/badge/Paper-PDF-red)](https://github.com/emergent-wisdom/understanding-graph/blob/main/paper/understanding_graph.pdf)
[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.19462658.svg)](https://doi.org/10.5281/zenodo.19462658)
[![npm version](https://img.shields.io/npm/v/understanding-graph.svg)](https://www.npmjs.com/package/understanding-graph)
[![MCP Registry](https://img.shields.io/badge/MCP_Registry-listed-blue)](https://registry.modelcontextprotocol.io/?q=io.github.emergent-wisdom%2Funderstanding-graph)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Understanding Graph is an MCP server that gives AI agents structured, persistent memory. Unlike knowledge bases that store facts, it stores externally useful *understanding updates* -- tensions, surprises, decisions, evidence, and how beliefs evolved over time. It does not require private chain-of-thought. Multiple agents can coordinate through the graph itself: each agent reads what others have written, builds on it, and leaves inspectable traces for the next -- stigmergy.

## Why Understanding Graph?

| Traditional Memory | Understanding Graph |
|-------------------|---------------------|
| Stores facts | Stores authored understanding updates |
| "User prefers dark mode" | "User switched to dark mode after eye strain -- tension between aesthetics and comfort resolved toward comfort" |
| Flat retrieval | Typed, revisable interpretation |
| Loses the interpretive middle | Preserves recorded rationale and revision |
| Single agent | Multi-agent coordination through shared graph |

**Core insight:** AI agents don't just need to remember facts -- they need the usable before state, pivoting evidence, updated conclusion, and remaining uncertainty. That lets later work test or revise a conclusion without reconstructing hidden deliberation.

---

## Quick Start

Requires [Node.js](https://nodejs.org/) 22 or newer.

### Recommended: use your Codex or Claude subscription

Run the initializer in the directory where you want the graph-backed work to
live:

```bash
cd your-project
npx -y understanding-graph@0.1.31 init
```

It creates project-scoped MCP configuration for both Codex and Claude Code,
installs the same fluid-understanding contract in `AGENTS.md` and
`CLAUDE.md`, installs a project-scoped `reading-mode` skill for both clients,
and adds the local `projects/` path to ignore rules without installing any
starter graph. Open either client, sign in with your normal ChatGPT or Claude
subscription, and ask for the actual research, writing, coding, or decision
task. The agent creates a descriptively named graph when real work begins. You
do not need to say “use the graph.” The model runs in the subscription client;
Understanding Graph itself makes no model API calls.

For a fresh chronological reading, give the agent a file path and ask it to
turn on reader mode. It stages the source without returning or sampling its
body, then encounters only the next ordered passage through `source_read` and
may attach ordinary, passage-grounded understanding before continuing. Codex
also exposes `$reading-mode`; Claude Code exposes `/reading-mode`. Text pasted
directly into chat has already been encountered, so use a file path when a
genuinely fresh reading matters.

[Codex is available through eligible ChatGPT plans](https://learn.chatgpt.com/docs/pricing), and [Claude Code can use Claude Pro or Max](https://support.claude.com/en/articles/11145838-use-claude-code-with-your-pro-or-max-plan). Their normal plan limits still apply.

### Installable plugin (workflow skill + MCP server)

The package ships both `.codex-plugin` and `.claude-plugin` manifests. The
plugin combines the MCP capabilities with an `understanding-work` skill. While
the mode is active, material, communicable understanding that could matter to
the work or a future inquiry develops in the graph.
The graph rolls a small state-dependent set of concrete next moves; the model
judges their weights against the user task and freely chooses, combines, changes,
or rejects them. The initializer above provides the same contract without
waiting for a plugin-directory listing.

For Claude Code, the existing marketplace flow is:

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

This gives you the MCP server and these skills:

| Skill | Invoke | What it teaches |
|-------|--------|-----------------|
| understanding-work | *(auto-loaded)* | Fluid graph-mediated understanding with weighted, model-chosen provocations |
| orient | `/understanding-graph:orient` | Read graph state at conversation start |
| quality-check | `/understanding-graph:quality-check` | Score, analyze, thermostat |
| reading-mode | `/understanding-graph:reading-mode` | Deep source reading with source_read |
| serendipity | `/understanding-graph:serendipity` | Inject novelty via grounded/pure serendipity |
| web-ui | `/understanding-graph:web-ui` | Launch 3D visualization at :3030 |
| graph-workflow | *(auto-loaded)* | Shared graph laws plus task-to-workflow routing |
| code-work | *(auto-loaded)* | Graph-native code nodes, generation, and executable evidence |
| collaborative-code | *(auto-loaded)* | Code-subtree ownership, handoffs, locks, and integration evidence |
| creative-work | *(auto-loaded)* | Books, prose, scripts, and editorial revision |

The raw MCP server works with any compatible client, but the bundled skill or
generated project instructions are the recommended experience. Tool schemas
alone do not reliably activate a multi-step understanding workflow.

### What the initializer creates

This creates:
- `.codex/config.toml` -- Codex MCP configuration
- `.mcp.json` -- Claude Code project MCP configuration
- `AGENTS.md` and `CLAUDE.md` -- the same canonical understanding workflow
- `.agents/skills/reading-mode/SKILL.md` -- explicit Codex reader workflow
- `.claude/skills/reading-mode/SKILL.md` -- explicit Claude Code reader workflow
- `.gitignore` entry for `projects/` -- keeps graph data local; no starter
  project is created

Every session opened in the directory shares the same project root. Once a
named graph is selected, agents working there share it. Use additional agents
only when the work has real independent seams.

### Raw MCP configuration (advanced)

If a client cannot install plugins or run the initializer, connect the MCP
server directly:

```bash
claude mcp add ug -- npx -y understanding-graph@0.1.31 mcp
```

MCP initialization still supplies a concise graph-use contract, but client
support for server instructions varies. For consistent behavior, also provide
the bundled `understanding-work` skill or its generated project instructions.

Per-client setup guides: [Claude Code](https://github.com/emergent-wisdom/understanding-graph/blob/main/integrations/claude-code.md) · [Claude Desktop](https://github.com/emergent-wisdom/understanding-graph/blob/main/integrations/claude-desktop.md) · [Cursor](https://github.com/emergent-wisdom/understanding-graph/blob/main/integrations/cursor.md) · [mcporter](https://github.com/emergent-wisdom/understanding-graph/blob/main/integrations/mcporter.md)

### Claude Desktop

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "understanding-graph": {
      "command": "npx",
      "args": ["-y", "understanding-graph@0.1.31", "mcp"],
      "env": {
        "PROJECT_DIR": "/path/to/your/projects",
        "UG_SOURCE_ROOT": "/path/to/your/source-project"
      }
    }
  }
}
```

`UG_SOURCE_ROOT` limits file-based source loading to that directory. The
project initializer sets it to the project root automatically.

### Cursor / Windsurf

Add to your MCP config:

```json
{
  "mcpServers": {
    "understanding-graph": {
      "command": "npx",
      "args": ["-y", "understanding-graph@0.1.31", "mcp"],
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
PROJECT_DIR=/path/to/your/projects npx -y understanding-graph@0.1.31 start
# open http://localhost:3000
```

Run independent sidecars by giving each process its own port and project-store
root. The roots may be sibling directories on the same volume:

```bash
PORT=3101 PROJECT_DIR=/srv/undergraph/worker-1 npx -y understanding-graph@0.1.31 start
PORT=3102 PROJECT_DIR=/srv/undergraph/worker-2 npx -y understanding-graph@0.1.31 start
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
npx -y understanding-graph@0.1.31 start
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

`graph_semantic_search`, `graph_similar`, `graph_semantic_gaps`, and `graph_backfill_embeddings` can use `@huggingface/transformers` (a local embedding model, roughly 160 MB once compiled). It is an *optional peer dependency* so the default install stays small. For an npx-based project, install both packages locally so Node can resolve the peer from the same dependency tree:

```bash
npm install --save-dev understanding-graph@0.1.31 @huggingface/transformers@4.2.0
npx understanding-graph@0.1.31 init
```

A separate global `@huggingface/transformers` install does not reliably satisfy an
isolated npx cache install.

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
manage their own atomic updates. Ordinary work revises, archives, or supersedes
nodes while preserving their history; irreversible purge is a separate,
explicitly selected administrative action. The commit stream becomes an
inspectable update log—each node's commit message becomes its *Origin Story*.

```
1. project_switch({ project: "my-project" })
2a. DIRECT: use graph_understand, graph_batch, or another graph tool immediately
2b. GUIDED: graph_suggest_next({ task, workflow: "coding" })
3. [if guided, judge, modify, reject, skip, or choose a sampled route]
4. graph_batch({ commit_message, agent_name, ... }) # preserve artifact + understanding
```

The optional chooser is an aid for surfacing graph-specific pointers that may
deepen or diversify understanding, recover neglected material, test the current
view, or expose a useful connection. Suggestions are sampled server-side from
graph- and workflow-weighted pressures, include concrete nodes or regions when
possible, and temporarily down-weight recently suggested action kinds. The
model remains responsible for task fit and may always work directly, do
something else, or stop rather than manufacture work. Set `UG_GUIDANCE_MODE` to
`direct` to remove ambient suggestion prompts; `graph_suggest_next` remains
available on demand.
Pass `creativity: false` to an individual roll when ordinary guidance is useful
but grounded random comparison, bisociation, ANI, disruption, and temporary
forcing are not. This changes the roll only; the optional creativity tools
remain available for direct use.

Retrieval has two orthogonal axes: `workflow` identifies the domain and its
native evidence, while `stance` weights the epistemic pressure—such as
deepening, resistance, connection, disruption, revisiting, or testing. Neither
axis limits what the model may do.

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

Each cognitive node captures an authored understanding update with a **trigger** marking *why* it was created:

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

Less common but available: `hypothesis`, `model`, `evaluation`, `analysis`, `experiment`, `serendipity`, `repetition`, `randomness`, `reference`, `library`. These ordinary cognitive nodes may preserve rich, provisional, unresolved testimony—not only settled conclusions—when it will help a future agent re-enter the work. The `thinking` trigger is different: it is reserved for the separate synthetic Reader/CMP synthesizer, which reconstructs chronological training blocks from the underlying graph. Reserved blocks are hidden from and immutable to ordinary reading, writing, coding, and general workflows; only `TOOL_MODE=synthetic_reader` can access them. The full, deliberately chosen set of 18 trigger types is documented in the [understanding-graph paper](https://github.com/emergent-wisdom/understanding-graph/blob/main/paper/understanding_graph.pdf) (Section 3.1); it is an evolving design rather than a claimed formal minimum.

### Edges (Connections)

| Edge Type | Meaning |
|-----------|---------|
| `supersedes` | New understanding replaces old; created through the dedicated `graph_supersede` lifecycle operation |
| `contradicts` | Ideas in conflict |
| `refines` | Adds precision to existing understanding |
| `learned_from` | Attribution of insight |
| `answers` / `questions` | Resolves or raises questions |
| `contains` | Parent-child hierarchy |
| `next` | Sequential ordering |

### Documents

Structured prose, source material, and graph-native code share the same
addressable document tree. A leaf can be a passage, function, class, type, or
test with its own recorded purpose, origin commit, revisions, and typed links to
the questions, decisions, evidence, or tensions that shaped it. This allows a
later Reader to ask why one exact unit exists—not merely why the file exists—by
calling `doc_read({ nodeId, showProvenance: true, showRevisions: true })`.

`implements` points from an abstract commitment to its concrete unit;
`expresses` and `inspired_by` point from an artifact unit to what it renders or
what its author reports as influential; `learned_from` points from a cognitive
update to the source or artifact encounter that occasioned it. These are
inspectable authored claims, not verified causes. Code roots generate runnable
files; units can be split, merged, moved, and reordered before regeneration.

### Projects

Isolated graphs for different contexts. Each project has its own SQLite database.

---

## Tools Overview

<details>
<summary>Selected tools from the 46-tool default <code>general</code> surface and 70-tool explicit <code>full</code> mode, plus batch-only operations callable through <code>graph_batch</code> (click to expand)</summary>

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
| `graph_context` | Full graph XML, optionally focused on one node; auto-compacts above 50 nodes |
| `graph_context_region` | Full details for one numbered region returned by context, skeleton, or search |
| `graph_semantic_search` | Find nodes by meaning |
| `graph_similar` | Find conceptually similar nodes |
| `graph_find_by_trigger` | Find nodes by type |
| `graph_analyze` | Find structural gaps, cycles, bridges, open questions, and serendipity nodes |
| `graph_semantic_gaps` | Find disconnected concepts |
| `graph_score` | Structural proxy for chronology, revision, resolution, edge specificity, and connectivity—not semantic quality |
| `graph_path` | Reasoning path between concepts |
| `graph_centrality` | Most influential concepts |
| `graph_thermostat` | Advisory entropy-style pulse for convergence, continuation, or divergence |
| `graph_history` | Commit history and changes |

### Synthesis & Exploration

The toolkit's median-escape branch---particularly ANI and Axiomatic Forcing---was inspired by [*The Ontology of the Alien*](https://doi.org/10.5281/zenodo.18912179). Its random cues, temporary axioms, and alternative-physics provocations are adapted here as optional agent-facing tools whose outputs remain speculative until scrutinized.

| Tool | Purpose |
|------|---------|
| `graph_bisociate` | Surface candidate cross-context pairs with spreading activation and information gain |
| `graph_discover_grounded` | Default bounded comparison of distant graph material; no connection is valid |
| `graph_discover_grounded_chaos` | Optional dictionary perturbation after a genuine grounded bridge; requires a host-installed word list |
| `graph_discover` | Explicitly speculative blind ANI over graph material |
| `graph_random` | Concrete random provocations, including optional scrutinized Physics What-If forcing |
| `graph_serendipity` | Batch-only: record a synthesis with source edges |
| `graph_validate` | Batch-only: record an authored validation judgment for a scrutinized serendipity |
| `graph_chaos` | Inject words from a machine-local dictionary or graph nodes into text |
| `graph_decide` | Batch-only: record a typed decision over options |
| `graph_evaluate_variations` | Rank alternatives with the experimental Novelty Score |

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

### Cross-Project (`TOOL_MODE=full`)

| Tool | Purpose |
|------|---------|
| `graph_lookup_external` | Look up node in another project |
| `graph_list_external` | List accessible external projects |
| `graph_find_by_reference` | Find nodes referencing a concept |
| `graph_resolve_references` | Verify cross-project references |
| `graph_global_lookup` | Search across all projects |

### Multi-Agent Coordination (Solver)

Solver tools are available in `research`, `collaborative_coding`, and `full`
tool modes.

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

Understanding Graph is designed as a shared persistent medium for [Claude Code Agent Teams](https://code.claude.com/docs/en/agent-teams). After running `npx -y understanding-graph@0.1.31 init`, the lead creates or selects a named graph; every teammate working in that project root can then share it -- stigmergy without bundled data.

### How it works

```
You: "Create an agent team to research and implement auth for this app"

Claude (Team Lead):
  ├── Researcher teammate   ─── reads/writes shared graph ───┐
  ├── Backend teammate       ─── reads/writes shared graph ───┤  Same Understanding Graph
  ├── Security teammate      ─── reads/writes shared graph ───┤  (via MCP)
  └── synthesizes findings from graph_history()               ┘
```

1. **`init` installs the same fluid protocol for every teammate** -- Each agent treats the graph as the canonical medium and may work directly or ask `graph_suggest_next` for concrete possibilities at natural choice points.
2. **Commit messages are the coordination layer** -- Each `graph_batch` requires a `commit_message`. When the Security teammate writes "Security Agent: found JWT stored in localStorage -- tension between convenience and XSS risk", the Backend teammate sees it via `graph_history()` and acts on it.
3. **Triggers classify contributions** -- Teammates tag their nodes (`tension`, `question`, `decision`, `surprise`), making it easy to find what matters: "show me all unresolved tensions" or "what questions are still open?"
4. **Persistent handoffs without mandatory direct messaging** -- Teammates can coordinate through the graph itself. The researcher leaves `question` nodes; the backend agent finds them via `graph_find_by_trigger` and creates `answers` edges.

### Getting started with a swarm

```bash
cd your-project
npx -y understanding-graph@0.1.31 init     # one-time setup
```

Then in Claude Code:
```
Create an agent team with 3 teammates to [your task].
Each teammate should work through the shared Understanding Graph,
preserve material understanding as it emerges, and use graph_batch
with descriptive commit messages so the team can coordinate.
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
  mcp-server/    # MCP server (46 default / 70 full tools + batch operations)
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
| `UG_SOURCE_ROOT` | current working directory | Directory that `source_load.filePath` may read from; provide `content` directly for files outside it |
| `PORT` | `3000` | Web server port |
| `HOST` | `127.0.0.1` | Web bind address; non-loopback requires `UG_WORKER_TOKEN` |
| `UG_WORKER_TOKEN` | -- | Bearer secret required for remote worker API/admin requests |
| `ANTHROPIC_API_KEY` | -- | For repository autonomous-worker scripts (optional) |
| `ANTHROPIC_MODEL` | -- | Explicit model ID for the optional Anthropic autonomous worker |
| `TOOL_MODE` | `general` | Enforced tool surface: safe cross-domain `general`; focused `reading`, `research`, `coding`, `collaborative_coding`, or `writing`; explicit broad `full`; or the reserved `synthetic_reader` pretraining producer |
| `UG_GUIDANCE_MODE` | `guided` | Suggestion aid: `guided` adds optional next-move prompts; `direct` suppresses ambient prompts while keeping `graph_suggest_next` callable on demand |
| `UG_ANI_DICTIONARY_PATH` | system word list | Absolute path to a host-installed newline-delimited word list when `/usr/share/dict/words` or another standard path is unavailable; no dictionary or reduced fallback is bundled |
| `DEFAULT_PROJECT` | unset | Optional project to load or explicitly create on startup |

---

## Working principles

1. **Use the graph as the medium** — While Understanding mode is active,
   preserve the communicable understanding and addressable artifact units that
   matter to the work, not merely its final answer.
2. **Keep agency with the model** — `graph_suggest_next` offers weighted,
   concrete provocations when the optional aid is useful. The model may work
   directly or choose, combine, modify, reject, replace, or skip them according
   to the user's task.
3. **Re-enter when it can change the work** — Revisit the accumulated graph at
   genuine choice points, surprises, resistance, or uncertainty—not on a fixed
   timer and not as ceremony.
4. **Synthesize rather than transcribe** — Preserve what an encounter changed,
   including unresolved implications and tensions, rather than copying the
   input. PURE is available as an optional stabilization check after open
   exploration; it is not a quota or a gate on emergence.
5. **Preserve provenance** — Use descriptive commits, dedicated revision and
   supersession operations, evidence from the real artifact, and explicit
   ownership or handoffs when collaboration actually requires them.

---

## Using with sema

Understanding Graph gives your agents shared *episodic* memory — the recorded interpretive trail behind a decision. [Sema](https://github.com/emergent-wisdom/sema) gives them shared *semantic* memory — a content-addressed vocabulary of cognitive patterns. They compose:

```bash
# Add both to Claude Code
claude mcp add ug   -- npx -y understanding-graph@0.1.31 mcp
claude mcp add sema -- uvx --from semahash sema mcp
```

With both installed, an agent can:

1. Reference a sema pattern URI (for example, `sema://StateLock#7859`) inside a node's `understanding` or `why` text to pin the meaning of a coordination primitive.
2. Use `graph_semantic_search` to find nodes that reference a pattern in the current project. Switch projects explicitly, or use cross-project reference tools, when the search spans graphs.
3. Call `sema_handshake` to verify that two agents share the *same* definition of a pattern *before* building on each other's thinking in the graph — the fail-closed handshake prevents silent semantic drift.

Full walkthrough: [using Understanding Graph with sema](https://github.com/emergent-wisdom/understanding-graph/blob/main/docs/using-with-sema.md)

### Coding inside the graph

Code lives in graph document roots and their ordered child nodes. Generate
runnable files with `doc_generate` or `doc_generate_all`, run the real build and
tests, then revise or rearrange the source nodes and regenerate—never patch the
generated projection directly.

See [coding-inside-the-graph](https://github.com/emergent-wisdom/understanding-graph/blob/main/docs/coding-inside-the-graph.md) for the full workflow.

---

## Citing

```bibtex
@misc{westerberg2026understanding,
  title        = {Understanding Graph: A Persistent Medium for Recursive Understanding},
  author       = {Westerberg, Henrik},
  year         = {2026},
  month        = aug,
  publisher    = {Zenodo},
  doi          = {10.5281/zenodo.19462658},
  url          = {https://doi.org/10.5281/zenodo.19462658}
}
```

See [`CITATION.cff`](https://github.com/emergent-wisdom/understanding-graph/blob/main/CITATION.cff) for the machine-readable version (GitHub
renders a "Cite this repository" button from it).

## License

MIT -- [LICENSE](LICENSE)

**GitHub:** [emergent-wisdom/understanding-graph](https://github.com/emergent-wisdom/understanding-graph)
**npm:** [understanding-graph](https://www.npmjs.com/package/understanding-graph)
**MCP Protocol:** [modelcontextprotocol.io](https://modelcontextprotocol.io)
