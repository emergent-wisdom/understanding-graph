# Coding Inside the Graph

> **Graph-native coding workflow.** Code is canonical in document nodes.
> Generate executable files for builds and tests, but never edit those
> projections directly: revise, batch-split a leaf, merge, move, or reorder the
> source nodes and regenerate.

A walkthrough showing how to build a small algorithm, a Bloom filter, **entirely as understanding-graph nodes**, with sema patterns as the cognitive primitives the design is grounded in, then `doc_generate` it to a real `.py` file that runs and self-verifies.

This is the coding pattern the [entangled-alignment paper](https://github.com/emergent-wisdom/entangled-alignment) calls *Causal Faithfulness*: the design and the code can't drift because they're the same artifact, and a future agent reading the source can re-handshake on the sema hashes embedded in the docstrings to verify the pattern definitions haven't shifted.

## Before you follow this tutorial: pick the right workflow

Understanding Graph routes reading, graph-native coding, collaborative coding,
writing, and general analysis explicitly. This tutorial focuses on coding.

**Design-First (this tutorial).** You have a concrete target. The design legitimately comes before the artifact, because the artifact will be evaluated against the design. One batch for the scaffold, one for the source as a doc tree, one for the post-hoc evaluation. This is the right pattern for code, schemas, protocols, migrations, and anything with a falsifiable "does it work" test at the end.

**Understanding-in-Flight (the other pattern).** You have a question, not a
fixed target: writing an essay, reading a paper, exploring a problem, or
drafting a proof. Here the evolving understanding is part of the work, and a
complete advance plan is unreliable. Work one meaningful unit at a time,
reread what it changed, and preserve genuine shifts with the prose or evidence
that produced them. Retroactive capture of a neat rationale for a finished
document is not a substitute for that chronology.

**If you apply this Bloom-filter tutorial's design-first cadence to an essay or
a reading session, the graph may look organized while losing the actual path of
discovery.** Use `graph_understand` with the `writing` or `reading` workflow and
let each rereading or source encounter condition the next pass.

The Bloom filter below is genuinely a Design-First task: the algorithm is
textbook, the constraints are known in advance, and the hypothesis (measured
FPR inside the declared 0.5%–1.5% acceptance band) can be validated by running
the generated file. That is exactly when this tutorial's pattern earns its
keep.

The output of this walkthrough is a real, runnable file:

```
$ python3 projects/bloom-filter-build/generated/bloom_filter.py
BloomFilter(capacity=1000, target_fpr=0.01)
  m (bit array size) = 9586
  k (hash functions) = 7
  inserts            = 1000
  theoretical FPR    = 1.0035%
  measured FPR       = 0.8600%  (86 / 10000)

Sema-grounded Check#1544:
  invariant: side-effect free  -> verified
  invariant: determinism       -> verified
  AcceptSpec#70dd:   PASS  (0.50% ≤ 0.86% ≤ 1.50%)
```

The interesting part is not the algorithm — Bloom filters are textbook.
The interesting part is that the design, the source code, the
verification check, and the evaluation after running it all live as
typed nodes in the same graph, connected by typed edges, with sema
patterns as the vocabulary the agent reasoned with.

## Prerequisites

Both servers attached to your agent:

```bash
claude mcp add ug   -- npx -y understanding-graph mcp
claude mcp add sema -- uvx --from semahash sema mcp
```

(Or run them via subprocess for testing — the walkthrough below uses
the tool names directly, regardless of how the agent is wired up.) The sema
search rankings and definitions shown below are a recorded snapshot. Treat a
different current handshake as a reason to stop or adapt, not as output to
silently force into this example.

## Step 1 — Find the cognitive anchor in sema

The first move is *not* to start writing code. It is to find the
sema pattern that captures what you're building. A Bloom filter is a
*non-blocking truth check with a bounded false-positive rate*. Search
sema for that:

```
sema_search({ query: "non-blocking truth check approximate set" })
```

Top result, score 0.54:

```
Check#1544 — Non-blocking truth evaluation
```

## Step 2 — Handshake and resolve the pattern

Lock the canonical hash and read the full mechanism. The handshake is
the safety primitive — if your local definition of "Check" disagrees
with the canonical one, the registry returns `HALT` and you stop
before building on a misaligned foundation.

```
sema_handshake({ ref: "Check" })
```

```json
{
  "verdict": "PROCEED",
  "handle": "Check",
  "verified_ref": "Check#1544",
  "invariants": [
    "Side-Effect Free: Running a check must not mutate the target state.",
    "Determinism: Same input context yields same boolean result."
  ]
}
```

```
sema_resolve({ handle: "Check" })
```

The mechanism field is the gold:

> A non-blocking verification primitive. Evaluates the truth-value of
> a Condition against a target and returns a Boolean status. Unlike a
> Gate (which alters control flow based on the result), a Check is
> purely observational and side-effect free. It answers 'Is this
> true?' without deciding 'Should we stop?'.

And the documented failure mode is:

> False Positive: Check returns True due to flawed logic or sensor
> noise.

This is *literally* the defining property of a Bloom filter:
probabilistic membership with bounded false positives. The grounding
is real, not metaphorical.

You'll also want a couple of supporting patterns. For the bit array
math:

```
sema_search({ query: "deterministic hash mapping" })
# → Shard#1e74 — Deterministic partitioning of state
```

And for the FPR bound itself:

```
sema_search({ query: "approximate bounded error tolerance" })
# → AcceptSpec#70dd — Non-compensatory failure boundaries
```

Three sema hashes (`Check#1544`, `Shard#1e74`, `AcceptSpec#70dd`).
These become the words you'll think *with*, not citations you'll add
*after*.

## Step 3 — Lay down the design as concept nodes (one atomic batch)

Now you write the design as graph nodes — one foundation, two decisions, one
falsifiable hypothesis, plus the connect edges. The
sema hashes appear inside the `understanding` field, naming the
substrate the decision sits on.

```
project_switch({ project: "bloom-filter-build" })
```

```js
graph_batch({
  commit_message: "Architect: ground the Bloom filter design and its measurable FPR bound in Check#1544",
  agent_name: "Architect",
  operations: [
    {
      tool: "graph_add_concept",
      params: {
        title: "A Bloom filter is an instance of Check#1544",
        trigger: "foundation",
        understanding:
          "Verified via sema_handshake (PROCEED, canonical Check#1544). " +
          "The sema pattern Check#1544 defines a non-blocking verification " +
          "primitive that returns a boolean truth value about a target without " +
          "mutating it. Its documented failure mode is literally 'False Positive: " +
          "Check returns True due to flawed logic or sensor noise.' A Bloom filter " +
          "is exactly this: a probabilistic set membership Check that may return " +
          "true for items not in the set (false positive) but never returns false " +
          "for items that are (no false negatives).",
        why:
          "Anchoring the data structure in Check#1544 makes the failure mode " +
          "load-bearing instead of an inconvenient detail. The whole design must " +
          "respect the FPR bound the user is told to expect.",
      },
    },
    {
      tool: "graph_add_concept",
      params: {
        title: "Sizing: 1% FPR at 1000 inserts → m=9586 bits, k=7 hashes",
        trigger: "decision",
        understanding:
          "For target FPR p=0.01 and capacity n=1000, the optimal bit array size " +
          "is m = -n*ln(p)/(ln(2)^2) ≈ 9586 bits, and the optimal hash count is " +
          "k = (m/n)*ln(2) ≈ 7. The Check#1544 pattern requires that the false " +
          "positive failure mode be bounded and quantifiable; these parameters " +
          "make that bound explicit.",
        why:
          "Without naming the parameters and the formula, the implementation " +
          "would be a magic-number ritual. Future agents revising the capacity " +
          "should be able to recompute m and k from this node.",
      },
    },
    {
      tool: "graph_add_concept",
      params: {
        title: "Hashing: double hashing to synthesize k hash functions from 2 primitives",
        trigger: "decision",
        understanding:
          "h_i(x) = (h1(x) + i*h2(x)) mod m for i in [0,k). h1 and h2 are derived " +
          "from a single SHA-256 of the input by splitting the digest. This gives " +
          "k distinct hash positions per item with one cryptographic hash call. " +
          "Determinism (one of Check#1544's invariants) is preserved because " +
          "SHA-256 is deterministic. Each hash position is a Shard#1e74 of the " +
          "bit array — deterministic partitioning of the state space.",
        why:
          "Standard production-quality approach. Naive implementations using k " +
          "separate hash invocations are k× slower without measurable FPR improvement.",
      },
    },
    {
      tool: "graph_add_concept",
      params: {
        title: "Hypothesis: actual FPR is within [0.5%, 1.5%] after 1000 inserts",
        trigger: "hypothesis",
        understanding:
          "With m=9586, k=7, n=1000, the theoretical FPR is " +
          "(1 - exp(-k*n/m))^k ≈ 0.0099. After actually inserting 1000 random " +
          "items and querying the filter for 10000 unseen items, the measured " +
          "FPR should fall within [0.005, 0.015] with reasonably high probability.",
        why:
          "This is the falsifiable claim of the design. A Check#1544 implementation " +
          "that promises a bound but does not measure against it is performing " +
          "safety, not exhibiting it.",
      },
    },
    {
      tool: "graph_connect",
      params: {
        from: "Sizing: 1% FPR at 1000 inserts → m=9586 bits, k=7 hashes",
        to:   "A Bloom filter is an instance of Check#1544",
        type: "refines",
        why:  "Sizing makes the abstract FPR bound concrete.",
      },
    },
    {
      tool: "graph_connect",
      params: {
        from: "Hashing: double hashing to synthesize k hash functions from 2 primitives",
        to:   "Sizing: 1% FPR at 1000 inserts → m=9586 bits, k=7 hashes",
        type: "refines",
        why:  "Once k=7 is fixed, the question becomes how to produce 7 hash positions per item efficiently.",
      },
    },
    {
      tool: "graph_connect",
      params: {
        from: "Hypothesis: actual FPR is within [0.5%, 1.5%] after 1000 inserts",
        to:   "Sizing: 1% FPR at 1000 inserts → m=9586 bits, k=7 hashes",
        type: "questions",
        why:  "The hypothesis tests the sizing decision empirically.",
      },
    },
  ],
});
```

A few things to notice:

- **`graph_batch` is atomic.** All seven operations (4 concepts + 3
  edges) land together or none of them do. If any operation fails, the
  whole batch is rolled back.
- **Title-based references work in `graph_connect`.** You don't have to
  thread `$0.id` back-references through the operations array — you
  can just write the literal node titles, and the pre-validation check
  resolves them transitively.
- **Every node has `why`.** A concept node without a `why` field is
  rejected. The `why` is the *Origin Story* — the agent's intent at
  the moment of creation, preserved for future agents.
- **Sema hashes go inside `understanding`.** They're not URL
  references or footnotes. They're load-bearing words in the
  description of what the node *is*.

## Step 4 — Build the source code as a `.py` doc tree

This is the part that's new. You create one **document root** node
with `fileType: "py"`, then a chain of **child nodes** whose
`content` field holds Python source. The order is set with
`afterId` so the children render in sequence. When you call
`doc_generate`, the system walks the tree depth-first and concatenates
the children's content into a real `.py` file.

```js
graph_batch({
  commit_message: "Engineer: implement Bloom filter as a .py doc tree, sema-grounded in Check#1544 + Shard#1e74 + AcceptSpec#70dd",
  agent_name: "Engineer",
  operations: [
    {
      tool: "doc_create",
      params: {
        title: "bloom_filter.py",
        isDocRoot: true,
        fileType: "py",
        content: `"""
Bloom filter — a Check#1544 for set membership.

A Bloom filter answers "is x probably in this set?" with bounded
false-positive rate (an AcceptSpec#70dd) and zero false negatives.
Each item is mapped to k bit positions in an m-bit array via
deterministic hashing — that mapping is a Shard#1e74 of the bit space.

Generated from the graph; do not edit by hand.
"""`,
      },
    },
    {
      tool: "doc_create",
      params: {
        title: "imports",
        parentId: "$0.id",
        content: "import hashlib\nimport math\nimport random",
      },
    },
    {
      tool: "doc_create",
      params: {
        title: "BloomFilter class",
        parentId: "$0.id",
        afterId:  "$1.id",
        content: `class BloomFilter:
    """A non-blocking probabilistic set membership Check#1544."""

    def __init__(self, capacity: int, false_positive_rate: float = 0.01):
        if capacity <= 0:
            raise ValueError("capacity must be positive")
        if not 0 < false_positive_rate < 1:
            raise ValueError("false_positive_rate must be between 0 and 1")
        self.capacity = capacity
        self.target_fpr = false_positive_rate
        self.m = max(1, math.ceil(-capacity * math.log(false_positive_rate) / (math.log(2) ** 2)))
        self.k = max(1, round((self.m / capacity) * math.log(2)))
        self.bits = 0
        self.count = 0`,
      },
    },
    {
      tool: "doc_create",
      params: {
        title: "hash positions",
        parentId: "$0.id",
        afterId: "$2.id",
        content: `    def _hash_positions(self, item: str):
        digest = hashlib.sha256(item.encode("utf-8")).digest()
        h1 = int.from_bytes(digest[:16], "big")
        h2 = int.from_bytes(digest[16:], "big")
        for i in range(self.k):
            yield (h1 + i * h2) % self.m`,
      },
    },
    {
      tool: "doc_create",
      params: {
        title: "add",
        parentId: "$0.id",
        afterId: "$3.id",
        content: `    def add(self, item: str) -> None:
        for position in self._hash_positions(item):
            self.bits |= 1 << position
        self.count += 1`,
      },
    },
    {
      tool: "doc_create",
      params: {
        title: "membership check",
        parentId: "$0.id",
        afterId: "$4.id",
        content: `    def __contains__(self, item: str) -> bool:
        return all(
            self.bits & (1 << position)
            for position in self._hash_positions(item)
        )`,
      },
    },
    {
      tool: "doc_create",
      params: {
        title: "estimated FPR",
        parentId: "$0.id",
        afterId: "$5.id",
        content: `    def estimated_fpr(self) -> float:
        return (1 - math.exp(-self.k * self.count / self.m)) ** self.k`,
      },
    },
    {
      tool: "doc_create",
      params: {
        title: "executable acceptance check",
        parentId: "$0.id",
        afterId: "$6.id",
        content: `def _main() -> None:
    bloom = BloomFilter(capacity=1000, false_positive_rate=0.01)
    rng = random.Random(27)
    inserted = [f"item-{rng.getrandbits(64)}" for _ in range(1000)]
    unseen = [f"query-{rng.getrandbits(64)}" for _ in range(10000)]
    for item in inserted:
        bloom.add(item)

    false_positives = sum(item in bloom for item in unseen)
    measured_fpr = false_positives / len(unseen)
    no_false_negatives = all(item in bloom for item in inserted[:200])

    probe = unseen[0]
    before_query = bloom.bits
    first_result = probe in bloom
    after_first_query = bloom.bits
    second_result = probe in bloom
    side_effect_free = before_query == after_first_query == bloom.bits
    deterministic = first_result == second_result
    accept_spec = 0.005 <= measured_fpr <= 0.015

    side_effect_status = "verified" if side_effect_free else "FAILED"
    deterministic_status = "verified" if deterministic else "FAILED"
    accept_status = "PASS" if accept_spec else "FAIL"

    print(f"BloomFilter(capacity={bloom.capacity}, target_fpr={bloom.target_fpr})")
    print(f"  m (bit array size) = {bloom.m}")
    print(f"  k (hash functions) = {bloom.k}")
    print(f"  inserts            = {bloom.count}")
    print(f"  theoretical FPR    = {bloom.estimated_fpr():.4%}")
    print(f"  measured FPR       = {measured_fpr:.4%}  ({false_positives} / {len(unseen)})")
    print()
    print("Sema-grounded Check#1544:")
    print(f"  invariant: side-effect free  -> {side_effect_status}")
    print(f"  invariant: determinism       -> {deterministic_status}")
    print(f"  AcceptSpec#70dd:   {accept_status}  (0.50% ≤ {measured_fpr:.2%} ≤ 1.50%)")

    assert no_false_negatives
    assert side_effect_free
    assert deterministic
    assert accept_spec


if __name__ == "__main__":
    _main()`,
      },
    },
    {
      tool: "graph_connect",
      params: {
        from: "$0.id",
        to: "A Bloom filter is an instance of Check#1544",
        type: "expresses",
        why: "The graph-native Python artifact realizes this design concept",
      },
    },
  ],
});
```

Each subsequent child uses `parentId: "$0.id"` (the doc root) and
`afterId: "$N.id"` (the previous sibling) to specify position. The
`$N.id` syntax is a back-reference to the result of the Nth operation
in the same batch — so `$0.id` is the doc root that operation 0 just
created.

After the batch completes, **`doc_generate` fires automatically** for
any document root touched in the batch, and writes the .py file to
`<projectDir>/<projectName>/generated/<filename>`.

The final `expresses` edge is required here because this project already has a
design graph: it grounds the new document root in the existing Bloom-filter
concept. Without that edge, orphan prevention correctly rolls the batch back.

## Step 5 — Run the generated file

`doc_generate` wrote the file to
`<PROJECT_DIR>/bloom-filter-build/generated/bloom_filter.py`. Code-significant
underscores and case are preserved. Run it:

```bash
python3 "${PROJECT_DIR:-$PWD/projects}/bloom-filter-build/generated/bloom_filter.py"
```

Output:

```
BloomFilter(capacity=1000, target_fpr=0.01)
  m (bit array size) = 9586
  k (hash functions) = 7
  inserts            = 1000
  theoretical FPR    = 1.0035%
  measured FPR       = 0.8600%  (86 / 10000)

Sema-grounded Check#1544:
  invariant: side-effect free  -> verified
  invariant: determinism       -> verified
  AcceptSpec#70dd:   PASS  (0.50% ≤ 0.86% ≤ 1.50%)
```

The measured FPR (0.86%) falls inside the AcceptSpec band ([0.5%,
1.5%]) the design declared, so the file's self-check prints `PASS`.
This is the closing of the loop: a sema-grounded design constraint
declared in a graph node, captured in the source as an embedded
self-test, run against real input.

## Step 6 — Capture the observed evaluation

The generated program has now produced evidence that changed what the graph can
justifiably claim. Capture that observed result—not because every document
batch needs a companion concept, but because this particular test resolves the
earlier hypothesis:

```js
graph_batch({
  commit_message: "Evaluator: bloom_filter.py runs and the declared AcceptSpec#70dd band holds",
  agent_name: "Evaluator",
  operations: [
    {
      tool: "graph_add_concept",
      params: {
        title: "Empirical: Bloom filter measured FPR is 0.86% (theoretical 1.00%)",
        trigger: "evaluation",
        understanding:
          "Ran the generated bloom_filter.py against 1000 inserts and 10000 " +
          "queries. Measured FPR = 0.86% (86/10000). Zero false negatives among " +
          "200 sampled inserted items. The AcceptSpec#70dd band [0.5%, 1.5%] is " +
          "satisfied. The 95% CI on 86/10000 is roughly [0.69%, 1.06%], which " +
          "contains the theoretical 1.00% — measurement does not refute theory.",
        why:
          "A Check#1544 implementation that promises a bound and then measures " +
          "against it and reports PASS exhibits Causal Faithfulness — the visible " +
          "design commitment (the AcceptSpec line in the source) is bound to the " +
          "actual behavior (the measured FPR).",
      },
    },
    {
      tool: "graph_connect",
      params: {
        from: "Empirical: Bloom filter measured FPR is 0.86% (theoretical 1.00%)",
        to:   "Hypothesis: actual FPR is within [0.5%, 1.5%] after 1000 inserts",
        type: "validates",
        why:  "Empirical measurement falls inside the AcceptSpec#70dd band declared by the hypothesis.",
      },
    },
  ],
});
```

The `validates` edge from the evaluation node back to the hypothesis
node closes the epistemic loop. A future agent reading this graph can
trace: foundation → sizing decision → hypothesis → empirical
evaluation → validation. The design and the verification are
*structurally* linked, not just coexistent.

## What the final graph looks like

```
graph_skeleton()
```

The exact community labels in `graph_skeleton` are analysis output, so do not
assert a particular region numbering. The operations above deterministically
create 13 nodes and 18 edges with this load-bearing topology:

```
A Bloom filter is an instance of Check#1544
├── Sizing decision
│   ├── Hashing decision
│   └── FPR hypothesis ← validates — Empirical evaluation
└── expresses — bloom_filter.py
    ├── imports
    ├── BloomFilter class
    ├── hash positions
    ├── add
    ├── membership check
    ├── estimated FPR
    └── executable acceptance check
```

The document children also have explicit `next` edges in the order shown. The
implementation is connected to the design through `expresses`, and the
measured result is connected to the falsifiable claim through `validates`.

## Why this is different from writing a `.py` file directly

Doing the same task with `write_file` would have produced a working
Bloom filter. The graph-based approach is observably different in
five ways:

1. **The AcceptSpec dragged its own verification into existence.**
   Because you declared the FPR bound as a design node *before*
   writing the code, you can't honestly write the file without
   including the measurement that proves the bound holds. The check
   at the bottom of `bloom_filter.py` exists because the design
   demanded it.

2. **The sema patterns provided cohesion.** The double-hashing
   decision became "the hash function implements a Shard#1e74
   partitioning" rather than "we need k hash positions." That framing
   is harder to drift from.

3. **The design and the code can't drift, by construction.** The
   sema hashes embedded in the design `understanding` fields end up
   *literally* in the `.py` file's docstrings, because the doc tree
   IS the source. A future agent re-handshakes on those hashes; if a
   pattern was refined, the handshake returns `HALT` and the agent
   gets a clear signal that the file's claim no longer matches.

4. **The reasoning trail survives.** A future agent (or you next
   week) can browse `bloom-filter-build` and reconstruct: why
   `Check#1544` was chosen, why `m=9586` and `k=7`, why double
   hashing, what the hypothesis was, what was measured, whether the
   AcceptSpec held.

5. **Live attention can remain causally attached to the artifact.**
   Documents do not need a companion concept merely to exist. When coding
   exposes a real surprise, tension, alternative, experiment, or decision,
   optional batch-only `graph_note` attaches it to the exact code/test unit and
   artifact reads or generation resurface it. Mechanical work and an honest
   `no_shift` remain valid; no generic warning asks for a decorative concept.

## Things to know

- **Use `graph_batch` for direct concept and document-tree mutations.** Some
  document helpers are exposed as top-level tools, but a batch is the workflow
  contract when related nodes, edges, and artifact changes must land together:
  it enforces atomicity and requires a commit message.
- **Required fields on `graph_add_concept` are `title`, `trigger`,
  `understanding`, AND `why`.** Omitting `why` or `understanding`
  fails validation.
- **Required fields on every `graph_connect` are `from`, `to`,
  `type`, AND a `why` of at least 3 characters.** "X" or "connects"
  will be rejected.
- **Valid trigger types** (the seven you'll use most): `foundation`,
  `surprise`, `tension`, `consequence`, `question`, `decision`,
  `prediction`. Less common but available: `hypothesis`, `model`,
  `evaluation`, `analysis`, `experiment`, `serendipity`,
  `repetition`, `randomness`, `reference`, `library`. The
  `thinking` trigger is reserved for synthetic Reader/CMP pretraining output
  in `TOOL_MODE=synthetic_reader`; ordinary coding never creates it.
- **Valid edge types**: `refines`, `answers`, `questions`,
  `expresses`, `supersedes`, `contradicts`, `contains`, `next`,
  `learned_from`, `validates`, `invalidates`, `implements`,
  `abstracts_from`, `contextualizes`, `diverse_from`, `relates`.
  Note that `consequence` exists as a *trigger* but not as an edge
  type.
- **`fileType: "py"` triggers code generation.** Other supported
  values include `md`, `tex`, `ts`, `js`, `txt`. The doc generator
  for `.py` files prepends a `# DO NOT EDIT DIRECTLY - Generated
  from graph node <id>` header automatically.

## Try it yourself

The fastest way to reproduce this exact session is:

```bash
# 1. Install both servers
claude mcp add ug   -- npx -y understanding-graph mcp
claude mcp add sema -- uvx --from semahash sema mcp

# 2. In Claude Code (or any MCP client), say:
#    "Read docs/coding-inside-the-graph.md and reproduce the bloom
#     filter walkthrough. Use the project name bloom-filter-build."
```

The agent will follow the steps above, ending with a runnable `.py`
file that prints `AcceptSpec#70dd: PASS`.
