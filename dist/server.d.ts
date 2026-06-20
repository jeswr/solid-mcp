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
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type SolidMcpConfig } from "./auth.js";
/**
 * Build an {@link McpServer} for the pod described by `config`. The config is
 * validated eagerly (podRoot must be an absolute http(s) container URL) so a
 * misconfiguration fails fast rather than at first request.
 */
export declare function createSolidMcpServer(config: SolidMcpConfig): McpServer;
//# sourceMappingURL=server.d.ts.map