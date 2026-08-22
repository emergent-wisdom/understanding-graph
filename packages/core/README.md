# @emergent-wisdom/understanding-graph-core

Core storage, graph, context, and document-generation services for
[Understanding Graph](https://github.com/emergent-wisdom/understanding-graph).
Most users should install the root `understanding-graph` package or the MCP
server instead; this package is the programmatic foundation used by those
packages.

## Install

```bash
npm install @emergent-wisdom/understanding-graph-core
```

## Main exports

- `sqlite`: initialize and query the per-project SQLite stores.
- `GraphStore` / `getGraphStore`: create, connect, revise, and inspect graph
  nodes and document trees.
- `ContextService`: render skeleton, history, neighborhood, and region context.
- `DocumentWriter` / `createDocumentWriter`: project document trees into
  Markdown, code, text, and LaTeX files.
- `EmbeddingService`: optional local semantic-search helpers.
- Shared graph, node, edge, trigger, commit, and source types.

The optional `@huggingface/transformers` peer dependency is only needed for
embedding-based features. The SQLite graph and non-embedding APIs work without
it.

## License

MIT — see [LICENSE](LICENSE).
