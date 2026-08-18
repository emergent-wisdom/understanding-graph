# @emergent-wisdom/understanding-graph-mcp-server

MCP server for Understanding Graphs: persistent, typed state that preserves
how an agent's attention, questions, hypotheses, decisions, and models evolve—not
only the facts it encountered.

## Quick start

Add the server to an MCP client:

```json
{
  "mcpServers": {
    "understanding-graph": {
      "command": "npx",
      "args": ["-y", "@emergent-wisdom/understanding-graph-mcp-server"],
      "env": {
        "PROJECT_DIR": "/absolute/path/to/projects",
        "TOOL_MODE": "full"
      }
    }
  }
}
```

`PROJECT_DIR` contains one SQLite-backed graph per project. The server creates
and activates `DEFAULT_PROJECT` (`default` unless configured) when necessary.

## Understanding, not transcription

The graph is a cognitive autobiography composed for future continuation. At
self-selected Thought Moments, an agent may preserve a rich, user-visible
account of what became salient: surprise, hesitation, association, ethical or
emotional weight, alternatives, predictions, experiments, unresolved
questions, and later revisions. It should not create notes by quota or pretend
that every encounter caused a neat belief shift.

This testimony is not represented as access to hidden model computation. Its
value is behavioral: a later model can re-enter it, test it against new
evidence, and make different work because of it.

The `thinking` trigger has a narrower meaning. It is reserved for reconstructed
synthetic Reader/CMP pretraining blocks and is available only in
`TOOL_MODE=synthetic_reader`. Those blocks and their incident relations are
hidden from and immutable to ordinary modes; ordinary reading, writing, and
coding use the other typed cognitive nodes.

## Working loop

1. Call `project_list`, then `project_switch` when a different graph is needed.
2. Call `graph_understand({ query, workflow })` to retrieve relevant priors,
   resistance, evidence, and exact typed relations. Treat the returned prompt
   as provisional orientation, never authority.
3. Work in the workflow's native evidence surface: chronological source
   passages for reading; graph document nodes plus generated tests for code;
   the actual manuscript and rereading for writing.
4. When something genuinely becomes worth carrying forward, commit the
   cognitive state and its evidence through one atomic `graph_batch`.
5. Use `graph_revise` or `graph_supersede` inside later batches when the state
   changes. Preserve the path rather than silently overwriting it.

`graph_understand.workflow` supports `reading`, `coding`,
`collaborative_coding`, `writing`, and `general` (plus explicit `auto`
inference).

## Mutation contract

Direct concept and edge mutations are operations inside `graph_batch`; they are
not separate top-level MCP tools. Relevant workflow modes also expose document
helpers at the top level. Use `graph_batch` whenever related document, concept,
and edge changes must land together: every batch requires a `commit_message`
and runs atomically.

```javascript
graph_batch({
  commit_message: "The failing boundary test changed the interval model",
  operations: [
    {
      tool: "graph_add_concept",
      params: {
        title: "Adjacent windows need half-open intervals",
        trigger: "decision",
        understanding:
          "Use start <= event < end so an event belongs to one window.",
        why: "The generated test double-counted a boundary event"
      }
    },
    {
      tool: "graph_connect",
      params: {
        from: "$0.id",
        to: "n_test_evidence",
        type: "learned_from",
        why: "This exact failing test caused the revision"
      }
    }
  ]
})
```

Use exact parameter names: `title`, `trigger`, `understanding`, `why` for a
concept; `from`, `to`, `type`, `why` for an edge. New concepts must be connected
to the graph. Workflow tools such as `source_read` manage their own atomic
updates.

## Tool modes

`TOOL_MODE` is an enforced allow-list, not merely a display filter:

| Mode | Intended work |
|---|---|
| `reading` | Chronological sources and passage-grounded understanding |
| `research` | Reading plus solver coordination |
| `coding` | Graph-native code documents, generation, and tests |
| `collaborative_coding` | Coding plus ownership, locks, and handoffs |
| `writing` | Graph-backed manuscripts and editorial revision |
| `full` | All ordinary workflow tools (default) |
| `synthetic_reader` | Reserved production/signing/translation of Reader/CMP `thinking` blocks |

Ordinary modes—including `full`—reject hidden or nested attempts to create a
reserved `thinking` block.

## Important tools

| Tool | Purpose |
|---|---|
| `graph_understand` | Build a deterministic task-conditioned re-entry packet |
| `graph_batch` | Apply a committed, atomic set of graph mutations |
| `graph_skeleton` / `graph_context` | Inspect graph structure and local state |
| `graph_semantic_search` | Find relevant prior state; lexical fallback works without embeddings |
| `graph_history` | Inspect commits, agents, and mutation events |
| `source_load` / `source_read` | Encounter a source chronologically and persist exact passages |
| `doc_read` / `doc_get_tree` | Navigate graph-native artifacts |
| `doc_generate` / `doc_generate_all` | Project document nodes into executable or readable files |
| `graph_score` | Check structural integrity; not semantic correctness |

Synthesis is normally an operation, not a catch-all node type. Store its result
as what it became: `analysis` for a stabilized integration, `model` for a
general mechanism, `hypothesis` for a provisional unification, `decision` for
a choice, `evaluation` for a judgment, or leave the tension/question open.
The mutating synthesis helpers `graph_serendipity`, `graph_validate`, and
`graph_decide` are nested `graph_batch` operations, never top-level calls; the
outer batch owns their transaction and commit.

## License and repository

MIT — see [LICENSE](LICENSE). Repository:
<https://github.com/emergent-wisdom/understanding-graph>
