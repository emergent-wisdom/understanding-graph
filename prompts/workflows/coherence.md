# Coherence Maintenance

Deploy when the graph needs consolidation:

1. `graph_skeleton()` -> shape of understanding
2. `graph_history({ limit: 50 })` -> recent evolution
3. `graph_analyze({ include: ["gaps", "bridges", "questions"] })` -> issues

## Maintenance Actions

- Supersede stale nodes (don't delete)
- Connect orphans to existing knowledge
- Update documents to reflect current understanding
- Add tension edges where beliefs conflict

**Rule:** Don't add new ideas. Only clarify existing ones.
