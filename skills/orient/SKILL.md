---
name: orient
description: |
  Orient at the start of every conversation by reading the understanding graph.
  Use when beginning a new session or switching context.
user-invocable: true
allowed-tools: |
  mcp__ug__graph_skeleton
  mcp__ug__graph_history
  mcp__ug__graph_semantic_search
  mcp__ug__graph_find_by_trigger
  mcp__ug__graph_context
  mcp__ug__graph_context_region
  mcp__ug__project_list
  mcp__ug__project_switch
  mcp__ug__graph_score
  Bash(lsof -ti:3030 *)
  Bash(npx -y understanding-graph start *)
  Bash(mkdir -p *)
---

# Orient

You have an MCP server: **understanding-graph** (`ug`). It gives you persistent memory across conversations.

## Understanding, not knowledge

You don't build a knowledge graph (a pile of facts). You build an **understanding graph** — a living map of comprehension.

| Paradigm | What it stores | The action |
|----------|---------------|------------|
| Extraction | Facts & entities | "What did they say?" |
| Indexing | Document chunks | "Where is it written?" |
| **Understanding** | **Tensions & synthesis** | **"What does it mean?"** |

The graph is metabolic, not crystalline. It stores shifts in belief rather than frozen facts. When you change your mind, you don't delete — you *supersede*, linking old belief to new insight to show how understanding evolved.

When you read the graph in a new conversation, you're not retrieving data. You're **re-synchronizing with a rhythm of thought** — inhabiting the mind of your past self to continue the thinking process.

## The conversation is working memory. The graph is long-term memory.

## Projects: separate work from autobiography

`default` is your long-term autobiography — it persists across all conversations and accumulates your evolving understanding over time.

When the user starts a **substantive task** (building something, researching a topic, analyzing a problem), create a dedicated project:

```
project_create({ name: "city-optimizer", description: "Genetic algorithm for city layout" })
project_switch({ project: "city-optimizer" })
```

Do all work in the task project. When done, switch back to `default` and plant one `reference` node pointing at the task project — a breadcrumb for future-you.

**When to create a new project:** The task has a clear scope, will produce multiple nodes, and isn't just a quick question. "Build a city optimizer" = new project. "What's a bloom filter?" = stays in default.

**During orientation:** Check `project_list()` to see existing projects. If the user's request matches an existing project, switch to it instead of creating a new one.

## Orientation protocol

1. **Ask if the user wants the graph UI** — if yes, launch it with `/understanding-graph:web-ui`

2. **Read the graph state:**

```
graph_skeleton()                        # shape of your memory
graph_history({ limit: 5 })             # recent commits
graph_semantic_search({ query: "..." }) # prior thinking on the topic
```

If a similar node exists, **extend it** — don't duplicate.

3. **Check quality:**
```
graph_score()                           # structural quality, target 70+
```

4. **Orient the user:** Summarize what the graph contains, what's been explored, what questions remain open.

5. **Flag maintenance needs:** If the graph has disconnected clusters, stale open questions, or low trigger/edge diversity — tell the user. Ask them to stop and think about the graph before diving into new work.

## During work: periodic check-ins

Don't just orient at the start. Periodically (every few substantial batches):
- Check `graph_analyze` for disconnected clusters that need bridging
- Check `graph_find_by_trigger` for trigger diversity — if you're only creating `foundation` and `decision`, you're probably missing `question`, `tension`, `prediction`, `consequence`
- Check edge diversity — if most edges are `relates`, the graph is shallow
- **Ask the user**: "Want to pause and look at the graph? There are things to connect / questions to revisit / beliefs to update."
