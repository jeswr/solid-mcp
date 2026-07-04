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
 * Delegates to `@jeswr/guarded-fetch`'s `assertWithinPodScope` (segment-boundary
 * same-origin path-prefix check on the WHATWG-normalised, canonical URL — `..`
 * traversal and `%2e%2e` style escapes are resolved away before the comparison,
 * so they cannot smuggle the target outside the root), re-wrapping its error
 * with the `pod-scope violation:` prefix this package's public contract relies
 * on. The pod root itself is accepted by default (`allowRoot` defaults to
 * `true`), matching this server's prior behaviour.
 */
export declare function requirePodScopedUrl(config: {
    podRoot: string;
}, url: string): string;
/**
 * WRITE-TARGET variant of {@link requirePodScopedUrl}: identical, except the
 * configured pod root itself is NOT an acceptable target (`allowRoot: false`).
 *
 * WHY a distinct guard for writes: `assertWithinPodScope` treats BOTH the
 * slash-terminated root (`…/pod/`) AND its slashless alias (`…/pod`) as "the
 * root", and — under the read default `allowRoot: true` — accepts both. But the
 * slashless alias `…/pod` is a resource in the PARENT container, one level ABOVE
 * the configured `…/pod/` sub-tree; accepting it as a WRITE target lets a client
 * PUT outside the configured scope (a boundary-widening the prior hand-rolled
 * `canonical.startsWith(root)` guard — with `root` slash-terminated — rejected,
 * since `…/pod` does not start with `…/pod/`). Reads may legitimately address the
 * container root (list/read it), so they keep `allowRoot: true`; writes must land
 * strictly UNDER the root, so this guard sets `allowRoot: false`. Fail-closed.
 */
export declare function requirePodScopedWriteUrl(config: {
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
/**
 * Wrap an authenticated `fetch` into a POD-SCOPED fetch that handles redirects
 * MANUALLY and validates every hop against the pod scope, via
 * `@jeswr/guarded-fetch`'s `createPodScopedFetch`.
 *
 * WHY: validating only the initial URL is not enough — `fetch` follows 3xx
 * redirects by default, so a poisoned in-pod resource could `302` to an external
 * (or internal-network) target and the underlying fetch would happily follow it,
 * re-opening the SSRF hole that the URL filter closed. `createPodScopedFetch`
 * forces `redirect: "manual"` and re-checks every hop's `Location` against the
 * pod scope before following (fail-closed: a redirect that leaves the pod throws
 * a `PodScopeError`, re-wrapped here as a `pod-scope violation` mentioning the
 * redirect, matching this package's prior error contract). Also applies the
 * WHATWG Fetch-spec-correct method/body-rewrite rules on a method-changing or
 * cross-origin hop (a strict improvement over the prior blanket "always
 * downgrade to GET after hop 1").
 *
 * Use this for every fetch that touches pod data; the one deliberate exception
 * is the off-pod WebID profile fetch (the configured identity), which uses the
 * raw fetch.
 */
export declare function scopedFetch(config: {
    podRoot: string;
    fetch: typeof fetch;
}): typeof fetch;
/** True when writes are enabled (the caller explicitly opted out of read-only). */
export declare function writesEnabled(config: SolidMcpConfig): boolean;
//# sourceMappingURL=auth.d.ts.map