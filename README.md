# @jeswr/solid-mcp

A [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server that
exposes a [Solid](https://solidproject.org) pod to MCP clients (Claude Desktop and
other MCP hosts) as **Resources** and **Tools**.

Pod URLs map 1:1 to MCP resources, and four pod-scope-guarded tools —
`solid_list`, `solid_read`, `solid_search`, `solid_write` — let an agent browse,
read, search, and (opt-in) write pod data over an **injectable authenticated Solid
fetch**. The server holds **no bespoke crypto**: you supply the authenticated
(Solid-OIDC / DPoP) `fetch`, so token handling stays in vetted upstream libraries.

> ⚠️ **Experimental, AI-agent-generated.** Part of the `@jeswr` Solid app suite.
> Read-only by default; review before granting write access to a real pod.

## What you get

- **Resources** — every in-pod URL is an MCP resource (the resource `uri` *is* the
  pod url). Containers are returned as a JSON listing, RDF resources as Turtle, and
  anything else as text or base64 bytes. A `list` callback browses the pod root.
- **Tools**
  | Tool | Args | Semantics |
  |---|---|---|
  | `solid_list` | `{ container }` | List a container's typed children (`url`, `name`, `isContainer`, `type`, `mimeType`, `size`, `modified`). `readOnlyHint`. |
  | `solid_read` | `{ url }` | Read a resource — Turtle for RDF, text or base64 otherwise. Fails closed (401/403). `readOnlyHint`. |
  | `solid_search` | `{ query, scope? }` | Client-side search: best-effort Type-Index discovery + a bounded recursive container scan, matching url/name and RDF literal values. No server FTS. `readOnlyHint`. |
  | `solid_write` | `{ url, content, contentType }` | PUT a resource. **Disabled unless `readOnly:false`.** `destructiveHint`. |

## Install

```sh
npm install github:jeswr/solid-mcp#main
```

The package commits a self-contained `dist/` (with `@jeswr/fetch-rdf` inlined via
esbuild), so it installs and imports directly from a GitHub branch under
`ignore-scripts=true` with **no build step**. npm publish is a deferred migration
(see [Roadmap](#roadmap-m2)).

## Auth model (the seam)

The server takes an **injectable authenticated `fetch`** and a `podRoot`:

```ts
import { createSolidMcpServer } from "@jeswr/solid-mcp";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = createSolidMcpServer({
  fetch: session.fetch, // an authenticated Solid-OIDC / DPoP fetch you provide
  podRoot: "https://alice.pod.example/",
  webId: "https://alice.pod.example/profile/card#me", // optional, enables Type-Index search
  readOnly: true, // DEFAULT — set false to enable solid_write
});

await server.connect(new StdioServerTransport());
```

`SolidMcpConfig`:

```ts
interface SolidMcpConfig {
  fetch: typeof fetch;   // authenticated Solid fetch (server holds no credentials)
  podRoot: string;       // absolute http(s) container URL ending in "/"
  webId?: string;        // optional, for Type-Index-driven search
  readOnly?: boolean;    // default true (writes disabled)
}
```

### Read-only by default; writes are opt-in

`solid_write` is **disabled** unless you create the server with `readOnly: false`.
When read-only, the tool returns an `isError` result (it never throws out of the
handler), so a client gets a clear "write disabled" message rather than a crash.

### Pod-scope / SSRF guard

Every Resource read and every Tool call is confined to `podRoot`. A URL is rejected
(with a `pod-scope violation` error) unless its canonical form is *within* the pod
root — this is the SSRF / capability boundary that stops an agent from using a tool
to reach an arbitrary origin or to escape the pod root via `..` path traversal
(URLs are normalised via `new URL()` before the strict prefix check, so encoded and
dot-segment escapes are resolved away first).

### CLI (M1)

The `solid-mcp` bin reads configuration from the environment and connects over
stdio:

| Env var | Required | Notes |
|---|---|---|
| `SOLID_MCP_POD_ROOT` | yes | absolute http(s) container URL ending in `/` |
| `SOLID_MCP_WEBID` | no | enables Type-Index search |
| `SOLID_MCP_READONLY` | no | default `"true"`; set `"false"` to enable writes |
| `SOLID_MCP_CLIENT_ID` / `_SECRET` / `_OIDC_ISSUER` / `_TOKEN_URL` | no | reserved for M2 |

**M1 auth scope:** a bundled headless client-credentials login is **not** part of
M1. If the client-credentials env vars are present, the CLI prints a clear message
and falls back to an **unauthenticated** `globalThis.fetch` (works for public
resources; protected resources fail closed). For an authenticated session today,
import `createSolidMcpServer` programmatically and pass your own authenticated
`fetch`. Bundled headless login is a [Roadmap (M2)](#roadmap-m2) item.

#### Claude Desktop config

Add to `claude_desktop_config.json` (`mcpServers`):

```jsonc
{
  "mcpServers": {
    "solid": {
      "command": "npx",
      "args": ["solid-mcp"],
      "env": {
        "SOLID_MCP_POD_ROOT": "https://alice.pod.example/",
        "SOLID_MCP_WEBID": "https://alice.pod.example/profile/card#me",
        "SOLID_MCP_READONLY": "true"
      }
    }
  }
}
```

## RDF discipline

The package parses RDF only via [`@jeswr/fetch-rdf`](https://github.com/jeswr/fetch-rdf)
+ [`@solid/object`](https://www.npmjs.com/package/@solid/object) (container
listings via `ContainerDataset`), and serialises with `n3.Writer`. It **never**
hand-builds or hand-parses RDF.

## Anti-silo / typed data

Typed pod data is read through the suite's shared RDF shapes (Activity Streams 2.0,
schema.org, [`@jeswr/solid-task-model`](https://github.com/jeswr/solid-task-model),
…), so an agent reads the **same shapes the suite apps write** — a task created in
solid-issues, a contact in the Pod Manager, a bookmark in a pod-app are all the same
graph. This is the integration-targets contract: agent access and app access share
one data model rather than per-app silos.

## Public API

```ts
import {
  createSolidMcpServer,
  type SolidMcpConfig,
  // pod operations (programmatic / testing):
  listContainer, readResource, readRdf, search, writeResource,
  // auth helpers + scope guard:
  normalizePodRoot, requirePodScopedUrl, podScopedUrlOrUndefined, writesEnabled,
  // types:
  type PodChild, type ReadResult, type ReadRdfResult, type SearchMatch, type SearchOptions,
} from "@jeswr/solid-mcp";
```

The authoritative, diffable snapshot of the whole public surface lives in
[`etc/solid-mcp.api.md`](./etc/solid-mcp.api.md) (generated by
[API Extractor](https://api-extractor.com/)). `npm run api:check` fails on any
drift and runs in CI; after an intended API change, regenerate + commit the
report with `npm run api:report`.

## Roadmap (M2)

- **Streamable-HTTP transport** (in addition to stdio).
- **Per-platform client configs** (Cline, Open WebUI, LibreChat MCP server,
  OpenClaw, …).
- **Bundled headless client-credentials login** so the CLI can run authenticated
  without a programmatic embed.
- **Deeper typed-data tools** (task / contact / bookmark / calendar shape-aware
  read + write) over `@jeswr/solid-task-model` and the suite shapes.

## License

MIT © [Jesse Wright](https://github.com/jeswr)
