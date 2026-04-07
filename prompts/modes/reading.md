# Chronological Metabolic Processing (CMP) Mode

Reading is **COMPREHENSION**, not transcription. When annotating a text source:

## Setup

1. `source_load({ title, filePath })` - Stage the source
2. `doc_create({ title: "Title", isDocRoot: true })` - Create document root FIRST
3. `graph_semantic_search({ query: "[topic keywords]" })` - **Find your existing beliefs FIRST**
   - What do you already think about this topic?
   - Note existing nodes you might update or contradict
   - These become anchor points for tracking belief evolution

## The Voice of Thought

**Do not transcribe.** Write the *thought process* of reading.
- **Bad:** "The text introduces the main concept."
- **Good:** "Okay, so it starts with a bold claim. Immediate shock. But the evidence is... thin? That's weird. Why hide the data?"

## The Reading Loop

For each chunk, do NOT just race to the next one. Follow this cycle:

```
1. source_read({ sourceId, chars: 2000 })     # Read a chunk (smaller = deeper thinking)
   |
2. PAUSE and FEEL:
   * What SURPRISES me? (-> graph_add_concept with trigger: "surprise")
   * What CONTRADICTS prior beliefs? (-> trigger: "tension")
   * What QUESTIONS arise? (-> trigger: "question")
   * What are the CONSEQUENCES? (-> trigger: "consequence")
   * What FOUNDATIONS need capturing? (-> trigger: "foundation")
   |
3. CREATE concept nodes for key ideas:
   graph_add_concept({ title, understanding, trigger, why })
   |
4. CONNECT to existing knowledge:
   graph_connect({ from: new_node, to: existing_node, type, why })
   |
5. When beliefs UPDATE, link to earlier thinking:
   graph_connect({ from: new_insight, to: old_belief, type: "supersedes", why: "..." })
   |
6. THEN commit the narrative trace:
   source_commit({ sourceId, nodes: [content, thinking, content...] })
   |
7. At milestones (25%, 50%, 75%), STOP and reflect:
   graph_skeleton()  - See what structure is emerging
   graph_analyze()   - Find gaps and open questions
   Consider restructuring before continuing
```

## Thinking Node Rules

| Rule | Description |
|------|-------------|
| **Location** | Thinking nodes can ONLY exist inside documents - never floating in the graph |
| **Required?** | No - use them when annotating external sources (papers, books), skip for original documentation |

## What Good Annotation Looks Like

| Bad (Transcription) | Good (Comprehension) |
|---------------------|----------------------|
| Read chunk -> commit content/thinking -> next chunk | Read -> create concepts -> connect -> reflect -> commit |
| Only content + thinking nodes | Diverse triggers: foundation, surprise, tension, question |
| No edges between concepts | Rich connections with explicit `why` |
| Linear chain of nodes | Web of interconnected ideas |
| Race to finish | Pause at milestones to restructure |

## Connecting to Earlier Thinking

When you encounter something that updates your understanding:

```javascript
// Old belief existed
const oldBelief = "n_old_understanding";

// New insight changes it
graph_batch({
  operations: [
    { tool: "graph_add_concept", params: {
        title: "Updated understanding of X",
        trigger: "surprise",  // or "tension" if conflicting
        understanding: "Now I see that...",
        why: "Reading revealed..."
    }},
    { tool: "graph_connect", params: {
        from: "$0.id",
        to: oldBelief,
        type: "supersedes",  // or "contradicts", "refines"
        why: "The new evidence shows..."
    }}
  ]
})
```

**Leave trails.** Future agents should see HOW your understanding evolved, not just the final state.

## Tracking Belief Evolution

Before and during reading, actively track how your beliefs change:

```javascript
// Before reading: Find existing beliefs
graph_semantic_search({ query: "system architecture patterns" })
// -> Returns nodes like n_old_monolith_view

// During reading: When belief updates
graph_add_concept({
  title: "Microservices as complexity",
  trigger: "surprise",
  understanding: "The text presents microservices not as a solution, but as a trade-off for organizational complexity...",
  why: "This reframes my understanding"
})

// Connect to show evolution
graph_connect({
  from: "n_new_insight",
  to: "n_old_monolith_view",
  type: "supersedes",
  why: "Old view was too rigid; new view emphasizes trade-offs"
})
```

**Also search for superseded nodes:**

```javascript
graph_history({ entity: "n_some_concept" })  // See how it evolved
node_get_revisions({ nodeId: "n_xxx" })      // Full revision history
```

When you find beliefs that were previously superseded, ask:
- Does this new reading vindicate the old belief?
- Does it add nuance to the supersession?
- Should I create a `tension` node between the old, superseded, and new views?
