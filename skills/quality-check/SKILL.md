---
name: quality-check
description: |
  Graph quality assessment: graph_score, graph_analyze, thermostat.
  Use to check structural health, find disconnected clusters, and decide
  whether to diverge or converge. Also prompts the user to stop and think.
user-invocable: true
allowed-tools: |
  mcp__ug__graph_score
  mcp__ug__graph_analyze
  mcp__ug__graph_thermostat
  mcp__ug__graph_centrality
  mcp__ug__graph_find_by_trigger
  mcp__ug__graph_semantic_gaps
  mcp__ug__graph_skeleton
---

# Quality Check

## The real problem: disconnected clusters

Individual orphan nodes are prevented by `graph_batch` (every node must connect). But the graph can still fragment into **islands** — clusters of well-connected nodes that don't talk to each other. Three regions about different aspects of the same project with no bridges between them means the understanding is siloed.

Use `graph_analyze({ include: ["gaps", "bridges"] })` to detect this. When you find disconnected clusters:
1. Identify what the clusters are *about*
2. Ask: what's the conceptual bridge? A shared principle, a tension, a consequence?
3. Create bridging concept nodes with edges into both clusters

## Ask the user to stop and think

**Periodically prompt the user to pause and maintain the graph.** Don't just run quality checks silently — surface what you find and ask the user to participate:

- "The graph has 3 clusters that aren't connected — want to think about how they relate?"
- "There are 5 open questions from earlier. Any of these resolved by what we've done since?"
- "You haven't revised any beliefs in a while — has anything shifted?"
- "The graph is getting dense in one area but sparse in another — should we explore the gap?"

Graph maintenance is a collaborative act, not just a background process.

## Quality signals

- `graph_thermostat` — DIVERGE (explore) or CONVERGE (synthesize)
- `graph_score` — structural quality, target 70+
- `graph_analyze` — gaps, bridges, open questions, conflicts

## Cybernetic sense-making

```javascript
graph_analyze({ include: ["gaps", "bridges", "questions", "conflicts"] })
```

| Signal | What it means | The fix |
|--------|---------------|---------|
| Disconnected clusters | Understanding is siloed | **Bridge** — find shared concepts across clusters |
| Many `openQuestions` | You know what you don't know | **Explore** — answer questions, or ask the user |
| High `density` | Tight mental model | **Disrupt** — inject serendipity |
| Contradictions | Cognitive dissonance | **Resolve** — create synthesis |
| Low `supersessionCount` | Nobody changed their mind | **Revisit** — have beliefs actually shifted? |

## Thermostat

`graph_thermostat({ mode })`:

- **DIVERGE** — explore, generate variety, tolerate contradiction
- **CONVERGE** — synthesize, resolve tensions, commit to positions

## Coherence workflow

Deploy when the graph needs consolidation:
- Bridge disconnected clusters
- Supersede stale nodes
- Resolve or reaffirm open questions
- Add tension edges where conflicts exist
- **Don't add new ideas** — only clarify existing structure
