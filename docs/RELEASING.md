# Releasing Understanding Graph

This repository publishes four npm packages plus one MCP Registry record. A
release is complete only when the exact source commit, packages, registry
metadata, paper PDF, and archive agree.

## 1. Freeze the candidate

- Work from a clean commit on Node 22 or 24.
- Confirm the root, Core, MCP, Web, plugin, `.mcp.json`, and `server.json`
  versions are synchronized by the instruction-contract test.
- Keep the paper and case studies in the release commit. Do not include
  `paper/tmp/` or local project databases.
- Push the candidate and require a green Node 22/24 GitHub Actions run before
  publishing. A local green run is necessary but not sufficient.

## 2. Verify behavior and artifacts

```bash
npm ci
npm run lint
npm run build
npm run typecheck
npm test
npm run smoke:mcp
npm run smoke:web-discovery
npm audit --omit=dev
```

Build `paper/understanding_graph.pdf` from the tracked TeX source, inspect every
rendered page, and reject overfull boxes, clipped text, stale dates, or broken
references. Verify the current protocol is described as fluid guidance rather
than a mandatory state machine.

Run `npm pack --dry-run --json` for Core, MCP, Web, and root. Then create the
real tarballs, install all four together into an empty temporary project, and
verify:

- `understanding-graph --version` reports the candidate root version;
- `understanding-graph mcp` completes an MCP initialize handshake;
- the default catalog is the safe `general` surface;
- the packed frontend references files present in the tarball; and
- no tests, local databases, paper build directories, or unrelated artifacts
  are packed.

## 3. Publish from the release tag

Each npm package must trust the GitHub Actions workflow `publish.yml` for the
`emergent-wisdom/understanding-graph` repository with `npm publish` permission.
The workflow uses short-lived OIDC credentials; do not add an npm token to the
repository.

After the candidate is green and all four version numbers are still unused,
create and push the annotated tag `v<root-version>` at the reviewed commit. The
tag starts the trusted workflow, which publishes and verifies each package in
dependency order:

1. `@emergent-wisdom/understanding-graph-core`
2. `@emergent-wisdom/understanding-graph-mcp-server`
3. `@emergent-wisdom/understanding-graph-web-server`
4. `understanding-graph`

The scoped packages declare public access in their manifests. The workflow
waits for each exact internal dependency version to become visible before it
advances. A normal merge never publishes; only a matching version tag does.

Install the public root package from an empty npm cache and repeat the CLI/MCP
smoke. Test `init` in a fresh directory and in a simulated 0.1.27 directory;
Claude must receive a project `.mcp.json`, Codex a project
`.codex/config.toml`, and user-authored configuration/instructions must survive.

## 4. Finish the immutable release

- Verify npm `gitHead`, provenance, and the tag point to the reviewed commit.
- Publish `server.json` with `mcp-publisher` only after npm propagation, then
  verify the MCP Registry reports the same version and current description.
- Deposit the PDF, source, and release archive as a new Zenodo version. The
  concept DOI identifies the series; record the version-specific DOI, tag,
  commit, package versions, and artifact hashes in the release notes.

## 5. Downstream release order

Undergraph must pin and deploy this verified Understanding Graph version before
its cloud bridge is announced. Publish and verify the separate `undergraph`
bridge only after the hosted MCP gateway passes graph-scoping, privacy, and
write-attribution smoke tests against the staged sidecar.

Do not describe the same-host worker pool as horizontal autoscaling. Do not
claim improved understanding, writing, coding, or alignment without the
controlled evaluations specified in the paper.
