# Graph Vision

**CRITICAL: Call tools ONE AT A TIME. Wait for each response before calling the next.**
Do NOT call multiple vision tools in parallel - this overwhelms the system.

To truly SEE the graph, you need multiple tools working together:

## 1. SKELETON - The Big Picture

```
graph_skeleton()
```

Returns the overall structure: regions, node counts, density. Use this to:
- Orient yourself when starting
- See what areas have been developed
- Spot imbalances (too much in one area, nothing in another)

## 2. FIND BY TYPE - What Exists?

```
graph_find_by_trigger({ trigger: "thinking" })
graph_find_by_trigger({ trigger: "tension" })
graph_find_by_trigger({ trigger: "question" })
```

Find all nodes of a specific type. Use this to:
- Count how many thinking nodes exist
- Find unresolved questions
- See what tensions have been identified

## 3. SEMANTIC SEARCH - Find by Meaning

```
graph_semantic_search({ query: "transformation identity" })
```

Find concepts related to a meaning. Use this to:
- Check if a concept already exists before creating
- Find related ideas to connect to
- Discover unexpected connections

## 4. CONTEXT - Zoom Into a Node

```
graph_context({ nodeId: "n_abc123" })
```

See a node and its immediate neighbors. Use this to:
- Understand what a node connects to
- See the local structure around an idea
- Trace edges to understand relationships

## 5. TIME TRAVEL - The 4th Dimension

The graph has three spatial dimensions (structure, type, meaning) and a **fourth: Time/Intent**.

When you call `graph_context`, each node includes an `<origin_story>`:

```xml
<node id="n_abc123" trigger="tension" ...>
  <title>The calm feels forced</title>
  <understanding>...</understanding>
  <origin_story agent="Skeptic" time="2024-01-15T14:32:00Z">
    Something doesn't add up here - the protagonist's calm feels forced,
    almost rehearsed. I'm flagging this because it contradicts the panic
    from n_xyz789 just three pages earlier.
  </origin_story>
</node>
```

**What is it?** The commit message written by the agent who created this node - their inner monologue at the moment of creation.

**Why does it matter?**
- **Intent Recovery**: "What was the agent thinking when they wrote this?"
- **Debate Context**: Understanding *why* someone disagreed, not just that they did
- **Time Correlation**: See what page/position triggered this thought

**Use it for Time Travel:**
1. Find a content node at a specific position (e.g., page 50)
2. Read its `<origin_story>` to see what agents were thinking at that point
3. Follow edges to see how that thinking evolved

**You are not just seeing the graph's structure - you're seeing its *history of thought*.**

## Vision Workflow (SEQUENTIAL - one at a time!)

**Start with skeleton, then go deeper ONLY if needed:**
1. `graph_skeleton()` - Usually sufficient! See overall shape first.
2. ONLY IF you need more detail, call ONE more tool based on what you learned.

**Don't call all tools "just in case" - be efficient.**
