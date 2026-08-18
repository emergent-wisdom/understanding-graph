# Creative-writing dogfood: *The Lent Night*

This directory preserves a graph-native science-fiction writing experiment.
The canonical manuscript was authored, reordered, and revised in document
nodes, then projected with `doc_generate`. Craft testimony lives in separate
typed concept nodes and does not appear in the generated story.

## Durable artifacts

- `the-lent-night.md` — final generated manuscript (1,569 prose words)
- `the-lent-night.before-separated-pass.md` — manuscript immediately before
  the rigorously separated conditioning continuation
- `conditioning-response.json` — the model's explicit response after reading
  the retrieve-and-stop packet and before any later mutation
- `separated-pass.diff` — the one-paragraph artifact change caused by that
  response
- `separated-pass-results.json` — exact tool results for the later mutation,
  regeneration, and revision-history read
- `the-lent-night.before-current-pass.md` — projection before the valid
  current-prompt continuation
- `current-conditioning-packet.json` — exact retrieve-and-stop output from the
  rebuilt current open-attention `graph_understand` prompt
- `current-conditioning-response.json` — fresh model response to the current
  open-attention packet, authored before mutation
- `current-pass.diff` — exact reader-facing change from the valid continuation
- `current-pass-results.json` — atomic topology commit, generation, reread, and
  conclusion-level revision results

The full SQLite project and 350KB+ chronological tool trace were retained only
in the run's temporary local workspace and are not part of this repository.
The valid current-prompt retrieve-and-stop packet is preserved durably as
`current-conditioning-packet.json`; the invalidated stale packet is omitted.

## Provenance correction

The first experiment successfully tested document-node composition,
paragraph/sentence projection, typed craft-note separation, structural edge
reordering, regeneration, and revision history. However, its early calls were
pre-authored in one script. Although prose and notes were structurally
interleaved, that timing does **not** demonstrate autonomous pauses or prove
that `graph_understand` caused the subsequent revisions. Artifact rereads did
genuinely surface the renderer, arithmetic, pacing, and emotional-density
problems; the causal role of graph conditioning was initially overstated.

An initial separated continuation corrected the process boundary but was later
found to have loaded stale compiled MCP output: it used the older
answer/update-contract prompt, not the current open-attention
`graph_understand` prompt in source. Its public-citation revision remains in
the graph and revision history, but it must not be presented as evidence for
the current prompt. `conditioning-response.json`, `separated-pass.diff`, and
`separated-pass-results.json` preserve that invalidated attempt transparently.

The final current-prompt continuation follows the required separation:

1. A fresh process called `graph_understand(workflow: "writing")`, wrote the
   exact current open-attention output to `current-conditioning-packet.json`,
   verified the new Thought-Moment wording, and stopped without authoring or
   executing any downstream action.
2. In a later model turn, the packet was read and an explicit response was
   authored in `current-conditioning-response.json` before mutation. It
   accepted the graph-carried need for silence around Mara's answer, rejected
   changes to the validated cup ending and mechanism exposition, and selected
   a document-topology experiment.
3. A separate later process used one atomic `graph_batch` to create and link a
   `surprise` node, create a paragraph-level replacement containing the same
   `“No,” she said.` prose, swap the reading-order edge, and archive the
   obsolete sentence node. It then regenerated and reread the artifact.
4. A final atomic batch recorded the observed before→pivot→after understanding
   transition. `current-pass.diff` preserves the exact reader-facing change,
   and `current-pass-results.json` preserves the tool results.

The valid current-prompt continuation was instead led by the graph-carried
decision that Mara's choice becomes real when she stops consoling. Rereading
the generated story after that retrieval exposed a projection mismatch: four
sentence nodes had been intentionally joined into one paragraph, so `“No,” she
said.` arrived as the tail of two possible consolations rather than as a bare
answer. A later process atomically created a `surprise` node, linked it to the
exact prose and prior decision, replaced the final sentence node with a
paragraph-level node containing the same words, archived the obsolete document
node, regenerated, and reread. `current-pass.diff` shows that only the pause
changed. The richer note remained separate from prose, revision history stores
its before→pivot→after transition, and no `thinking` node was created.

The invalidated stale-prompt continuation was led by an unresolved
graph-carried question:
whether Mara deleting her name made private humility function as cheap moral
payment. The packet also supplied evidence that the cracked-blue-cup ending
already worked and should remain implicit. The resulting action therefore left
the ending and mechanism untouched, kept Mara publicly named, and moved the
institutional euphemism ("sacrifice") into conflict with her signature.

## Findings

- Paragraph and sentence node titles leaked into Markdown as visible headings.
  `DocumentWriter` now suppresses headings for exact `paragraph` and `sentence`
  levels, joins consecutive sentence nodes into one paragraph, and preserves
  headings for section-like nodes.
- A connected craft concept never entered generated prose; focused tests cover
  this separation.
- Structural edge surgery can create a syntactically valid but semantically
  wrong reading chain when IDs are mapped incorrectly. The first mistaken
  rearrangement was caught only by rereading the generated artifact. This
  finding led to the batch-only `doc_move` operation: it validates a complete
  sibling chain, moves a whole subtree transactionally, returns the final
  order, and regenerates every affected root. A separate live coding dogfood
  pass now covers the safe path; raw `contains`/`next` surgery remains unsafe.
- Targeted lexical `graph_understand` originally grounded an arithmetic query
  in the mechanism hypothesis but dropped the directly relevant arithmetic
  experiment because its trigger fit neither baseline nor resistance. The
  retrieval fix now admits query-relevant `experiment` and `reference` nodes
  as evidence and follows their typed `learned_from` links; a regression covers
  this exact failure shape.
- Empty Markdown roots are rejected; a graph-native manuscript container needs
  real artifact content. The root here contains only `# The Lent Night`.
- Reserved synthetic Reader isolation now keeps ordinary source/document reads,
  generation, position reports, and exports free of hidden block titles, IDs,
  and content. If the chronological tail is a hidden synthetic block, ordinary
  `source_read` now fails closed before consuming more source text; only
  `synthetic_reader` can continue that sequence. This avoids creating two
  incompatible visible/synthetic `next` orders while preserving the canonical
  A→thinking→B chronology.
- No `thinking` nodes were created. The creative journal used ordinary typed
  nodes (`surprise`, `tension`, `question`, `hypothesis`, `prediction`,
  `consequence`, `evaluation`, `decision`, and `experiment`) as required.
