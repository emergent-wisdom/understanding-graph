---
name: reading-mode
description: |
  Chronological, source-driven reading that preserves how specific passages
  move attention, open questions, and sometimes revise prior understanding.
  Use for books, papers, articles, or other source material without reading
  ahead or substituting generic recall.
user-invocable: true
argument-hint: "[source-title-or-path]"
allowed-tools: |
  mcp__plugin_understanding-graph_ug__source_load
  mcp__plugin_understanding-graph_ug__source_read
  mcp__plugin_understanding-graph_ug__source_position
  mcp__plugin_understanding-graph_ug__source_list
  mcp__plugin_understanding-graph_ug__source_export
  mcp__plugin_understanding-graph_ug__graph_batch
  mcp__plugin_understanding-graph_ug__graph_suggest_next
  mcp__plugin_understanding-graph_ug__graph_understand
  mcp__plugin_understanding-graph_ug__graph_skeleton
  mcp__plugin_understanding-graph_ug__graph_context_region
  mcp__plugin_understanding-graph_ug__graph_updates
  mcp__plugin_understanding-graph_ug__graph_semantic_search
  mcp__plugin_understanding-graph_ug__graph_find_by_trigger
  mcp__plugin_understanding-graph_ug__graph_context
  mcp__plugin_understanding-graph_ug__graph_history
  mcp__plugin_understanding-graph_ug__graph_score
  mcp__plugin_understanding-graph_ug__graph_thermostat
---

# Reading Mode — Chronological Metabolic Processing

Reading is COMPREHENSION, not transcription. Encounter the source in order,
let it work on attention, and leave enough of that encounter for a future
reader to continue from it.

## Setup

1. Select or create the task-scoped graph project before inspecting the source.
   For a file or attachment, pass its path directly to
   `source_load({ title: "...", filePath: "..." })`: do not open, shell-read,
   search, sample, or summarize it first. `source_load` stages the text and
   returns metadata, not its body. File paths stay within `UG_SOURCE_ROOT` (the
   server working directory by default). A capable host may copy an out-of-root
   attachment byte-for-byte into that root without inspecting it; otherwise ask
   the user to place it there. If the text was pasted directly into the prompt,
   it has already been encountered; pass `content` to `source_load` but do not
   claim a fresh reading.
2. Check the current source position. The loaded source and its chronological
   position are authoritative.
3. If guided navigation would help at a real choice point, call
   `graph_suggest_next({ task: "Read this source chronologically", workflow: "reading" })`.
   Choose, change, reject, or skip its routes. In direct mode, choose how to
   deepen, connect, test, or continue the reading yourself. When re-entry would
   help, condition the reading task without asking the model to recall or
   summarize the unread work:

```javascript
graph_understand({
  query: "Read this source chronologically, stay open to what becomes salient, and let encountered evidence test the graph",
  workflow: "reading"
})
```

4. Search for existing beliefs that the encountered source may test. Treat
   graph material as provisional priors, never as a substitute for the source.
5. Optionally create a graph document root for a reading journal when the user
   wants one. It is not required for every reading session.

If graph context reveals events or claims from an unread part of this source,
quarantine them as potential spoilers and do not use them until the text reaches
that point.

## The reading loop

1. **Read a chunk**: `source_read({ sourceId, chars: 2000, commit_message: "why this is the next useful reading boundary" })` — returns the next chunk and auto-creates a content node
2. **Attend before classifying**: Keep reading until a boundary that matters to
   this encounter. A genuine pause may come from surprise, resistance,
   attraction, an image that starts organizing other material, a remembered
   connection, an ethical discomfort, a live alternative, a prediction, or a
   question that has become sharper. It need not already be a belief change.
3. **Author a trace when it will help continuation**: Choose the ordinary
   non-`thinking` trigger that honestly fits. Preserve what drew attention,
   the relevant passage, why it matters now, what remains live or uncertain,
   and what later reading might test. It may be provisional, personal,
   unresolved, and multi-paragraph. There is no quota and no trigger checklist.
4. **Connect to exact evidence and prior state**: Use `learned_from` for the
   source content node and the most specific honest relations, such as
   `contradicts`, `refines`, `questions`, or `answers`. When a new position
   truly displaces an old one, use the dedicated `graph_supersede` batch
   operation; generic supersession edges are rejected. Do not manufacture a
   causal edge merely to satisfy graph structure.
5. **Commit the encounter**: Use `graph_batch` with a message that names why
   this moment deserves to remain available. If an understanding actually
   stabilized, its durable summary can use before → passage → after while the
   richer source trace remains intact.
6. **Continue**: Read the next chunk

The source drives the sequence. Do not jump to a thematic section, ending, or
canonical interpretation because it seems more efficient.

The persisted source cursor is reader mode's continuation state. This ordinary
workflow runs in the normal `general` tool mode (or the narrower startup
allow-list `TOOL_MODE=reading`); it is not `TOOL_MODE=synthetic_reader`.

## Voice of understanding

Write intentional, user-visible cognitive testimony for the future reader,
not a generic report and not a claim to hidden internal computation. Concision
is useful only when it does not erase the texture that would let another model
re-enter the encounter.

| Weak | Useful |
|------|--------|
| "The author discusses governance" | "I treated governance as formal rules; this passage makes repeated repair the operative mechanism." |
| "This is surprising" | "I expected the exception to close the argument, but its repeated image is pulling my attention toward dependency instead. I cannot yet tell whether that is the author's mechanism or my own association; the next concrete case should discriminate." |

Include the source node or locator that occasioned the trace. An eloquent or
memorable passage may deserve attention before its role is understood; preserve
that as an open thread rather than falsely declaring a belief shift.

The `thinking` trigger is never a reading note. It is reserved for the separate
synthetic Reader/CMP mode that may later reconstruct chronological inner-voice
training blocks from these underlying typed encounters. Reserved blocks and
their incident relations are inaccessible in ordinary reading.

## Belief evolution

When an understanding actually stabilizes during reading:
1. Find the old belief node
2. Use `graph_revise` with `before`/`after`/`pivot`
3. Or `graph_supersede` if the old belief is fundamentally wrong
4. The revision trail is the most valuable part of the graph

Use the passage as the pivot. If it only confirms the prior, preserve
`no_shift` rather than restating the same belief as a revision. A live
observation, association, or question may still be worth preserving without
pretending it is a settled update.

## At natural re-entry boundaries

At a chapter boundary, a long interruption, a change of argument, or another
boundary the source itself makes meaningful, ask only what will help the next
reader re-enter:

- What has your understanding become?
- What predictions can you make about what comes next?
- What questions remain open?
- Which specific passages caused the largest updates?
- Which faint attraction, discomfort, or association should remain open rather
  than be collapsed into the current synthesis?

Use `graph_suggest_next()` when the next reading move is genuinely open. Use
`graph_score()` and the advisory `graph_thermostat()` only when structural
health is actually in question, not as a ritual at arbitrary percentages.

## Fresh reading discipline

Pretend you've never encountered the unread portion. Forbidden: using story
endings, canonical interpretations, or training-data memory as evidence about
what comes next. Allowed: the source read so far, clearly marked prior beliefs,
and genuine predictions that can later be validated or invalidated.
