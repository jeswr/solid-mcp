import { type SolidMcpConfig } from "./auth.js";
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
 * List the children of an LDP container at `url` (pod-scoped). Parses the
 * container listing via fetch-rdf + @solid/object's ContainerDataset; maps each
 * child's (possibly relative) id to an absolute URL.
 *
 * SECURITY: a container listing is UNTRUSTED data — a malicious or compromised
 * pod could put an `ldp:contains` entry pointing at an external origin. Every
 * resolved child URL is therefore re-validated against the pod scope, and any
 * child that resolves OUTSIDE the pod is DROPPED (fail-closed). This is what
 * stops a poisoned listing from making a downstream `solid_read` / `solid_search`
 * fetch an arbitrary URL (SSRF). Callers can rely on every returned `child.url`
 * being in-pod.
 */
export declare function listContainer(config: SolidMcpConfig, url: string): Promise<PodChild[]>;
/**
 * Read a resource's raw bytes (pod-scoped) via a plain GET on the injected fetch
 * (NOT fetchRdf — we want the bytes for ANY content type). Decides text vs binary
 * by content-type. Fails CLOSED on 401/403 with a clear "supply an authenticated
 * fetch" error, and on any other non-2xx with the status.
 */
export declare function readResource(config: SolidMcpConfig, url: string): Promise<ReadResult>;
/**
 * Fetch an RDF resource (pod-scoped) and return a canonical Turtle view (via
 * n3.Writer — never hand-concatenated) plus the parsed dataset.
 */
export declare function readRdf(config: SolidMcpConfig, url: string): Promise<ReadRdfResult>;
/**
 * The lowercase RDF media types this package recognises — the ONE reviewed list,
 * shared by every RDF decision so they cannot drift:
 *   - here (`isRdfLike`): which resources to RDF-parse during a literal search;
 *   - in server.ts: which resources to render as Turtle in the read path.
 * If a new RDF serialisation is supported, adding it here updates BOTH. Internal
 * (not re-exported from index.ts), so it is not part of the public API surface.
 */
export declare const RDF_MEDIA_TYPES: Set<string>;
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
export declare function search(config: SolidMcpConfig, query: string, options?: SearchOptions): Promise<SearchMatch[]>;
/**
 * Write `content` to `url` with `contentType` (pod-scoped) via PUT on the injected
 * fetch. GUARDED: throws if the server is read-only (the default). On a non-2xx
 * response it throws with the status.
 */
export declare function writeResource(config: SolidMcpConfig, url: string, content: string, contentType: string): Promise<{
    url: string;
    etag?: string;
}>;
//# sourceMappingURL=pod.d.ts.map