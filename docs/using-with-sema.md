# Using Understanding Graph with Sema

Understanding Graph and [sema](https://github.com/emergent-wisdom/sema) cover
two different axes of shared memory for AI agents. They compose cleanly, and
most teams benefit from running both.

| Layer | Tool | Answers |
|---|---|---|
| Episodic memory | Understanding Graph | *What happened? Why did we choose this?* |
| Semantic memory | Sema | *What does this word actually mean, byte-for-byte?* |

Episodic without semantic: agents accumulate reasoning traces but drift on
the meaning of the words they use. Semantic without episodic: agents agree
on definitions but have no history to build on. Together, they form a
reasoning commons that survives across sessions and across agents.

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

When an understanding-graph node describes a coordination decision, pin the
sema pattern hash inside the `mechanism` field. This turns the node's
coordination primitive into a content-addressed reference that can never
drift:

```
graph_batch({
  commit_message: "Researcher: chose StateLock for auth session mutex",
  operations: [{
    op: "add_concept",
    trigger: "decision",
    title: "Session mutex via StateLock",
    mechanism: "Use sema://StateLock#7859 for session-level mutex.",
    explanation: "StateLock gives us a fail-closed lock with known semantics; we verified the hash via sema_handshake before committing."
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
  operations: [{
    op: "add_concept",
    trigger: "tension",
    title: "Disagreement on MechanisticDesignProposal definition",
    mechanism: "Local hash a7f2 does not match canonical ad31.",
    explanation: "sema_handshake returned HALT. Pausing design work until the definition is reconciled."
  }]
})
```

The `tension` node is visible to every teammate via `graph_history()` and
`graph_find_by_trigger({ trigger: "tension" })`.

## Pattern: discover past uses of a sema pattern

If an agent wants to know how the team has used `StateLock` in the past,
`graph_semantic_search` will surface every node that mentions the hash:

```
graph_semantic_search({ query: "StateLock#7859" })
```

This returns a ranked list of graph nodes — decisions, tensions, questions,
and thinking traces — all anchored to that specific, hash-verified
definition. Because sema hashes are content-addressed, you're guaranteed to
be reading history about the *same* `StateLock`, not a renamed or drifted
version.

## Minimal two-agent coordination recipe

Two agents working on a shared design problem:

**Agent A (Architect)** — `CLAUDE.md`:

```markdown
1. graph_skeleton() to orient.
2. Before posting a design, sema_handshake on MechanisticDesignProposal#8cf7.
3. If PROCEED, write a `decision` node via graph_batch, citing the hash.
4. If HALT, write a `tension` node and stop.
```

**Agent B (Engineer)** — `CLAUDE.md`:

```markdown
1. graph_history() to see what the Architect posted.
2. For any `decision` node that cites a sema hash, run sema_handshake first.
3. Only implement after PROCEED. Log the handshake result as a `thinking`
   node.
```

This recipe guarantees:

- The design trail is legible (episodic memory, via the graph).
- The definitions are stable (semantic memory, via sema).
- Drift causes an explicit HALT, not a silent failure.

## See also

- [Understanding Graph integrations](../integrations/) — per-client setup guides
- [Sema integrations](https://github.com/emergent-wisdom/sema/tree/main/integrations) — per-client setup guides
- [Sema docs: using-with-understanding-graph](https://github.com/emergent-wisdom/sema/blob/main/docs/using-with-understanding-graph.md) — the mirror walkthrough
