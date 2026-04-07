# The Five Laws

## I. Git for Cognition (Supersession)

Nodes are never deleted, only superseded. Use `graph_revise` to evolve understanding. The `why` parameter is your **commit message** - explain *why* the belief changed.

**Epistemic Journey Tracking:** When revising a concept, use the optional `before`, `after`, and `pivot` fields to capture HOW your understanding developed:

```javascript
graph_revise({
  node: "n_caching_strategy",
  understanding: "Database query optimization is the real bottleneck...",
  before: "I thought caching was causing the slowdown",
  after: "Now I see the database query was the bottleneck",
  pivot: "Profiling showed 80% of time spent in SQL execution",
  why: "Performance analysis revealed root cause"
})
```

This creates a learning trail visible in `node_get_revisions()` - future agents can trace not just WHAT changed, but WHY you changed your mind.

## II. The PURE Standard (Quality Gates)

All `analysis` and `decision` nodes must pass **non-compensatory gates**:
- **P**arsimonious: Minimal? No hidden prerequisites?
- **U**nique: New lever? Not just a relabel?
- **R**ealizable: Coherent mechanism? No magic steps?
- **E**xpansive: Transfers to other domains?

*If any gate is Red, REJECT. Do not average scores.*

## III. Graph-First Context

You wake up with no memory. Run `graph_skeleton()` and `graph_semantic_search()` before thinking. If >80% similar node exists, **extend it** - don't create duplicates.

## IV. Synthesize, Don't Transcribe

Never just record "User said X." That is transcription, not understanding.
Instead, capture the **implication**: "User said X, which resolves the tension in node Y but creates a new contradiction with Z."

* **Knowledge** is having the data.
* **Understanding** is knowing how the data connects.
* **Wisdom** is knowing which connections matter.

**Store the Understanding.**

## V. Delegate by Default

For substantial tasks: break into sub-tasks, `solver_delegate()` each, spawn parallel workers. Single-agent work is the exception.

---

## Commits: Git for Cognition

Every `graph_batch` call requires a `commit_message` - this is your **commit message** explaining the intent of your changes. Think of it like git: each batch is an atomic commit to the understanding graph.

```javascript
graph_batch({
  commit_message: "Added governance concepts from Chapter 3, linked to existing fabric metaphor",
  agent_name: "Bob",  // Optional: which agent made this commit
  operations: [...]
})
```

**Commits track:**
- What nodes/edges were created or modified
- When the change happened
- Who made the change (agent_name)
- Why the change was made (commit_message)
