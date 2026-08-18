# Understanding Graph viewer

This private workspace package builds the read-only viewer bundled with the
root `understanding-graph` package. It provides a 3D view of a project's nodes
and edges together with search, commit history, node and edge details,
documents, timeline controls, and graph statistics.

The viewer does not create or mutate graph content. Those operations belong to
the MCP server so they retain validation, commits, and workflow boundaries. The
local web server supplies the viewer's read APIs and serves the production
bundle from `dist/`.

## Development

Install dependencies from the repository root, then run the API and Vite dev
server in separate terminals:

```bash
npm install
npm run dev:web
```

```bash
npm run dev -w @understanding-graph/frontend
```

Vite serves the viewer at `http://localhost:5173` and proxies `/api` requests to
the web server at `http://localhost:3000`.

Useful package commands:

```bash
npm run build -w @understanding-graph/frontend
npm run lint -w @understanding-graph/frontend
npm run preview -w @understanding-graph/frontend
```

`preview` serves only the built frontend. A compatible same-origin API or proxy
is still required. To build and run the complete local product instead, use:

```bash
npm run build
npm run start:web
```

## API contract

The viewer expects JSON APIs under the same-origin `/api` prefix. The canonical
implementation is `packages/web-server`. Its principal dependencies are:

- project listing, current-project lookup, and project loading;
- graph, node, edge, commit, and conversation reads;
- document roots, document navigation, rendered content, and PDFs;
- semantic search and database statistics; and
- compact or full graph context for the copy action.

Responses must use the shapes consumed in `src/hooks/useApi.ts`. The frontend
normalizes snake_case responses where documented there. Graph writes must not
be exposed through this viewer; the bundled web server blocks REST mutations
unless explicitly enabled for deliberate local testing.

## Display-only builds

For a public snapshot backed by prebaked JSON or another immutable API adapter,
build with:

```bash
VITE_DISPLAY_ONLY=true npm run build -w @understanding-graph/frontend
```

This build-time flag disables periodic polling and treats fetched data as
stable. It does not provide data, authentication, or a security boundary, and
it does not remove the viewer's initial API requests. A deployment must still
serve the expected `/api` responses and enforce its own access policy.

## Current limitations

- The interface is desktop-first. Narrow and mobile layouts do not expose the
  complete project, search, details, and timeline experience.
- The graph requires WebGL and `ResizeObserver`; there is no non-visual graph
  equivalent yet.
- Semantic search depends on server-side embedding support and coverage.
- API connection failures have limited in-app recovery guidance.
- The frontend has no built-in authentication or multi-user authorization.
