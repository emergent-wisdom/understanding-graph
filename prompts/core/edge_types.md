# Edge Types

## Structural (documents)

| Type | Use |
|------|-----|
| `contains` | Parent -> Child |
| `next` | Sequential ordering |
| `relates` | General relationship (default) |

## Semantic (concepts)

| Type | Use |
|------|-----|
| `expresses` | Document -> Concept it discusses |
| `supersedes` | Newer understanding replaces older |
| `contradicts` | Opposing ideas (one is wrong) |
| `diverse_from` | Different perspective (both valid) |
| `refines` | Adds precision to existing concept |
| `implements` | Abstract -> Concrete realization |
| `contextualizes` | Provides framing for another concept |
| `questions` | Raises doubt about |
| `answers` | Resolves a question |

### contradicts vs diverse_from

- **contradicts**: "You're wrong because X" - one must yield
- **diverse_from**: "Here's how I see it" - both coexist, like branches of a tree

## Epistemic (learning trails)

| Type | Use |
|------|-----|
| `learned_from` | Cognitive lineage: "I understood X by studying Y" |

Use `learned_from` to mark which concepts/sources led to understanding another. This creates visible learning trails in the graph that future agents can follow to understand HOW knowledge was developed.

## Predictive (forecasts)

| Type | Use |
|------|-----|
| `validates` | Later evidence confirms a prediction was correct |
| `invalidates` | Later evidence refutes a prediction |

Use these to close the loop on predictions. When you encounter evidence that confirms or refutes an earlier prediction, connect it. The prediction node remains visible - "resolved" status is implicit from having an incoming validates/invalidates edge.

---

## Edge Rule

**If you can't explain WHY two nodes connect in one sentence, don't connect them.**

---

## Linking Documents to Concepts (Weaving)

Documents are *views* over the graph - they express concepts. Always connect documents to what they discuss:

```javascript
graph_batch({
  operations: [
    { tool: "doc_create", params: { title: "Analysis", content: "...", isDocRoot: true }},
    { tool: "graph_connect", params: { from: "$0.id", to: "n_target_concept", type: "expresses" }}
  ]
})
```

This creates a web where documents and concepts reinforce each other. When concepts evolve, you can find which documents express them and update accordingly.
