---
name: understanding-work
description: Use an available Understanding Graph or Undergraph MCP as the persistent medium for substantive reading, research, writing, coding, design, diagnosis, decisions, and other knowledge work. Trigger whenever a user asks for meaningful work in a graph-backed project, even if they do not explicitly say “use the graph.” Let all communicable, material understanding that could matter to the work or a future inquiry develop in the graph, choose a process suited to the task, and use graph state to provoke later attention and action.
---

# Work through Understanding

Protocol compatibility: `fluid-understanding-v1`.

When this skill is active, the graph is the canonical medium in which the task
develops. It is not a memory aid or filing cabinet visited after the answer is
finished. The primary task is not merely to write a novel, answer a question,
or produce code. It is to do that work *through the Understanding Graph* so the
understanding that makes the artifact possible remains available for new work.

Do not wait for the user to name a tool. Begin in the graph unless the user
explicitly asks not to use it. Chat may report progress, ask for a decision, or
present a result; it does not replace graph work.

Maintain medium integrity: never leave newly developed substantive artifact
text or communicable understanding only in chat. Before completing a turn,
write the exact artifact units and genuine testimony to the graph. The final
response may mirror or summarize what was committed. This is an invariant of
the medium, not a mandatory sequence for how understanding must unfold.

## Enter the medium

Call `project_list` before substantive graph work and confirm the active project
matches the task. If none is active, select an existing match or create a
descriptive, task-scoped one with `project_switch`; an empty list means create
one. If several existing projects are plausible, ask rather than guess. Never
create a generic catch-all project.

Choose the amount of navigation aid that suits the model and task:

- **Direct:** call `graph_understand`, `graph_batch`, or another appropriate
  graph tool immediately and choose for yourself when to deepen, connect,
  test, revisit, disrupt, or pause.
- **Guided:** call `graph_suggest_next` when graph-specific pointers could
  deepen or diversify understanding, recover neglected material, test the
  current view, or make a useful connection visible.

The live server may provide guided prompts automatically or run in direct mode.
Either way, `graph_suggest_next` remains optional and callable on demand. Its
weighted routes are provocations, not quality guarantees or required phases;
choose, combine, modify, reject, replace, or skip them. A route may call
`graph_understand` to bring task-relevant graph material into view. Treat any
returned material as provisional prior understanding, not authority. If the
graph is empty, begin honestly without inventing a past.

Do not privately complete the task and later deposit a polished rationale.
Develop artifacts and understanding in the graph while they are alive.

## Encounter supplied sources chronologically

When the user supplies a book, paper, article, transcript, or other sequential
text to understand, enter reader mode before inspecting the source itself.
Select or create the task-scoped project, then stage a file or attachment with
`source_load` without opening, shell-reading, searching, sampling, or
summarizing it first. `source_load` returns metadata, not the source body.

Encounter the text only through successive `source_read` results, normally in
bounded 2,000-character passages, and preserve their order. Attend to the
current passage before requesting the next one. When it produces communicable,
material understanding that may help continuation, attach ordinary typed
testimony to that exact content node with `graph_note`; its `learned_from`
provenance is created automatically. A passage that produces no durable update
needs no note. Continue from the persisted source cursor, never from an unread
part of the source or generic recall.

This is ordinary reading through the graph. It uses workflow `reading` in the
normal `general` tool mode; it never activates `synthetic_reader` or creates the
reserved `thinking` trigger. If an attachment lies outside `UG_SOURCE_ROOT`, a
capable host may copy it byte-for-byte into the project root without inspecting
it; otherwise ask the user to place it there. Do not weaken the source-root
boundary.

## Preserve the understanding that exists

Default to preserving all communicable, material understanding that could matter
to the work or the Reader's future inquiry—not only final conclusions or dramatic
changes. This may include:

- what currently draws attention and why;
- questions, hesitations, tensions, and uncertain interpretations;
- competing explanations or creative alternatives;
- relations noticed between sources, artifacts, and prior understanding;
- reasons a choice seems promising, risky, or premature;
- evidence, tests, and encounters that strengthen or weaken a view;
- predictions, decisions, evaluations that record corrections, and consequences;
- what an artifact unit is trying to do and how that intention changes;
- a possible synthesis, including why it might fail;
- what remains open for the next instance.

Use ordinary typed cognitive nodes and exact provenance. The batch-only
`graph_note({ about, testimony, title?, trigger?, why?, status? })` attaches
user-visible testimony to the source, artifact unit, or prior understanding that
occasioned it. Preserve enough texture to recover how the view was reached and
what alternatives remained, rather than recording only a verdict.

This is not a request for hidden or token-level chain-of-thought. Never claim
access to hidden model state, transcribe private token-by-token reasoning, or
reconstruct a tidy rationale after completion. It is authored, inspectable
understanding for continuity. Do not manufacture notes to demonstrate activity;
if no communicable, material understanding is present, add nothing.

Ordinary work never creates the reserved `thinking` trigger. Use ordinary types
such as `question`, `tension`, `surprise`, `hypothesis`, `model`, `analysis`,
`decision`, `evaluation`, `experiment`, or `consequence` as the content warrants.

## Choose your own process

There is no mandatory loop or state machine for ordinary human collaboration.
Move among reading, searching, making, preserving, testing, connecting,
revising, disrupting, re-entering, reconsidering, and pausing in whatever order
the task needs. Invent a local loop when useful. Abandon it when it stops being
useful.

Re-enter with `graph_understand` whenever prior or newly changed graph state
could alter what comes next. A useful result is not merely that the graph was
consulted, but that something already persisted changes a later question,
association, artifact, experiment, or decision.

Use `graph_batch` to preserve related artifact, understanding, relation, and
provenance changes atomically. Do not create nodes or edges to satisfy a quota.

## Keep artifacts locally addressable

Represent an artifact in units that can be understood, revised, moved, tested,
or reused independently. Use semantic boundaries rather than size targets:

- prose: a beat, image, exchange, turn, argument move, paragraph, or small
  paragraph cluster;
- code: a function, class, type, test, import group, or coherent block with one
  responsibility;
- research: a source passage, claim, method, result, objection, or inference;
- decisions: a live option, criterion, assumption, risk, prediction, or
  consequence.

Use chapters, scenes, modules, or reports as containers when they hold several
independent centers. Split or move a unit when its reason to change diverges
from its neighbors. Do not split mechanically.

Connect an artifact to cognition only when the relation is real. Use
`inspired_by` when graph material genuinely shaped an artifact unit,
`expresses` when the artifact renders a concept, and `learned_from` when an
understanding came from evidence. Use `implements` from an abstract decision or
design to the exact concrete passage, function, class, or test that realizes it.
Give each relation a local, truthful `why`.

This makes the artifact queryable in both directions: from a decision or tension
to the units it shaped, and from one exact unit back to its recorded purpose,
origin commit, influences, and later revisions. Use
`doc_read({ nodeId, showProvenance: true, showRevisions: true })` when asking why
that unit exists or changed. The result is an authored provenance account, not
verified causality; a missing relation means unrecorded, not uncaused.

## Invite emergence without surrendering judgment

When optional guidance would help, use this lightweight chooser loop at a real
choice point:

1. Call `graph_suggest_next` with the live user task or local uncertainty. It
   rolls several weighted options. An option may contain a multi-step route and
   may continue, deepen, search, read, inspect, connect, compare randomly,
   disrupt, reread an artifact, preserve, or pause.
2. Inspect the weights in the context of the actual task. Give higher rolls
   stronger consideration, but judge whether the route can genuinely serve the
   user. Combine, modify, reject, or replace suggestions when warranted.
3. Engage in the chosen route. Let the user task and the rolled action jointly
   shape what happens. Preserve the communicable understanding produced, then
   ask again at the next real choice point.

The endpoint proposes; the agent chooses. Stop calling it whenever direct work
is more natural. Turning off the aid removes no graph capability and does not
excuse the agent from noticing when the work needs deeper, broader, resistant,
or revisional attention.

Workflow and stance are separate. `workflow` identifies the work domain and its
native evidence. A rolled `stance`—`balanced`, `deepen`, `resist`, `connect`,
`disrupt`, `revisit`, or `test`—changes what the next re-entry weights. When you
select a route that calls `graph_understand`, preserve its stance. Judge the
returned pressure freely; stance does not dictate a conclusion.

Use `graph_discover_grounded` when a distant comparison might reveal hidden
structure, and `graph_analyze` when questions, gaps, bridges, or conflicts need
inspection. A suggestion may instead propose `graph_random({ force: true })`:
for one generative pass, assume the sampled concepts connect and articulate the
strongest Physics What-If. Then release that assumption and test the candidate.
Forced bisociation generates possibilities; it does not validate them. Reject
noise. “No defensible connection” is valid. When a resonance genuinely changes
the work, preserve its provenance so later instances can see where the influence
came from.

Before reporting completion, make sure the graph contains the live state another
instance would need: artifacts, understanding, unresolved attention, and honest
evidence. Resolve only what the work actually resolved. Verify generated files,
tests, citations, or other external evidence against the graph, then present the
result without turning the protocol into the subject of the answer.
