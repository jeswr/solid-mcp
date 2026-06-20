// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/**
 * `solid-mcp` CLI — the stdio-transport entry point (M1).
 *
 * Reads configuration from the environment:
 *   - SOLID_MCP_POD_ROOT   (REQUIRED) absolute http(s) container URL ending in '/'
 *   - SOLID_MCP_WEBID      (optional) the owner WebID, enabling Type-Index search
 *   - SOLID_MCP_READONLY   (default "true"; set "false" to enable writes)
 *   - SOLID_MCP_CLIENT_ID / SOLID_MCP_CLIENT_SECRET / SOLID_MCP_OIDC_ISSUER /
 *     SOLID_MCP_TOKEN_URL  (optional) headless client-credentials login inputs.
 *
 * AUTH (M1 scope): the server holds NO bespoke crypto. A headless
 * client-credentials login is NOT bundled in M1 — if those env vars are present we
 * print a clear message and fall back to an UNAUTHENTICATED `globalThis.fetch`
 * (works for public resources; protected resources fail-closed). To use an
 * authenticated session, import `createSolidMcpServer` programmatically and pass
 * your own authenticated `fetch`.
 *
 * This file stays thin — all testable logic lives in server.ts / pod.ts / auth.ts.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { SolidMcpConfig } from "./auth.js";
import { createSolidMcpServer } from "./server.js";

/** Resolve the auth fetch for the CLI. M1: unauthenticated fallback only. */
function resolveCliFetch(): typeof fetch {
  const hasCreds =
    !!process.env.SOLID_MCP_CLIENT_ID &&
    !!process.env.SOLID_MCP_CLIENT_SECRET &&
    (!!process.env.SOLID_MCP_OIDC_ISSUER || !!process.env.SOLID_MCP_TOKEN_URL);
  if (hasCreds) {
    process.stderr.write(
      "[solid-mcp] headless client-credentials login is not bundled in M1. " +
        "Pass an authenticated fetch programmatically via createSolidMcpServer, " +
        "or run unauthenticated for public resources. Falling back to an " +
        "unauthenticated fetch (protected resources will fail closed).\n",
    );
  }
  return globalThis.fetch;
}

async function main(): Promise<void> {
  const podRoot = process.env.SOLID_MCP_POD_ROOT;
  if (!podRoot) {
    process.stderr.write(
      "[solid-mcp] SOLID_MCP_POD_ROOT is required (an absolute http(s) container URL ending in '/').\n",
    );
    process.exit(1);
    return;
  }

  const readOnly = (process.env.SOLID_MCP_READONLY ?? "true").toLowerCase() !== "false";

  const config: SolidMcpConfig = {
    fetch: resolveCliFetch(),
    podRoot,
    readOnly,
  };
  const webId = process.env.SOLID_MCP_WEBID;
  if (webId) config.webId = webId;

  // createSolidMcpServer validates podRoot eagerly — surface a bad value clearly.
  let server: ReturnType<typeof createSolidMcpServer>;
  try {
    server = createSolidMcpServer(config);
  } catch (e) {
    process.stderr.write(
      `[solid-mcp] configuration error: ${e instanceof Error ? e.message : e}\n`,
    );
    process.exit(1);
    return;
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(
    `[solid-mcp] connected (stdio). pod=${podRoot} readOnly=${readOnly}${webId ? ` webId=${webId}` : ""}\n`,
  );
}

main().catch((e) => {
  process.stderr.write(`[solid-mcp] fatal: ${e instanceof Error ? (e.stack ?? e.message) : e}\n`);
  process.exit(1);
});
