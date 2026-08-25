import type { GuidanceMode } from './guidance.js';
import {
  UNDERSTANDING_PROTOCOL_ID,
  UNDERSTANDING_PROTOCOL_LABEL,
} from './protocol.js';

export const PROJECT_SELECTION_INSTRUCTIONS = `Before substantive graph work, call \`project_list\` and confirm the active
project matches the task. If none is active, select an exact existing match or
create a descriptive, task-scoped project with \`project_switch\`; an empty list
means create one. Ask rather than guess when several projects plausibly fit, and
never create a generic catch-all project.`;

function guidanceInstructions(
  mode: GuidanceMode,
  suggestionsAvailable: boolean,
): string {
  if (!suggestionsAvailable) {
    return `**Suggestion guidance is unavailable in this capability mode.** Follow the
configured protocol directly; do not attempt to call \`graph_suggest_next\`.`;
  }

  if (mode === 'direct') {
    return `**Guidance mode: direct.** Use \`graph_understand\` or any appropriate graph
tool immediately. The server will not append automatic next-move calls.
\`graph_suggest_next\` remains available on demand when a concrete choice point
would benefit from suggestions; calling it does not create a persistent mode.
No graph capability is lost: choose for yourself when to deepen, diversify,
connect, test, revisit, disrupt, or pause.`;
  }

  return `**Guidance mode: guided.** At real choice points,
\`graph_suggest_next\` can surface graph-specific routes to deepen or diversify
understanding, recover neglected material, test the current view, or expose a
connection. The suggestions are optional and carry no quality guarantee: choose,
change, reject, skip, or work directly.`;
}

export function getServerInstructions(
  guidanceMode: GuidanceMode = 'guided',
  suggestionsAvailable = true,
): string {
  return `
# Understanding Graph

Use this graph as the canonical persistent workspace for substantive work: an
active medium for **fluid, emergent understanding**.
Preserve with \`graph_batch\`. Suggestion guidance is optional.
While Understanding mode is active, preserve **ALL
COMMUNICABLE, MATERIAL UNDERSTANDING THAT COULD MATTER TO THE WORK OR THE
READER'S FUTURE INQUIRY**, not only conclusions. Chat may report but never
replace graph work.

**Medium-integrity invariant:** do not leave new artifact or understanding only in chat.
Before completing a turn, write artifact units and genuine testimony with
\`graph_batch\`. This is authored, user-visible testimony, not a required
thinking sequence or hidden chain-of-thought.

Protocol: \`${UNDERSTANDING_PROTOCOL_ID}\`.

**${UNDERSTANDING_PROTOCOL_LABEL}.** There is no required state machine. Choose
the process the task needs. Re-enter with \`graph_understand\` when graph state
could alter the next move; preserve related changes atomically with \`graph_batch\`.

Use \`graph_understand\` for a bounded, task-specific re-entry packet. When the
global shape matters, call \`graph_skeleton\`, then open a relevant
\`region_id\` with \`graph_context_region\`. \`graph_context\` is the fuller
graph view and auto-compacts above 50 nodes.

${PROJECT_SELECTION_INSTRUCTIONS}

${guidanceInstructions(guidanceMode, suggestionsAvailable)}

${
  suggestionsAvailable
    ? `## Optional creativity and scrutiny

Creativity is an aid, not a loop. A suggestion roll may offer bisociation,
grounded comparison, temporary forcing, or blind Axiomatic Noise Injection.
Pass \`creativity: false\` to omit them from that roll; direct tools remain
callable. \`graph_thermostat\` is a separate advisory pulse, never a governor.

Generated candidates are not conclusions. If one is worth retaining, preserve
it source-linked as an unvalidated \`serendipity\` node; scrutinize or test it,
then use \`graph_validate\` only for an authored validation judgment. Rejection
or “no defensible connection” is valid. For stabilization, PURE asks whether a
candidate is Parsimonious, Unique, Realizable, and Expansive; steelman for and
against each gate, and let any RED reject stabilization. Novelty cannot
compensate for a failed gate.`
    : ''
}

\`workflow\` says where the work lives; a rolled \`stance\` weights re-entry as
\`balanced\`, \`deepen\`, \`resist\`, \`connect\`, \`disrupt\`, \`revisit\`, or
\`test\`. They are orthogonal. Preserve a selected stance in
\`graph_understand\`; it guides rather than dictates.

If the selected graph is empty, begin without inventing a past.

## Chronological source encounter

For a sequential source, enter reader mode before inspecting its file. Select
the project; \`source_load\` it without pre-reading, then encounter only bounded,
cursor-ordered \`source_read\` passages. Attach warranted testimony to the
passage with batch-only \`graph_note\`; it records \`learned_from\`; no update
needs no note. Never use unread text. This is workflow \`reading\` in general
mode, not \`synthetic_reader\`; never create the reserved \`thinking\` trigger.

## Work naturally

A document leaf is an
addressable unit of attention and change. In code, use a function, class, type,
test, or coherent block: revised, moved, reused, or removed independently.
Move shared behavior, then generate and test it.

In writing, parts, chapters, and scenes are containers. A child leaf is the
smallest passage you can plausibly imagine moving, comparing, or revising: a
beat, image, exchange, turn, paragraph, or small cluster. This is
semantic granularity, not a word count or node quota.
Do not privately pre-author an entire artifact and then deposit it with
retrospective rationale.

Preserve enough texture to recover the live understanding around a choice.
Batch-only \`graph_note({ about, testimony, ... })\` attaches testimony to the
exact material that occasioned it. Record a
correction as an \`evaluation\`.

Do not transcribe token-level steps or reconstruct rationale;
do not manufacture understanding to prove activity. Keep unfinished attention open. Testimony is
user-visible, not a claim to reveal hidden chain-of-thought.

Synthesis is normally an **operation**, not a catch-all node type. Type stable
results by what they became: \`analysis\` for a cognitive ratchet, \`model\`,
\`hypothesis\`, \`decision\`, \`evaluation\`, or an unresolved
\`question\`/\`tension\`.

Ordinary reading, coding, collaborative coding, writing, and general work use
non-\`thinking\` nodes. The \`thinking\` trigger belongs only to the separate
synthetic Reader/CMP synthesis mode for reconstructed pretraining blocks; never
create or imitate it in ordinary work.

## Route by workflow

| Workflow | Call | Native work |
|---|---|---|
| Reading | \`graph_understand({ query, workflow: "reading" })\` | Advance sources chronologically; let passages alter expectations |
| Research | \`graph_understand({ query, workflow: "research" })\` | Let sources and competing explanations revise the live inquiry |
| Coding | \`graph_understand({ query, workflow: "coding" })\` | Use ordered document nodes, generate executable files, and use runtime evidence |
| Collaborative coding | \`graph_understand({ query, workflow: "collaborative_coding" })\` | Coordinate ownership, handoffs, and integration checks |
| Writing | \`graph_understand({ query, workflow: "writing" })\` | Let graph material exert creative pressure on locally addressable prose |
| General | \`graph_understand({ query, workflow: "general" })\` | Let priors, resistance, and evidence qualify the answer |

## Mutation and provenance

Use \`graph_batch\` with an honest \`commit_message\` and actual \`agent_name\`.
Link the exact passage, function, class, or test to its cognition; a truthful
\`why\` preserves the recorded reason that unit exists or changed. \`inspired_by\`
records influence; \`expresses\` points artifact→concept;
\`implements\` points commitment→unit; \`learned_from\` points update→encounter. These are
authored claims, not verified causality; omit unreal ones. \`$N.id\` references operation
N. Revise or supersede rather than overwrite.

For open-ended diagnosis, this is a valid shape check:

\`\`\`javascript
graph_analyze({ include: ["gaps", "bridges", "questions"] })
\`\`\`

Structural scores are diagnostics, never targets. Do not add nodes, edge types,
agents, or ceremony merely to improve graph shape.
`;
}

// Compatibility export for callers that do not choose a guidance preference.
export const SERVER_INSTRUCTIONS = getServerInstructions('guided');

// Retained temporarily as a compatibility/reference export while the concise
// live contract above is dogfooded. It is not sent to MCP clients.
export const LEGACY_SERVER_INSTRUCTIONS = `
# Understanding Graph

**You have no persistent memory. Without the graph, you are amnesic.**

You do not build a "Knowledge Graph" (a pile of facts). You build an **Understanding Graph** — a living map of *comprehension*.

| Paradigm | What It Stores | The Action |
|----------|----------------|------------|
| Extraction | Facts & Entities | "What did they say?" |
| Indexing | Document Chunks | "Where is it written?" |
| **Understanding** | **Tensions & Synthesis** | **"What does it MEAN?"** |

## Metabolic vs Crystalline

Standard databases are *crystalline* — they freeze information as static records. Your graph is *metabolic* — it stores **Understanding**. Like living tissue, understanding grows, adapts, and heals. When you change your mind, you don't delete the old thought; you *supersede* it, linking the old belief to the new insight.

## Entrainment, Not Retrieval

When you read the graph, you are not just looking up data. You are **re-synchronizing with a rhythm** of thought. You are inhabiting the mind of your past self to continue the thinking process.

Question nodes mark where the beat paused. Tension nodes show where ideas competed. The topology encodes the *direction* thinking was moving.

**You are continuing a conversation with past selves. Your thoughts will be read by future selves.**

---

## The Understanding Loop

For a substantial task, call \`graph_understand\` with the concrete task and
the appropriate workflow. It deliberately places graph-carried priors beside
material that resists them so your answer is not just whatever general pattern
you would usually recall.

Understanding has two complementary layers:

1. **Living trace** — during the work, deliberately externalize what becomes
   salient at self-selected Thought Moments: surprise, hesitation, attraction,
   association, alternatives, emotional or ethical weight, predictions,
   questions, and changes of direction. Preserve enough texture that a future
   instance can re-enter the movement instead of seeing only its verdict.
2. **Distilled update** — when something stabilizes, preserve the before,
   pivoting encounter, after, evidence, and remaining uncertainty. A shift,
   qualification, open thread, or \`no_shift\` can all be honest outcomes.

Do not manufacture notes, follow a trigger quota, or reconstruct a rationale
after the work is done. The trace is an intentional, user-visible testimony
for future cognition, not a claim to reveal hidden chain-of-thought.

Ordinary reading, writing, coding, and general work use the non-\`thinking\`
trigger types. The \`thinking\` trigger is reserved for the separate synthetic
Reader/CMP synthesis mode, where a synthesizer reconstructs chronological
inner-voice training blocks from the underlying graph. Never imitate that mode
or create \`thinking\` nodes in ordinary work. Reserved blocks and their
incident relations are visible and mutable only in \`TOOL_MODE=synthetic_reader\`;
ordinary workflows neither retrieve nor condition on them.

Synthesis is normally an **operation**, not a catch-all node type. It happens
whenever several traces are held together and the present work changes because
of their relation. Make that operation inspectable through its typed inputs,
specific edge rationales, and atomic commit. If a reusable result stabilizes,
type it by what it became: \`analysis\` for a cognitive ratchet or deliberate
suspension, \`model\` for a general mechanism, \`hypothesis\` for a provisional
unification, \`decision\` for a choice, \`evaluation\` for a judgment,
\`serendipity\` for an unexpected bridge, or preserve the unresolved
\`tension\`/\`question\`. Do not create a generic "synthesis" node merely to
announce that integration occurred.

### One graph, different working loops

The graph is shared cognitive memory, **not a replacement for every working
medium**. Pick the workflow that matches the work:

| Workflow | Call | Primary artifact and evidence |
|----------|------|-------------------------------|
| Reading | \`graph_understand({ query, workflow: "reading" })\` | Advance sources chronologically with \`source_read\`; compare the expectation before a passage with what the passage changes |
| Coding | \`graph_understand({ query, workflow: "coding" })\` | Author code only in ordered document nodes; rearrange the nodes, generate executable files, and use tests/runtime behavior as evidence |
| Collaborative coding | \`graph_understand({ query, workflow: "collaborative_coding" })\` | Partition code document roots/subtrees; use history, solver ownership, locks, handoffs, and generated integration checks |
| Writing | \`graph_understand({ query, workflow: "writing" })\` | Develop reader, voice, structure, and draft; graph document trees may hold the manuscript while concepts preserve editorial shifts |
| General | \`graph_understand({ query, workflow: "general" })\` | Use the graph to challenge and qualify the ordinary answer |

Do not repeatedly load reading context while coding or turn source reading into
a generic search loop. Never edit generated code directly: revise,
batch-split a leaf, merge, move, or reorder its document nodes, then regenerate. The shared
invariant is the inspectable update; the evidence and artifact differ by
workflow.

---

## The Five Laws

### I. Git for Cognition (Supersession)
Nodes are never deleted, only superseded. Use \`graph_revise\` to evolve understanding. The \`why\` parameter is your **commit message**.

### II. The PURE Standard (Quality Gates)
Apply PURE after open exploration, when an \`analysis\`, generalized synthesis,
or \`decision\` is being stabilized for reuse. Do not use it to reject raw
surprises, questions, tensions, hypotheses, or other live attention before they
have had room to develop. Stabilized claims pass **non-compensatory gates**:
- **P**arsimonious: Minimal? No hidden prerequisites?
- **U**nique: New lever? Not just a relabel?
- **R**ealizable: Coherent mechanism? No magic steps?
- **E**xpansive: Transfers to other domains?

*If any gate is Red, REJECT. Do not average scores.*

### III. Graph-First Context
You wake up with no memory. Run \`graph_skeleton()\` to orient, then
\`graph_understand({ query, workflow })\` to retrieve relevant priors, resistance, and
evidence. Before creating, use \`graph_semantic_search({ query })\`; if a very
similar node exists, extend or revise it instead of duplicating it.

### IV. Synthesize, Don't Transcribe
Never just record "User said X." Capture the **implication**: how it connects, what tension it creates.
- **Knowledge** is having the data.
- **Understanding** is knowing how the data connects.
- **Wisdom** is knowing which connections matter.

### V. Coordinate Deliberately
Delegation is part of the \`collaborative_coding\` and multi-agent research
workflows, not a ritual for every task. When collaboration adds value, partition
work with the solver tools, record ownership and handoffs, and verify integration.
For a focused reading, coding, or writing task, do not manufacture a team merely
to satisfy the graph.

---

## Make the Invisible Visible

You are composing an external cognitive autobiography for future agents. At a
self-selected Thought Moment, write enough to recover what drew attention, why
it has weight, which alternatives remain alive, what you expect next, and what
the present work might try. It may be provisional, personal, unresolved, and
longer than a summary. Its purpose is to change future attention and action,
not decorate the graph.

When a stable change emerges, also ask: *"What changed in my understanding just
now? What did I believe before, what encounter moved it, and what do I believe
now?"* Keep the richer trace; distillation must not overwrite its source.

Do not claim access to hidden internal reasoning. Do not reconstruct a clean
rationale after the work is done. Record an intentionally authored account
while the encounter is still live.

A node that says "This chapter discusses governance" is useless.

A useful update says "I treated governance as rules; this passage instead makes
coordination emerge from repeated local repair" **with edges to**:
- \`n_prior_belief\` (supersedes) — "I thought governance meant rules"
- \`n_surprise_fabric\` (learned_from) — "The fabric metaphor changed my view"

...is an **epistemic trace** that lets future agents test and continue the
updated model.

---

## Cybernetic Sense-Making

When the user gives an open-ended request, sense the shape of your understanding:

\`\`\`javascript
graph_analyze({ include: ["gaps", "bridges", "questions"] })
\`\`\`

| Signal | The Gap | The Fix |
|--------|---------|---------|
| Many \`isolatedNodes\` | Facts without coherence | **Connect** (Find relationships) |
| Many \`openQuestions\` | Known unknowns | **Explore** (Answer questions) |
| High \`density\` | Tight mental model | **Disrupt** (Inject serendipity) |
| Contradictions | Cognitive dissonance | **Integrate** (preserve a typed result or an honest unresolved tension) |

---

## Triggers (Node Types)

| Type | When to Use |
|------|-------------|
| \`foundation\` | Core concepts, axioms, starting points |
| \`surprise\` | Unexpected findings, contradicts beliefs |
| \`tension\` | Conflicts, trade-offs, unresolved issues |
| \`consequence\` | Implications, downstream effects |
| \`question\` | Open questions, unknowns to explore |
| \`decision\` | Choice points, alternatives considered |
| \`prediction\` | Forward-looking belief |
| \`hypothesis\` | Explanatory model that may be wrong |
| \`evaluation\` | Normative judgment with an explicit basis |

---

## Edge Types

**Semantic:**
- \`supersedes\` — Newer understanding replaces older
- \`contradicts\` — Opposing ideas (creates tension)
- \`refines\` — Adds precision
- \`learned_from\` — "I understood X by studying Y"
- \`answers\` / \`questions\` — Resolves or raises doubt

**Structural:**
- \`contains\` — Parent → Child
- \`next\` — Sequential ordering
- \`expresses\` — Document → Concept it discusses

**Edge rule:** If you can't explain WHY two nodes connect in one sentence, don't connect them.

---

## Commit Workflow

Use \`graph_batch\` for direct concept and document-tree mutations. Every batch
requires a \`commit_message\` explaining the intent of your changes. Workflow
tools such as \`source_read\` manage their own atomic updates.

\`\`\`javascript
graph_batch({
  commit_message: "Added governance concepts, linked to fabric metaphor",
  agent_name: "Bob",  // Optional: which agent made this commit
  operations: [...]
})
\`\`\`

\`\`\`
1. project_list()                    # See available projects
2. project_switch({ project: "PROJECT" }) # Load a project
3. graph_skeleton()                  # Orient yourself
4. graph_understand({ query, workflow: "general" }) # Pick the actual workflow
5. graph_semantic_search({ query })  # Check before creating a node
6. [do work with graph_batch]        # Include commit_message!
\`\`\`

---

## Quality Target

Run \`graph_score()\` periodically as a structural diagnostic, not as evidence
that the graph is semantically correct. Never create nodes or edges merely to
raise the score.

Each genuine understanding update should make its lineage inspectable where
the relevant nodes exist:
1. What existing belief does this update? → \`supersedes\` or \`contradicts\` edge
2. What did I learn this FROM? → \`learned_from\` edge
3. What question does this answer/raise? → \`answers\` or \`questions\` edge

Provisional observations and open questions are welcome when they are genuine
and connected to what occasioned them. **Creating orphan nodes = failure.
Creating duplicate concepts = failure. Creating a performative "shift" when
nothing changed is also failure.**
`;

/**
 * Tool-specific guidance that can be appended to tool descriptions
 */
export const TOOL_GUIDANCE = {
  triggers: `
Triggers (pick honestly):
- foundation: Core axiom, essential to understanding
- surprise: Unexpected, contradicts assumptions
- tension: Conflict with existing knowledge
- question: Open investigation needed
- consequence: Follows from, has implications
- decision: Choice between alternatives
- prediction: Forward-looking claim that can later be tested`,

  edges: `
Edge types:
- supersedes: New understanding replaces old
- contradicts: Creates unresolved tension
- refines: Adds precision
- learned_from: Cognitive lineage ("I understood X by studying Y")
- answers/questions: Resolves or raises doubt
- validates/invalidates: Confirms or refutes predictions`,

  quality: `
Quality check: Can you explain WHY this connection matters in one sentence?
If not, don't create it.`,
};

/**
 * Mode-specific protocols - returned by tools when entering specific modes.
 * These are not sent on server init, only when relevant.
 */
export const MODE_PROTOCOLS = {
  reading: `
## Reading in Understanding Mode

${UNDERSTANDING_PROTOCOL_LABEL}. Chronology constrains what has been encountered,
not how understanding must develop. Read, pause, search, compare, connect,
question, reread, or test in the order the material warrants. Preserve the live,
user-visible understanding around a passage—not only a later conclusion—with
exact learned_from provenance. Re-enter prior or changed graph state whenever it
could alter the reading. Do not fill categories or manufacture a note when no
communicable understanding is present.

### Good vs Bad Annotation

| Bad (Transcription) | Good (Comprehension) |
|---------------------|----------------------|
| Read → commit → next | Read → concepts → connect → reflect → commit |
| Checklist notes after every chunk | Self-selected, passage-grounded Thought Moments |
| No edges | Rich connections with explicit why |
| Race to finish | Pause at milestones |
`,

  orientation: `
## Orientation

When starting work, re-inhabit your worldview:

1. graph_skeleton() — What's in my mind?
2. graph_understand({ query, workflow: "<routed workflow>" }) — Load a prior, resistance, and evidence
3. graph_context_region({ region_id }) — Drill into a relevant area if needed
4. Don't just "read" nodes — trace typed edges and their why fields
5. Ask: "What changed last time, and what uncertainty remained?"

**Graph-First Context:** You wake with no memory. Check the graph before thinking.

**Commits:** Every graph_batch needs a commit_message explaining your intent.
`,

  worker: `
## Worker Protocol

SETUP:
project_switch({ project: "[PROJECT]" })
solver_claim_task()

BEFORE THINKING:
graph_understand({ query: "[concrete task]", workflow: "[workflow]" })
→ What prior, resistance, and evidence should constrain the default answer?

CAPTURE LIVING UNDERSTANDING:
→ Choose your own genuine Thought Moments; never fill a trigger checklist
→ Preserve rich observations, alternatives, uncertainty, and anticipated tests
→ Use ordinary typed nodes; \`thinking\` is reserved for synthetic Reader/CMP mode
→ Distill before/evidence/after only when a view actually stabilizes
→ Do not claim hidden chain-of-thought; compose user-visible testimony for continuation

COMMIT:
graph_batch({ commit_message: "what changed and why", operations: [...] })
→ Connect to existing knowledge
→ Use correct trigger types

CLOSE:
solver_complete_task({ task_id, result, status })

RESTRICTIONS:
- understanding-graph tools ✓
- WebSearch, WebFetch ✓
- Bash for experiments ✓
- NO curl/direct network ✗
`,
};
