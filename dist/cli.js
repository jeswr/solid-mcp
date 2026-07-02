#!/usr/bin/env node

// src/cli.ts
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

// src/server.ts
import { isContainerUrl as isContainerUrl2 } from "@jeswr/guarded-fetch";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

// src/auth.ts
import {
  assertWithinPodScope,
  createPodScopedFetch,
  PodScopeError,
  podScopedUrl
} from "@jeswr/guarded-fetch";
function normalizePodRoot(podRoot) {
  if (typeof podRoot !== "string" || podRoot.length === 0) {
    throw new Error("podRoot is required (an absolute http(s) URL ending in '/').");
  }
  let parsed;
  try {
    parsed = new URL(podRoot);
  } catch {
    throw new Error(
      `podRoot must be an absolute http(s) URL ending in '/', got: ${JSON.stringify(podRoot)}`
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`podRoot must use http(s), got protocol: ${parsed.protocol}`);
  }
  if (!parsed.pathname.endsWith("/")) {
    throw new Error(`podRoot must end in '/' (a container URL), got: ${podRoot}`);
  }
  return parsed.toString();
}
function requirePodScopedUrl(config, url) {
  return scopeOrThrow(config.podRoot, url, { allowRoot: true });
}
function requirePodScopedWriteUrl(config, url) {
  return scopeOrThrow(config.podRoot, url, { allowRoot: false });
}
function scopeOrThrow(podRoot, url, options) {
  const root = normalizePodRoot(podRoot);
  try {
    return assertWithinPodScope(root, url, options);
  } catch (err) {
    throw new Error(
      `pod-scope violation: ${err instanceof PodScopeError ? err.message : String(err)}`
    );
  }
}
function podScopedUrlOrUndefined(config, url) {
  const root = normalizePodRoot(config.podRoot);
  return podScopedUrl(root, url);
}
var MAX_REDIRECT_HOPS = 10;
function scopedFetch(config) {
  const root = normalizePodRoot(config.podRoot);
  const scoped = createPodScopedFetch(root, {
    fetch: config.fetch,
    maxRedirects: MAX_REDIRECT_HOPS
  });
  const wrapped = async (input, init) => {
    try {
      return await scoped(input, init);
    } catch (err) {
      if (err instanceof PodScopeError) {
        throw new Error(
          `pod-scope violation: redirected outside the configured pod root ${root} (redirect-based SSRF guard) \u2014 ${err.message}`
        );
      }
      throw err;
    }
  };
  return wrapped;
}
function writesEnabled(config) {
  return config.readOnly === false;
}

// node_modules/@jeswr/fetch-rdf/dist/parse.js
import contentType from "content-type";
import { Store, StreamParser } from "n3";
import { JsonLdParser } from "jsonld-streaming-parser";

// node_modules/@jeswr/fetch-rdf/dist/errors.js
var RdfFetchError = class extends Error {
  /** The original cause, if any (e.g. a network error or parser exception). */
  cause;
  /** HTTP status code from a non-2xx response, if applicable. */
  status;
  /** The final request URL (after redirects), if known. */
  url;
  /** Raw `Content-Type` header from the response, if known. */
  contentType;
  constructor(message, options = {}) {
    super(message);
    this.name = "RdfFetchError";
    if (options.cause !== void 0)
      this.cause = options.cause;
    if (options.status !== void 0)
      this.status = options.status;
    if (options.url !== void 0)
      this.url = options.url;
    if (options.contentType !== void 0)
      this.contentType = options.contentType;
  }
};

// node_modules/@jeswr/fetch-rdf/dist/parse.js
var SUPPORTED_RDF_MEDIA_TYPES = [
  "text/turtle",
  "application/n-triples",
  "application/n-quads",
  "application/trig",
  "application/ld+json"
];
var N3_FAMILY = /* @__PURE__ */ new Set([
  "text/turtle",
  "application/n-triples",
  "application/n-quads",
  "application/trig"
]);
var JSON_LD_FAMILY = /* @__PURE__ */ new Set([
  "application/ld+json"
]);
async function parseRdf(body, contentTypeHeader, options = {}) {
  const rawHeader = contentTypeHeader ?? "text/turtle";
  let mediaType;
  try {
    mediaType = contentType.parse(rawHeader).type;
  } catch (cause) {
    throw new RdfFetchError(`Invalid Content-Type header: "${rawHeader}".`, { cause, contentType: rawHeader });
  }
  const baseIRI = options.baseIRI;
  let parser;
  if (N3_FAMILY.has(mediaType)) {
    parser = new StreamParser({
      format: mediaType,
      ...baseIRI !== void 0 && { baseIRI }
    });
  } else if (JSON_LD_FAMILY.has(mediaType)) {
    parser = new JsonLdParser({
      ...baseIRI !== void 0 && { baseIRI }
    });
  } else {
    throw new RdfFetchError(`Unsupported RDF media type: "${mediaType}". Supported: ${SUPPORTED_RDF_MEDIA_TYPES.join(", ")}.`, { contentType: rawHeader, ...baseIRI !== void 0 && { url: baseIRI } });
  }
  const storePromise = collectIntoStore(parser);
  try {
    await pumpBody(parser, body);
    return await storePromise;
  } catch (cause) {
    if (cause instanceof RdfFetchError)
      throw cause;
    throw new RdfFetchError(`Failed to parse ${mediaType} body${baseIRI ? ` at ${baseIRI}` : ""}.`, { cause, contentType: rawHeader, ...baseIRI !== void 0 && { url: baseIRI } });
  }
}
function collectIntoStore(parser) {
  return new Promise((resolve, reject) => {
    const store = new Store();
    parser.on("data", (quad) => {
      store.addQuad(quad);
    });
    parser.on("error", reject);
    parser.on("end", () => {
      resolve(store);
    });
  });
}
async function pumpBody(parser, body) {
  if (typeof body === "string") {
    parser.end(body);
    return;
  }
  let parserError = null;
  const onParserError = (err) => {
    parserError = err;
  };
  parser.on("error", onParserError);
  const reader = body.getReader();
  try {
    const decoder = new TextDecoder();
    for (; ; ) {
      if (parserError)
        throw parserError;
      const { done, value } = await reader.read();
      if (done)
        break;
      if (value === void 0)
        continue;
      const text = decoder.decode(value, { stream: true });
      if (text.length === 0)
        continue;
      if (!parser.write(text))
        await waitForDrain(parser);
    }
    if (parserError)
      throw parserError;
    const tail = decoder.decode();
    if (tail.length > 0)
      parser.write(tail);
    parser.end();
  } catch (err) {
    parser.destroy(err instanceof Error ? err : new Error(String(err)));
    try {
      await reader.cancel();
    } catch {
    }
    throw err;
  } finally {
    parser.off("error", onParserError);
    reader.releaseLock();
  }
}
function waitForDrain(parser) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      parser.off("drain", onDrain);
      parser.off("error", onError);
    };
    const onDrain = () => {
      cleanup();
      resolve();
    };
    const onError = (err) => {
      cleanup();
      reject(err);
    };
    parser.once("drain", onDrain);
    parser.once("error", onError);
  });
}

// node_modules/@jeswr/fetch-rdf/dist/fetch.js
var ACCEPT = "text/turtle, application/ld+json;q=0.9";
async function fetchRdf(url, options = {}) {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const headers = new Headers(options.headers);
  headers.set("accept", ACCEPT);
  let response;
  try {
    response = await fetchImpl(url, {
      headers,
      ...options.signal !== void 0 && { signal: options.signal }
    });
  } catch (cause) {
    throw new RdfFetchError(`Network error fetching ${url}: ${errorMessage(cause)}`, { cause, url });
  }
  if (!response.ok) {
    throw new RdfFetchError(`HTTP ${response.status} ${response.statusText || ""} fetching ${url}.`.trim(), {
      status: response.status,
      url: response.url || url,
      contentType: response.headers.get("content-type") ?? void 0
    });
  }
  const dataset = await parseRdf(response.body ?? "", response.headers.get("content-type"), { baseIRI: response.url || url });
  return { dataset, headers: response.headers };
}
function errorMessage(cause) {
  if (cause instanceof Error)
    return cause.message;
  return String(cause);
}

// src/pod.ts
import { isContainerUrl } from "@jeswr/guarded-fetch";
import { ContainerDataset } from "@solid/object";
import { DataFactory, Writer } from "n3";
function isTextualContentType(ct) {
  if (!ct) {
    return true;
  }
  const m = ct.toLowerCase();
  if (m.startsWith("text/")) return true;
  if (m === "application/json" || m.endsWith("+json")) return true;
  if (m === "application/xml" || m.endsWith("+xml")) return true;
  const textApps = [
    "application/ld+json",
    "application/json",
    "application/x-turtle",
    "text/turtle",
    "application/trig",
    "application/n-triples",
    "application/n-quads",
    "application/sparql-query",
    "application/sparql-update",
    "application/javascript",
    "application/yaml"
  ];
  return textApps.includes(m);
}
function bareMediaType(header) {
  if (!header) return void 0;
  const semi = header.indexOf(";");
  const mt = (semi === -1 ? header : header.slice(0, semi)).trim().toLowerCase();
  return mt.length > 0 ? mt : void 0;
}
async function listContainer(config, url) {
  const target = requirePodScopedUrl(config, url);
  const { dataset } = await fetchRdf(target, { fetch: scopedFetch(config) });
  const container = new ContainerDataset(dataset, DataFactory).container;
  const children = [];
  for (const r of container?.contains ?? []) {
    let resolvedChild;
    try {
      resolvedChild = new URL(r.id, target).toString();
    } catch {
      continue;
    }
    const childUrl = podScopedUrlOrUndefined(config, resolvedChild);
    if (childUrl === void 0) {
      continue;
    }
    const child = {
      url: childUrl,
      name: r.name,
      isContainer: r.isContainer,
      type: [...r.type]
    };
    if (r.mimeType !== void 0) child.mimeType = r.mimeType;
    if (r.size !== void 0) child.size = r.size;
    if (r.modified !== void 0) child.modified = r.modified.toISOString();
    children.push(child);
  }
  return children;
}
async function readResource(config, url) {
  const target = requirePodScopedUrl(config, url);
  const res = await scopedFetch(config)(target, { method: "GET" });
  if (res.status === 401 || res.status === 403) {
    throw new Error(
      `unauthenticated/forbidden (${res.status}) reading ${target} \u2014 supply an authenticated fetch (the Solid-MCP server holds no credentials of its own).`
    );
  }
  if (!res.ok) {
    throw new Error(`failed to read ${target}: HTTP ${res.status} ${res.statusText}`);
  }
  const contentType2 = bareMediaType(res.headers.get("content-type"));
  const etag = res.headers.get("etag") ?? void 0;
  const result = {};
  if (contentType2 !== void 0) result.contentType = contentType2;
  if (etag !== void 0) result.etag = etag;
  if (isTextualContentType(contentType2)) {
    result.text = await res.text();
  } else {
    const buf = await res.arrayBuffer();
    result.base64 = Buffer.from(buf).toString("base64");
  }
  return result;
}
async function readRdf(config, url) {
  const target = requirePodScopedUrl(config, url);
  const { dataset } = await fetchRdf(target, { fetch: scopedFetch(config) });
  const turtle = await serializeTurtle(dataset);
  return { turtle, dataset };
}
function serializeTurtle(dataset) {
  return new Promise((resolve, reject) => {
    const writer = new Writer({ format: "text/turtle" });
    writer.addQuads(dataset.getQuads(null, null, null, null));
    writer.end((err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
}
var RDF_LIKE = /* @__PURE__ */ new Set([
  "text/turtle",
  "application/x-turtle",
  "application/ld+json",
  "application/n-triples",
  "application/n-quads",
  "application/trig"
]);
async function search(config, query, options = {}) {
  const q = (query ?? "").trim().toLowerCase();
  if (q.length === 0) {
    return [];
  }
  const maxDepth = options.maxDepth ?? 4;
  const maxResources = options.maxResources ?? 500;
  const scope = requirePodScopedUrl(config, options.scope ?? config.podRoot);
  const byUrl = /* @__PURE__ */ new Map();
  const addMatch = (m, rank) => {
    const existing = byUrl.get(m.url);
    if (!existing || rank < (rankOf.get(m.url) ?? Number.POSITIVE_INFINITY)) {
      byUrl.set(m.url, m);
      rankOf.set(m.url, rank);
    }
  };
  const rankOf = /* @__PURE__ */ new Map();
  const seedContainers = /* @__PURE__ */ new Set([scope]);
  if (config.webId) {
    try {
      for (const hint of await typeIndexContainers(config)) {
        try {
          const scoped = requirePodScopedUrl(config, hint);
          if (isContainerUrl(scoped)) {
            seedContainers.add(scoped);
          } else {
            const name = decodeURIComponent(scoped.replace(/\/$/, "").split("/").pop() ?? scoped);
            if (scoped.toLowerCase().includes(q) || name.toLowerCase().includes(q)) {
              addMatch({ url: scoped, name, snippet: "type-index instance" }, 0);
            }
          }
        } catch {
        }
      }
    } catch {
    }
  }
  let visited = 0;
  const seenContainers = /* @__PURE__ */ new Set();
  const queue = [];
  for (const c of seedContainers) {
    queue.push({ url: c, depth: 0 });
  }
  while (queue.length > 0) {
    if (visited >= maxResources) break;
    const next = queue.shift();
    if (!next) break;
    const { url, depth } = next;
    if (seenContainers.has(url)) continue;
    seenContainers.add(url);
    let children;
    try {
      children = await listContainer(config, url);
    } catch {
      continue;
    }
    for (const child of children) {
      if (visited >= maxResources) break;
      visited++;
      const nameLc = child.name.toLowerCase();
      const urlLc = child.url.toLowerCase();
      if (nameLc.includes(q) || urlLc.includes(q)) {
        addMatch({ url: child.url, name: child.name, snippet: "name/url match" }, 1);
      }
      if (child.isContainer) {
        if (depth + 1 <= maxDepth) {
          queue.push({ url: child.url, depth: depth + 1 });
        }
      } else if (isRdfLike(child.mimeType) || hasRdfExtension(child.url)) {
        const literalHit = await literalMatch(config, child.url, q);
        if (literalHit) {
          addMatch({ url: child.url, name: child.name, snippet: `literal: ${literalHit}` }, 2);
        }
      }
    }
  }
  return [...byUrl.values()].sort((a, b) => (rankOf.get(a.url) ?? 9) - (rankOf.get(b.url) ?? 9));
}
function isRdfLike(mimeType) {
  if (!mimeType) return false;
  return RDF_LIKE.has(mimeType.toLowerCase());
}
var RDF_EXTENSIONS = [".ttl", ".jsonld", ".nt", ".nq", ".trig", ".n3"];
function hasRdfExtension(url) {
  let path;
  try {
    path = new URL(url).pathname.toLowerCase();
  } catch {
    path = url.toLowerCase();
  }
  return RDF_EXTENSIONS.some((ext) => path.endsWith(ext));
}
async function literalMatch(config, url, q) {
  const target = podScopedUrlOrUndefined(config, url);
  if (target === void 0) {
    return void 0;
  }
  let dataset;
  try {
    ({ dataset } = await fetchRdf(target, { fetch: scopedFetch(config) }));
  } catch {
    return void 0;
  }
  for (const quad of dataset.getQuads(null, null, null, null)) {
    if (quad.object.termType === "Literal") {
      const v = quad.object.value;
      if (v.toLowerCase().includes(q)) {
        return v.length > 120 ? `${v.slice(0, 117)}...` : v;
      }
    }
  }
  return void 0;
}
async function typeIndexContainers(config) {
  const webId = config.webId;
  if (!webId) return [];
  const solidNs = "http://www.w3.org/ns/solid/terms#";
  const out = /* @__PURE__ */ new Set();
  const { dataset: profile } = await fetchRdf(webId, { fetch: config.fetch });
  const indexes = /* @__PURE__ */ new Set();
  for (const p of [`${solidNs}publicTypeIndex`, `${solidNs}privateTypeIndex`]) {
    for (const quad of profile.getQuads(null, DataFactory.namedNode(p), null, null)) {
      if (quad.object.termType === "NamedNode") {
        const scoped = podScopedUrlOrUndefined(config, quad.object.value);
        if (scoped !== void 0) indexes.add(scoped);
      }
    }
  }
  for (const index of indexes) {
    try {
      const { dataset: ti } = await fetchRdf(index, { fetch: scopedFetch(config) });
      for (const p of [`${solidNs}instance`, `${solidNs}instanceContainer`]) {
        for (const quad of ti.getQuads(null, DataFactory.namedNode(p), null, null)) {
          if (quad.object.termType === "NamedNode") {
            const scoped = podScopedUrlOrUndefined(config, quad.object.value);
            if (scoped !== void 0) out.add(scoped);
          }
        }
      }
    } catch {
    }
  }
  return [...out];
}
async function writeResource(config, url, content, contentType2) {
  if (!writesEnabled(config)) {
    throw new Error("write disabled: server is read-only (set readOnly:false to enable writes).");
  }
  const target = requirePodScopedWriteUrl(config, url);
  const res = await config.fetch(target, {
    method: "PUT",
    headers: { "content-type": contentType2 },
    body: content,
    redirect: "manual"
  });
  if (res.status >= 300 && res.status < 400) {
    throw new Error(
      `refusing to follow a redirect (${res.status}) on a write to ${target} (a redirected write could escape the pod \u2014 SSRF guard).`
    );
  }
  if (res.status === 401 || res.status === 403) {
    throw new Error(
      `unauthenticated/forbidden (${res.status}) writing ${target} \u2014 supply an authenticated fetch with write access.`
    );
  }
  if (!res.ok) {
    throw new Error(`failed to write ${target}: HTTP ${res.status} ${res.statusText}`);
  }
  const etag = res.headers.get("etag") ?? void 0;
  const result = { url: target };
  if (etag !== void 0) result.etag = etag;
  return result;
}

// src/server.ts
var RDF_MEDIA = /* @__PURE__ */ new Set([
  "text/turtle",
  "application/x-turtle",
  "application/ld+json",
  "application/n-triples",
  "application/n-quads",
  "application/trig"
]);
function errorText(e) {
  return e instanceof Error ? e.message : String(e);
}
function toolText(text) {
  return { content: [{ type: "text", text }] };
}
function toolError(e) {
  return { isError: true, content: [{ type: "text", text: errorText(e) }] };
}
function createSolidMcpServer(config) {
  const podRoot = normalizePodRoot(config.podRoot);
  const cfg = { ...config, podRoot };
  const server = new McpServer(
    { name: "@jeswr/solid-mcp", version: "0.1.0" },
    { capabilities: { resources: {}, tools: {} } }
  );
  const rootUrl = new URL(podRoot);
  const template = new ResourceTemplate(`${rootUrl.protocol}//${rootUrl.host}/{+path}`, {
    list: async () => {
      const children = await listContainer(cfg, podRoot);
      return {
        resources: children.map((c) => ({
          uri: c.url,
          name: c.name,
          ...c.mimeType ? { mimeType: c.mimeType } : {}
        }))
      };
    }
  });
  server.registerResource(
    "solid-pod",
    template,
    {
      title: "Solid pod resource",
      description: "A resource in the Solid pod. Containers are returned as a JSON listing; RDF resources as Turtle; other resources as text or base64 bytes."
    },
    async (uri) => {
      const target = requirePodScopedUrl(cfg, uri.toString());
      if (isContainerUrl2(target)) {
        const children = await listContainer(cfg, target);
        return {
          contents: [
            { uri: target, mimeType: "application/json", text: JSON.stringify(children, null, 2) }
          ]
        };
      }
      const bytes = await readResource(cfg, target);
      if (bytes.contentType && RDF_MEDIA.has(bytes.contentType)) {
        const { turtle } = await readRdf(cfg, target);
        return { contents: [{ uri: target, mimeType: "text/turtle", text: turtle }] };
      }
      if (bytes.text !== void 0) {
        return {
          contents: [
            {
              uri: target,
              ...bytes.contentType ? { mimeType: bytes.contentType } : {},
              text: bytes.text
            }
          ]
        };
      }
      return {
        contents: [
          {
            uri: target,
            mimeType: bytes.contentType ?? "application/octet-stream",
            blob: bytes.base64 ?? ""
          }
        ]
      };
    }
  );
  server.registerTool(
    "solid_list",
    {
      title: "List a Solid container",
      description: "List the immediate children of a Solid LDP container (must be within the pod). Returns typed children (url, name, isContainer, type, mimeType, size, modified).",
      inputSchema: {
        container: z.string().describe("Absolute URL of the container (within the pod).")
      },
      annotations: { readOnlyHint: true, openWorldHint: true }
    },
    async ({ container }) => {
      try {
        const children = await listContainer(cfg, container);
        return toolText(JSON.stringify(children, null, 2));
      } catch (e) {
        return toolError(e);
      }
    }
  );
  server.registerTool(
    "solid_read",
    {
      title: "Read a Solid resource",
      description: "Read a resource in the pod. RDF resources are returned as Turtle; other resources as text, or base64 for binary. Fails closed (401/403) if the resource is protected and no authenticated fetch was supplied.",
      inputSchema: { url: z.string().describe("Absolute URL of the resource (within the pod).") },
      annotations: { readOnlyHint: true, openWorldHint: true }
    },
    async ({ url }) => {
      try {
        const target = requirePodScopedUrl(cfg, url);
        const bytes = await readResource(cfg, target);
        if (bytes.contentType && RDF_MEDIA.has(bytes.contentType)) {
          const { turtle } = await readRdf(cfg, target);
          return toolText(turtle);
        }
        if (bytes.text !== void 0) {
          return toolText(bytes.text);
        }
        return toolText(
          `[binary ${bytes.contentType ?? "application/octet-stream"}, base64]
${bytes.base64 ?? ""}`
        );
      } catch (e) {
        return toolError(e);
      }
    }
  );
  server.registerTool(
    "solid_search",
    {
      title: "Search the Solid pod",
      description: "Client-side search across the pod (no server FTS): best-effort Type-Index discovery plus a bounded recursive container scan, matching the query against resource url/name and, for RDF resources, literal values. Returns ranked matches.",
      inputSchema: {
        query: z.string().describe("Case-insensitive search term."),
        scope: z.string().optional().describe("Optional container URL to restrict the search to (within the pod).")
      },
      annotations: { readOnlyHint: true, openWorldHint: true }
    },
    async ({ query, scope }) => {
      try {
        const matches = await search(cfg, query, scope ? { scope } : {});
        return toolText(JSON.stringify(matches, null, 2));
      } catch (e) {
        return toolError(e);
      }
    }
  );
  server.registerTool(
    "solid_write",
    {
      title: "Write a Solid resource",
      description: "Write (PUT) a resource in the pod. DISABLED by default \u2014 the server is read-only unless created with readOnly:false. Pod-scope-guarded.",
      inputSchema: {
        url: z.string().describe("Absolute URL of the resource to write (within the pod)."),
        content: z.string().describe("The resource body to write."),
        contentType: z.string().describe("The Content-Type for the written resource.")
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true }
    },
    async ({ url, content, contentType: contentType2 }) => {
      if (!writesEnabled(cfg)) {
        return toolError(
          "write disabled: server is read-only (set readOnly:false to enable writes)."
        );
      }
      try {
        const result = await writeResource(cfg, url, content, contentType2);
        return toolText(`wrote ${result.url}${result.etag ? ` (etag ${result.etag})` : ""}`);
      } catch (e) {
        return toolError(e);
      }
    }
  );
  return server;
}

// src/cli.ts
function resolveCliFetch() {
  const hasCreds = !!process.env.SOLID_MCP_CLIENT_ID && !!process.env.SOLID_MCP_CLIENT_SECRET && (!!process.env.SOLID_MCP_OIDC_ISSUER || !!process.env.SOLID_MCP_TOKEN_URL);
  if (hasCreds) {
    process.stderr.write(
      "[solid-mcp] headless client-credentials login is not bundled in M1. Pass an authenticated fetch programmatically via createSolidMcpServer, or run unauthenticated for public resources. Falling back to an unauthenticated fetch (protected resources will fail closed).\n"
    );
  }
  return globalThis.fetch;
}
async function main() {
  const podRoot = process.env.SOLID_MCP_POD_ROOT;
  if (!podRoot) {
    process.stderr.write(
      "[solid-mcp] SOLID_MCP_POD_ROOT is required (an absolute http(s) container URL ending in '/').\n"
    );
    process.exit(1);
    return;
  }
  const readOnly = (process.env.SOLID_MCP_READONLY ?? "true").toLowerCase() !== "false";
  const config = {
    fetch: resolveCliFetch(),
    podRoot,
    readOnly
  };
  const webId = process.env.SOLID_MCP_WEBID;
  if (webId) config.webId = webId;
  let server;
  try {
    server = createSolidMcpServer(config);
  } catch (e) {
    process.stderr.write(
      `[solid-mcp] configuration error: ${e instanceof Error ? e.message : e}
`
    );
    process.exit(1);
    return;
  }
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(
    `[solid-mcp] connected (stdio). pod=${podRoot} readOnly=${readOnly}${webId ? ` webId=${webId}` : ""}
`
  );
}
main().catch((e) => {
  process.stderr.write(`[solid-mcp] fatal: ${e instanceof Error ? e.stack ?? e.message : e}
`);
  process.exit(1);
});
//# sourceMappingURL=cli.js.map
