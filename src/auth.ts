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

/**
 * Non-throwing variant of {@link requirePodScopedUrl}: returns the canonical
 * in-pod URL string, or `undefined` if `url` is not within the pod root (or is
 * not a valid http(s) URL). Use this to FILTER OUT untrusted URLs (e.g. child
 * entries from a container listing, or type-index targets discovered from a
 * profile) rather than throwing — a malicious listing/profile that points at an
 * external origin is silently dropped (fail-closed) instead of aborting the call.
 */
export function podScopedUrlOrUndefined(
  config: { podRoot: string },
  url: string,
): string | undefined {
  try {
    return requirePodScopedUrl(config, url);
  } catch {
    return undefined;
  }
}

/** Max redirect hops a pod-scoped fetch will follow before giving up. */
const MAX_REDIRECT_HOPS = 10;

/**
 * Wrap an authenticated `fetch` into a POD-SCOPED fetch that handles redirects
 * MANUALLY and validates every hop against the pod scope.
 *
 * WHY: validating only the initial URL is not enough — `fetch` follows 3xx
 * redirects by default, so a poisoned in-pod resource could `302` to an external
 * (or internal-network) target and the underlying fetch would happily follow it,
 * re-opening the SSRF hole that the URL filter closed. This wrapper forces
 * `redirect: "manual"`, and on each 3xx it resolves the `Location` against the
 * current URL and requires the result to be WITHIN the pod before following
 * (fail-closed: a redirect that leaves the pod throws a pod-scope violation).
 *
 * The first request's URL is NOT re-validated here (callers already pass a
 * scope-checked target); only the redirect targets are checked. Use this for every
 * fetch that touches pod data; the one deliberate exception is the off-pod WebID
 * profile fetch (the configured identity), which uses the raw fetch.
 */
export function scopedFetch(config: { podRoot: string; fetch: typeof fetch }): typeof fetch {
  const root = normalizePodRoot(config.podRoot);
  const wrapped = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    let currentUrl =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    // Preserve the caller's init but force manual redirect handling.
    let currentInit: RequestInit = { ...init, redirect: "manual" };
    for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
      const res = await config.fetch(currentUrl, currentInit);
      // 3xx with a Location → a redirect we must vet before following.
      const isRedirect = res.status >= 300 && res.status < 400 && res.headers.has("location");
      if (!isRedirect) {
        return res;
      }
      const location = res.headers.get("location") ?? "";
      let nextUrl: string;
      try {
        nextUrl = new URL(location, currentUrl).toString();
      } catch {
        throw new Error(
          `pod-scope violation: unparseable redirect Location ${JSON.stringify(location)} from ${currentUrl}.`,
        );
      }
      if (!nextUrl.startsWith(root)) {
        throw new Error(
          `pod-scope violation: ${currentUrl} redirected to ${nextUrl}, which is outside the pod ` +
            `root ${root} (redirect-based SSRF guard). The redirect was not followed.`,
        );
      }
      currentUrl = nextUrl;
      // After the first hop, drop a body (a 303/redirect-to-GET); keep method GET
      // for safety on subsequent hops to avoid replaying a write to a new URL.
      currentInit = { ...currentInit, method: "GET", body: undefined, redirect: "manual" };
    }
    throw new Error(`too many redirects (>${MAX_REDIRECT_HOPS}) for a pod-scoped fetch.`);
  };
  return wrapped as typeof fetch;
}

/** True when writes are enabled (the caller explicitly opted out of read-only). */
export function writesEnabled(config: SolidMcpConfig): boolean {
  return config.readOnly === false;
}
