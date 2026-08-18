# @emergent-wisdom/understanding-graph-web-server

The local REST and static-file server used by
[Understanding Graph](https://github.com/emergent-wisdom/understanding-graph).
It serves the bundled visualization and read-only graph APIs. Graph content
mutations are intentionally routed through the MCP server so they receive the
same atomic commits, validation, and workflow boundaries as other agents.

Most users should install the root package:

```bash
npm install -g understanding-graph
understanding-graph start
```

The server is also available as a workspace package for programmatic or local
development use. Set `PROJECT_DIR` to choose the project-store directory and
`PORT` to change the local port.

For independent workers, run one process per absolute storage root and port:

```bash
PORT=3101 PROJECT_DIR=/srv/undergraph/worker-1 understanding-graph start
PORT=3102 PROJECT_DIR=/srv/undergraph/worker-2 understanding-graph start
```

The processes may share the same installation and parent storage volume, but
must not share the same `PROJECT_DIR`. The default bind address is loopback. A
non-loopback `HOST` additionally requires `UG_WORKER_TOKEN`; trusted callers
must send `Authorization: Bearer <UG_WORKER_TOKEN>` on every `/api` or `/admin`
request. Use TLS or a private authenticated network between machines.

## License

MIT — see [LICENSE](LICENSE).
