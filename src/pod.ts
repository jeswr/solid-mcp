// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/**
 * Pod operations over the injected authenticated `fetch`, all pod-scope-guarded.
 *
 * RDF discipline (house rule): we NEVER hand-build or hand-parse RDF. Container
 * listings are parsed via `@jeswr/fetch-rdf` (`fetchRdf`) + `@solid/object`
 * (`ContainerDataset`), and any RDF representation we hand back to a client is
 * re-serialised with `n3.Writer` over the parsed quads.
 */
import { fetchRdf, RdfFetchError } from "@jeswr/fetch-rdf";
import { ContainerDataset } from "@solid/object";
import { DataFactory, Writer } from "n3";
import { requirePodScopedUrl, type SolidMcpConfig, writesEnabled } from "./auth.js";

/** A typed child of an LDP container, mapped to absolute URLs. */
export interface PodChild {
  /** Absolute URL of the child resource. */
  url: string;
  /** Human-friendly name (the last path segment, per @solid/object). */
  name: string;
  /** Whether the child is itself a container. */
  isContainer: boolean;
  /** The child's RDF types (rdf:type IRIs), if any. */
  type: string[];
  /** The child's MIME type, if advertised. */
  mimeType?: string;
  /** The child's byte size, if advertised. */
  size?: number;
  /** The child's last-modified time (ISO 8601), if advertised. */
  modified?: string;
}

/** The result of reading a (possibly binary) resource's bytes. */
export interface ReadResult {
  /** The response Content-Type (lowercased media type, no params), if any. */
  contentType?: string;
  /** UTF-8 text body — present iff the content-type is textual. */
  text?: string;
  /** Base64-encoded body — present iff the content-type is treated as binary. */
  base64?: string;
  /** The resource ETag, if the server returned one. */
  etag?: string;
}

/** The result of reading an RDF resource as Turtle. */
export interface ReadRdfResult {
  /** A canonical Turtle serialisation of the resource graph (via n3.Writer). */
  turtle: string;
  /** The parsed dataset, for callers that want to query it (e.g. search). */
  dataset: import("n3").Store;
}

/** A single search hit. */
export interface SearchMatch {
  /** Absolute URL of the matching resource. */
  url: string;
  /** Human-friendly name. */
  name: string;
  /** A short snippet explaining why it matched (url/name/literal), if relevant. */
  snippet?: string;
}

/** Options controlling {@link search}. */
export interface SearchOptions {
  /** Restrict the crawl to this sub-container (must be within the pod). */
  scope?: string;
  /** Max recursion depth for the container scan (default 4). */
  maxDepth?: number;
  /** Max total resources visited in the scan (default 500). */
  maxResources?: number;
}

/**
 * Content-types we treat as textual (everything else is returned base64). Covers
 * the RDF serialisations plus the common text / json / xml families.
 */
function isTextualContentType(ct: string | undefined): boolean {
  if (!ct) {
    // No content-type advertised: default to text (the common case for pods).
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
    "application/yaml",
  ];
  return textApps.includes(m);
}

/** Strip parameters off a Content-Type header to its bare media type, lowercased. */
function bareMediaType(header: string | null): string | undefined {
  if (!header) return undefined;
  const semi = header.indexOf(";");
  const mt = (semi === -1 ? header : header.slice(0, semi)).trim().toLowerCase();
  return mt.length > 0 ? mt : undefined;
}

/**
 * List the children of an LDP container at `url` (pod-scoped). Parses the
 * container listing via fetch-rdf + @solid/object's ContainerDataset; maps each
 * child's (possibly relative) id to an absolute URL.
 */
export async function listContainer(config: SolidMcpConfig, url: string): Promise<PodChild[]> {
  const target = requirePodScopedUrl(config, url);
  const { dataset } = await fetchRdf(target, { fetch: config.fetch });
  const container = new ContainerDataset(dataset, DataFactory).container;
  const children: PodChild[] = [];
  for (const r of container?.contains ?? []) {
    // child.id may be relative to the container; resolve against the container URL.
    const childUrl = new URL(r.id, target).toString();
    const child: PodChild = {
      url: childUrl,
      name: r.name,
      isContainer: r.isContainer,
      type: [...r.type],
    };
    if (r.mimeType !== undefined) child.mimeType = r.mimeType;
    if (r.size !== undefined) child.size = r.size;
    if (r.modified !== undefined) child.modified = r.modified.toISOString();
    children.push(child);
  }
  return children;
}

/**
 * Read a resource's raw bytes (pod-scoped) via a plain GET on the injected fetch
 * (NOT fetchRdf — we want the bytes for ANY content type). Decides text vs binary
 * by content-type. Fails CLOSED on 401/403 with a clear "supply an authenticated
 * fetch" error, and on any other non-2xx with the status.
 */
export async function readResource(config: SolidMcpConfig, url: string): Promise<ReadResult> {
  const target = requirePodScopedUrl(config, url);
  const res = await config.fetch(target, { method: "GET" });
  if (res.status === 401 || res.status === 403) {
    throw new Error(
      `unauthenticated/forbidden (${res.status}) reading ${target} — supply an authenticated fetch ` +
        "(the Solid-MCP server holds no credentials of its own).",
    );
  }
  if (!res.ok) {
    throw new Error(`failed to read ${target}: HTTP ${res.status} ${res.statusText}`);
  }
  const contentType = bareMediaType(res.headers.get("content-type"));
  const etag = res.headers.get("etag") ?? undefined;
  const result: ReadResult = {};
  if (contentType !== undefined) result.contentType = contentType;
  if (etag !== undefined) result.etag = etag;
  if (isTextualContentType(contentType)) {
    result.text = await res.text();
  } else {
    const buf = await res.arrayBuffer();
    result.base64 = Buffer.from(buf).toString("base64");
  }
  return result;
}

/**
 * Fetch an RDF resource (pod-scoped) and return a canonical Turtle view (via
 * n3.Writer — never hand-concatenated) plus the parsed dataset.
 */
export async function readRdf(config: SolidMcpConfig, url: string): Promise<ReadRdfResult> {
  const target = requirePodScopedUrl(config, url);
  const { dataset } = await fetchRdf(target, { fetch: config.fetch });
  const turtle = await serializeTurtle(dataset);
  return { turtle, dataset };
}

/** Serialise an n3.Store to Turtle via n3.Writer (no hand-built triples). */
function serializeTurtle(dataset: import("n3").Store): Promise<string> {
  return new Promise((resolve, reject) => {
    const writer = new Writer({ format: "text/turtle" });
    writer.addQuads(dataset.getQuads(null, null, null, null));
    writer.end((err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
}

/** Lowercase media types that we will try to RDF-parse during a literal search. */
const RDF_LIKE = new Set([
  "text/turtle",
  "application/x-turtle",
  "application/ld+json",
  "application/n-triples",
  "application/n-quads",
  "application/trig",
]);

/**
 * Client-side search across the pod (NO server FTS).
 *
 * Strategy:
 *  1. Best-effort Type-Index discovery: if `config.webId` is set, read the
 *     profile, follow `solid:publicTypeIndex` / `solid:privateTypeIndex`, and add
 *     each registration's `solid:instance` / `solid:instanceContainer` as a hint.
 *  2. Bounded recursive container scan from the scope (default: the pod root),
 *     capped by depth + total resources, matching `query` (case-insensitive)
 *     against each resource's url / name AND — for RDF resources — against literal
 *     object values.
 *
 * Returns de-duplicated, ranked matches (name/url hits first, then literal hits).
 */
export async function search(
  config: SolidMcpConfig,
  query: string,
  options: SearchOptions = {},
): Promise<SearchMatch[]> {
  const q = (query ?? "").trim().toLowerCase();
  if (q.length === 0) {
    return [];
  }
  const maxDepth = options.maxDepth ?? 4;
  const maxResources = options.maxResources ?? 500;
  const scope = requirePodScopedUrl(config, options.scope ?? config.podRoot);

  const byUrl = new Map<string, SearchMatch>();
  const addMatch = (m: SearchMatch, rank: number) => {
    const existing = byUrl.get(m.url);
    // Lower rank = stronger; keep the strongest. Store rank alongside via a Map.
    if (!existing || rank < (rankOf.get(m.url) ?? Number.POSITIVE_INFINITY)) {
      byUrl.set(m.url, m);
      rankOf.set(m.url, rank);
    }
  };
  const rankOf = new Map<string, number>();

  // (1) Type-Index hints (best-effort — never let a failure abort the scan).
  const seedContainers = new Set<string>([scope]);
  if (config.webId) {
    try {
      for (const hint of await typeIndexContainers(config)) {
        // Only honour hints inside the pod scope.
        try {
          const scoped = requirePodScopedUrl(config, hint);
          if (scoped.endsWith("/")) {
            seedContainers.add(scoped);
          } else {
            // A direct instance file: match its url/name immediately.
            const name = decodeURIComponent(scoped.replace(/\/$/, "").split("/").pop() ?? scoped);
            if (scoped.toLowerCase().includes(q) || name.toLowerCase().includes(q)) {
              addMatch({ url: scoped, name, snippet: "type-index instance" }, 0);
            }
          }
        } catch {
          // hint outside pod scope — ignore.
        }
      }
    } catch {
      // No type index / unreadable profile — fall through to the plain scan.
    }
  }

  // (2) Bounded recursive container scan.
  let visited = 0;
  const seenContainers = new Set<string>();
  const queue: Array<{ url: string; depth: number }> = [];
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

    let children: PodChild[];
    try {
      children = await listContainer(config, url);
    } catch {
      continue; // unreadable container — skip.
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
        // Literal search inside RDF resources (best-effort). A container listing
        // often does NOT advertise a child's mimeType, so we also try resources
        // whose URL carries a known RDF file extension.
        const literalHit = await literalMatch(config, child.url, q);
        if (literalHit) {
          addMatch({ url: child.url, name: child.name, snippet: `literal: ${literalHit}` }, 2);
        }
      }
    }
  }

  return [...byUrl.values()].sort((a, b) => (rankOf.get(a.url) ?? 9) - (rankOf.get(b.url) ?? 9));
}

/** Is the MIME type one we will attempt to RDF-parse for literal search? */
function isRdfLike(mimeType: string | undefined): boolean {
  if (!mimeType) return false;
  return RDF_LIKE.has(mimeType.toLowerCase());
}

/** Known RDF file extensions (used when a listing omits the child mimeType). */
const RDF_EXTENSIONS = [".ttl", ".jsonld", ".nt", ".nq", ".trig", ".n3"];

/** Does the URL path carry a known RDF file extension? */
function hasRdfExtension(url: string): boolean {
  let path: string;
  try {
    path = new URL(url).pathname.toLowerCase();
  } catch {
    path = url.toLowerCase();
  }
  return RDF_EXTENSIONS.some((ext) => path.endsWith(ext));
}

/**
 * Read an RDF resource and return the first literal object value containing `q`
 * (case-insensitive), truncated to a short snippet, or `undefined`. Never throws.
 */
async function literalMatch(
  config: SolidMcpConfig,
  url: string,
  q: string,
): Promise<string | undefined> {
  let dataset: import("n3").Store;
  try {
    ({ dataset } = await fetchRdf(url, { fetch: config.fetch }));
  } catch {
    return undefined;
  }
  for (const quad of dataset.getQuads(null, null, null, null)) {
    if (quad.object.termType === "Literal") {
      const v = quad.object.value;
      if (v.toLowerCase().includes(q)) {
        return v.length > 120 ? `${v.slice(0, 117)}...` : v;
      }
    }
  }
  return undefined;
}

/**
 * Best-effort: discover the type-index registration target containers / instances
 * from the owner's WebID profile. Reads the profile, follows
 * `solid:publicTypeIndex` / `solid:privateTypeIndex`, then each type index's
 * `solid:instance` / `solid:instanceContainer`. Returns absolute URL strings.
 * Throws only if the profile itself cannot be fetched — caller catches.
 */
async function typeIndexContainers(config: SolidMcpConfig): Promise<string[]> {
  const webId = config.webId;
  if (!webId) return [];
  const Solid = "http://www.w3.org/ns/solid/terms#";
  const out = new Set<string>();
  const { dataset: profile } = await fetchRdf(webId, { fetch: config.fetch });
  const indexes = new Set<string>();
  for (const p of [`${Solid}publicTypeIndex`, `${Solid}privateTypeIndex`]) {
    for (const quad of profile.getQuads(null, DataFactory.namedNode(p), null, null)) {
      if (quad.object.termType === "NamedNode") indexes.add(quad.object.value);
    }
  }
  for (const index of indexes) {
    try {
      const { dataset: ti } = await fetchRdf(index, { fetch: config.fetch });
      for (const p of [`${Solid}instance`, `${Solid}instanceContainer`]) {
        for (const quad of ti.getQuads(null, DataFactory.namedNode(p), null, null)) {
          if (quad.object.termType === "NamedNode") out.add(quad.object.value);
        }
      }
    } catch {
      // unreadable type index — skip.
    }
  }
  return [...out];
}

/**
 * Write `content` to `url` with `contentType` (pod-scoped) via PUT on the injected
 * fetch. GUARDED: throws if the server is read-only (the default). On a non-2xx
 * response it throws with the status.
 */
export async function writeResource(
  config: SolidMcpConfig,
  url: string,
  content: string,
  contentType: string,
): Promise<{ url: string; etag?: string }> {
  if (!writesEnabled(config)) {
    throw new Error("write disabled: server is read-only (set readOnly:false to enable writes).");
  }
  const target = requirePodScopedUrl(config, url);
  const res = await config.fetch(target, {
    method: "PUT",
    headers: { "content-type": contentType },
    body: content,
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error(
      `unauthenticated/forbidden (${res.status}) writing ${target} — supply an authenticated fetch ` +
        "with write access.",
    );
  }
  if (!res.ok) {
    throw new Error(`failed to write ${target}: HTTP ${res.status} ${res.statusText}`);
  }
  const etag = res.headers.get("etag") ?? undefined;
  const result: { url: string; etag?: string } = { url: target };
  if (etag !== undefined) result.etag = etag;
  return result;
}

export { RdfFetchError };
