# Contributing to Understanding Graph

Early-stage project. Contributions welcome — here's how to get started.

## Local development

```bash
git clone https://github.com/emergent-wisdom/understanding-graph.git
cd understanding-graph
npm install
npm run build
```

Run the MCP server locally:

```bash
npm run start:mcp
```

Run the web UI with hot reload:

```bash
npm run dev
# http://localhost:3030
```

Run checks:

```bash
npm run lint
npm run typecheck
npm test
```

## Project structure

```
packages/
  core/         Graph store, services, types (shared library)
  mcp-server/   MCP tool server (stdio)
  web-server/   Express API + serves frontend
  frontend/     React + Three.js graph visualization
skills/         Claude Code plugin skills (SKILL.md files)
```

## What to work on

**Good first contributions:**

- New skills in `skills/` — a skill is a single `SKILL.md` file that teaches Claude Code a workflow. Look at existing skills for the format.
- Bug reports with reproduction steps
- Improvements to existing skills based on real usage

**Bigger contributions:**

- New MCP tools in `packages/mcp-server/src/tools/`
- Graph store improvements in `packages/core/`
- Frontend visualization features

## Submitting changes

1. Fork the repo and create a branch
2. Make your changes
3. Run `npm run lint && npm run typecheck && npm test`
4. Open a PR — describe what you changed and why

Keep PRs focused. One skill per PR, one feature per PR.
