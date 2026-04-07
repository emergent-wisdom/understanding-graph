# References and Citations

Use `reference` nodes to cite external sources or cross-project content.

## Cross-Project Reference

```javascript
graph_batch({
  operations: [
    { tool: "graph_add_concept", params: {
        title: "EAT Framework",
        trigger: "reference",
        understanding: "Epistemic-Affective Topology for character psychology",
        why: "Citing foundational theory from narrative-engine project",
        references: [{ project: "narrative-engine", nodeId: "n_eat_paper" }]
    }}
  ]
})
```

## External URL Reference

```javascript
graph_batch({
  operations: [
    { tool: "graph_add_concept", params: {
        title: "Attention Is All You Need",
        trigger: "reference",
        understanding: "The transformer architecture paper (Vaswani et al. 2017)",
        why: "Foundational reference for attention mechanisms",
        references: [{ url: "https://arxiv.org/abs/1706.03762" }]
    }}
  ]
})
```

## Bibliography (Library Node)

Group references under a `library` node:

```javascript
graph_batch({
  operations: [
    { tool: "graph_add_concept", params: {
        title: "References",
        trigger: "library",
        understanding: "Bibliography for this paper",
        why: "Collecting all citations"
    }},
    { tool: "graph_connect", params: {
        from: "$0.id", to: "n_ref_1", type: "contains"
    }},
    { tool: "graph_connect", params: {
        from: "$0.id", to: "n_ref_2", type: "contains"
    }}
  ]
})
```
