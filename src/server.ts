// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/**
 * createSolidMcpServer — build an MCP server that exposes a Solid pod.
 *
 * The pod is surfaced two ways:
 *  - **Resources**: pod URLs map 1:1 to MCP resource URIs (the resource uri IS the
 *    pod url). A `list` callback browses the pod root's children. The read callback
 *    returns a container listing as JSON, an RDF resource as Turtle, or any other
 *    resource as text / base64 bytes. Every read is pod-scope-guarded.
 *  - **Tools**: `solid_list`, `solid_read`, `solid_search`, `solid_write`. All are
 *    pod-scope-guarded and use the injected authenticated fetch. `solid_write`
 *    reflects the read-only default (returns `isError` when disabled, never throws
 *    out of the handler). Tool handlers catch errors → `{ isError: true, ... }`.
 */
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  normalizePodRoot,
  requirePodScopedUrl,
  type SolidMcpConfig,
  writesEnabled,
} from "./auth.js";
import {
  listContainer,
  RDF_MEDIA_TYPES,
  readRdf,
  readResource,
  search,
  writeResource,
} from "./pod.js";

/** A URL ending in `/` is an LDP container. */
function isContainerUrl(url: string): boolean {
  return url.endsWith("/");
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Build an {@link McpServer} for the pod described by `config`. The config is
 * validated eagerly (podRoot must be an absolute http(s) container URL) so a
 * misconfiguration fails fast rather than at first request.
 */
export function createSolidMcpServer(config: SolidMcpConfig): McpServer {
  // Eagerly validate + canonicalise the pod root (throws on a bad podRoot).
  const podRoot = normalizePodRoot(config.podRoot);
  const cfg: SolidMcpConfig = { ...config, podRoot };

  const server = new McpServer(
    { name: "@jeswr/solid-mcp", version: "0.1.0" },
    { capabilities: { resources: {}, tools: {} } },
  );

  // ---- Resources: a template mapping every pod URL to an MCP resource ----
  // The resource URI scheme mirrors the pod's http(s) URLs 1:1. We register a
  // wildcard template over the pod's scheme+host so any in-pod URL is addressable;
  // the `list` callback enumerates the pod root's immediate children so a client
  // can discover what's there.
  const rootUrl = new URL(podRoot);
  const template = new ResourceTemplate(`${rootUrl.protocol}//${rootUrl.host}/{+path}`, {
    list: async () => {
      const children = await listContainer(cfg, podRoot);
      return {
        resources: children.map((c) => ({
          uri: c.url,
          name: c.name,
          ...(c.mimeType ? { mimeType: c.mimeType } : {}),
        })),
      };
    },
  });

  server.registerResource(
    "solid-pod",
    template,
    {
      title: "Solid pod resource",
      description:
        "A resource in the Solid pod. Containers are returned as a JSON listing; RDF resources as Turtle; other resources as text or base64 bytes.",
    },
    async (uri: URL) => {
      const target = requirePodScopedUrl(cfg, uri.toString());
      if (isContainerUrl(target)) {
        const children = await listContainer(cfg, target);
        return {
          contents: [
            { uri: target, mimeType: "application/json", text: JSON.stringify(children, null, 2) },
          ],
        };
      }
      // Peek at the content-type via the bytes path; render RDF as Turtle.
      const bytes = await readResource(cfg, target);
      if (bytes.contentType && RDF_MEDIA_TYPES.has(bytes.contentType)) {
        const { turtle } = await readRdf(cfg, target);
        return { contents: [{ uri: target, mimeType: "text/turtle", text: turtle }] };
      }
      if (bytes.text !== undefined) {
        return {
          contents: [
            {
              uri: target,
              ...(bytes.contentType ? { mimeType: bytes.contentType } : {}),
              text: bytes.text,
            },
          ],
        };
      }
      return {
        contents: [
          {
            uri: target,
            mimeType: bytes.contentType ?? "application/octet-stream",
            blob: bytes.base64 ?? "",
          },
        ],
      };
    },
  );

  // ---- Tools ----
  server.registerTool(
    "solid_list",
    {
      title: "List a Solid container",
      description:
        "List the immediate children of a Solid LDP container (must be within the pod). Returns typed children (url, name, isContainer, type, mimeType, size, modified).",
      inputSchema: {
        container: z.string().describe("Absolute URL of the container (within the pod)."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ container }) => {
      try {
        const children = await listContainer(cfg, container);
        return { content: [{ type: "text" as const, text: JSON.stringify(children, null, 2) }] };
      } catch (e) {
        return { isError: true, content: [{ type: "text" as const, text: errorText(e) }] };
      }
    },
  );

  server.registerTool(
    "solid_read",
    {
      title: "Read a Solid resource",
      description:
        "Read a resource in the pod. RDF resources are returned as Turtle; other resources as text, or base64 for binary. Fails closed (401/403) if the resource is protected and no authenticated fetch was supplied.",
      inputSchema: { url: z.string().describe("Absolute URL of the resource (within the pod).") },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ url }) => {
      try {
        const target = requirePodScopedUrl(cfg, url);
        const bytes = await readResource(cfg, target);
        if (bytes.contentType && RDF_MEDIA_TYPES.has(bytes.contentType)) {
          const { turtle } = await readRdf(cfg, target);
          return { content: [{ type: "text" as const, text: turtle }] };
        }
        if (bytes.text !== undefined) {
          return { content: [{ type: "text" as const, text: bytes.text }] };
        }
        return {
          content: [
            {
              type: "text" as const,
              text: `[binary ${bytes.contentType ?? "application/octet-stream"}, base64]\n${bytes.base64 ?? ""}`,
            },
          ],
        };
      } catch (e) {
        return { isError: true, content: [{ type: "text" as const, text: errorText(e) }] };
      }
    },
  );

  server.registerTool(
    "solid_search",
    {
      title: "Search the Solid pod",
      description:
        "Client-side search across the pod (no server FTS): best-effort Type-Index discovery plus a bounded recursive container scan, matching the query against resource url/name and, for RDF resources, literal values. Returns ranked matches.",
      inputSchema: {
        query: z.string().describe("Case-insensitive search term."),
        scope: z
          .string()
          .optional()
          .describe("Optional container URL to restrict the search to (within the pod)."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ query, scope }) => {
      try {
        const matches = await search(cfg, query, scope ? { scope } : {});
        return { content: [{ type: "text" as const, text: JSON.stringify(matches, null, 2) }] };
      } catch (e) {
        return { isError: true, content: [{ type: "text" as const, text: errorText(e) }] };
      }
    },
  );

  server.registerTool(
    "solid_write",
    {
      title: "Write a Solid resource",
      description:
        "Write (PUT) a resource in the pod. DISABLED by default — the server is read-only unless created with readOnly:false. Pod-scope-guarded.",
      inputSchema: {
        url: z.string().describe("Absolute URL of the resource to write (within the pod)."),
        content: z.string().describe("The resource body to write."),
        contentType: z.string().describe("The Content-Type for the written resource."),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    async ({ url, content, contentType }) => {
      // Reflect the read-only default as an isError result rather than throwing.
      if (!writesEnabled(cfg)) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: "write disabled: server is read-only (set readOnly:false to enable writes).",
            },
          ],
        };
      }
      try {
        const result = await writeResource(cfg, url, content, contentType);
        return {
          content: [
            {
              type: "text" as const,
              text: `wrote ${result.url}${result.etag ? ` (etag ${result.etag})` : ""}`,
            },
          ],
        };
      } catch (e) {
        return { isError: true, content: [{ type: "text" as const, text: errorText(e) }] };
      }
    },
  );

  return server;
}
