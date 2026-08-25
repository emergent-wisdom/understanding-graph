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
        "TOOL_MODE": "general"
      }
    }
  }
}
```

`PROJECT_DIR` contains one SQLite-backed graph per project. A fresh directory
stays empty until `project_switch` creates a deliberately named project. Set
`DEFAULT_PROJECT` only when the host explicitly wants to load or create that
named project at startup.

ANI (`graph_chaos` and the blind `graph_discover` path) reads a word list
installed on the host machine. The server autodetects conventional paths such
as `/usr/share/dict/words`; set `UG_ANI_DICTIONARY_PATH` to an absolute
newline-delimited word-list file on other machines. No dictionary corpus or
reduced fallback is bundled with the package.

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

## Understanding mode

The graph is the working medium, not a log. Preserve communicable, material
understanding that could matter to the work or a future inquiry: questions, interpretations,
alternatives, relations, evidence, reasons, uncertainty, decisions, revisions,
and artifact intent—not only conclusions. This is authored, user-visible
testimony, never hidden token-level chain-of-thought.

Models may work directly with `graph_understand`, `graph_batch`, and the other
tools, or optionally call
`graph_suggest_next({ task, workflow, focusNodeIds? })` when graph-specific
pointers could deepen or diversify understanding, recover neglected material,
test the current view, or expose a useful connection. The server computes state-
and workflow-dependent pressure, down-weights recently suggested action kinds,
samples a small set without replacement, and returns only those concrete routes
with weights and reasons. The model judges task fit and may choose, combine,
modify, reject, replace, or skip every route. Set `UG_GUIDANCE_MODE=direct` to
suppress automatic next-move prompts while keeping the endpoint callable.
Pass `creativity: false` to keep ordinary guidance while omitting bisociation,
grounded random comparison, ANI, disruption, and temporary forcing from that
particular roll. The creativity tools remain directly callable.

There is no required cognitive state machine. The model may read, search, make,
test, connect, disrupt, re-enter, revise, preserve, or pause in whatever order
the work warrants.

Local clients may call `project_list` and `project_switch` before orientation
when a different graph is needed. Hosted graph connections are already bound
to one authorized graph and do not expose project switching.

`graph_understand.workflow` supports `reading`, `research`, `coding`,
`collaborative_coding`, `writing`, and `general` (plus explicit `auto`
inference).

## Mutation contract

Direct concept and edge mutations are operations inside `graph_batch`; they are
not separate top-level MCP tools. Relevant workflow modes also expose document
helpers at the top level. Use `graph_batch` whenever related document, concept,
and edge changes must land together: every batch requires a `commit_message`
and the actual committing `agent_name`, and runs atomically.

```javascript
graph_batch({
  commit_message: "The failing boundary test changed the interval model",
  agent_name: "coding-agent",
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
| `general` | Safe cross-domain understanding, sources, and artifacts (default) |
| `reading` | Chronological sources and passage-grounded understanding |
| `research` | Reading plus solver coordination |
| `coding` | Graph-native code documents, generation, and tests |
| `collaborative_coding` | Coding plus ownership, locks, and handoffs |
| `writing` | Graph-backed manuscripts and editorial revision |
| `full` | Explicit broad access, including administrative tools |
| `synthetic_reader` | Reserved production/signing/translation of Reader/CMP `thinking` blocks |

Ordinary modes—including `full`—reject hidden or nested attempts to create a
reserved `thinking` block.

## Important tools

| Tool | Purpose |
|---|---|
| `graph_suggest_next` | Optional aid that samples state-dependent concrete provocations for the model to judge |
| `graph_understand` | Build a deterministic task-conditioned re-entry packet |
| `graph_batch` | Apply a committed, atomic set of graph mutations |
| `graph_skeleton` / `graph_context` | Inspect graph structure and local state |
| `graph_semantic_search` | Find relevant prior state; lexical fallback works without embeddings |
| `graph_bisociate` | Use spreading activation and information gain to surface candidate cross-context connections |
| `graph_discover_grounded` | Compare distant graph material; an honest no-connection result is valid |
| `graph_discover` / `graph_chaos` | Optional blind ANI using a machine-local dictionary |
| `graph_random` | Sample concrete provocations or run a temporary Physics What-If; preserve only what survives scrutiny |
| `graph_evaluate_variations` | Rank alternatives with the experimental Novelty Score |
| `graph_thermostat` | Advisory entropy-style pulse for choosing convergence, continuation, or divergence |
| `graph_history` | Inspect commits, agents, and mutation events |
| `source_load` / `source_read` | Encounter a source chronologically and persist exact passages |
| `doc_read` / `doc_get_tree` | Navigate graph-native artifacts |
| `doc_generate` / `doc_generate_all` | Project document nodes into executable or readable files |
| `graph_score` | Check structural integrity; not semantic correctness |

`source_load.filePath` is limited to `UG_SOURCE_ROOT`, which defaults to the
server working directory. Pass text as `content` or set that host-controlled
root explicitly when sources live elsewhere.

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
