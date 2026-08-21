# Using Understanding Graph with Sema

Understanding Graph and [sema](https://github.com/emergent-wisdom/sema) cover
two different axes of shared memory for AI agents. They compose cleanly, and
most teams benefit from running both.

| Layer | Tool | Answers |
|---|---|---|
| Persistent understanding | Understanding Graph | *What changed? Why did we choose this? What remains unresolved?* |
| Semantic memory | Sema | *What does this word actually mean, byte-for-byte?* |

Persistent understanding without semantic grounding: agents accumulate useful
testimony but can drift on the meaning of the words they use. Semantic grounding
without history: agents agree on definitions but have no experience to build
on. Together, they form an understanding commons that survives across sessions
and across agents.

> **A note on the hashes in this doc.** The examples below use live canonical
> hashes from the current sema vocabulary (`StateLock#7859`,
> `MechanisticDesignProposal#8cf7`). Sema patterns can be refined, and
> refinement changes the hash. If a handshake in this doc returns `HALT`
> instead of `PROCEED`, run `sema show <handle>` to see the current
> canonical stub — that's the system working as designed, not a doc bug.

## Install both

```bash
claude mcp add ug   -- npx -y understanding-graph mcp
claude mcp add sema -- uvx --from semahash sema mcp
```

Verify:

```
claude mcp list
```

You should see both `ug` and `sema` listed as active.

## Pattern: anchor a graph node in a sema pattern

When an understanding-graph node describes a coordination decision, include the
sema pattern URI in its `understanding` or `why` text. This turns the node's
coordination primitive into a content-addressed reference that can never
drift:

```
graph_batch({
  commit_message: "Researcher: chose StateLock for auth session mutex",
  agent_name: "Researcher",
  operations: [{
    tool: "graph_add_concept",
    params: {
      trigger: "decision",
      title: "Session mutex via StateLock",
      understanding: "Use sema://StateLock#7859 for the session-level mutex. StateLock gives us a fail-closed lock with verified semantics.",
      why: "Records the shared primitive and the exact definition this decision depends on."
    }
  }]
})
```

Later, any agent reading this node can pass `StateLock#7859` to
`sema_handshake` to verify they share the same definition before acting on
the decision.

## Pattern: verify before committing to a decision

Before writing a `decision` node that depends on a shared concept, run a
handshake:

```
sema_handshake({ ref: "MechanisticDesignProposal#8cf7" })
```

If the verdict is `HALT`, do *not* write the decision node. Instead, write a
`tension` node documenting the mismatch, so other agents can see why the
decision was blocked:

```
graph_batch({
  commit_message: "Architect: HALTed on MechanisticDesignProposal — hash drift",
  agent_name: "Architect",
  operations: [{
    tool: "graph_add_concept",
    params: {
      trigger: "tension",
      title: "Disagreement on MechanisticDesignProposal definition",
      understanding: "The local sema hash a7f2 does not match canonical ad31. sema_handshake returned HALT, so the dependent design choice remains unresolved.",
      why: "Makes the semantic mismatch visible before another agent builds on it."
    }
  }]
})
```

The `tension` node is visible to every teammate via `graph_history()` and
`graph_find_by_trigger({ trigger: "tension" })`.

## Pattern: discover past uses of a sema pattern

If an agent wants to know how the team has used `StateLock` in the past,
`graph_semantic_search` can surface nodes in the current project that mention
the hash:

```
graph_semantic_search({ query: "StateLock#7859" })
```

This returns a ranked list of graph nodes—decisions, tensions, questions, and
other externalized understanding—all anchored to that specific, hash-verified
definition. Because sema hashes are content-addressed, you're guaranteed to
be reading history about the *same* `StateLock`, not a renamed or drifted
version. Search is project-scoped: switch projects and repeat the query, or use
explicit cross-project references, when you need to inspect another graph.

## Minimal two-agent coordination recipe

Two agents working on a shared design problem:

**Agent A (Architect)** — `CLAUDE.md`:

```markdown
1. Ask graph_suggest_next({ task, workflow: "collaborative_coding" }) at the first real choice point; choose or reject its routes according to the task.
2. Before posting a design that depends on MechanisticDesignProposal#8cf7, run sema_handshake.
3. If PROCEED, preserve the decision and its exact sema URI via graph_batch.
4. If HALT, preserve the unresolved tension rather than silently continuing.
```

**Agent B (Engineer)** — `CLAUDE.md`:

```markdown
1. Re-enter the relevant decision or update when it can change the implementation; do not replay a fixed orientation ritual.
2. For any decision that cites a sema URI, run sema_handshake before relying on it.
3. Only implement after PROCEED. Preserve a material mismatch as an ordinary `tension`, `evaluation`, or `decision` node—not as the reserved `thinking` type.
```

This recipe guarantees:

- The design trail is legible (episodic memory, via the graph).
- The definitions are stable (semantic memory, via sema).
- Drift causes an explicit HALT, not a silent failure.

## See also

- [Understanding Graph integrations](../integrations/) — per-client setup guides
- [Sema integrations](https://github.com/emergent-wisdom/sema/tree/main/integrations) — per-client setup guides
- [Sema docs: using-with-understanding-graph](https://github.com/emergent-wisdom/sema/blob/main/docs/using-with-understanding-graph.md) — the mirror walkthrough
