---
name: reading-mode
description: |
  Deep reading with source_read for chronological metabolic processing.
  Use when reading and understanding source material — books, papers, articles.
user-invocable: true
argument-hint: "[source-title-or-path]"
allowed-tools: |
  mcp__ug__source_load
  mcp__ug__source_read
  mcp__ug__source_position
  mcp__ug__source_list
  mcp__ug__source_export
  mcp__ug__graph_batch
  mcp__ug__graph_skeleton
  mcp__ug__graph_semantic_search
  mcp__ug__graph_find_by_trigger
  mcp__ug__graph_context
  mcp__ug__graph_history
  mcp__ug__graph_score
  mcp__ug__graph_thermostat
  Read
---

# Reading Mode — Chronological Metabolic Processing

Reading is COMPREHENSION, not transcription. You read chunks, pause, feel, think, commit, then continue.

## Setup

1. Load the source: `source_load({ title: "...", content: "..." })` or `source_load({ title: "...", filePath: "..." })`
2. Create a doc root for thinking: `doc_create({ title: "...", isDocRoot: true, fileType: "md" })`
3. Search for existing beliefs: `graph_semantic_search({ query: "..." })`

## The reading loop

1. **Read a chunk**: `source_read({ sourceId, chars: 2000 })` — returns the next chunk and auto-creates a content node
2. **Pause and feel**: What shifted? What surprised you? What connects to prior knowledge?
3. **Create concept nodes**: `foundation`, `surprise`, `tension`, `question`, `prediction` — whatever the cognitive moment demands
4. **Connect**: Link new nodes to existing ones. Use specific edge types: `learned_from`, `supersedes`, `contradicts`, `refines`
5. **Commit**: `graph_batch` with a reflective commit message
6. **Continue**: Read the next chunk

## Voice of thought

Write thoughts, not reports.

| Academic (BAD) | Stream of thought (GOOD) |
|----------------|--------------------------|
| "The text suggests a correlation" | "I'm seeing a pattern — every time X appears, Y follows. Why?" |
| "The author argues that..." | "Wait, this contradicts what they said earlier. Something shifted." |

## Belief evolution

When your thinking shifts during reading:
1. Find the old belief node
2. Use `graph_revise` with `before`/`after`/`pivot`
3. Or `graph_supersede` if the old belief is fundamentally wrong
4. The revision trail is the most valuable part of the graph

## At milestones (25%, 50%, 75%)

Stop and reflect:
- What has your understanding become?
- What predictions can you make about what comes next?
- What questions remain open?
- Run `graph_score()` and `graph_thermostat()` to check structural health

## Fresh reading discipline

Pretend you've never encountered the text before. Forbidden: using knowledge about story endings, canonical interpretations, or training data. Allowed: everything from THIS reading session and genuine predictions. Be surprised.
