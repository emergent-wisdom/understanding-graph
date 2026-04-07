# Cross-Project Reading

**Read from any project without switching.** Some tools query SQLite directly and work across projects. Others require the in-memory graph and need `project_switch()` first.

## Tools That Work Cross-Project (SQLite queries)

These tools accept `project: "other-project"` and work without switching:

| Tool | Purpose | Example |
|------|---------|---------|
| `graph_list_external` | Browse all nodes | `graph_list_external({ project: "default", limit: 50 })` |
| `graph_lookup_external` | Get specific node | `graph_lookup_external({ project: "default", nodeId: "n_xxx" })` |
| `graph_find_by_trigger` | Find nodes by type | `graph_find_by_trigger({ trigger: "library", project: "default" })` |
| `graph_global_lookup` | Find node across ALL projects | `graph_global_lookup({ nodeId: "n_xxx" })` |
| `graph_resolve_references` | Follow reference chains | `graph_resolve_references({ nodeId: "n_xxx", depth: 2 })` |

## Tools That Require project_switch() (need loaded graph)

These tools use the in-memory graphology instance and only work on the current project:

| Tool | Why it needs loaded graph |
|------|---------------------------|
| `graph_semantic_search` | Requires embeddings in memory |
| `graph_centrality` | Requires full graph topology |
| `graph_similar` | Requires neighbor analysis |
| `graph_path` | Requires pathfinding on graph |
| `graph_analyze` | Requires structural analysis |

## Workflow: Cross-Referencing Knowledge

```
1. Stay in current project:           project_switch("my-project")
2. Find library sources in Home:      graph_find_by_trigger({ trigger: "library", project: "default" })
3. Look up specific paper:            graph_lookup_external({ project: "default", nodeId: "n_paper_id" })
4. Find node across all projects:     graph_global_lookup({ nodeId: "n_unknown" })
5. Resolve reference chains:          graph_resolve_references({ nodeId: "n_xxx", depth: 2 })
6. Create local concept:              graph_add_concept({ ... })
7. Link with cross-project ref:       graph_connect({ from: "n_local", to: "n_paper_id",
                                        references: [{ project: "default", nodeId: "n_paper_id" }] })
```

## Key Principles

- **SQLite tools**: Work anywhere, query any project directly
- **Graph tools**: Need `project_switch()` first (they use in-memory structures)
- **Reference, don't duplicate**: Link to Home concepts instead of copying them
- **Global lookup**: When you have a node ID but don't know which project it's in

## Home Project

The `default` project ("Home") is long-term memory - foundational concepts spanning multiple projects.

- `graph_list_external({ project: "default" })` - browse long-term memory
- `graph_lookup_external({ project: "default", nodeId })` - recall specific knowledge
