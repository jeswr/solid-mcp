// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
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
export function normalizePodRoot(podRoot: string): string {
  if (typeof podRoot !== "string" || podRoot.length === 0) {
    throw new Error("podRoot is required (an absolute http(s) URL ending in '/').");
  }
  let parsed: URL;
  try {
    parsed = new URL(podRoot);
  } catch {
    throw new Error(
      `podRoot must be an absolute http(s) URL ending in '/', got: ${JSON.stringify(podRoot)}`,
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`podRoot must use http(s), got protocol: ${parsed.protocol}`);
  }
  if (!parsed.pathname.endsWith("/")) {
    throw new Error(`podRoot must end in '/' (a container URL), got: ${podRoot}`);
  }
  // `new URL()` normalizes the origin (lowercases host, applies default ports,
  // resolves `.`/`..` segments in the path), so the returned string is canonical.
  return parsed.toString();
}

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
export function requirePodScopedUrl(config: { podRoot: string }, url: string): string {
  const root = normalizePodRoot(config.podRoot);
  if (typeof url !== "string" || url.length === 0) {
    throw new Error("a non-empty URL is required.");
  }
  let resolved: URL;
  try {
    // Resolve relative refs against the (canonical) pod root. An absolute URL
    // ignores the base; a relative one is resolved within the pod.
    resolved = new URL(url, root);
  } catch {
    throw new Error(`not a valid URL (and not resolvable within the pod): ${JSON.stringify(url)}`);
  }
  if (resolved.protocol !== "http:" && resolved.protocol !== "https:") {
    throw new Error(
      `pod-scope violation: only http(s) URLs are allowed, got protocol ${resolved.protocol} for ${url}`,
    );
  }
  const canonical = resolved.toString();
  if (!canonical.startsWith(root)) {
    throw new Error(
      `pod-scope violation: ${canonical} is outside the configured pod root ${root}. ` +
        "The Solid-MCP server only operates within its pod (SSRF / scope guard).",
    );
  }
  return canonical;
}

/** True when writes are enabled (the caller explicitly opted out of read-only). */
export function writesEnabled(config: SolidMcpConfig): boolean {
  return config.readOnly === false;
}
