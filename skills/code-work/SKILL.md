---
name: code-work
description: |
  Build, debug, refactor, and test software whose canonical source lives in
  understanding-graph document nodes. Use for coding projects, algorithms,
  modules, configuration, tests, and structural code rearrangement. Generated
  files are executable projections and must never be edited directly.
user-invocable: false
allowed-tools: |
  mcp__ug__graph_understand
  mcp__ug__graph_batch
  mcp__ug__graph_skeleton
  mcp__ug__graph_semantic_search
  mcp__ug__graph_history
  mcp__ug__doc_list_roots
  mcp__ug__doc_get_tree
  mcp__ug__doc_get_children
  mcp__ug__doc_flatten
  mcp__ug__doc_read
  mcp__ug__doc_generate
  mcp__ug__doc_generate_all
  Read
  Bash
---

# Graph-Native Code

Treat the graph as the source tree. A generated `.py`, `.ts`, `.json`, or test
file is a disposable projection used for execution; never patch it directly.

## Represent the project

- Use one document root per generated file. Give it the intended filename and
  `fileType`.
- Use ordered child nodes for meaningful code units: imports, types, functions,
  classes, helpers, implementation blocks, exports, fixtures, and tests.
- A leaf should have one coherent responsibility and reason to change. Make it
  addressable when you may need to understand, test, revise, move, reuse, or
  remove it independently. Do not create a node for every line.
- When behavior is duplicated, put the shared function/class in the appropriate
  module node, update callers/imports, and remove the copies. The graph does not
  replace ordinary modular design; it makes that design movable and inspectable.
- Represent configuration, package manifests, and tests as document roots too.
- Connect durable design concepts to the concrete nodes they `implement`.

For code file types, generation concatenates root content and descendants as
raw code in document order. Node titles are graph metadata, not emitted code.

## Start

1. Orient with `graph_skeleton` and `graph_history`.
2. Inspect existing roots with `doc_list_roots`; use `doc_get_tree` before
   changing an established file.
3. Condition the task explicitly:

```javascript
graph_understand({
  query: "Build or change this graph-native software project and verify it",
  workflow: "coding"
})
```

4. Search before adding a cognitive node. Reuse or revise an existing thread
   when it is genuinely the same; do not compress a distinct live alternative
   merely because it shares vocabulary.

## Code with open attention

The graph is not a change log attached after implementation. Let it carry the
human-scale movement of building: what seems elegant or brittle, the shape you
expected, what a library or test makes newly visible, competing designs still
alive, a naming discomfort that may signal a bad boundary, a hypothesis about a
failure, the next observation that could distinguish alternatives, and the
moment the problem itself changes.

Pause at moments you choose because something actually becomes salient, not at
fixed intervals or to satisfy a trigger quota. Use the honest non-`thinking`
type—often `surprise`, `tension`, `question`, `hypothesis`,
`prediction`, `consequence`, `evaluation`, `decision`, `analysis`,
`experiment`, or `serendipity`. Write enough intentional, user-visible
testimony that a future programmer can re-enter the state, including unresolved
alternatives and uncertainty. Link it to the exact code node, test, runtime
observation, or earlier cognitive node that gave it weight.

The `thinking` trigger is reserved for the separate synthetic Reader/CMP
synthesis mode. Its blocks and incident relations are inaccessible in coding;
coding agents never create or imitate them. These authored cognitive nodes also
do not claim access to hidden model computation.

When an understanding eventually stabilizes, distill its before, pivot, after,
evidence, and remaining uncertainty without erasing the richer path. A test
that confirms the expected behavior may honestly produce no new node.

## Build

Begin with the smallest useful executable scaffold and one coherent unit rather
than composing a complete file off-graph. Let each later unit encounter the
structure and open attention already present. The first child needs only
`parentId`; each later sibling uses `afterId` so generated order is explicit.

When an actual uncertainty appears, `graph_note` is the low-friction path. It
is optional, batch-only, and automatically attaches ordinary typed testimony to
the exact artifact with `learned_from`; omit `trigger` if classification would
prematurely close the question. A subsequent read or generation resurfaces the
open thread so it can affect the next implementation or test.

```javascript
graph_batch({
  commit_message: "Started parser structure and preserved the live token-boundary question",
  operations: [
    { tool: "doc_create", params: {
        title: "parser.py", content: "from dataclasses import dataclass",
        isDocRoot: true, fileType: "py", level: "document"
    }},
    { tool: "doc_create", params: {
        title: "Token model", content: "@dataclass\nclass Token:\n    kind: str\n    value: str",
        parentId: "$0.id", level: "section"
    }},
    { tool: "graph_note", params: {
        about: "$1.id",
        title: "Token boundaries may belong to the evaluator",
        trigger: "question",
        testimony: "Keeping positions on tokens makes errors local, but may couple tokenization to evaluation. The first evaluator test should reveal whether the boundary is useful or merely convenient."
    }}
  ]
})
```

Use `$N.id` with the operation index, counting every operation.

## Rearrange and refactor

Change structure in the graph, not in generated output:

- revise a unit with `doc_revise`;
- split an oversized leaf unit with batch-only `doc_split`;
- merge consecutive leaf siblings that no longer deserve separate ownership
  with `doc_merge`; move them together first when needed, and never use merge
  to absorb subtrees or document roots;
- move or reorder one existing unit and its subtree with batch-only `doc_move`;
- inspect `doc_get_tree` or `doc_flatten` after structural changes.

Move a function or class node to the module that owns its responsibility just
as you would refactor files normally: use `doc_move` across document parents,
revise imports/callers in their own nodes, regenerate every affected root, then
run the tests. A node is not permanently bound to the file where it was first
written.

For example, reorder `A → B → C` to `A → C → B` with
`{ tool: "doc_move", params: { nodeId: "B", afterId: "C" } }`. To move a
subtree across parents, also provide `parentId`; `afterId` must be a direct
child of that destination parent. Omit `afterId` to place the subtree first.
The operation validates the whole sibling chain, rewires `contains`/`next`
edges atomically, preserves content and revisions, and regenerates every
affected root after commit. Never call it directly or hand-rewire these edges.

Split through the same atomic boundary:
`{ tool: "doc_split", params: { nodeId: "unit", mode: "lines", lineNumbers: [24, 61] } }`.
The target must be a leaf. The original node becomes an empty container, its
prior source remains in revision history, and the ordered children become the
executable projection. Line boundaries are unique zero-based indexes from 1
through the line before the end. Do not pass `keepParent`, `asFiles`, or
`project`. Split existing child units individually instead of creating a
second sibling sequence.

Make structural changes and their durable design update in one `graph_batch`
when they form one logical change. Regenerate immediately after restructuring.

## Execute the projection

1. Run `doc_generate` for one file or `doc_generate_all` for the project.
2. Execute the generated program, build, typecheck, and tests in the generated
   directory.
3. Treat observable output as an encounter with the graph source, not merely a
   pass/fail gate. Let unexpected behavior redirect attention before explaining
   it away.
4. If a test fails, locate the responsible document node, revise or rearrange
   it, regenerate, and rerun. Never repair the generated file.
5. At genuine Thought Moments, preserve the rich underlying observation,
   alternative, question, or hypothesis while it is live. Later distill a
   revised `decision` or `analysis` if one actually stabilizes.

The completion check is strict: all requested source files exist as graph
roots, generation is reproducible, generated files were not hand-edited, and
the relevant executable checks pass after a fresh regeneration.

For simultaneous contributors, use `collaborative-code` and partition
ownership by document roots or subtrees.
