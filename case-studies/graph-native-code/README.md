# Graph-native coding dogfood: Pulse Ledger

This directory preserves the generated projection from a real graph-only
coding run. The implementation was authored as ordered document nodes—not as
repository files—then projected with `doc_generate_all` and exercised with the
Python compiler, unit tests, and a live program call.

## What the run exercised

- Seven Python document roots generated seven importable files.
- `models.py` began as one document node and was split into named `Event` and
  `WindowSummary` children. The root's live code was cleared while its original
  source remained in revision history.
- The four `analytics.py` units were created in the wrong order, then moved to
  `_validate_width → _bucket_start → summarize → merge_summaries` before
  generation.
- `_coerce_tags` and `parse_event` moved as a subtree from `service.py` to a new
  `parsing.py` root. `service.py` retained only orchestration.
- The first executable run discovered one genuine defect: the ledger treated
  the end of a range as inclusive. A graph-only `doc_revise` changed
  `start <= timestamp <= end` to the half-open
  `start <= timestamp < end`; `graph_understand(workflow: "coding")` then
  retrieved both current and prior code.
- Final verification: all seven files compiled, all eight tests passed, and a
  real service run returned `ingest=(2, 1)` with two deterministic windows.

The graph contained 19 active nodes, all 19 document nodes with content—no
companion concept nodes were manufactured to satisfy a quota. The generated
files below are evidence, not the canonical source. Their headers preserve the
document-root IDs from the isolated run.

## Product findings caused by this run

1. Filename slugging changed `test_pulseledger.py` into
   `test-pulseledger.py`, so test discovery silently ran zero tests. Code
   filenames now preserve safe, import-significant characters and case.
2. Code splitting inserted a Markdown-style `% Split` placeholder into Python.
   Code roots now retain their revision, clear their live parent content, name
   declaration children, and generate from ordered children only.
3. Coding retrieval discarded every document node after lexical ranking.
   Coding baselines now admit code documents and their revisions.
4. Raw `contains`/`next` edge surgery was too easy to get subtly wrong. The new
   batch-only `doc_move` validates the whole sibling chain, moves subtrees
   atomically, returns the final order, and regenerates affected roots.

## Re-run the projection

```bash
cd generated
python3 -m py_compile *.py
python3 -m unittest -v test_pulseledger.py
```

The isolated SQLite graph and exact MCP traces were retained locally at
`/var/folders/2t/k4cprbjx7pldrdpz2m33cwyr0000gn/T/ug-graph-native-code-oX7A6i`.
That temporary path is supporting evidence for this run, not a portable test
fixture; the repository regression suites encode the durable contracts.
