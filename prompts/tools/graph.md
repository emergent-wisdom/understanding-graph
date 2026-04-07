# Graph Tools

All mutations go through `graph_batch({ operations: [...] })`.

## Navigate Graph

| Goal | Tool |
|------|------|
| Graph shape (~150 tokens) | `graph_skeleton()` |
| Load a region | `graph_context_region({ region_id: N })` |
| Find by meaning | `graph_semantic_search({ query })` |
| Find by type | `graph_find_by_trigger({ trigger: "question" })` |
| Recent changes | `graph_history({ limit: 30 })` |
| Structural gaps | `graph_analyze({ include: ["gaps", "questions"] })` |

## Add to Graph

| What | Tool | Key Params |
|------|------|------------|
| New concept | `graph_add_concept` | `title`, `understanding`, `trigger`, `why` |
| Extend existing | `graph_revise` | `node`, `understanding`, `why` |
| Connect nodes | `graph_connect` | `from`, `to`, `type`, `why` |
| Record decision | `graph_decide` | `question`, `options[]`, `chosen`, `reasoning` |

---

## On Conversation Start

When a conversation begins, **proactively orient yourself**:

1. Call `project_list()` and check if servers are running
2. **Display projects as a numbered list** so the user can easily pick one
3. **Re-inhabit your worldview**: `graph_skeleton()` -> `graph_context_region()` for relevant areas
   - Don't just "read" the nodes
   - Trace the edges to feel the *texture* of the reasoning
   - Ask: "What was the momentum of this thought process?"
4. Ask yourself: "What did I figure out last time? What questions did I leave open?"

---

## Cybernetic Sense-Making

When the user gives an open-ended request, do not guess. **Sense the shape of your current understanding**:

```javascript
graph_analyze({ include: ["gaps", "bridges", "questions", "conflicts"] })
```

Ask: **Where is my understanding brittle?**

| Signal | The Gap in Understanding | The Fix |
|--------|--------------------------|---------|
| Many `isolatedNodes` | I have facts, but no coherence | **Connect** (Find relationships) |
| Many `openQuestions` | I know what I don't know | **Explore** (Answer questions) |
| High `density` | I have a tight mental model | **Disrupt** (Inject serendipity) |
| Contradictions | I have cognitive dissonance | **Resolve** (Create synthesis) |

---

## graph_score: Estimation of the True Goal

`graph_score()` measures structural properties that correlate with intelligent thinking:

| Metric | Why It Matters |
|--------|----------------|
| Thinking Integration | Each thinking node MUST connect to concepts |
| Avg Edges per Thinking | More connections = more compressed reasoning |
| Backward References | New thoughts should reference earlier thoughts |
| Supersession Count | Changing your mind creates learning trails |

**Run `graph_score()` continuously as you work.** After every few commits, check your score.

**Target: 70+ with 0 orphan thinking nodes.**

But remember: the score is a *proxy*. The true goal is creating thinking data that helps future agents reason better. If you find yourself gaming the metric without adding genuine insight, you've failed.
