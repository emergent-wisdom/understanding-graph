# API Parameters (Authoritative Reference)

## Atomic Tools Require graph_batch

The atomic tools below (`graph_add_concept`, `graph_connect`, `graph_revise`) must be wrapped inside `graph_batch`. Direct calls will fail.

```javascript
// CORRECT
graph_batch({
  operations: [
    { tool: "graph_add_concept", params: { ... } },
    { tool: "graph_connect", params: { ... } }
  ],
  commit_message: "Your reflection on what you're adding and why"
})

// WRONG - fails with "Tool not found"
graph_add_concept({ ... })
```

**commit_message is REQUIRED** - reflect on your changes, don't just describe them.

### Commit Messages: The Metacognitive Stream

Your commit messages are visible to other agents via `graph_updates`. They see not just WHAT you created, but WHY you created it and what you were thinking.

**Descriptive (BAD):**
- "Added tension node about conflict"
- "Connected X to Y"
- "Created prediction about outcome"

**Reflective (GOOD):**
- "Something doesn't add up here - the protagonist's calm feels forced"
- "I'm sensing a pattern: every mention of 'safety' precedes a failure"
- "This contradicts my earlier belief - updating my mental model"
- "The skeptic in me can't let this optimism pass unchallenged"

Your commit message should capture:
- What triggered this thought NOW (not just "I analyzed X")
- Your emotional/cognitive state ("I'm suspicious", "This confirms my hunch")
- How this connects to your evolving understanding

The Synthesizer will read your commits to weave the *debate* between agents, not just the facts.

---

## Parameter Reference

These are strict. Wrong parameters fail silently.

| Tool | Parameter | Correct | WRONG |
|------|-----------|---------|-------|
| `graph_add_concept` | Title | `title` | ~~name~~, ~~text~~ |
| `doc_create` | Title | `title` | ~~text~~, ~~name~~ |
| `doc_create` | Hierarchy | `level` | ~~docType~~, ~~type~~ |
| `doc_create` | Content | `content` | ~~prose~~, ~~body~~ |
| `doc_revise` | Target | `nodeId` | ~~node~~, ~~id~~ |
| `doc_revise` | Content | `content` | ~~prose~~ |
| `doc_revise` | Reason | `why` | (required!) |
| `graph_revise` | Target | `node` | ~~nodeId~~ |
| `graph_revise` | Content | `understanding` | ~~content~~ |
| `graph_connect` | Edge type | `type` | ~~edgeType~~ |

**Variable references:** `$0.id` = first operation's result, `$1.id` = second (0-indexed, quoted).

## Required Fields (Strict)

**`graph_add_concept`** - ALL four required:
- `title` - Title of the concept
- `trigger` - Why adding (from valid triggers below)
- `understanding` - Your synthesis of this concept
- `why` - Why this matters (min 3 chars)

**`graph_connect`** - ALL four required:
- `from` - Source node ID (or `$0.id` reference)
- `to` - Target node ID
- `type` - Edge type (from valid types below)
- `why` - Why this connection exists (min 3 chars)

## Valid Enums (Strict)

**Triggers (`trigger`):**
- `foundation` (core concepts)
- `surprise` (unexpected findings)
- `tension` (conflicts/contradictions)
- `consequence` (implications)
- `repetition` (recurring patterns)
- `question` (open inquiries)
- `serendipity` (unexpected connections)
- `decision` (choice points)
- `experiment` (tests/trials)
- `analysis` (breakdowns/examinations)
- `randomness` (chance observations)
- `reference` (pointer to external source)
- `library` (collection of references)
- `prediction` (forecasts)
- `hypothesis` (explanatory theories)
- `model` (generalized patterns)
- `evaluation` (judgments/values)

**Edge Types:**
- `relates` (default)
- `next` (sequence)
- `contains` (hierarchy)
- `expresses` (semantic)
- `supersedes` (correction)
- `contradicts` (conflict)
- `diverse_from` (alternative)
- `refines` (precision)
- `implements` (realization)
- `abstracts_from` (generalization)
- `contextualizes` (framing)
- `questions` (doubt)
- `answers` (resolution)
- `learned_from` (lineage)
- `validates` (confirmation)
- `invalidates` (refutation)
