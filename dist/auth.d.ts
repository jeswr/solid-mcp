/**
 * The AUTH SEAM + the pod-scope (SSRF) guard.
 *
 * The server holds NO bespoke crypto. The caller supplies an already-authenticated
 * Solid-OIDC / DPoP `fetch` (e.g. from a reactive-auth session), and every pod
 * operation routes through it. This keeps token handling — the security-critical
 * part — in vetted upstream libraries, not in this package.
 *
 * The pod-scope guard ({@link requirePodScopedUrl}) is the SSRF / capability
 * boundary: it refuses any URL that is not within the configured `podRoot`, so an
 * MCP client / agent cannot use a tool to reach an arbitrary origin (SSRF) or
 * escape the pod root via path traversal.
 */
/**
 * Configuration for a Solid-MCP server instance.
 *
 * The single non-negotiable input is an authenticated `fetch` and the `podRoot`
 * it is scoped to. Everything else is optional, with safe defaults.
 */
export interface SolidMcpConfig {
    /**
     * An authenticated (Solid-OIDC / DPoP) `fetch`, supplied by the caller. The
     * server performs NO token acquisition itself — it just uses this. For public
     * resources you may pass `globalThis.fetch`; for protected resources you MUST
     * pass an authenticated one (otherwise reads fail-closed with a 401/403).
     */
    fetch: typeof fetch;
    /**
     * The absolute http(s) pod (or sub-container) root this server is scoped to.
     * MUST be an absolute http/https URL ending in `/`. Every Resource and Tool is
     * confined to this subtree (the SSRF / capability boundary).
     */
    podRoot: string;
    /**
     * The owner's WebID, if known. Enables best-effort Type-Index discovery in
     * `search`. Optional.
     */
    webId?: string;
    /**
     * Whether the server is read-only. Defaults to `true` (writes disabled). Set to
     * `false` to enable the `solid_write` tool / `writeResource`.
     */
    readOnly?: boolean;
}
/**
 * Validate a {@link SolidMcpConfig.podRoot}: it must be an absolute http(s) URL
 * with a trailing slash. Throws a clear error otherwise. Returns the normalized
 * (parsed-and-restringified) podRoot so callers compare against a canonical form.
 */
export declare function normalizePodRoot(podRoot: string): string;
/**
 * Resolve `url` against the config's pod root and assert it is WITHIN the pod
 * root. Returns the canonical absolute URL string. THROWS if the resolved URL is
 * outside the pod (different origin, or a path that escapes the root) — this is
 * the SSRF / scope guard.
 *
 * The check is a strict prefix test on the normalized, canonical URL: a candidate
 * is in-pod iff its canonical string STARTS WITH the canonical podRoot. Because
 * both are run through `new URL()` first, `..` traversal and `%2e%2e` style
 * escapes are resolved away before the comparison, so they cannot smuggle the
 * target outside the root. A path that resolves above the root (e.g. the parent
 * container) will not share the podRoot prefix and is rejected.
 */
export declare function requirePodScopedUrl(config: {
    podRoot: string;
}, url: string): string;
/**
 * Non-throwing variant of {@link requirePodScopedUrl}: returns the canonical
 * in-pod URL string, or `undefined` if `url` is not within the pod root (or is
 * not a valid http(s) URL). Use this to FILTER OUT untrusted URLs (e.g. child
 * entries from a container listing, or type-index targets discovered from a
 * profile) rather than throwing — a malicious listing/profile that points at an
 * external origin is silently dropped (fail-closed) instead of aborting the call.
 */
export declare function podScopedUrlOrUndefined(config: {
    podRoot: string;
}, url: string): string | undefined;
/** True when writes are enabled (the caller explicitly opted out of read-only). */
export declare function writesEnabled(config: SolidMcpConfig): boolean;
//# sourceMappingURL=auth.d.ts.map